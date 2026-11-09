import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SCOPE_IDS } from "@temujira/shared";
import { buildApp } from "../src/app";
import { bearer, jsonReq, makeMember, makeTestApp, setupAdmin } from "./helpers";

let t: Awaited<ReturnType<typeof makeTestApp>>;
beforeEach(async () => { t = await makeTestApp(); });
afterEach(() => t?.cleanup());
const get = () => t.app.request("/api/v1/instance");
const update = (display_name: unknown, token: string) => t.app.request("/api/v1/instance", jsonReq("PATCH", { display_name }, bearer(token)));

describe("instance branding", () => {
  it("exposes only the public display name, including before setup", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ instance: { display_name: "Temujira" } });
    expect((await t.app.request("/api/v1/instance", jsonReq("PATCH", { display_name: "Other" }))).status).toBe(401);
  });

  it("lets an admin rename the app, persists the name, and permits a reset", async () => {
    const admin = await setupAdmin(t.app);
    expect((await update("  Acme & Partners  ", admin.token)).status).toBe(200);
    expect(await (await get()).json()).toEqual({ instance: { display_name: "Acme & Partners" } });
    const restarted = await buildApp(t.ctx.config);
    try {
      expect(await (await restarted.app.request("/api/v1/instance")).json()).toEqual({ instance: { display_name: "Acme & Partners" } });
      const doc = await (await restarted.app.request("/api/v1/openapi.json")).json() as { info: { title: string } };
      expect(doc.info.title).toBe("Acme & Partners API");
    } finally { restarted.ctx.sqlite.close(); }
    expect((await update("Temujira", admin.token)).status).toBe(200);
    expect(await (await get()).json()).toEqual({ instance: { display_name: "Temujira" } });
  });

  it("sets the name during setup and does not allow setup to rename an existing installation", async () => {
    const input = { email: "admin@example.com", name: "Admin", password: "synthetic-password", display_name: "Company Tasks" };
    const setup = await t.app.request("/api/v1/setup", jsonReq("POST", input));
    expect(setup.status).toBe(200);
    expect(await (await get()).json()).toEqual({ instance: { display_name: input.display_name } });
    expect((await t.app.request("/api/v1/setup", jsonReq("POST", { ...input, display_name: "Other" }))).status).toBe(403);
    expect(await (await get()).json()).toEqual({ instance: { display_name: input.display_name } });
    const welcome = t.ctx.sqlite.prepare("SELECT title, description FROM tasks").get() as { title: string; description: string };
    expect(welcome.title + welcome.description).not.toMatch(/temujira/i);
  });

  it("denies members even when they hold every scope and writes no audit event", async () => {
    const admin = await setupAdmin(t.app);
    const member = await makeMember(t.app, admin.token, { scopes: [...SCOPE_IDS] });
    expect((await update("Other", member.token)).status).toBe(403);
    expect(await (await get()).json()).toEqual({ instance: { display_name: "Temujira" } });
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
    expect(await (await get()).json()).toEqual({ instance: { display_name: "Temujira" } });
  });

  it("rejects an invalid setup name before creating any users", async () => {
    const response = await t.app.request("/api/v1/setup", jsonReq("POST", { email: "admin@example.com", name: "Admin", password: "synthetic-password", display_name: " " }));
    expect(response.status).toBe(400);
    expect(await (await t.app.request("/api/v1/setup")).json()).toEqual({ needsSetup: true });
  });
});
