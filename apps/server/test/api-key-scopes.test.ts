import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, jsonReq, makeAgentWithKey, makeMember, makeTestApp, makeWorkspace, setupAdmin } from "./helpers";

let t: Awaited<ReturnType<typeof makeTestApp>>;
let admin: { token: string; userId: string };

beforeAll(async () => {
  t = await makeTestApp();
  admin = await setupAdmin(t.app);
});
afterAll(() => t.cleanup());

const send = (path: string, method: string, body: unknown, token: string) =>
  t.app.request(`/api/v1${path}`, jsonReq(method, body, bearer(token)));
const get = (path: string, token: string) =>
  t.app.request(`/api/v1${path}`, { headers: bearer(token) });

interface KeyJson {
  scopes: string[] | null;
  workspace_ids: string[] | null;
}

describe("scoped API keys", () => {
  it("narrows scopes below the owner and rejects wider grants", async () => {
    const workspace = await makeWorkspace(t.app, admin.token, "SCOPEA");
    const member = await makeMember(t.app, admin.token, { scopes: ["tasks:write"] });

    const created = await send("/api-keys", "POST", { name: "limited", scopes: ["tasks:write"] }, member.token);
    expect(created.status).toBe(200);
    const body = (await created.json()) as { apiKey: KeyJson; token: string };
    expect(body.apiKey.scopes).toEqual(["tasks:write"]);
    expect(body.apiKey.workspace_ids).toBeNull();

    expect((await send(`/workspaces/${workspace.id}/tasks`, "POST", { title: "key task" }, body.token)).status).toBe(200);
    expect((await send(`/workspaces/${workspace.id}/tags`, "POST", { name: "nope" }, body.token)).status).toBe(403);
    expect((await send("/api-keys", "POST", { name: "over", scopes: ["workspaces:manage"] }, member.token)).status).toBe(403);
    expect((await send("/api-keys", "POST", { name: "over", scopes: ["not-a-scope"] }, member.token)).status).toBe(400);

    const list = (await (await get("/api-keys", member.token)).json()) as { items: Array<KeyJson & { name: string }> };
    expect(list.items.find((key) => key.name === "limited")!.scopes).toEqual(["tasks:write"]);
  });

  it("narrows workspaces and reports effective limits on auth/me", async () => {
    const first = await makeWorkspace(t.app, admin.token, "KEYS1");
    const second = await makeWorkspace(t.app, admin.token, "KEYS2");
    const member = await makeMember(t.app, admin.token, { scopes: ["tasks:write"] });

    const created = await send("/api-keys", "POST", { name: "one-workspace", workspace_ids: [first.id] }, member.token);
    expect(created.status).toBe(200);
    const { token } = (await created.json()) as { token: string };

    const workspaces = (await (await get("/workspaces", token)).json()) as { items: Array<{ id: string }> };
    expect(workspaces.items.map((workspace) => workspace.id)).toEqual([first.id]);
    expect((await get(`/workspaces/${second.id}`, token)).status).toBe(404);
    expect((await send(`/workspaces/${second.id}/tasks`, "POST", { title: "denied" }, token)).status).toBe(404);

    const me = (await (await get("/auth/me", token)).json()) as { user: { workspace_access_all: boolean; workspace_ids: string[] } };
    expect(me.user.workspace_access_all).toBe(false);
    expect(me.user.workspace_ids).toEqual([first.id]);
  });

  it("supports empty limits and inherits when the fields are omitted", async () => {
    const workspace = await makeWorkspace(t.app, admin.token, "KEYSN");
    const member = await makeMember(t.app, admin.token, { scopes: ["tasks:write"] });

    const empty = await send("/api-keys", "POST", { name: "none", scopes: [], workspace_ids: [] }, member.token);
    expect(empty.status).toBe(200);
    const emptyBody = (await empty.json()) as { apiKey: KeyJson; token: string };
    expect(emptyBody.apiKey.scopes).toEqual([]);
    expect(emptyBody.apiKey.workspace_ids).toEqual([]);
    expect(((await (await get("/workspaces", emptyBody.token)).json()) as { items: unknown[] }).items).toEqual([]);
    // No write scope is rejected before the workspace check.
    expect((await send(`/workspaces/${workspace.id}/tasks`, "POST", { title: "denied" }, emptyBody.token)).status).toBe(403);

    const noWorkspaces = await send("/api-keys", "POST", { name: "no-ws", scopes: ["tasks:write"], workspace_ids: [] }, member.token);
    expect(noWorkspaces.status).toBe(200);
    const noWorkspacesBody = (await noWorkspaces.json()) as { token: string };
    expect(((await (await get("/workspaces", noWorkspacesBody.token)).json()) as { items: unknown[] }).items).toEqual([]);
    expect((await send(`/workspaces/${workspace.id}/tasks`, "POST", { title: "denied" }, noWorkspacesBody.token)).status).toBe(404);

    const inherited = await send("/api-keys", "POST", { name: "inherit" }, member.token);
    expect(inherited.status).toBe(200);
    const inheritedBody = (await inherited.json()) as { apiKey: KeyJson; token: string };
    expect(inheritedBody.apiKey.scopes).toBeNull();
    expect(inheritedBody.apiKey.workspace_ids).toBeNull();
    expect(((await (await get("/workspaces", inheritedBody.token)).json()) as { items: unknown[] }).items.length).toBeGreaterThan(0);
  });

  it("never grants beyond the owner or the creating manager", async () => {
    const first = await makeWorkspace(t.app, admin.token, "LIMIT1");
    const second = await makeWorkspace(t.app, admin.token, "LIMIT2");
    const member = await makeMember(t.app, admin.token, {
      scopes: ["tasks:write"],
      workspace_access_all: false,
      workspace_ids: [first.id],
    });

    expect((await send("/api-keys", "POST", { name: "outside", user_id: member.userId, workspace_ids: [second.id] }, admin.token)).status).toBe(403);
    expect((await send("/api-keys", "POST", { name: "wider", user_id: member.userId, scopes: ["workspaces:manage"] }, admin.token)).status).toBe(403);

    const manager = await makeMember(t.app, admin.token, { scopes: ["tasks:write", "api_keys:manage"] });
    expect((await send("/api-keys", "POST", { name: "admin-key", user_id: admin.userId }, manager.token)).status).toBe(403);
    expect((await send("/api-keys", "POST", { name: "manager-wide", user_id: manager.userId, scopes: ["api_keys:manage"] }, manager.token)).status).toBe(200);

    const adminKey = await send("/api-keys", "POST", { name: "admin-own" }, admin.token);
    const adminKeyId = ((await adminKey.json()) as { apiKey: { id: string } }).apiKey.id;
    expect((await t.app.request(`/api/v1/api-keys/${adminKeyId}`, { method: "DELETE", headers: bearer(manager.token) })).status).toBe(403);

    const target = await makeMember(t.app, admin.token, { scopes: ["tasks:write"] });
    expect((await send("/api-keys", "POST", { name: "delegated", user_id: target.userId, scopes: ["tasks:write"] }, manager.token)).status).toBe(200);
  });

  it("prevents non-admins from acquiring an admin agent identity", async () => {
    const agent = await makeAgentWithKey(t.app, admin.token, "Admin agent");
    expect((await send(`/users/${agent.userId}`, "PATCH", { role: "admin", exclusive_identity: true }, admin.token)).status).toBe(200);
    const manager = await makeMember(t.app, admin.token, { scopes: ["tasks:write", "api_keys:manage"] });
    expect((await send(`/identities/${agent.userId}/session`, "POST", {}, manager.token)).status).toBe(403);
    expect((await send(`/identities/${agent.userId}/session`, "POST", {}, admin.token)).status).toBe(200);
  });

  it("clamps delegated keys and identity sessions to the manager's access", async () => {
    const first = await makeWorkspace(t.app, admin.token, "CLMP1");
    const second = await makeWorkspace(t.app, admin.token, "CLMP2");
    const manager = await makeMember(t.app, admin.token, {
      scopes: ["tasks:write", "api_keys:manage"],
      workspace_access_all: false,
      workspace_ids: [first.id],
    });
    const broad = await makeMember(t.app, admin.token);
    const delegated = await send("/api-keys", "POST", { name: "delegated-clamp", user_id: broad.userId }, manager.token);
    expect(delegated.status).toBe(200);
    const body = (await delegated.json()) as { apiKey: KeyJson; token: string };
    expect(body.apiKey.scopes).toEqual(["tasks:write"]);
    expect(body.apiKey.workspace_ids).toEqual([first.id]);
    expect((await get(`/workspaces/${second.id}`, body.token)).status).toBe(404);
    expect((await get(`/workspaces/${first.id}`, body.token)).status).toBe(200);

    const broadAgent = await makeAgentWithKey(t.app, admin.token, "Broad agent");
    expect((await send(`/users/${broadAgent.userId}`, "PATCH", { exclusive_identity: true }, admin.token)).status).toBe(200);
    expect((await send(`/identities/${broadAgent.userId}/session`, "POST", {}, manager.token)).status).toBe(403);

    const narrowAgent = await makeAgentWithKey(t.app, admin.token, "Narrow agent");
    expect((await send(`/users/${narrowAgent.userId}`, "PATCH", {
      workspace_access_all: false,
      workspace_ids: [first.id],
      exclusive_identity: true,
    }, admin.token)).status).toBe(200);
    expect((await send(`/identities/${narrowAgent.userId}/session`, "POST", {}, manager.token)).status).toBe(200);
  });
});
