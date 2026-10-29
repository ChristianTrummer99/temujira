import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_TASK_FILTER_TAGS, type Task, type Tag } from "@temujira/shared";
import { bearer, jsonReq, makeMember, makeTask, makeTestApp, makeWorkspace, setupAdmin } from "./helpers";

let t: Awaited<ReturnType<typeof makeTestApp>>;
let admin: Awaited<ReturnType<typeof setupAdmin>>;
let workspace: Awaited<ReturnType<typeof makeWorkspace>>;
let other: Awaited<ReturnType<typeof makeWorkspace>>;
let a: Tag, b: Tag, foreign: Tag;
let onlyA: { id: string }, onlyB: { id: string }, both: { id: string; status_id: string };

const send = (path: string, body: unknown) => t.app.request(`/api/v1${path}`, jsonReq("POST", body, bearer(admin.token)));
const requestList = (query: Record<string, string> = {}, token = admin.token) =>
  t.app.request(`/api/v1/workspaces/${workspace.id}/tasks?${new URLSearchParams({ sort: "number", order: "asc", ...query })}`, { headers: bearer(token) });
const list = async (query: Record<string, string> = {}) => {
  const response = await requestList(query);
  expect(response.status).toBe(200);
  return await response.json() as { items: Task[]; total: number; offset: number; limit: number };
};

beforeAll(async () => {
  t = await makeTestApp();
  admin = await setupAdmin(t.app);
  workspace = await makeWorkspace(t.app, admin.token, "MTAG");
  other = await makeWorkspace(t.app, admin.token, "MTAGB");
  const tag = async (workspaceId: string, name: string) => (await (await send(`/workspaces/${workspaceId}/tags`, { name })).json() as { tag: Tag }).tag;
  a = await tag(workspace.id, "A"); b = await tag(workspace.id, "B"); foreign = await tag(other.id, "Foreign");
  onlyA = await makeTask(t.app, admin.token, workspace.id, { title: "A only", tag_ids: [a.id] });
  onlyB = await makeTask(t.app, admin.token, workspace.id, { title: "B only", tag_ids: [b.id] });
  both = await makeTask(t.app, admin.token, workspace.id, { title: "Both", tag_ids: [a.id, b.id], assignee_id: admin.userId });
  await makeTask(t.app, admin.token, workspace.id, { title: "Neither" });
  const archived = await makeTask(t.app, admin.token, workspace.id, { title: "Archived both", tag_ids: [a.id, b.id] });
  await t.app.request(`/api/v1/tasks/${archived.id}`, jsonReq("PATCH", { archived: true }, bearer(admin.token)));
  await makeTask(t.app, admin.token, other.id, { title: "Foreign task", tag_ids: [foreign.id] });
});
afterAll(() => t?.cleanup());

describe("multi-tag task filters", () => {
  it("requires all selected tags by default", async () => {
    const result = await list({ tag_ids: `${a.id},${b.id}` });
    expect(result.total).toBe(1);
    expect(result.items.map((task) => task.id)).toEqual([both.id]);
  });

  it("matches any selected tag without duplicate rows or totals", async () => {
    const result = await list({ tag_ids: `${a.id},${b.id}`, tag_match: "any" });
    expect(result.total).toBe(3);
    expect(result.items.map((task) => task.id)).toEqual([onlyA.id, onlyB.id, both.id]);
  });

  it("keeps counts and pages correct and combines other filters", async () => {
    const query = { tag_ids: `${a.id},${b.id}`, tag_match: "any", limit: "1" };
    const first = await list(query), second = await list({ ...query, offset: "1" }), third = await list({ ...query, offset: "2" });
    for (const page of [first, second, third]) { expect(page.total).toBe(3); expect(page.items).toHaveLength(1); }
    expect([first, second, third].map((page) => page.items[0]!.id)).toEqual([onlyA.id, onlyB.id, both.id]);
    const assigned = await list({ tag_ids: `${a.id},${b.id}`, tag_match: "any", assignee_id: admin.userId, status_id: both.status_id, q: "Both" });
    expect(assigned.items.map((task) => task.id)).toEqual([both.id]);
    expect((await list({ tag_ids: `${a.id},${b.id}`, include_archived: "true" })).total).toBe(2);
  });

  it("deduplicates tags and keeps the old single-tag query compatible", async () => {
    expect((await list({ tag_id: a.id })).items.map((task) => task.id)).toEqual([onlyA.id, both.id]);
    expect((await list({ tag_ids: `${a.id},${a.id},${b.id}` })).items.map((task) => task.id)).toEqual([both.id]);
    expect((await list({ tag_id: a.id, tag_ids: `${a.id},${b.id}` })).items.map((task) => task.id)).toEqual([both.id]);
    expect((await list({ tag_id: a.id, tag_ids: b.id, tag_match: "any" })).total).toBe(3);
    expect((await list()).total).toBe(4);
  });

  it("does not expose tasks from another workspace", async () => {
    expect((await list({ tag_ids: `${a.id},${foreign.id}` })).total).toBe(0);
    expect((await list({ tag_ids: `${a.id},${foreign.id}`, tag_match: "any" })).items.map((task) => task.id)).toEqual([onlyA.id, both.id]);
    const limited = await makeMember(t.app, admin.token, { workspace_access_all: false, workspace_ids: [other.id] });
    expect((await requestList({ tag_ids: `${a.id},${b.id}` }, limited.token)).status).toBe(404);
  });

  it.each(["", "not-an-id", "01ARZ3NDEKTSV4RRFFQ69G5FAV,", ",01ARZ3NDEKTSV4RRFFQ69G5FAV"])("rejects malformed tag lists (%j)", async (tag_ids) => {
    expect((await requestList({ tag_ids })).status).toBe(400);
  });

  it("rejects unknown match modes and excessive tag lists", async () => {
    expect((await requestList({ tag_ids: a.id, tag_match: "none" })).status).toBe(400);
    expect((await requestList({ tag_ids: Array(MAX_TASK_FILTER_TAGS + 1).fill(a.id).join(",") })).status).toBe(400);
    expect((await requestList({ tag_ids: Array(MAX_TASK_FILTER_TAGS).fill(a.id).join(",") })).status).toBe(200);
  });
});
