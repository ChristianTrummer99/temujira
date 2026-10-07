import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { hasScope } from "../access";
import { users, userWorkspaces } from "../db/schema";
import { forbidden, notFound, validationError } from "../errors";
import { userToApi, type UserRow } from "../serialize";
import { newId, now } from "../util";
import { readUpload } from "./attachmentsRoutes";
import { currentUser, type AppContext, type Handlers } from "./types";

/** Trust the file signature, not the supplied name or MIME type. No SVG/HTML avatars. */
function imageMime(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export function avatarsHandlers(ctx: AppContext): Pick<Handlers, "avatars.get" | "avatars.upload" | "avatars.delete"> {
  const requireUser = (id: string) => {
    const user = ctx.db.select().from(users).where(eq(users.id, id)).get();
    if (!user) throw notFound("user");
    return user;
  };
  const canEdit = (actor: UserRow, target: UserRow) => {
    if (actor.id === target.id) return;
    if (!hasScope(actor, "users:manage")) throw forbidden("only the user or a user manager can change this picture");
    if (actor.role !== "admin" && target.role === "admin") throw forbidden("only admins can modify admin accounts");
  };
  const serialize = (user: UserRow) => userToApi(user, ctx.db.select({ id: userWorkspaces.workspaceId })
    .from(userWorkspaces).where(eq(userWorkspaces.userId, user.id)).all().map((w) => w.id));
  return {
    "avatars.get": (c) => {
      const user = requireUser(c.req.param("id") ?? "");
      if (!user.avatarId || !user.avatarMimeType || !ctx.storage.exists(user.avatarId)) throw notFound("profile picture");
      const stream = Readable.toWeb(ctx.storage.stream(user.avatarId)) as unknown as ReadableStream;
      return new Response(stream, { headers: {
        "Content-Type": user.avatarMimeType,
        "Content-Length": String(ctx.storage.size(user.avatarId)),
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
        "Cache-Control": "private, no-cache",
      } });
    },
    "avatars.upload": async (c) => {
      const id = c.req.param("id") ?? "";
      const actor = currentUser(c);
      canEdit(actor, requireUser(id));
      const file = await readUpload(c, ctx, 2 * 1024 * 1024);
      const avatarId = newId();
      let user: UserRow;
      let previousAvatar: string | null = null;
      try {
        const mime = imageMime(readFileSync(ctx.storage.path(file.tmpId)));
        if (!mime) throw validationError("choose a PNG, JPEG, GIF, or WebP picture up to 2 MB");
        // Reload after the streamed upload: another request may have replaced the picture.
        const before = requireUser(id);
        canEdit(actor, before);
        ctx.storage.commit(file.tmpId, avatarId);
        user = ctx.db.update(users).set({ avatarId, avatarMimeType: mime, updatedAt: now() })
          .where(eq(users.id, id)).returning().get()!;
        previousAvatar = before.avatarId;
      } catch (error) {
        ctx.storage.abort(file.tmpId);
        ctx.storage.delete(avatarId);
        throw error;
      }
      if (previousAvatar) ctx.storage.delete(previousAvatar);
      return c.json({ user: serialize(user) });
    },
    "avatars.delete": (c) => {
      const before = requireUser(c.req.param("id") ?? "");
      canEdit(currentUser(c), before);
      if (!before.avatarId) return c.json({ user: serialize(before) });
      const user = ctx.db.update(users).set({ avatarId: null, avatarMimeType: null, updatedAt: now() })
        .where(eq(users.id, before.id)).returning().get()!;
      ctx.storage.delete(before.avatarId);
      return c.json({ user: serialize(user) });
    },
  };
}
