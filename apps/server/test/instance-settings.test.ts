import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { SCOPE_IDS, type InstanceSettings } from "@temujira/shared";
import { buildApp } from "../src/app";
import { bearer, fileUpload, jsonReq, makeMember, makeTestApp, setupAdmin } from "./helpers";

let t: Awaited<ReturnType<typeof makeTestApp>>;
beforeEach(async () => { t = await makeTestApp(); });
afterEach(() => t?.cleanup());
const get = () => t.app.request("/api/v1/instance");
const update = (display_name: unknown, token: string) => t.app.request("/api/v1/instance", jsonReq("PATCH", { display_name }, bearer(token)));

describe("instance branding", () => {
  it("exposes only the public display name and logo id, including before setup", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ instance: { display_name: "Temujira", logo_id: null } });
    expect((await t.app.request("/api/v1/instance", jsonReq("PATCH", { display_name: "Other" }))).status).toBe(401);
  });

  it("lets an admin rename the app, persists the name, and permits a reset", async () => {
    const admin = await setupAdmin(t.app);
    expect((await update("  Acme & Partners  ", admin.token)).status).toBe(200);
    expect(await (await get()).json()).toEqual({ instance: { display_name: "Acme & Partners", logo_id: null } });
    const restarted = await buildApp(t.ctx.config);
    try {
      expect(await (await restarted.app.request("/api/v1/instance")).json()).toEqual({ instance: { display_name: "Acme & Partners", logo_id: null } });
      const doc = await (await restarted.app.request("/api/v1/openapi.json")).json() as { info: { title: string } };
      expect(doc.info.title).toBe("Acme & Partners API");
    } finally { restarted.ctx.sqlite.close(); }
    expect((await update("Temujira", admin.token)).status).toBe(200);
    expect(await (await get()).json()).toEqual({ instance: { display_name: "Temujira", logo_id: null } });
  });

  it("sets the name during setup and does not allow setup to rename an existing installation", async () => {
    const input = { email: "admin@example.com", name: "Admin", password: "synthetic-password", display_name: "Company Tasks" };
    const setup = await t.app.request("/api/v1/setup", jsonReq("POST", input));
    expect(setup.status).toBe(200);
    expect(await (await get()).json()).toEqual({ instance: { display_name: input.display_name, logo_id: null } });
    expect((await t.app.request("/api/v1/setup", jsonReq("POST", { ...input, display_name: "Other" }))).status).toBe(403);
    expect(await (await get()).json()).toEqual({ instance: { display_name: input.display_name, logo_id: null } });
    const welcome = t.ctx.sqlite.prepare("SELECT title, description FROM tasks").get() as { title: string; description: string };
    expect(welcome.title + welcome.description).not.toMatch(/temujira/i);
  });

  it("denies members even when they hold every scope and writes no audit event", async () => {
    const admin = await setupAdmin(t.app);
    const member = await makeMember(t.app, admin.token, { scopes: [...SCOPE_IDS] });
    expect((await update("Other", member.token)).status).toBe(403);
    expect(await (await get()).json()).toEqual({ instance: { display_name: "Temujira", logo_id: null } });
    expect(t.ctx.sqlite.prepare("SELECT id FROM activity_events WHERE action='instance.updated'").all()).toEqual([]);
  });

  it("denies scope-limited and workspace-limited admin keys but accepts an unrestricted admin key", async () => {
    const admin = await setupAdmin(t.app);
    for (const limits of [{ scopes: [] }, { workspace_ids: [] }, { scopes: [...SCOPE_IDS] }, {}]) {
      const response = await t.app.request("/api/v1/api-keys", jsonReq("POST", { name: "Branding key", ...limits }, bearer(admin.token)));
      expect(response.status).toBe(200);
      const key = await response.json() as { token: string };
      expect((await update("Company Tasks", key.token)).status).toBe(Object.keys(limits).length ? 403 : 200);
    }
  });

  it("records the old and new names in admin-only audit history", async () => {
    const admin = await setupAdmin(t.app);
    await update("Company Tasks", admin.token);
    const row = t.ctx.sqlite.prepare("SELECT visibility, metadata FROM activity_events WHERE action='instance.updated'").get() as { visibility: string; metadata: string };
    expect(row.visibility).toBe("admin");
    expect(JSON.parse(row.metadata).changes).toEqual([{ field: "display_name", from: "Temujira", to: "Company Tasks" }]);
  });

  it.each(["", "   ", "x".repeat(81), "Name\nLine", "Name\u0000", "Name\u202e", null, 42])("rejects an invalid display name (%j)", async (name) => {
    const admin = await setupAdmin(t.app);
    expect((await update(name, admin.token)).status).toBe(400);
    expect(await (await get()).json()).toEqual({ instance: { display_name: "Temujira", logo_id: null } });
  });

  it("rejects an invalid setup name before creating any users", async () => {
    const response = await t.app.request("/api/v1/setup", jsonReq("POST", { email: "admin@example.com", name: "Admin", password: "synthetic-password", display_name: " " }));
    expect(response.status).toBe(400);
    expect(await (await t.app.request("/api/v1/setup")).json()).toEqual({ needsSetup: true });
  });
});

describe("instance logo", () => {
  const PNG = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJQAAAABJRU5ErkJggg==", "base64"));
  const GIF = new Uint8Array(Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;", "latin1"));
  const logo = (headers: Record<string, string> = {}) => t.app.request("/api/v1/instance/logo", { headers });
  const uploadLogo = (token: string, bytes: Uint8Array<ArrayBuffer> = PNG, mime = "image/png") =>
    t.app.request("/api/v1/instance/logo", fileUpload(bytes, "logo.png", mime, bearer(token)));
  const removeLogo = (token: string) => t.app.request("/api/v1/instance/logo", { method: "DELETE", headers: bearer(token) });
  const instanceOf = async (response: Response | Promise<Response>) => ((await (await response).json()) as { instance: InstanceSettings }).instance;

  it("lets an admin set a public logo, replace it, keep it after a restart, and remove it", async () => {
    const admin = await setupAdmin(t.app);
    expect((await logo()).status).toBe(404);
    const first = await instanceOf(uploadLogo(admin.token));
    expect(first).toEqual({ display_name: "Temujira", logo_id: expect.any(String) });
    expect(await instanceOf(get())).toEqual(first);
    // Public, like the app name: the sign-in screen and the browser tab icon use it.
    const image = await logo();
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(image.headers.get("x-content-type-options")).toBe("nosniff");
    expect(image.headers.get("etag")).toBe(`"${first.logo_id}"`);
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(PNG);
    expect((await logo({ "If-None-Match": `"${first.logo_id}"` })).status).toBe(304);

    // The file signature decides the type, not the supplied MIME type.
    const second = await instanceOf(uploadLogo(admin.token, GIF, "image/png"));
    expect(second.logo_id).not.toBe(first.logo_id);
    expect(t.ctx.storage.exists(first.logo_id!)).toBe(false);
    const replaced = await logo({ "If-None-Match": `"${first.logo_id}"` });
    expect(replaced.status).toBe(200);
    expect(replaced.headers.get("content-type")).toBe("image/gif");

    const restarted = await buildApp(t.ctx.config);
    try {
      expect(restarted.ctx.storage.exists(second.logo_id!)).toBe(true);
      expect((await restarted.app.request("/api/v1/instance/logo")).status).toBe(200);
    } finally { restarted.ctx.sqlite.close(); }

    expect(await instanceOf(removeLogo(admin.token))).toEqual({ display_name: "Temujira", logo_id: null });
    expect(t.ctx.storage.exists(second.logo_id!)).toBe(false);
    expect((await logo()).status).toBe(404);
    expect((await removeLogo(admin.token)).status).toBe(200);
  });

  it("keeps the app name when the logo changes, and the logo when the name changes", async () => {
    const admin = await setupAdmin(t.app);
    await update("Company Tasks", admin.token);
    const { logo_id } = await instanceOf(uploadLogo(admin.token));
    expect(await instanceOf(get())).toEqual({ display_name: "Company Tasks", logo_id });
    await update("Other Tasks", admin.token);
    expect(await instanceOf(get())).toEqual({ display_name: "Other Tasks", logo_id });
  });

  it("denies anonymous callers, members with every scope, and limited admin keys", async () => {
    const admin = await setupAdmin(t.app);
    const member = await makeMember(t.app, admin.token, { scopes: [...SCOPE_IDS] });
    expect((await t.app.request("/api/v1/instance/logo", fileUpload(PNG, "logo.png", "image/png"))).status).toBe(401);
    expect((await t.app.request("/api/v1/instance/logo", { method: "DELETE" })).status).toBe(401);
    expect((await uploadLogo(member.token)).status).toBe(403);
    expect((await removeLogo(member.token)).status).toBe(403);
    for (const limits of [{ scopes: [...SCOPE_IDS] }, { workspace_ids: [] }, {}]) {
      const response = await t.app.request("/api/v1/api-keys", jsonReq("POST", { name: "Logo key", ...limits }, bearer(admin.token)));
      const key = await response.json() as { token: string };
      const expected = Object.keys(limits).length ? 403 : 200;
      expect((await uploadLogo(key.token)).status).toBe(expected);
      expect((await removeLogo(key.token)).status).toBe(expected);
    }
    expect(t.ctx.sqlite.prepare("SELECT id FROM activity_events WHERE action LIKE 'instance.logo%' AND actor_id=?").all(member.userId)).toEqual([]);
  });

  it("rejects unsafe and oversized images without losing the current logo or leaving temporary files", async () => {
    const admin = await setupAdmin(t.app);
    const { logo_id } = await instanceOf(uploadLogo(admin.token));
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
    expect((await uploadLogo(admin.token, svg, "image/svg+xml")).status).toBe(400);
    expect((await uploadLogo(admin.token, new TextEncoder().encode("<html><script>alert(1)</script></html>"), "image/gif")).status).toBe(400);
    expect((await uploadLogo(admin.token, new Uint8Array(2 * 1024 * 1024 + 1))).status).toBe(413);
    expect((await instanceOf(get())).logo_id).toBe(logo_id);
    expect(t.ctx.storage.exists(logo_id!)).toBe(true);
    expect(readdirSync(t.ctx.storage.path(".")).filter((name) => name.startsWith(".tmp-"))).toEqual([]);
  });

  it("records logo changes in admin-only history", async () => {
    const admin = await setupAdmin(t.app);
    const { logo_id } = await instanceOf(uploadLogo(admin.token));
    await removeLogo(admin.token);
    const event = (action: string) => t.ctx.sqlite.prepare("SELECT visibility, metadata FROM activity_events WHERE action=?").get(action) as { visibility: string; metadata: string };
    expect(event("instance.logo_updated").visibility).toBe("admin");
    expect(JSON.parse(event("instance.logo_updated").metadata).changes).toEqual([{ field: "logo_id", from: null, to: logo_id }]);
    expect(event("instance.logo_removed").visibility).toBe("admin");
    expect(JSON.parse(event("instance.logo_removed").metadata).changes).toEqual([{ field: "logo_id", from: logo_id, to: null }]);
  });
});
