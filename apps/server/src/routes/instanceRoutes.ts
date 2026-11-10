import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { MAX_LOGO_BYTES, type UpdateInstanceInput } from "@temujira/shared";
import { forbidden, notFound, validationError } from "../errors";
import { getInstanceLogo, getInstanceSettings, saveInstanceLogo, saveInstanceSettings } from "../instance";
import { newId } from "../util";
import { readUpload } from "./attachmentsRoutes";
import { imageMime } from "./avatarsRoutes";
import { body, currentUser, type AppContext, type Ctx, type Handlers } from "./types";

/** Instance-wide changes are outside any scope or workspace-limited key grant. */
function requireUnrestrictedAdmin(c: Ctx) {
  const user = currentUser(c);
  if (user.keyScopes !== undefined || user.keyWorkspaceIds !== undefined) {
    throw forbidden("unrestricted admin credentials required");
  }
}

export function instanceHandlers(ctx: AppContext): Pick<Handlers,
  "instance.get" | "instance.update" | "instance.getLogo" | "instance.uploadLogo" | "instance.deleteLogo"> {
  const settings = (c: Ctx) => {
    c.header("Cache-Control", "no-store");
    return c.json({ instance: getInstanceSettings(ctx.db) });
  };
  return {
    "instance.get": (c) => settings(c),
    "instance.update": (c) => {
      requireUnrestrictedAdmin(c);
      saveInstanceSettings(ctx.db, body<UpdateInstanceInput>(c));
      return settings(c);
    },
    // Public, like the app name: the sign-in screen and the browser tab icon use it.
    "instance.getLogo": (c) => {
      const logo = getInstanceLogo(ctx.db);
      if (!logo || !ctx.storage.exists(logo.id)) throw notFound("app logo");
      // Each upload gets a new id, so the id is a strong validator for the bytes.
      const headers = { ETag: `"${logo.id}"`, "Cache-Control": "public, no-cache", "X-Content-Type-Options": "nosniff" };
      if (c.req.header("if-none-match")?.split(",").some((tag) => tag.trim() === headers.ETag)) {
        return new Response(null, { status: 304, headers });
      }
      const stream = Readable.toWeb(ctx.storage.stream(logo.id)) as unknown as ReadableStream;
      return new Response(stream, { headers: {
        ...headers,
        "Content-Type": logo.mimeType,
        "Content-Length": String(ctx.storage.size(logo.id)),
        "Content-Disposition": "inline",
      } });
    },
    "instance.uploadLogo": async (c) => {
      requireUnrestrictedAdmin(c);
      const file = await readUpload(c, ctx, MAX_LOGO_BYTES);
      const logoId = newId();
      let previous: string | null;
      try {
        const mimeType = imageMime(readFileSync(ctx.storage.path(file.tmpId)));
        if (!mimeType) throw validationError("choose a PNG, JPEG, GIF, or WebP image up to 2 MB");
        ctx.storage.commit(file.tmpId, logoId);
        previous = saveInstanceLogo(ctx.db, { id: logoId, mimeType });
      } catch (error) {
        ctx.storage.abort(file.tmpId);
        ctx.storage.delete(logoId);
        throw error;
      }
      if (previous) ctx.storage.delete(previous);
      return settings(c);
    },
    "instance.deleteLogo": (c) => {
      requireUnrestrictedAdmin(c);
      if (getInstanceSettings(ctx.db).logo_id) {
        const previous = saveInstanceLogo(ctx.db, null);
        if (previous) ctx.storage.delete(previous);
      }
      return settings(c);
    },
  };
}
