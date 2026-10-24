import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, jsonReq, makeMember, makeTask, makeTestApp, makeWorkspace, setupAdmin } from "./helpers";

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

describe("cross-workspace task moves", () => {
  it("allocates a new key and clears tags and custom fields", async () => {
    const source = await makeWorkspace(t.app, admin.token, "MOVA");
    const target = await makeWorkspace(t.app, admin.token, "MOVB");
    const tag = (await (await send(`/workspaces/${source.id}/tags`, "POST", { name: "Old tag" }, admin.token)).json()) as { tag: { id: string } };
    const field = (await (await send(`/workspaces/${source.id}/fields`, "POST", { name: "Old field", type: "text" }, admin.token)).json()) as { field: { id: string } };
    const task = await makeTask(t.app, admin.token, source.id, { title: "Move me", tag_ids: [tag.tag.id] });
    await send(`/tasks/${task.id}`, "PATCH", { field_values: { [field.field.id]: "old" } }, admin.token);
    expect((await send(`/tasks/${task.id}/comments`, "POST", { body: "keep me" }, admin.token)).status).toBe(200);
    await makeTask(t.app, admin.token, target.id, { title: "Already here" });
    const statuses = (await (await get(`/workspaces/${target.id}/statuses`, admin.token)).json()) as { items: Array<{ id: string; name: string }> };
    const done = statuses.items.find((status) => status.name === "Done")!;

    const res = await send(`/tasks/${task.id}/move`, "POST", { workspace_id: target.id, status_id: done.id }, admin.token);
    expect(res.status).toBe(200);
    const moved = (await res.json()) as { task: { id: string; key: string; workspace_id: string; status: { name: string }; tags: unknown[]; field_values: Record<string, string> } };
    expect(moved.task.key).toBe("MOVB-2");
    expect(moved.task.workspace_id).toBe(target.id);
    expect(moved.task.status.name).toBe("Done");
    expect(moved.task.tags).toEqual([]);
    expect(moved.task.field_values).toEqual({});

    const comments = (await (await get(`/tasks/${moved.task.id}/comments`, admin.token)).json()) as { items: Array<{ body: string }> };
    expect(comments.items[0]!.body).toBe("keep me");
    expect((await get(`/tasks/${task.key}`, admin.token)).status).toBe(404);
    expect((await get(`/tasks/${moved.task.key}`, admin.token)).status).toBe(200);

    const activity = (await (await get(`/tasks/${moved.task.id}/activity`, admin.token)).json()) as { items: Array<{ action: string; workspace_id: string; metadata: Record<string, string> }> };
    const moveEvent = activity.items.find((event) => event.action === "task.moved")!;
    expect(moveEvent.workspace_id).toBe(target.id);
    expect(moveEvent.metadata.from_key).toBe(`${source.key}-${task.number}`);
    expect(moveEvent.metadata.to_key).toBe(moved.task.key);
  });

  it("defaults to the first target status and keeps inbox links working", async () => {
    const source = await makeWorkspace(t.app, admin.token, "INBA");
    const target = await makeWorkspace(t.app, admin.token, "INBB");
    const member = await makeMember(t.app, admin.token);
    const task = await makeTask(t.app, admin.token, source.id, { title: "Notify me" });
    expect((await send(`/tasks/${task.id}/comments`, "POST", { body: "ping", mention_ids: [member.userId] }, admin.token)).status).toBe(200);
    const before = (await (await get("/inbox", member.token)).json()) as { items: Array<{ workspace: { key: string } }> };
    expect(before.items[0]!.workspace.key).toBe(source.key);

    const res = await send(`/tasks/${task.id}/move`, "POST", { workspace_id: target.id }, admin.token);
    expect(res.status).toBe(200);
    const moved = (await res.json()) as { task: { key: string; status_id: string } };
    const statuses = (await (await get(`/workspaces/${target.id}/statuses`, admin.token)).json()) as { items: Array<{ id: string }> };
    expect(moved.task.status_id).toBe(statuses.items[0]!.id);

    const after = (await (await get("/inbox", member.token)).json()) as { items: Array<{ workspace: { key: string }; task_key: string }> };
    expect(after.items[0]!.workspace.key).toBe(target.key);
    expect(after.items[0]!.task_key).toBe(moved.task.key);
  });

  it("rejects the same workspace and targets outside the caller's access", async () => {
    const source = await makeWorkspace(t.app, admin.token, "ACCA");
    const target = await makeWorkspace(t.app, admin.token, "ACCB");
    const task = await makeTask(t.app, admin.token, source.id, { title: "Restricted move" });
    expect((await send(`/tasks/${task.id}/move`, "POST", { workspace_id: source.id }, admin.token)).status).toBe(400);

    const limited = await makeMember(t.app, admin.token, {
      scopes: ["tasks:write"],
      workspace_access_all: false,
      workspace_ids: [source.id],
    });
    expect((await get(`/tasks/${task.id}`, limited.token)).status).toBe(200);
    expect((await send(`/tasks/${task.id}/move`, "POST", { workspace_id: target.id }, limited.token)).status).toBe(404);
    expect((await get(`/tasks/${task.id}`, limited.token)).status).toBe(200);

    const both = await makeMember(t.app, admin.token, {
      scopes: ["tasks:write"],
      workspace_access_all: false,
      workspace_ids: [source.id, target.id],
    });
    expect((await send(`/tasks/${task.id}/move`, "POST", { workspace_id: target.id }, both.token)).status).toBe(200);
  });
});
