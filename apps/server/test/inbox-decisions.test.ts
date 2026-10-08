import { afterAll, beforeAll, expect, it } from 'vitest';
import { bearer, jsonReq, makeMember, makeTask, makeTestApp, makeWorkspace, setupAdmin } from './helpers';
import type { InboxConversation } from '@temujira/shared';

let t: Awaited<ReturnType<typeof makeTestApp>>;
let admin: Awaited<ReturnType<typeof setupAdmin>>;
beforeAll(async () => { t = await makeTestApp(); admin = await setupAdmin(t.app); });
afterAll(() => t?.cleanup());
const request = (token: string, method: string, path: string, body?: unknown) => t.app.request(`/api/v1${path}`, body === undefined ? { method, headers: bearer(token) } : jsonReq(method, body, bearer(token)));
async function inbox(token: string, query = '') {
  const response = await request(token, 'GET', `/inbox${query}`);
  expect(response.status).toBe(200);
  return await response.json() as { items: InboxConversation[]; total: number; unread: number };
}

it('filters unanswered questions before counts/paging and applies the same scope to mark-all', async () => {
  const ws = await makeWorkspace(t.app, admin.token, 'DECIDE');
  const hidden = await makeWorkspace(t.app, admin.token, 'HIDDEN');
  const task = await makeTask(t.app, admin.token, ws.id, { title: 'Decisions' });
  const secret = await makeTask(t.app, admin.token, hidden.id, { title: 'Hidden' });
  const reader = await makeMember(t.app, admin.token);
  const other = await makeMember(t.app, admin.token);
  const post = async (taskId: string, body: Record<string, unknown>) => (await (await request(admin.token, 'POST', `/tasks/${taskId}/comments`, body)).json() as { comment: { id: string } }).comment;
  const first = await post(task.id, { body: 'First question', question_options: ['Yes', 'No'], mention_ids: [reader.userId, other.userId] });
  const second = await post(task.id, { body: 'Second question', question_options: ['A', 'B'], mention_ids: [reader.userId] });
  await post(task.id, { body: 'Status update on question', parent_id: first.id, mention_ids: [reader.userId] });
  const status = await post(task.id, { body: 'Ordinary status update', mention_ids: [reader.userId] });
  const answered = await post(task.id, { body: 'Already answered', question_options: ['A', 'B'], mention_ids: [reader.userId] });
  await post(task.id, { body: 'A', parent_id: answered.id, answer_option_index: 0 });
  await post(secret.id, { body: 'Hidden decision', question_options: ['A', 'B'], mention_ids: [reader.userId] });
  await request(admin.token, 'PATCH', `/users/${reader.userId}`, { workspace_access_all: false, workspace_ids: [ws.id] });
  const filtered = await inbox(reader.token, '?needs_decision=true&limit=1');
  expect(filtered.total).toBe(2); expect(filtered.unread).toBe(2); expect(filtered.items).toHaveLength(1);
  const all = await inbox(reader.token, '?needs_decision=true&include_read=true');
  expect(new Set(all.items.map((item) => item.thread_id))).toEqual(new Set([first.id, second.id]));
  expect(await (await request(reader.token, 'POST', '/inbox/read?mark_read=true&needs_decision=true')).json()).toEqual({ ok: true, updated: 2 });
  expect((await inbox(reader.token, '?needs_decision=true')).unread).toBe(0);
  expect(new Set((await inbox(reader.token)).items.map((item) => item.thread_id))).toEqual(new Set([status.id, answered.id]));
  expect((await inbox(other.token)).unread).toBe(1);
  expect(t.ctx.sqlite.prepare('SELECT read_at FROM inbox_items WHERE user_id=? AND workspace_id=?').get(reader.userId, hidden.id)).toEqual({ read_at: null });
});

it('checks the current decision state when marking read, including questions answered after listing', async () => {
  const ws = await makeWorkspace(t.app, admin.token, 'RACE');
  const task = await makeTask(t.app, admin.token, ws.id, { title: 'Changing question' });
  const reader = await makeMember(t.app, admin.token);
  const result = await request(admin.token, 'POST', `/tasks/${task.id}/comments`, { body: 'Choose', question_options: ['A', 'B'], mention_ids: [reader.userId] });
  const { comment } = await result.json() as { comment: { id: string } };
  expect((await inbox(reader.token, '?needs_decision=true')).unread).toBe(1);
  await request(admin.token, 'POST', `/tasks/${task.id}/comments`, { body: 'A', parent_id: comment.id, answer_option_index: 0 });
  expect(await (await request(reader.token, 'POST', '/inbox/read?mark_read=true&needs_decision=true')).json()).toEqual({ ok: true, updated: 0 });
  expect((await inbox(reader.token)).unread).toBe(1);
});
