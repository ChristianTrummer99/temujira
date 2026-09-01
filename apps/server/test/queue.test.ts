import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { QueueEntrySchema } from "@temujira/shared";
import {
  bearer,
  jsonReq,
  makeTask,
  makeTestApp,
  makeWorkspace,
  makeMember,
  setupAdmin,
  type TaskJson,
  type WorkspaceJson,
} from "./helpers";

let t: Awaited<ReturnType<typeof makeTestApp>>;
let admin: { token: string; userId: string };
let member: { token: string; userId: string };
let ws: WorkspaceJson;
let otherMember: { token: string };

interface QueueEntryJson {
  id: string;
  task: TaskJson & { field_values: Record<string, string> };
  state: string;
  blocked: boolean;
  position: number;
  created_at: number;
}

const getQueue = async (token: string): Promise<QueueEntryJson[]> => {
  const res = await t.app.request("/api/v1/queue", { headers: bearer(token) });
  expect(res.status).toBe(200);
  const { items } = (await res.json()) as { items: QueueEntryJson[] };
  for (const item of items) expect(QueueEntrySchema.safeParse(item).success).toBe(true);
  return items;
};

const add = async (token: string, idOrKey: string): Promise<QueueEntryJson> => {
  const res = await t.app.request("/api/v1/queue", jsonReq("POST", { task: idOrKey }, bearer(token)));
  expect(res.status).toBe(200);
  const { entry } = (await res.json()) as { entry: QueueEntryJson };
  expect(QueueEntrySchema.safeParse(entry).success).toBe(true);
  return entry;
};

const setState = async (token: string, entryId: string, state: string): Promise<Response> =>
  await t.app.request(`/api/v1/queue/${entryId}`, jsonReq("PATCH", { state }, bearer(token)));

const next = async (token: string): Promise<QueueEntryJson | null> => {
  const res = await t.app.request("/api/v1/queue/next", { headers: bearer(token) });
  expect(res.status).toBe(200);
  const { entry } = (await res.json()) as { entry: QueueEntryJson | null };
  return entry;
};

let taskCounter = 0;
const newTask = (token = admin.token): Promise<TaskJson> =>
  makeTask(t.app, token, ws.id, { title: `Queue task ${++taskCounter}` });

beforeAll(async () => {
  t = await makeTestApp();
  admin = await setupAdmin(t.app);
  member = await makeMember(t.app, admin.token, { name: "Queue Member" });
  otherMember = await makeMember(t.app, admin.token, { name: "Other Member" });
  ws = await makeWorkspace(t.app, admin.token, "QUE");
});
afterAll(() => t.cleanup());

describe("queue CRUD", () => {
  it("adds tasks in append order with positions, 409 on duplicates", async () => {
    const a = await newTask();
    const b = await newTask();
    const ea = await add(admin.token, a.key);
    const eb = await add(admin.token, b.key);
    expect(ea.position).toBeLessThan(eb.position);
    expect((await getQueue(admin.token)).map((e) => e.task.id)).toEqual([a.id, b.id]);
    const dup = await t.app.request("/api/v1/queue", jsonReq("POST", { task: a.key }, bearer(admin.token)));
    expect(dup.status).toBe(409);
  });

  it("queues are per-user: member's queue does not see admin's tasks", async () => {
    await newTask(admin.token);
    const mine = await newTask(member.token);
    await add(member.token, mine.key);
    expect((await getQueue(member.token)).length).toBe(1);
    expect((await getQueue(admin.token)).length).toBe(2); // admin's own two
  });

  it("sets states and is owner-scoped (other user's entry -> 404)", async () => {
    const task = await newTask(member.token);
    const entry = await add(member.token, task.key);
    const res = await setState(member.token, entry.id, "running");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { entry: QueueEntryJson }).entry.state).toBe("running");
    await setState(member.token, entry.id, "ready");
    // admin cannot touch member's entry
    const foreign = await setState(admin.token, entry.id, "running");
    expect(foreign.status).toBe(404);
    // and cannot remove it either
    const del = await t.app.request(`/api/v1/queue/${entry.id}`, { method: "DELETE", headers: bearer(admin.token) });
    expect(del.status).toBe(404);
    // member queue: 1 from the per-user test + this test's entry
    expect((await getQueue(member.token)).length).toBe(2);
  });

  it("reorders only with the exact full own-array", async () => {
    const a = await newTask(admin.token);
    const b = await newTask(admin.token);
    const ea = await add(admin.token, a.key);
    const eb = await add(admin.token, b.key);
    await add(admin.token, (await newTask(admin.token)).key); // third entry stays put
    const ids = (await getQueue(admin.token)).map((e) => e.id);
    expect(ids).toContain(ea.id);
    expect(ids).toContain(eb.id);
    const res = await t.app.request("/api/v1/queue/order", jsonReq("PUT", { entry_ids: ids }, bearer(admin.token)));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { items: QueueEntryJson[] }).items.map((e) => e.id)).toEqual(ids);
    // a subset is rejected
    const subset = await t.app.request("/api/v1/queue/order", jsonReq("PUT", { entry_ids: ids.slice(1) }, bearer(admin.token)));
    expect(subset.status).toBe(400);
  });

  it("removes an entry (the complete act) and leaves the task untouched", async () => {
    const task = await newTask(member.token);
    const before = await t.app.request(`/api/v1/tasks/${task.id}`, { headers: bearer(member.token) });
    const taskBefore = ((await before.json()) as { task: TaskJson }).task;
    const queuedBefore = (await getQueue(member.token)).length;
    const entry = await add(member.token, task.key);
    const del = await t.app.request(`/api/v1/queue/${entry.id}`, { method: "DELETE", headers: bearer(member.token) });
    expect(del.status).toBe(200);
    expect((await getQueue(member.token)).length).toBe(queuedBefore);
    // task title/status/updated_at unchanged by queue operations
    const afterRes = await t.app.request(`/api/v1/tasks/${task.id}`, { headers: bearer(member.token) });
    const taskAfter = ((await afterRes.json()) as { task: TaskJson }).task;
    expect(taskAfter.title).toBe(taskBefore.title);
    expect(taskAfter.status_id).toBe(taskBefore.status_id);
    expect(taskAfter.updated_at).toBe(taskBefore.updated_at);
  });
});

describe("queue.next", () => {
  it("returns null on an empty queue", async () => {
    const e = await next(otherMember.token);
    expect(e).toBeNull();
  });

  it("prefers running > ready > queued", async () => {
    // otherMember's queue is otherwise empty, so positions are the two entries below.
    const a = await newTask(otherMember.token);
    const b = await newTask(otherMember.token);
    const ea = await add(otherMember.token, a.key);
    const eb = await add(otherMember.token, b.key);
    await setState(otherMember.token, eb.id, "running");
    expect((await next(otherMember.token))?.id).toBe(eb.id);
    await setState(otherMember.token, eb.id, "ready");
    expect((await next(otherMember.token))?.id).toBe(eb.id);
    await setState(otherMember.token, eb.id, "queued");
    expect((await next(otherMember.token))?.id).toBe(ea.id);
    void ea;
  });
});

describe("queue blocked derivation (FR-39)", () => {
  it("flags an entry blocked when a task blocks it", async () => {
    const blocker = await newTask(admin.token);
    const target = await newTask(otherMember.token);
    const entry = await add(otherMember.token, target.key);
    expect(entry.blocked).toBe(false);
    const linkRes = await t.app.request(
      `/api/v1/tasks/${blocker.key}/links`,
      jsonReq("POST", { type: "blocks", task: target.key }, bearer(admin.token)),
    );
    expect(linkRes.status).toBe(200);
    const reloaded = (await getQueue(otherMember.token)).find((e) => e.id === entry.id)!;
    expect(reloaded.blocked).toBe(true);
  });
});