import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bearer,
  jsonReq,
  makeMember,
  makeTask,
  makeTestApp,
  makeWorkspace,
  setupAdmin,
  uniqueEmail,
} from "./helpers";

let t: Awaited<ReturnType<typeof makeTestApp>>;
let admin: { token: string; userId: string };

beforeAll(async () => {
  t = await makeTestApp();
  admin = await setupAdmin(t.app);
});
afterAll(() => t.cleanup());

const createWorkspace = (token: string, key: string) =>
  t.app.request("/api/v1/workspaces", jsonReq("POST", { name: key, key }, bearer(token)));

describe("capability scopes", () => {
  it("members start with tasks:write only: no workspace creation", async () => {
    const member = await makeMember(t.app, admin.token);
    expect((await createWorkspace(member.token, "SCOPE1")).status).toBe(403);
  });

  it("granting workspaces:create lets the member create a workspace", async () => {
    const member = await makeMember(t.app, admin.token, {
      scopes: ["tasks:write", "workspaces:create"],
    });
    const ws = await makeWorkspace(t.app, member.token, "SCOPE2");
    expect(ws.key).toBe("SCOPE2");
  });

  it("scope changes take effect on the next request", async () => {
    const member = await makeMember(t.app, admin.token, {
      scopes: ["tasks:write", "workspaces:create"],
    });
    expect((await createWorkspace(member.token, "SCOPE3")).status).toBe(200);
    const patch = await t.app.request(
      `/api/v1/users/${member.userId}`,
      jsonReq("PATCH", { scopes: ["tasks:write"] }, bearer(admin.token)),
    );
    expect(patch.status).toBe(200);
    expect((await createWorkspace(member.token, "SCOPE4")).status).toBe(403);
  });

  it("users:manage allows user creation without the admin role", async () => {
    const manager = await makeMember(t.app, admin.token, { scopes: ["tasks:write", "users:manage"] });
    const res = await t.app.request(
      "/api/v1/users",
      jsonReq("POST", { email: uniqueEmail("scoped"), name: "Scoped", password: "password-123" }, bearer(manager.token)),
    );
    expect(res.status).toBe(200);
  });

  it("api_keys:manage allows minting a key for another user", async () => {
    const member = await makeMember(t.app, admin.token);
    const target = await makeMember(t.app, admin.token);
    const manager = await makeMember(t.app, admin.token, { scopes: ["tasks:write", "api_keys:manage"] });
    const denied = await t.app.request(
      "/api/v1/api-keys",
      jsonReq("POST", { name: "x", user_id: target.userId }, bearer(member.token)),
    );
    expect(denied.status).toBe(403);
    const allowed = await t.app.request(
      "/api/v1/api-keys",
      jsonReq("POST", { name: "provisioned", user_id: target.userId }, bearer(manager.token)),
    );
    expect(allowed.status).toBe(200);
  });

  it("api_keys:manage lists every user's keys; members see only their own", async () => {
    const target = await makeMember(t.app, admin.token);
    const manager = await makeMember(t.app, admin.token, {
      scopes: ["tasks:write", "api_keys:manage"],
    });
    const adminKey = await t.app.request(
      "/api/v1/api-keys",
      jsonReq("POST", { name: "admin-key" }, bearer(admin.token)),
    );
    expect(adminKey.status).toBe(200);
    const targetKey = await t.app.request(
      "/api/v1/api-keys",
      jsonReq("POST", { name: "target-key", user_id: target.userId }, bearer(manager.token)),
    );
    expect(targetKey.status).toBe(200);

    const denied = await t.app.request("/api/v1/api-keys?all=true", {
      headers: bearer(target.token),
    });
    expect(denied.status).toBe(403);

    const all = await t.app.request("/api/v1/api-keys?all=true", {
      headers: bearer(manager.token),
    });
    expect(all.status).toBe(200);
    const allBody = (await all.json()) as { items: { user_id: string }[] };
    const owners = new Set(allBody.items.map((k) => k.user_id));
    expect(owners.has(admin.userId)).toBe(true);
    expect(owners.has(target.userId)).toBe(true);

    const own = await t.app.request("/api/v1/api-keys", { headers: bearer(target.token) });
    const ownBody = (await own.json()) as { items: { user_id: string }[] };
    expect(ownBody.items.length).toBeGreaterThan(0);
    expect(ownBody.items.every((k) => k.user_id === target.userId)).toBe(true);
  });

  it("non-admin managers cannot escalate", async () => {
    const manager = await makeMember(t.app, admin.token, { scopes: ["tasks:write", "users:manage"] });
    const target = await makeMember(t.app, admin.token);

    // Role change is admin-only.
    const role = await t.app.request(
      `/api/v1/users/${target.userId}`,
      jsonReq("PATCH", { role: "admin" }, bearer(manager.token)),
    );
    expect(role.status).toBe(403);

    // Cannot grant a scope they don't hold (api_keys:manage here).
    const escalate = await t.app.request(
      `/api/v1/users/${target.userId}`,
      jsonReq("PATCH", { scopes: ["tasks:write", "api_keys:manage"] }, bearer(manager.token)),
    );
    expect(escalate.status).toBe(403);

    // Delegating a scope they do hold is allowed.
    const delegate = await t.app.request(
      `/api/v1/users/${target.userId}`,
      jsonReq("PATCH", { scopes: ["tasks:write", "users:manage"] }, bearer(manager.token)),
    );
    expect(delegate.status).toBe(200);

    // Cannot grant access to all workspaces while their own access is limited.
    const limited = await makeMember(t.app, admin.token, {
      scopes: ["tasks:write", "users:manage"],
      workspace_access_all: false,
      workspace_ids: [],
    });
    const grantAll = await t.app.request(
      `/api/v1/users/${target.userId}`,
      jsonReq("PATCH", { workspace_access_all: true }, bearer(limited.token)),
    );
    expect(grantAll.status).toBe(403);

    // Admin accounts are untouchable.
    const touchAdmin = await t.app.request(
      `/api/v1/users/${admin.userId}`,
      jsonReq("PATCH", { name: "Hax" }, bearer(manager.token)),
    );
    expect(touchAdmin.status).toBe(403);
  });

  it("admins bypass workspace restrictions", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "ADMALL");
    await t.app.request(
      `/api/v1/users/${admin.userId}`,
      jsonReq("PATCH", { workspace_access_all: false, workspace_ids: [] }, bearer(admin.token)),
    );
    expect((await t.app.request(`/api/v1/workspaces/${ws.id}`, { headers: bearer(admin.token) })).status).toBe(200);
  });
});

describe("workspace-scoped access", () => {
  it("scoped members see only their workspaces and tasks; direct access 404s", async () => {
    const ws1 = await makeWorkspace(t.app, admin.token, "SCPA");
    const ws2 = await makeWorkspace(t.app, admin.token, "SCPB");
    const task1 = await makeTask(t.app, admin.token, ws1.id, { title: "Visible" });
    const task2 = await makeTask(t.app, admin.token, ws2.id, { title: "Hidden" });
    const member = await makeMember(t.app, admin.token, {
      workspace_access_all: false,
      workspace_ids: [ws1.id],
    });

    const list = await t.app.request("/api/v1/workspaces?include_archived=1", { headers: bearer(member.token) });
    const ids = ((await list.json()) as { items: Array<{ id: string }> }).items.map((w) => w.id);
    expect(ids).toContain(ws1.id);
    expect(ids).not.toContain(ws2.id);

    expect((await t.app.request(`/api/v1/workspaces/${ws1.id}`, { headers: bearer(member.token) })).status).toBe(200);
    expect((await t.app.request(`/api/v1/workspaces/${ws2.id}`, { headers: bearer(member.token) })).status).toBe(404);
    expect((await t.app.request(`/api/v1/workspaces/${ws2.key}`, { headers: bearer(member.token) })).status).toBe(404);

    expect((await t.app.request(`/api/v1/tasks/${task1.id}`, { headers: bearer(member.token) })).status).toBe(200);
    expect((await t.app.request(`/api/v1/tasks/${task2.id}`, { headers: bearer(member.token) })).status).toBe(404);
    expect((await t.app.request(`/api/v1/tasks/${task2.key}`, { headers: bearer(member.token) })).status).toBe(404);

    expect(
      (await t.app.request(`/api/v1/workspaces/${ws2.key}/tasks`, { headers: bearer(member.token) })).status,
    ).toBe(404);
    expect(
      (
        await t.app.request(
          `/api/v1/workspaces/${ws2.id}/tasks`,
          jsonReq("POST", { title: "Nope" }, bearer(member.token)),
        )
      ).status,
    ).toBe(404);
  });

  it("scoped members cannot see hidden tasks in mine/queue/inbox", async () => {
    const ws1 = await makeWorkspace(t.app, admin.token, "HIDA");
    const ws2 = await makeWorkspace(t.app, admin.token, "HIDB");
    const visible = await makeTask(t.app, admin.token, ws1.id, { title: "Visible" });
    const hidden = await makeTask(t.app, admin.token, ws2.id, { title: "Hidden" });

    const member = await makeMember(t.app, admin.token);

    // Build associations + inbox rows + queue entries while access is still unrestricted.
    for (const task of [visible, hidden]) {
      const comment = await t.app.request(
        `/api/v1/tasks/${task.id}/comments`,
        jsonReq("POST", { body: "ping", mention_ids: [member.userId] }, bearer(admin.token)),
      );
      expect(comment.status).toBe(200);
      const queued = await t.app.request("/api/v1/queue", jsonReq("POST", { task: task.id }, bearer(member.token)));
      expect(queued.status).toBe(200);
    }

    const patch = await t.app.request(
      `/api/v1/users/${member.userId}`,
      jsonReq("PATCH", { workspace_access_all: false, workspace_ids: [ws1.id] }, bearer(admin.token)),
    );
    expect(patch.status).toBe(200);

    const mine = await t.app.request("/api/v1/tasks/mine", { headers: bearer(member.token) });
    const mineIds = ((await mine.json()) as { items: Array<{ id: string }> }).items.map((x) => x.id);
    expect(mineIds).toContain(visible.id);
    expect(mineIds).not.toContain(hidden.id);

    const queue = await t.app.request("/api/v1/queue", { headers: bearer(member.token) });
    const queueTaskIds = ((await queue.json()) as { items: Array<{ task: { id: string } }> }).items.map(
      (x) => x.task.id,
    );
    expect(queueTaskIds).toContain(visible.id);
    expect(queueTaskIds).not.toContain(hidden.id);

    const inbox = await t.app.request("/api/v1/inbox", { headers: bearer(member.token) });
    const inboxJson = (await inbox.json()) as { items: Array<{ task_id: string }>; unread: number };
    expect(inboxJson.items.some((x) => x.task_id === visible.id)).toBe(true);
    expect(inboxJson.items.some((x) => x.task_id === hidden.id)).toBe(false);
    expect(inboxJson.unread).toBe(1);
  });

  it("creating a user with an allowlist is visible to managers in users.list", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "VIS");
    const manager = await makeMember(t.app, admin.token, { scopes: ["tasks:write", "users:manage"] });
    const created = await t.app.request(
      "/api/v1/users",
      jsonReq(
        "POST",
        {
          email: uniqueEmail("allowlisted"),
          name: "Allowlisted",
          password: "password-123",
          scopes: ["tasks:write"],
          workspace_access_all: false,
          workspace_ids: [ws.id],
        },
        bearer(manager.token),
      ),
    );
    expect(created.status).toBe(200);

    const list = await t.app.request("/api/v1/users?include_deactivated=1", { headers: bearer(manager.token) });
    const users = ((await list.json()) as { items: Array<{ email: string; workspace_ids: string[]; workspace_access_all: boolean }> })
      .items;
    const row = users.find((u) => u.email.startsWith("allowlisted-"))!;
    expect(row.workspace_access_all).toBe(false);
    expect(row.workspace_ids).toEqual([ws.id]);

    // Viewers without users:manage don't get access details.
    const member = await makeMember(t.app, admin.token);
    const hidden = await t.app.request("/api/v1/users", { headers: bearer(member.token) });
    const hiddenUsers = ((await hidden.json()) as { items: Array<{ email: string; workspace_ids: string[] }> }).items;
    expect(hiddenUsers.find((u) => u.email.startsWith("allowlisted-"))!.workspace_ids).toEqual([]);
  });
});
