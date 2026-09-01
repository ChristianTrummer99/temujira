import { Readable } from "node:stream";
import busboy from "busboy";
import { eq } from "drizzle-orm";
import { attachments, comments } from "../db/schema";
import { HttpError, forbidden, notFound, validationError } from "../errors";
import { attachmentToApi, type AttachmentRow } from "../serialize";
import { newId, now } from "../util";
import { requireTask } from "./resolve";
import { currentUser, type AppContext, type Ctx, type Handlers } from "./types";

/** Content-Length preflight tolerance over the byte cap (multipart framing overhead). */
const PREFLIGHT_SLACK = 1024 * 1024;

interface UploadedFile {
  tmpId: string;
  size: number;
  sha256: string;
  filename: string;
  mimeType: string;
}

/** Basename only, control chars stripped, capped at 255 chars, fallback "file". */
export function sanitizeFilename(name: string | undefined): string {
  if (!name) return "file";
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return "file";
  return cleaned.slice(0, 255);
}

/** ASCII fallback + RFC 5987 filename*=UTF-8''... encoding. */
function contentDisposition(type: "inline" | "attachment", filename: string): string {
  const fallback = filename.replace(/[^\u0020-\u007e]/g, "_").replace(/["\\]/g, "_") || "file";
  const encoded = encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * Parse a multipart/form-data request with a single `file` field, streaming the bytes
 * into storage (which enforces the byte cap mid-stream, hashes, and counts size).
 */
async function readUpload(c: Ctx, ctx: AppContext): Promise<UploadedFile> {
  const maxBytes = ctx.config.maxUploadMb * 1024 * 1024;
  const declared = c.req.header("content-length");
  if (declared !== undefined && Number(declared) > maxBytes + PREFLIGHT_SLACK) {
    throw new HttpError("payload_too_large", `file exceeds the ${ctx.config.maxUploadMb}MB upload limit`);
  }
  const contentType = c.req.header("content-type") ?? "";
  if (!/^multipart\/form-data/i.test(contentType)) {
    throw validationError("expected multipart/form-data with a single `file` field");
  }
  const rawBody = c.req.raw.body;
  if (!rawBody) throw validationError("request has no body");
  let bb: busboy.Busboy;
  try {
    // defParamCharset utf8: browsers send raw UTF-8 filenames (busboy defaults to latin1).
    bb = busboy({ headers: { "content-type": contentType }, limits: { files: 1 }, defParamCharset: "utf8" });
  } catch {
    throw validationError("malformed multipart/form-data request");
  }
  const nodeStream = Readable.fromWeb(rawBody as never);
  return await new Promise<UploadedFile>((resolve, reject) => {
    let seenFile = false;
    bb.on("file", (fieldname, file, info) => {
      if (seenFile || fieldname !== "file") {
        file.resume();
        return;
      }
      seenFile = true;
      ctx.storage
        .putStream(file)
        .then((stored) =>
          resolve({
            ...stored,
            filename: sanitizeFilename(info.filename),
            mimeType: info.mimeType || "application/octet-stream",
          }),
        )
        .catch(reject);
    });
    bb.on("close", () => {
      if (!seenFile) reject(validationError("multipart field `file` is required"));
    });
    bb.on("error", (err) => reject(err instanceof HttpError ? err : validationError("malformed multipart body")));
    nodeStream.on("error", reject);
    nodeStream.pipe(bb);
  });
}

/** Insert the attachment row, then move the temp bytes into place (crash-consistent). */
function storeUpload(
  ctx: AppContext,
  file: UploadedFile,
  parent: { taskId: string | null; commentId: string | null },
  uploaderId: string,
): AttachmentRow {
  const row: AttachmentRow = {
    id: newId(),
    taskId: parent.taskId,
    commentId: parent.commentId,
    uploaderId,
    filename: file.filename,
    mimeType: file.mimeType,
    size: file.size,
    sha256: file.sha256,
    createdAt: now(),
  };
  try {
    ctx.db.insert(attachments).values(row).run();
  } catch (err) {
    ctx.storage.abort(file.tmpId);
    throw err;
  }
  try {
    ctx.storage.commit(file.tmpId, row.id);
  } catch (err) {
    ctx.db.delete(attachments).where(eq(attachments.id, row.id)).run();
    ctx.storage.abort(file.tmpId);
    throw err;
  }
  return row;
}

function requireAttachment(ctx: AppContext, id: string): AttachmentRow {
  const row = ctx.db.select().from(attachments).where(eq(attachments.id, id)).get();
  if (!row) throw notFound("attachment");
  return row;
}

export function attachmentsHandlers(
  ctx: AppContext,
): Pick<
  Handlers,
  | "attachments.uploadToTask"
  | "attachments.uploadToComment"
  | "attachments.get"
  | "attachments.download"
  | "attachments.delete"
> {
  return {
    "attachments.uploadToTask": async (c) => {
      const user = currentUser(c);
      const { task } = requireTask(ctx.db, c.req.param("idOrKey") ?? "");
      const file = await readUpload(c, ctx);
      const row = storeUpload(ctx, file, { taskId: task.id, commentId: null }, user.id);
      return c.json({ attachment: attachmentToApi(row) });
    },

    "attachments.uploadToComment": async (c) => {
      const user = currentUser(c);
      const id = c.req.param("id") ?? "";
      const comment = ctx.db.select().from(comments).where(eq(comments.id, id)).get();
      if (!comment) throw notFound("comment");
      const file = await readUpload(c, ctx);
      const row = storeUpload(ctx, file, { taskId: null, commentId: comment.id }, user.id);
      return c.json({ attachment: attachmentToApi(row) });
    },

    "attachments.get": (c) => {
      const row = requireAttachment(ctx, c.req.param("id") ?? "");
      return c.json({ attachment: attachmentToApi(row) });
    },

    "attachments.download": (c) => {
      const row = requireAttachment(ctx, c.req.param("id") ?? "");
      if (!ctx.storage.exists(row.id)) {
        console.error(`[temujira] attachment ${row.id} has a DB row but no file on disk`);
        throw notFound("attachment file");
      }
      const bareMime = (row.mimeType.split(";")[0] ?? "").trim().toLowerCase();
      // Inline safelist: image/* except SVG, plus PDF. Everything else downloads as an
      // opaque octet-stream so uploaded HTML/SVG can never script on this origin.
      const inline = (bareMime.startsWith("image/") && bareMime !== "image/svg+xml") || bareMime === "application/pdf";
      const headers = new Headers({
        "X-Content-Type-Options": "nosniff",
        "Content-Length": String(row.size),
        "Content-Type": inline ? row.mimeType : "application/octet-stream",
        "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", row.filename),
      });
      const stream = Readable.toWeb(ctx.storage.stream(row.id)) as unknown as ReadableStream;
      return new Response(stream, { status: 200, headers });
    },

    "attachments.delete": (c) => {
      const user = currentUser(c);
      const row = requireAttachment(ctx, c.req.param("id") ?? "");
      if (row.uploaderId !== user.id && user.role !== "admin") {
        throw forbidden("only the uploader or an admin can delete this attachment");
      }
      // Row first; bytes after — the startup sweep collects any unlink that fails.
      ctx.db.delete(attachments).where(eq(attachments.id, row.id)).run();
      ctx.storage.delete(row.id);
      return c.json({ ok: true as const });
    },
  };
}
