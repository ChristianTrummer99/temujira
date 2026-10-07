import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TaskSchema, type Task, type Tag, type Status } from "@temujira/shared";
import { bearer, jsonReq, makeMember, makeTask, makeTestApp, makeWorkspace, setupAdmin } from "./helpers";

let t: Awaited<ReturnType<typeof makeTestApp>>;
let admin: Awaited<ReturnType<typeof setupAdmin>>;
beforeAll(async () => { t = await makeTestApp(); admin = await setupAdmin(t.app); });
afterAll(() => t?.cleanup());
const send = (path: string, method: string, body: unknown, token = admin.token) => t.app.request(`/api/v1${path}`, jsonReq(method, body, bearer(token)));
const get = async (id: string) => (await (await t.app.request(`/api/v1/tasks/${id}`, { headers: bearer(admin.token) })).json() as { task: Task }).task;

describe("bulk updates and saved order", () => {
  it("updates all selected tasks, preserves unrelated tags, and audits each before-state", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "BATCH");
    const a = await makeTask(t.app, admin.token, ws.id, { title: "A" });
    const b = await makeTask(t.app, admin.token, ws.id, { title: "B", assignee_id: admin.userId });
    const statuses = await (await t.app.request(`/api/v1/workspaces/${ws.id}/statuses`, { headers: bearer(admin.token) })).json() as { items: Status[] };
    const tag = async (name: string) => (await (await send(`/workspaces/${ws.id}/tags`, "POST", { name })).json() as { tag: Tag }).tag;
    const keep = await tag("Keep"), remove = await tag("Remove"), add = await tag("Add");
    await send(`/tasks/${a.id}`, "PATCH", { tag_ids: [keep.id, remove.id] });
    await send(`/tasks/${b.id}`, "PATCH", { status_id: statuses.items[1]!.id });
    const res = await send(`/workspaces/${ws.id}/tasks/bulk`, "PATCH", { task_ids: [a.id, b.id], status_id: statuses.items[2]!.id, assignee_id: null, add_tag_ids: [add.id], remove_tag_ids: [remove.id] });
    expect(res.status).toBe(200);
    const { items } = await res.json() as { items: Task[] };
    for (const task of items) { expect(TaskSchema.safeParse(task).success).toBe(true); expect(task.assignee_id).toBeNull(); }
    expect((await get(a.id)).tags.map((x) => x.id).sort()).toEqual([keep.id, add.id].sort());
    expect((await get(b.id)).tags.map((x) => x.id)).toEqual([add.id]);
    for (const [task, oldStatus] of [[a, statuses.items[0]!], [b, statuses.items[1]!]] as const) {
      const events = await (await t.app.request(`/api/v1/tasks/${task.id}/activity`, { headers: bearer(admin.token) })).json() as { items: Array<{ metadata: { route: string; changes: unknown[] } }> };
      expect(events.items.find((e) => e.metadata.route === "tasks.bulkUpdate")?.metadata.changes)
        .toContainEqual({ field: "status", from: oldStatus.name, to: statuses.items[2]!.name });
    }
  });

  it("rejects the whole batch for a foreign task, invalid tag, or missing write scope", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "SAFE");
    const other = await makeWorkspace(t.app, admin.token, "HIDE");
    const a = await makeTask(t.app, admin.token, ws.id, { title: "Untouched" });
    const hidden = await makeTask(t.app, admin.token, other.id, { title: "Hidden" });
    const member = await makeMember(t.app, admin.token, { workspace_access_all: false, workspace_ids: [ws.id] });
    expect((await send(`/workspaces/${ws.id}/tasks/bulk`, "PATCH", { task_ids: [a.id, hidden.id], archived: true }, member.token)).status).toBe(404);
    expect((await send(`/workspaces/${ws.id}/tasks/bulk`, "PATCH", { task_ids: [a.id], archived: true, add_tag_ids: [hidden.id] })).status).toBe(400);
    expect((await send(`/workspaces/${ws.id}/tasks/bulk`, "PATCH", { task_ids: [a.id, a.id], archived: true })).status).toBe(400);
    const reader = await makeMember(t.app, admin.token, { scopes: [] });
    expect((await send(`/workspaces/${ws.id}/tasks/bulk`, "PATCH", { task_ids: [a.id], archived: true }, reader.token)).status).toBe(403);
    expect((await get(a.id)).archived_at).toBeNull();
    expect((await get(a.id)).updated_at).toBe(a.updated_at);
  });

  it("moves relative to an anchor without dropping hidden or off-page tasks", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "ORDER");
    const a = await makeTask(t.app, admin.token, ws.id, { title: "A" });
    const b = await makeTask(t.app, admin.token, ws.id, { title: "B" });
    const c = await makeTask(t.app, admin.token, ws.id, { title: "C" });
    const list = async () => (await (await t.app.request(`/api/v1/workspaces/${ws.id}/tasks?sort=position&order=asc`, { headers: bearer(admin.token) })).json() as { items: Task[] }).items;
    expect((await list()).map((x) => x.id)).toEqual([c.id, b.id, a.id]);
    expect((await send(`/workspaces/${ws.id}/tasks/order`, "PUT", { task_id: a.id, before_id: c.id })).status).toBe(200);
    expect((await list()).map((x) => x.id)).toEqual([a.id, c.id, b.id]);
    expect((await send(`/workspaces/${ws.id}/tasks/order`, "PUT", { task_id: a.id, before_id: null })).status).toBe(200);
    expect((await list()).map((x) => x.id)).toEqual([c.id, b.id, a.id]);
    expect((await get(b.id)).updated_at).toBe(b.updated_at); // rank normalization is not an edit
    expect((await send(`/workspaces/${ws.id}/tasks/order`, "PUT", { task_id: a.id, before_id: a.id })).status).toBe(400);
    const reader = await makeMember(t.app, admin.token, { scopes: [] });
    expect((await send(`/workspaces/${ws.id}/tasks/order`, "PUT", { task_id: a.id, before_id: null }, reader.token)).status).toBe(403);
    const foreign = await makeWorkspace(t.app, admin.token, "FAR");
    const far = await makeTask(t.app, admin.token, foreign.id, { title: "Foreign" });
    expect((await send(`/workspaces/${ws.id}/tasks/order`, "PUT", { task_id: a.id, before_id: far.id })).status).toBe(404);
    const statuses = await (await t.app.request(`/api/v1/workspaces/${ws.id}/statuses`, { headers: bearer(admin.token) })).json() as { items: Status[] };
    const targetStatus = statuses.items[1]!.id;
    await send(`/tasks/${c.id}`, "PATCH", { status_id: targetStatus });
    expect((await send(`/workspaces/${ws.id}/tasks/order`, "PUT", { task_id: a.id, before_id: c.id, status_id: targetStatus })).status).toBe(200);
    expect((await get(a.id)).status_id).toBe(targetStatus);
    expect((await list()).map((x) => x.id)).toEqual([a.id, c.id, b.id]);
    expect((await send(`/workspaces/${ws.id}/tasks/order`, "PUT", { task_id: a.id, before_id: b.id, status_id: targetStatus })).status).toBe(400);
    expect((await list()).map((x) => x.id)).toEqual([a.id, c.id, b.id]);
  });

  it("filters unassigned tasks before pagination and totals", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "UNAS");
    const a = await makeTask(t.app, admin.token, ws.id, { title: "Unassigned" });
    await makeTask(t.app, admin.token, ws.id, { title: "Assigned", assignee_id: admin.userId });
    const res = await t.app.request(`/api/v1/workspaces/${ws.id}/tasks?unassigned=true&limit=1`, { headers: bearer(admin.token) });
    expect(await res.json()).toMatchObject({ total: 1, items: [{ id: a.id }] });
  });
});
