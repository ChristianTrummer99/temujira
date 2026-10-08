import { afterAll, beforeAll, expect, it } from "vitest";
import { InboxConversationSchema, type Comment, type InboxConversation, type InboxEvent } from "@temujira/shared";
import { newId } from "../src/util";
import { bearer, jsonReq, makeMember, makeTask, makeTestApp, makeWorkspace, setupAdmin } from "./helpers";

let t: Awaited<ReturnType<typeof makeTestApp>>;
let admin: Awaited<ReturnType<typeof setupAdmin>>;
beforeAll(async () => { t = await makeTestApp(); admin = await setupAdmin(t.app); });
afterAll(() => t?.cleanup());
const request = (token: string, method: string, path: string, data?: unknown) => t.app.request(`/api/v1${path}`,
  data === undefined ? { method, headers: bearer(token) } : jsonReq(method, data, bearer(token)));
async function inbox(token: string, query = "") {
  const response = await request(token, "GET", `/inbox${query}`);
  expect(response.status).toBe(200);
  const result = await response.json() as { items: InboxConversation[]; total: number; unread: number };
  for (const item of result.items) expect(InboxConversationSchema.safeParse(item).success).toBe(true);
  return result;
}
async function post(token: string, task: string, input: Record<string, unknown>) {
  const response = await request(token, "POST", `/tasks/${task}/comments`, input);
  expect(response.status).toBe(200);
  return (await response.json() as { comment: Comment }).comment;
}

it("keeps an answered question and new replies in one stable item, but streams each new message", async () => {
  const ws = await makeWorkspace(t.app, admin.token, "CONVO");
  const task = await makeTask(t.app, admin.token, ws.id, { title: "One conversation" });
  const reader = await makeMember(t.app, admin.token);
  const root = await post(admin.token, task.id, { body: "Which rollout?", question_options: ["Gradual", "Immediate"], mention_ids: [reader.userId] });
  const first = await inbox(reader.token);
  const id = first.items[0]!.id;
  expect(first).toMatchObject({ total: 1, unread: 1, items: [{ thread_id: root.id }] });
  const answer = await post(reader.token, task.id, { body: "Gradual", parent_id: root.id, answer_option_index: 0 });
  expect(await inbox(reader.token)).toMatchObject({ total: 0, unread: 0 });
  expect((await inbox(reader.token, "?include_read=true")).items[0]!.id).toBe(id);
  const checkpoint = await (await request(reader.token, "GET", "/inbox/events")).json() as { cursor: number };
  const a = await post(admin.token, task.id, { body: "First follow-up", parent_id: answer.id, mention_ids: [reader.userId] });
  const b = await post(admin.token, task.id, { body: "Second follow-up", parent_id: answer.id, mention_ids: [reader.userId] });
  // Equal timestamps still choose the most recently inserted notification.
  t.ctx.sqlite.prepare("UPDATE inbox_items SET created_at=100 WHERE user_id=?").run(reader.userId);
  const current = await inbox(reader.token);
  expect(current).toMatchObject({ total: 1, unread: 1, items: [{ id, thread_id: root.id, source_comment: { id: b.id }, parent_comment: { id: root.id, question: { answer_option_index: 0 } } }] });
  expect((await inbox(reader.token, "?include_read=true")).total).toBe(1);
  const events = await (await request(reader.token, "GET", `/inbox/events?after=${checkpoint.cursor}`)).json() as { items: InboxEvent[] };
  expect(events.items.map((e) => e.item.source_comment.id)).toEqual([a.id, b.id]);
  expect(await (await request(reader.token, "POST", `/inbox/${id}/read`)).json()).toEqual({ ok: true, updated: 1 });
  expect(await inbox(reader.token)).toMatchObject({ total: 0, unread: 0 });
  // A raw watcher notification id also acknowledges the conversation, idempotently.
  expect(await (await request(reader.token, "POST", `/inbox/${events.items[1]!.item.id}/read`)).json()).toEqual({ ok: true, updated: 0 });
  await post(admin.token, task.id, { body: "New request", parent_id: answer.id });
  expect(await inbox(reader.token)).toMatchObject({ total: 1, unread: 1, items: [{ id, thread_id: root.id }] });
});

it("groups existing duplicate kinds without deleting retained notifications", async () => {
  const ws = await makeWorkspace(t.app, admin.token, "LEGACY");
  const reader = await makeMember(t.app, admin.token);
  const task = await makeTask(t.app, admin.token, ws.id, { title: "Retained records" });
  const root = await post(reader.token, task.id, { body: "Please respond" });
  const reply = await post(admin.token, task.id, { body: "Response", parent_id: root.id });
  const item = (await inbox(reader.token)).items[0]!;
  const duplicate = newId();
  t.ctx.sqlite.prepare(`INSERT INTO inbox_items(id,user_id,workspace_id,task_id,actor_id,kind,source_comment_id,parent_comment_id,read_at,created_at)
    SELECT ?,user_id,workspace_id,task_id,actor_id,'mention',source_comment_id,parent_comment_id,NULL,created_at FROM inbox_items WHERE id=?`).run(duplicate, item.id);
  expect(await inbox(reader.token, "?limit=1")).toMatchObject({ total: 1, unread: 1, items: [{ id: item.id, source_comment: { id: reply.id } }] });
  expect(await (await request(reader.token, "POST", `/inbox/${duplicate}/read`)).json()).toEqual({ ok: true, updated: 1 });
  expect(t.ctx.sqlite.prepare("SELECT count(*) n, sum(read_at IS NULL) unread FROM inbox_items WHERE user_id=?").get(reader.userId)).toEqual({ n: 2, unread: 0 });
});

it("groups before pagination and counts, keeps separate asks separate, and enforces workspace/owner scope", async () => {
  const ws = await makeWorkspace(t.app, admin.token, "PAGES");
  const hidden = await makeWorkspace(t.app, admin.token, "SECRET");
  const reader = await makeMember(t.app, admin.token);
  const other = await makeMember(t.app, admin.token);
  const visibleTask = await makeTask(t.app, admin.token, ws.id, { title: "Visible" });
  const secretTask = await makeTask(t.app, admin.token, hidden.id, { title: "Hidden" });
  const root = await post(admin.token, visibleTask.id, { body: "First ask", mention_ids: [reader.userId, other.userId] });
  for (let i = 0; i < 6; i++) await post(admin.token, visibleTask.id, { body: `Reply ${i}`, parent_id: root.id, mention_ids: [reader.userId] });
  const separate = await post(admin.token, visibleTask.id, { body: "Separate ask", mention_ids: [reader.userId] });
  await post(admin.token, secretTask.id, { body: "Hidden ask", mention_ids: [reader.userId] });
  await request(admin.token, "PATCH", `/users/${reader.userId}`, { workspace_access_all: false, workspace_ids: [ws.id] });
  const page1 = await inbox(reader.token, "?limit=1");
  const page2 = await inbox(reader.token, "?limit=1&offset=1");
  expect(page1.total).toBe(2); expect(page1.unread).toBe(2);
  expect(new Set([page1.items[0]!.thread_id, page2.items[0]!.thread_id])).toEqual(new Set([root.id, separate.id]));
  expect((await inbox(reader.token, "?limit=1&offset=2")).items).toEqual([]);
  const otherId = (await inbox(other.token)).items[0]!.id;
  expect((await request(reader.token, "POST", `/inbox/${otherId}/read`)).status).toBe(404);
  expect(await (await request(reader.token, "POST", "/inbox/read?mark_read=true")).json()).toEqual({ ok: true, updated: 2 });
  expect((await inbox(reader.token)).unread).toBe(0);
  expect((await inbox(other.token)).unread).toBe(1);
  expect(t.ctx.sqlite.prepare("SELECT read_at FROM inbox_items WHERE user_id=? AND workspace_id=?").get(reader.userId, hidden.id)).toEqual({ read_at: null });
});
