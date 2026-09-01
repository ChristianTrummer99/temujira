import { createHash } from "node:crypto";
import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sanitizeFilename } from "../src/routes/attachmentsRoutes";
import {
  bearer,
  fileUpload,
  jsonReq,
  makeMember,
  makeTask,
  makeTestApp,
  makeWorkspace,
  setupAdmin,
  type TaskJson,
} from "./helpers";

let t: Awaited<ReturnType<typeof makeTestApp>>;
let admin: { token: string; userId: string };
let member: { userId: string; token: string };
let task: TaskJson;
let uploadsDir: string;

interface AttachmentJson {
  id: string;
  task_id: string | null;
  comment_id: string | null;
  uploader_id: string;
  filename: string;
  mime_type: string;
  size: number;
  sha256: string;
}

// A tiny real PNG (1x1 transparent pixel) so we round-trip actual binary bytes.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const uploadToTask = async (
  token: string,
  bytes: string | Uint8Array<ArrayBuffer>,
  filename: string,
  type: string,
): Promise<AttachmentJson> => {
  const res = await t.app.request(`/api/v1/tasks/${task.id}/attachments`, fileUpload(bytes, filename, type, bearer(token)));
  expect(res.status).toBe(200);
  return ((await res.json()) as { attachment: AttachmentJson }).attachment;
};

beforeAll(async () => {
  t = await makeTestApp(); // maxUploadMb: 5
  admin = await setupAdmin(t.app);
  member = await makeMember(t.app, admin.token);
  const ws = await makeWorkspace(t.app, admin.token, "ATT");
  task = await makeTask(t.app, admin.token, ws.id, { title: "Has files" });
  uploadsDir = join(t.ctx.config.dataDir, "uploads");
});
afterAll(() => t.cleanup());

describe("upload", () => {
  it("uploads a PNG to a task: metadata, sha256, bytes on disk, embedded on tasks.get", async () => {
    const att = await uploadToTask(admin.token, new Uint8Array(PNG_BYTES), "pixel.png", "image/png");
    expect(att.task_id).toBe(task.id);
    expect(att.comment_id).toBeNull();
    expect(att.uploader_id).toBe(admin.userId);
    expect(att.filename).toBe("pixel.png");
    expect(att.mime_type).toBe("image/png");
    expect(att.size).toBe(PNG_BYTES.length);
    expect(att.sha256).toBe(createHash("sha256").update(PNG_BYTES).digest("hex"));
    expect(existsSync(join(uploadsDir, att.id))).toBe(true);

    const got = await t.app.request(`/api/v1/tasks/${task.id}`, { headers: bearer(admin.token) });
    const embedded = ((await got.json()) as { task: TaskJson }).task;
    expect(embedded.attachments!.some((a) => a.id === att.id)).toBe(true);
  });

  it("uploads to a comment (task key parent resolution also works)", async () => {
    const commentRes = await t.app.request(
      `/api/v1/tasks/${task.key}/comments`,
      jsonReq("POST", { body: "with file" }, bearer(member.token)),
    );
    const { comment } = (await commentRes.json()) as { comment: { id: string } };
    const res = await t.app.request(
      `/api/v1/comments/${comment.id}/attachments`,
      fileUpload("hello comment", "note.txt", "text/plain", bearer(member.token)),
    );
    expect(res.status).toBe(200);
    const { attachment } = (await res.json()) as { attachment: AttachmentJson };
    expect(attachment.comment_id).toBe(comment.id);
    expect(attachment.task_id).toBeNull();

    const list = await t.app.request(`/api/v1/tasks/${task.id}/comments`, { headers: bearer(member.token) });
    const { items } = (await list.json()) as { items: Array<{ id: string; attachments: Array<{ id: string }> }> };
    expect(items.find((c) => c.id === comment.id)!.attachments.some((a) => a.id === attachment.id)).toBe(true);
  });

  it("404s for a missing parent task or comment", async () => {
    const noTask = await t.app.request(
      "/api/v1/tasks/ZZ-1/attachments",
      fileUpload("x", "x.txt", "text/plain", bearer(admin.token)),
    );
    expect(noTask.status).toBe(404);
    const noComment = await t.app.request(
      "/api/v1/comments/01ARZ3NDEKTSV4RRFFQ69G5FAV/attachments",
      fileUpload("x", "x.txt", "text/plain", bearer(admin.token)),
    );
    expect(noComment.status).toBe(404);
  });

  it("rejects a request without a `file` field or without multipart (validation_error)", async () => {
    const fd = new FormData();
    fd.append("other", new File(["x"], "x.txt", { type: "text/plain" }));
    const wrongField = await t.app.request(`/api/v1/tasks/${task.id}/attachments`, {
      method: "POST",
      body: fd,
      headers: bearer(admin.token),
    });
    expect(wrongField.status).toBe(400);

    const notMultipart = await t.app.request(
      `/api/v1/tasks/${task.id}/attachments`,
      jsonReq("POST", { file: "nope" }, bearer(admin.token)),
    );
    expect(notMultipart.status).toBe(400);
  });

  it("sanitizes filenames on upload: basename only, 255 cap, fallback", async () => {
    const traversal = await uploadToTask(admin.token, "x", "../../../etc/passwd", "text/plain");
    expect(traversal.filename).toBe("passwd");

    const long = await uploadToTask(admin.token, "x", `${"a".repeat(300)}.txt`, "text/plain");
    expect(long.filename.length).toBe(255);

    const dots = await uploadToTask(admin.token, "x", "..", "text/plain");
    expect(dots.filename).toBe("file");
  });

  it("sanitizeFilename strips control chars and handles edge cases (unit)", () => {
    // Raw control chars in a multipart part header are rejected by busboy itself
    // ("Malformed part header"), so the strip branch is exercised directly here as
    // defense-in-depth.
    expect(sanitizeFilename("we\u0001ird\u0007.txt")).toBe("weird.txt");
    expect(sanitizeFilename("tab\ttab.txt")).toBe("tabtab.txt");
    expect(sanitizeFilename("C:\\Users\\evil\\shell.exe")).toBe("shell.exe");
    expect(sanitizeFilename(undefined)).toBe("file");
    expect(sanitizeFilename("")).toBe("file");
    expect(sanitizeFilename(".")).toBe("file");
    expect(sanitizeFilename("a/b/c.png")).toBe("c.png");
  });

  it("413s an oversized upload mid-stream and leaves no orphan files", async () => {
    const before = readdirSync(uploadsDir).sort();
    const big = new Uint8Array(6 * 1024 * 1024); // cap is 5MB
    const res = await t.app.request(
      `/api/v1/tasks/${task.id}/attachments`,
      fileUpload(big, "big.bin", "application/octet-stream", bearer(admin.token)),
    );
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("payload_too_large");

    const after = readdirSync(uploadsDir).sort();
    expect(after).toEqual(before); // no new files, no .tmp-* leftovers
    expect(after.some((f) => f.startsWith(".tmp-"))).toBe(false);

    // Subsequent uploads still work.
    const ok = await uploadToTask(admin.token, "still fine", "ok.txt", "text/plain");
    expect(ok.size).toBe(10);
  });

  it("413s immediately on a Content-Length preflight far over the cap", async () => {
    const res = await t.app.request(`/api/v1/tasks/${task.id}/attachments`, {
      method: "POST",
      body: "tiny",
      headers: {
        ...bearer(admin.token),
        "content-type": "multipart/form-data; boundary=x",
        "content-length": String(7 * 1024 * 1024), // 5MB cap + 1MB slack < 7MB
      },
    });
    expect(res.status).toBe(413);
  });
});

describe("download", () => {
  it("round-trips bytes with inline disposition for a PNG", async () => {
    const att = await uploadToTask(admin.token, new Uint8Array(PNG_BYTES), "photo.png", "image/png");
    const res = await t.app.request(`/api/v1/attachments/${att.id}/download`, { headers: bearer(admin.token) });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-length")).toBe(String(PNG_BYTES.length));
    expect(res.headers.get("content-disposition")).toBe(`inline; filename="photo.png"; filename*=UTF-8''photo.png`);

    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(PNG_BYTES)).toBe(true);
    expect(createHash("sha256").update(body).digest("hex")).toBe(att.sha256);
  });

  it("serves an uploaded .html file as an attachment octet-stream (stored-XSS hardening)", async () => {
    const html = "<script>alert('xss')</script>";
    const att = await uploadToTask(admin.token, html, "evil.html", "text/html");
    const res = await t.app.request(`/api/v1/attachments/${att.id}/download`, { headers: bearer(admin.token) });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="evil.html"; filename*=UTF-8''evil.html`,
    );
    expect(await res.text()).toBe(html);
  });

  it("keeps SVG out of the inline safelist but lets PDF in", async () => {
    const svg = await uploadToTask(admin.token, "<svg/>", "img.svg", "image/svg+xml");
    const svgRes = await t.app.request(`/api/v1/attachments/${svg.id}/download`, { headers: bearer(admin.token) });
    expect(svgRes.headers.get("content-disposition")).toContain("attachment;");
    expect(svgRes.headers.get("content-type")).toBe("application/octet-stream");

    const pdf = await uploadToTask(admin.token, "%PDF-1.4", "doc.pdf", "application/pdf");
    const pdfRes = await t.app.request(`/api/v1/attachments/${pdf.id}/download`, { headers: bearer(admin.token) });
    expect(pdfRes.headers.get("content-disposition")).toContain("inline;");
    expect(pdfRes.headers.get("content-type")).toBe("application/pdf");
  });

  it("encodes non-ASCII filenames per RFC 5987 with an ASCII fallback", async () => {
    const att = await uploadToTask(admin.token, "data", "ünïcode döc.txt", "text/plain");
    const res = await t.app.request(`/api/v1/attachments/${att.id}/download`, { headers: bearer(admin.token) });
    const cd = res.headers.get("content-disposition")!;
    expect(cd.startsWith("attachment; filename=\"")).toBe(true);
    expect(cd).toContain("filename*=UTF-8''%C3%BCn%C3%AFcode%20d%C3%B6c.txt");
    // ASCII fallback contains no raw non-ASCII bytes.
    expect(/^[ -~]*$/.test(cd)).toBe(true);
  });

  it("404s when the DB row exists but the file is missing on disk", async () => {
    const att = await uploadToTask(admin.token, "vanishing", "gone.txt", "text/plain");
    unlinkSync(join(uploadsDir, att.id));
    const res = await t.app.request(`/api/v1/attachments/${att.id}/download`, { headers: bearer(admin.token) });
    expect(res.status).toBe(404);
    // Metadata row still exists.
    const meta = await t.app.request(`/api/v1/attachments/${att.id}`, { headers: bearer(admin.token) });
    expect(meta.status).toBe(200);
  });
});

describe("get + delete", () => {
  it("returns metadata and 404s for unknown ids", async () => {
    const att = await uploadToTask(member.token, "meta", "meta.txt", "text/plain");
    const res = await t.app.request(`/api/v1/attachments/${att.id}`, { headers: bearer(admin.token) });
    expect(res.status).toBe(200);
    const { attachment } = (await res.json()) as { attachment: AttachmentJson };
    expect(attachment.uploader_id).toBe(member.userId);
    expect(attachment.sha256).toBe(att.sha256);

    const missing = await t.app.request("/api/v1/attachments/01ARZ3NDEKTSV4RRFFQ69G5FAV", {
      headers: bearer(admin.token),
    });
    expect(missing.status).toBe(404);
  });

  it("only the uploader or an admin can delete; bytes are removed", async () => {
    const att = await uploadToTask(member.token, "mine", "mine.txt", "text/plain");
    const otherMember = await makeMember(t.app, admin.token);

    const forbidden = await t.app.request(`/api/v1/attachments/${att.id}`, {
      method: "DELETE",
      headers: bearer(otherMember.token),
    });
    expect(forbidden.status).toBe(403);

    const ok = await t.app.request(`/api/v1/attachments/${att.id}`, {
      method: "DELETE",
      headers: bearer(member.token),
    });
    expect(ok.status).toBe(200);
    expect(existsSync(join(uploadsDir, att.id))).toBe(false);
    expect((await t.app.request(`/api/v1/attachments/${att.id}`, { headers: bearer(admin.token) })).status).toBe(404);

    // Admin may delete someone else's attachment.
    const att2 = await uploadToTask(member.token, "admin removes", "adm.txt", "text/plain");
    const byAdmin = await t.app.request(`/api/v1/attachments/${att2.id}`, {
      method: "DELETE",
      headers: bearer(admin.token),
    });
    expect(byAdmin.status).toBe(200);
  });
});
