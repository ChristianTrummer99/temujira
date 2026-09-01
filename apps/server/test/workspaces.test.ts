import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, jsonReq, makeMember, makeTestApp, makeWorkspace, setupAdmin, type WorkspaceJson } from "./helpers";

let t: Awaited<ReturnType<typeof makeTestApp>>;
let admin: { token: string; userId: string };
let member: { token: string; userId: string };

beforeAll(async () => {
  t = await makeTestApp();
  admin = await setupAdmin(t.app);
  member = await makeMember(t.app, admin.token);
});
afterAll(() => t.cleanup());

describe("workspaces.create", () => {
  it("lets any member create a workspace and seeds the 3 default statuses", async () => {
    const ws = await makeWorkspace(t.app, member.token, "ENG", "Engineering");
    expect(ws.key).toBe("ENG");
    expect(ws.name).toBe("Engineering");
    expect(ws.archived_at).toBeNull();

    const statuses = await t.app.request(`/api/v1/workspaces/${ws.id}/statuses`, { headers: bearer(member.token) });
    expect(statuses.status).toBe(200);
    const { items } = (await statuses.json()) as { items: Array<{ name: string; position: number; color: string }> };
    expect(items.map((s) => s.name)).toEqual(["Backlog", "In Progress", "Done"]);
    expect(items.map((s) => s.position)).toEqual([0, 1, 2]);
  });

  it("409s on a duplicate key", async () => {
    const res = await t.app.request(
      "/api/v1/workspaces",
      jsonReq("POST", { name: "Other", key: "ENG" }, bearer(admin.token)),
    );
    expect(res.status).toBe(409);
  });

  it("rejects malformed keys (validation)", async () => {
    for (const key of ["eng", "E", "TOOLONGKEY", "1AB", "EN-G"]) {
      const res = await t.app.request(
        "/api/v1/workspaces",
        jsonReq("POST", { name: "Bad", key }, bearer(admin.token)),
      );
      expect(res.status, `key ${key}`).toBe(400);
    }
  });
});

describe("workspaces.get", () => {
  it("resolves by ULID and by key; 404s otherwise", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "RES");

    const byId = await t.app.request(`/api/v1/workspaces/${ws.id}`, { headers: bearer(admin.token) });
    expect(byId.status).toBe(200);
    expect(((await byId.json()) as { workspace: WorkspaceJson }).workspace.id).toBe(ws.id);

    const byKey = await t.app.request("/api/v1/workspaces/RES", { headers: bearer(admin.token) });
    expect(byKey.status).toBe(200);
    expect(((await byKey.json()) as { workspace: WorkspaceJson }).workspace.id).toBe(ws.id);

    expect((await t.app.request("/api/v1/workspaces/NOPE", { headers: bearer(admin.token) })).status).toBe(404);
    expect((await t.app.request("/api/v1/workspaces/notakey", { headers: bearer(admin.token) })).status).toBe(404);
    expect(
      (await t.app.request("/api/v1/workspaces/01ARZ3NDEKTSV4RRFFQ69G5FAV", { headers: bearer(admin.token) })).status,
    ).toBe(404);
  });
});

describe("workspaces.update + list", () => {
  it("renames a workspace", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "REN");
    const res = await t.app.request(
      "/api/v1/workspaces/REN",
      jsonReq("PATCH", { name: "Renamed" }, bearer(admin.token)),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { workspace: WorkspaceJson }).workspace.name).toBe("Renamed");
    expect(((await t.app.request(`/api/v1/workspaces/${ws.id}`, { headers: bearer(admin.token) })).status)).toBe(200);
  });

  it("archives and unarchives; list hides archived unless include_archived", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "ARC");
    const archive = await t.app.request(
      `/api/v1/workspaces/${ws.id}`,
      jsonReq("PATCH", { archived: true }, bearer(admin.token)),
    );
    expect(archive.status).toBe(200);
    const archived = ((await archive.json()) as { workspace: WorkspaceJson }).workspace;
    expect(archived.archived_at).not.toBeNull();

    const plain = await t.app.request("/api/v1/workspaces", { headers: bearer(admin.token) });
    const plainItems = ((await plain.json()) as { items: WorkspaceJson[] }).items;
    expect(plainItems.some((w) => w.id === ws.id)).toBe(false);

    const all = await t.app.request("/api/v1/workspaces?include_archived=true", { headers: bearer(admin.token) });
    const allItems = ((await all.json()) as { items: WorkspaceJson[] }).items;
    expect(allItems.some((w) => w.id === ws.id)).toBe(true);

    const unarchive = await t.app.request(
      `/api/v1/workspaces/${ws.id}`,
      jsonReq("PATCH", { archived: false }, bearer(admin.token)),
    );
    expect(((await unarchive.json()) as { workspace: WorkspaceJson }).workspace.archived_at).toBeNull();
  });

  it("lists workspaces in created_at ascending order", async () => {
    const res = await t.app.request("/api/v1/workspaces?include_archived=1", { headers: bearer(admin.token) });
    const { items } = (await res.json()) as { items: Array<WorkspaceJson & { created_at: number }> };
    expect(items.length).toBeGreaterThan(1);
    for (let i = 1; i < items.length; i++) {
      expect(items[i]!.created_at).toBeGreaterThanOrEqual(items[i - 1]!.created_at);
    }
  });

  it("404s when updating a missing workspace", async () => {
    const res = await t.app.request(
      "/api/v1/workspaces/GONE",
      jsonReq("PATCH", { name: "X" }, bearer(admin.token)),
    );
    expect(res.status).toBe(404);
  });
});
