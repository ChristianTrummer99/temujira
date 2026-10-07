import { afterAll, beforeAll, expect, it } from "vitest";
import type { Comment, InboxItem } from "@temujira/shared";
import { bearer, jsonReq, makeMember, makeTask, makeTestApp, makeWorkspace, setupAdmin } from "./helpers";

let t: Awaited<ReturnType<typeof makeTestApp>>;
let admin: Awaited<ReturnType<typeof setupAdmin>>;
beforeAll(async () => { t = await makeTestApp(); admin = await setupAdmin(t.app); });
afterAll(() => t?.cleanup());
const request = (token: string, method: string, path: string, data?: unknown) => t.app.request(`/api/v1${path}`,
  data === undefined ? { method, headers: bearer(token) } : jsonReq(method, data, bearer(token)));
async function list(token: string) {
  return (await (await request(token, "GET", "/inbox?include_read=true")).json() as { items: InboxItem[] }).items;
}
async function comment(token: string, task: string, body: Record<string, unknown>) {
  const response = await request(token, "POST", `/tasks/${task}/comments`, body);
  expect(response.status).toBe(200);
  return (await response.json() as { comment: Comment }).comment;
}

it("opening messages is read-only; per-item read is owner-only, scoped, and idempotent", async () => {
  const ws = await makeWorkspace(t.app, admin.token, "READ");
  const task = await makeTask(t.app, admin.token, ws.id, { title: "Read rules" });
  const reader = await makeMember(t.app, admin.token, { scopes: [] });
  await comment(admin.token, task.id, { body: "First request", mention_ids: [reader.userId] });
  await comment(admin.token, task.id, { body: "Second request", mention_ids: [reader.userId] });
  await request(reader.token, "GET", `/tasks/${task.id}`);
  await request(reader.token, "GET", `/tasks/${task.id}/comments`);
  const before = await list(reader.token);
  expect(before).toHaveLength(2);
  expect(before.every((item) => item.read_at === null)).toBe(true);
  const path = `/inbox/${before[0]!.id}/read`;
  expect((await request(admin.token, "POST", path)).status).toBe(404);
  expect(await (await request(reader.token, "POST", path)).json()).toEqual({ ok: true, updated: 1 });
  const firstRead = (await list(reader.token)).find((i) => i.id === before[0]!.id)!.read_at;
  expect(firstRead).not.toBeNull();
  expect(await (await request(reader.token, "POST", path)).json()).toEqual({ ok: true, updated: 0 });
  const after = await list(reader.token);
  expect(after.find((i) => i.id === before[0]!.id)!.read_at).toBe(firstRead);
  expect(after.find((i) => i.id === before[1]!.id)!.read_at).toBeNull();
  await request(admin.token, "PATCH", `/users/${reader.userId}`, { workspace_access_all: false, workspace_ids: [] });
  expect((await request(reader.token, "POST", `/inbox/${before[1]!.id}/read`)).status).toBe(404);
  expect(t.ctx.sqlite.prepare("SELECT read_at FROM inbox_items WHERE id=?").get(before[1]!.id)).toEqual({ read_at: null });
});

it("a recipient's reply clears only their existing notifications in that thread", async () => {
  const ws = await makeWorkspace(t.app, admin.token, "REPLY");
  const task = await makeTask(t.app, admin.token, ws.id, { title: "Thread boundaries" });
  const reader = await makeMember(t.app, admin.token);
  const other = await makeMember(t.app, admin.token);
  const root = await comment(admin.token, task.id, { body: "Please review", mention_ids: [reader.userId, other.userId] });
  const followup = await comment(admin.token, task.id, { body: "More context", parent_id: root.id, mention_ids: [reader.userId] });
  const unrelated = await comment(admin.token, task.id, { body: "Separate request", mention_ids: [reader.userId] });
  // Someone else's response must not clear the recipient's inbox.
  await comment(other.token, task.id, { body: "My response", parent_id: root.id });
  expect((await list(reader.token)).every((i) => i.read_at === null)).toBe(true);
  await comment(reader.token, task.id, { body: "Unrelated new comment" });
  expect((await list(reader.token)).every((i) => i.read_at === null)).toBe(true);
  // The transaction must not mark items read if reply validation fails.
  expect((await request(reader.token, "POST", `/tasks/${task.id}/comments`, { body: "Invalid", parent_id: root.id, answer_option_index: 0 })).status).toBe(400);
  expect((await list(reader.token)).every((i) => i.read_at === null)).toBe(true);
  const response = await comment(reader.token, task.id, { body: "Reviewed", parent_id: followup.id });
  expect(response.parent_id).toBe(root.id);
  const items = await list(reader.token);
  expect(items.filter((i) => [root.id, followup.id].includes(i.source_comment.id)).every((i) => i.read_at !== null)).toBe(true);
  expect(items.find((i) => i.source_comment.id === unrelated.id)!.read_at).toBeNull();
  const next = await comment(admin.token, task.id, { body: "One more question", parent_id: response.id });
  expect((await list(reader.token)).find((i) => i.source_comment.id === next.id)!.read_at).toBeNull();
  const events = await (await request(reader.token, "GET", `/tasks/${task.id}/activity`)).json() as { items: Array<{ action: string; visibility: string; metadata: Record<string, unknown> }> };
  expect(events.items.some((e) => e.action === "inbox.read" && e.visibility === "private" && e.metadata.reason === "reply")).toBe(true);
});

it("answering a question remains a reply and clears only the answerer's notification", async () => {
  const ws = await makeWorkspace(t.app, admin.token, "ANSWER");
  const task = await makeTask(t.app, admin.token, ws.id, { title: "Question" });
  const reader = await makeMember(t.app, admin.token);
  const other = await makeMember(t.app, admin.token);
  const root = await comment(admin.token, task.id, { body: "Which option?", question_options: ["Yes", "No"], mention_ids: [reader.userId, other.userId] });
  const reply = await comment(reader.token, task.id, { body: "Yes", parent_id: root.id, answer_option_index: 0 });
  expect(reply.parent_id).toBe(root.id);
  expect(reply.body).toBe("Yes");
  expect((await list(reader.token))[0]!.read_at).not.toBeNull();
  expect((await list(other.token))[0]!.read_at).toBeNull();
  const result = await (await request(reader.token, "GET", `/tasks/${task.id}/comments`)).json() as { items: Comment[] };
  expect(result.items[0]!.question?.answer_option_index).toBe(0);
  expect(result.items[0]!.replies.map((c) => c.id)).toContain(reply.id);
});
