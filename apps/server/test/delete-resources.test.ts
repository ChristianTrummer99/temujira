import { afterAll, beforeAll, expect, it } from "vitest";
import { bearer, fileUpload, jsonReq, makeMember, makeTask, makeTestApp, makeWorkspace, setupAdmin } from "./helpers";

let t: Awaited<ReturnType<typeof makeTestApp>>;
let admin: Awaited<ReturnType<typeof setupAdmin>>;
beforeAll(async () => { t = await makeTestApp(); admin = await setupAdmin(t.app); });
afterAll(() => t?.cleanup());
const req = (path: string, method = "GET", data?: unknown, token = admin.token) => t.app.request(`/api/v1${path}`,
  data === undefined ? { method, headers: bearer(token) } : jsonReq(method, data, bearer(token)));
async function graph(key: string) {
  const ws = await makeWorkspace(t.app, admin.token, key);
  const member = await makeMember(t.app, admin.token, { workspace_access_all: false, workspace_ids: [ws.id] });
  const task = await makeTask(t.app, admin.token, ws.id, { title: `Delete graph ${key}`, description: 'uniquedeletionphrase' });
  const root = await (await req(`/tasks/${task.id}/comments`, "POST", { body: 'Mention', mention_ids: [member.userId] })).json() as { comment: { id: string } };
  await req(`/tasks/${task.id}/comments`, "POST", { body: 'Reply', parent_id: root.comment.id });
  const tag = await (await req(`/workspaces/${ws.id}/tags`, 'POST', { name: 'Fixture' })).json() as { tag: { id: string } };
  const field = await (await req(`/workspaces/${ws.id}/fields`, 'POST', { name: 'Detail', type: 'text' })).json() as { field: { id: string } };
  await req(`/tasks/${task.id}`, 'PATCH', { tag_ids: [tag.tag.id], field_values: { [field.field.id]: 'Stored value' } });
  const upload = async (path: string) => {
    const response = await t.app.request(`/api/v1${path}`, fileUpload('stored content', 'fixture.txt', 'text/plain', bearer(admin.token)));
    expect(response.status).toBe(200);
    return (await response.json() as { attachment: { id: string } }).attachment.id;
  };
  const files = [await upload(`/tasks/${task.id}/attachments`), await upload(`/comments/${root.comment.id}/attachments`)];
  t.ctx.sqlite.prepare(`INSERT INTO queue_entries(id,user_id,task_id,position,added_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`).run(task.id, admin.userId, task.id, 0, admin.userId, 1, 1);
  return { ws, task, member, files };
}

it("deletes a complete task graph and bytes, retains audit context, and keeps other tasks", async () => {
  const g = await graph('DTASK');
  const otherWs = await makeWorkspace(t.app, admin.token, 'OTHER');
  const other = await makeTask(t.app, admin.token, otherWs.id, { title: 'Keep me' });
  await req(`/tasks/${g.task.id}/links`, 'POST', { type: 'blocks', task: other.id });
  expect((await req(`/tasks/${g.task.id}`, 'DELETE')).status).toBe(200);
  expect((await req(`/tasks/${g.task.key}`)).status).toBe(404);
  expect((await req(`/tasks/${other.id}`)).status).toBe(200);
  for (const table of ['comments', 'attachments', 'inbox_items', 'mentions', 'field_values', 'task_tags', 'task_associations', 'queue_entries']) {
    expect(t.ctx.sqlite.prepare(`SELECT count(*) n FROM ${table} WHERE task_id=?`).get(g.task.id)).toEqual({ n: 0 });
  }
  for (const id of g.files) expect(t.ctx.storage.exists(id)).toBe(false);
  expect(t.ctx.sqlite.prepare('SELECT count(*) n FROM task_links WHERE src_task_id=? OR dst_task_id=?').get(g.task.id, g.task.id)).toEqual({ n: 0 });
  expect(t.ctx.sqlite.prepare('SELECT count(*) n FROM search_fts WHERE task_id=?').get(g.task.id)).toEqual({ n: 0 });
  expect(t.ctx.sqlite.pragma('foreign_key_check')).toEqual([]);
  const log = await (await req(`/activity?workspace=${g.ws.key}&action=task.deleted`)).json() as { items: Array<{ task_id: string | null; task_key: string }> };
  expect(log.items).toMatchObject([{ task_id: null, task_key: g.task.key }]);
  const next = await makeTask(t.app, admin.token, g.ws.id, { title: 'Next' });
  expect(next.number).toBeGreaterThan(g.task.number);
});

it("deletes a populated workspace, grants and settings while preserving admin-only history", async () => {
  const g = await graph('DSPACE');
  const otherWs = await makeWorkspace(t.app, admin.token, 'CROSS');
  const other = await makeTask(t.app, admin.token, otherWs.id, { title: 'Survivor' });
  await req(`/tasks/${other.id}/links`, 'POST', { type: 'relates', task: g.task.id });
  expect((await req(`/workspaces/${g.ws.id}`, 'DELETE')).status).toBe(200);
  expect((await req(`/workspaces/${g.ws.key}`)).status).toBe(404);
  for (const table of ['tasks', 'statuses', 'tags', 'field_defs', 'inbox_items', 'user_workspaces']) {
    expect(t.ctx.sqlite.prepare(`SELECT count(*) n FROM ${table} WHERE workspace_id=?`).get(g.ws.id)).toEqual({ n: 0 });
  }
  expect(t.ctx.sqlite.pragma('foreign_key_check')).toEqual([]);
  for (const id of g.files) expect(t.ctx.storage.exists(id)).toBe(false);
  const log = await (await req('/activity?action=workspace.deleted')).json() as { items: Array<{ visibility: string; metadata: { target_id: string } }> };
  expect(log.items.some((e) => e.visibility === 'admin' && e.metadata.target_id === g.ws.id)).toBe(true);
  expect((await req(`/tasks/${other.id}`)).status).toBe(200);
  // Reusing the key does not turn old history into history for the new workspace.
  const replacement = await makeWorkspace(t.app, admin.token, g.ws.key);
  expect(replacement.id).not.toBe(g.ws.id);
});

it("rejects missing scopes and hidden targets and rolls back a failed delete before unlinking bytes", async () => {
  const g = await graph('GUARD');
  const viewer = await makeMember(t.app, admin.token, { scopes: [] });
  const scoped = await makeMember(t.app, admin.token, { scopes: ['tasks:write', 'workspaces:manage'], workspace_access_all: false, workspace_ids: [] });
  expect((await req(`/tasks/${g.task.id}`, 'DELETE', undefined, viewer.token)).status).toBe(403);
  expect((await req(`/workspaces/${g.ws.id}`, 'DELETE', undefined, g.member.token)).status).toBe(403);
  expect((await req(`/tasks/${g.task.id}`, 'DELETE', undefined, scoped.token)).status).toBe(404);
  expect((await req(`/workspaces/${g.ws.id}`, 'DELETE', undefined, scoped.token)).status).toBe(404);
  t.ctx.sqlite.exec("CREATE TRIGGER reject_delete BEFORE DELETE ON tasks BEGIN SELECT RAISE(ABORT, 'fixture failure'); END");
  try { expect((await req(`/tasks/${g.task.id}`, 'DELETE')).status).toBe(500); }
  finally { t.ctx.sqlite.exec('DROP TRIGGER reject_delete'); }
  expect((await req(`/tasks/${g.task.id}`)).status).toBe(200);
  for (const id of g.files) expect(t.ctx.storage.exists(id)).toBe(true);
  expect(t.ctx.sqlite.pragma('foreign_key_check')).toEqual([]);
});
