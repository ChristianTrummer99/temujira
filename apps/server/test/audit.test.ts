import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROUTES, ROUTE_IDS } from "@temujira/shared";
import { AUDIT_ACTIONS } from "../src/audit";
import { bearer, fileUpload, jsonReq, makeMember, makeTask, makeTestApp, makeWorkspace, setupAdmin } from "./helpers";

let t: Awaited<ReturnType<typeof makeTestApp>>;
let admin: Awaited<ReturnType<typeof setupAdmin>>;
beforeAll(async () => { t = await makeTestApp(); admin = await setupAdmin(t.app); });
afterAll(() => t?.cleanup());
async function feed(token: string, path = '/api/v1/activity') {
  const response = await t.app.request(path, { headers: bearer(token) });
  expect(response.status).toBe(200);
  return await response.json() as { items: Array<{ action: string; task_id: string | null; actor_id: string; metadata: Record<string, unknown> }>; total: number };
}

describe('mutation audit', () => {
  it('covers every non-read route explicitly', () => {
    expect(Object.keys(AUDIT_ACTIONS).sort()).toEqual(ROUTE_IDS.filter((id) => ROUTES[id].method !== 'GET').sort());
  });

  it('logs ticket changes, edited/deleted comments and indirect attachment actions', async () => {
    const ws = await makeWorkspace(t.app, admin.token, 'AUD');
    const task = await makeTask(t.app, admin.token, ws.id, { title: 'Original' });
    await t.app.request(`/api/v1/tasks/${task.id}`, jsonReq('PATCH', { title: 'Revised', description: 'details' }, bearer(admin.token)));
    const res = await t.app.request(`/api/v1/tasks/${task.id}/comments`, jsonReq('POST', { body: 'First' }, bearer(admin.token)));
    const { comment } = await res.json() as { comment: { id: string } };
    await t.app.request(`/api/v1/comments/${comment.id}`, jsonReq('PATCH', { body: 'Edited' }, bearer(admin.token)));
    const upload = await t.app.request(`/api/v1/comments/${comment.id}/attachments`, fileUpload(new TextEncoder().encode('file'), 'audit.txt', 'text/plain', bearer(admin.token)));
    const { attachment } = await upload.json() as { attachment: { id: string } };
    await t.app.request(`/api/v1/attachments/${attachment.id}`, { method: 'DELETE', headers: bearer(admin.token) });
    await t.app.request(`/api/v1/comments/${comment.id}`, { method: 'DELETE', headers: bearer(admin.token) });
    const result = await feed(admin.token, `/api/v1/tasks/${task.key}/activity`);
    expect(result.items.map((e) => e.action)).toEqual(expect.arrayContaining(['task.created', 'task.updated', 'comment.created', 'comment.updated', 'comment.deleted', 'attachment.uploaded', 'attachment.deleted']));
    expect(result.items.every((e) => e.task_id === task.id && e.actor_id === admin.userId)).toBe(true);
    expect(result.items.find((e) => e.action === 'task.updated')?.metadata.changes).toContainEqual({ field: 'title', from: 'Original', to: 'Revised' });
    const before = result.total;
    await t.app.request(`/api/v1/tasks/${task.id}`, { headers: bearer(admin.token) });
    expect((await feed(admin.token, `/api/v1/tasks/${task.key}/activity`)).total).toBe(before);
  });

  it('keeps cross-workspace and private events out of every unauthorized feed', async () => {
    const ws = await makeWorkspace(t.app, admin.token, 'LOGA');
    const secret = await makeWorkspace(t.app, admin.token, 'LOGB');
    const a = await makeTask(t.app, admin.token, ws.id, { title: 'Visible' });
    const b = await makeTask(t.app, admin.token, secret.id, { title: 'Confidential' });
    const member = await makeMember(t.app, admin.token, { workspace_access_all: false, workspace_ids: [ws.id] });
    await t.app.request(`/api/v1/tasks/${a.id}/links`, jsonReq('POST', { type: 'blocks', task: b.key }, bearer(admin.token)));
    await t.app.request('/api/v1/auth/me', jsonReq('PATCH', { name: 'Audit admin' }, bearer(admin.token)));
    const result = await feed(member.token);
    expect(JSON.stringify(result)).not.toMatch(/Confidential|LOGB|profile.updated|task.linked/);
    const ownTicket = await feed(member.token, `/api/v1/tasks/${a.id}/activity`);
    expect(ownTicket.items.some((e) => e.action === 'task.linked')).toBe(false);
    expect((await t.app.request(`/api/v1/tasks/${b.id}/activity`, { headers: bearer(member.token) })).status).toBe(404);
    const paged = await feed(member.token, '/api/v1/activity?limit=1');
    expect(paged.total).toBe(result.total);
    expect(paged.items).toHaveLength(1);
    const adminResult = await feed(admin.token);
    expect(adminResult.items.some((e) => e.action === 'profile.updated')).toBe(true);
  });

  it('redacts credentials and retains administrative history without exposing it to members', async () => {
    const member = await makeMember(t.app, admin.token);
    const keyRes = await t.app.request('/api/v1/api-keys', jsonReq('POST', { name: 'audit-key', user_id: member.userId }, bearer(admin.token)));
    const { apiKey, token } = await keyRes.json() as { apiKey: { id: string }; token: string };
    await t.app.request(`/api/v1/api-keys/${apiKey.id}`, { method: 'DELETE', headers: bearer(admin.token) });
    const history = await feed(admin.token, '/api/v1/activity?limit=200');
    expect(history.items.map((e) => e.action)).toContain('api_key.revoked');
    expect(JSON.stringify(history)).not.toContain(token);
    expect(JSON.stringify(history)).not.toContain(member.password);
    expect(JSON.stringify(history)).not.toContain(admin.token);
    const memberHistory = await feed(member.token);
    expect(memberHistory.items.some((e) => e.action === 'user.created')).toBe(false);
    expect(memberHistory.items.some((e) => e.action === 'api_key.created')).toBe(true); // own credential metadata
  });

  it('puts bulk status replacement and field/tag deletion in each affected ticket history', async () => {
    const ws = await makeWorkspace(t.app, admin.token, 'BULK');
    const task = await makeTask(t.app, admin.token, ws.id, { title: 'Affected' });
    const statusRes = await t.app.request(`/api/v1/workspaces/${ws.id}/statuses`, { headers: bearer(admin.token) });
    const { items } = await statusRes.json() as { items: Array<{ id: string }> };
    const moveTo = items.find((s) => s.id !== task.status_id)!;
    expect((await t.app.request(`/api/v1/statuses/${task.status_id}?move_to=${moveTo.id}`, { method: 'DELETE', headers: bearer(admin.token) })).status).toBe(200);
    expect((await feed(admin.token, `/api/v1/tasks/${task.id}/activity`)).items.some((e) => e.action === 'status.deleted')).toBe(true);
    const tagRes = await t.app.request(`/api/v1/workspaces/${ws.id}/tags`, jsonReq('POST', { name: 'Disposable', color: '#112233' }, bearer(admin.token)));
    const { tag } = await tagRes.json() as { tag: { id: string } };
    const fieldRes = await t.app.request(`/api/v1/workspaces/${ws.id}/fields`, jsonReq('POST', { name: 'Fixture', type: 'text' }, bearer(admin.token)));
    const { field } = await fieldRes.json() as { field: { id: string } };
    expect((await t.app.request(`/api/v1/tasks/${task.id}`, jsonReq('PATCH', { tag_ids: [tag.id], field_values: { [field.id]: 'present' } }, bearer(admin.token)))).status).toBe(200);
    expect((await t.app.request(`/api/v1/tags/${tag.id}`, { method: 'DELETE', headers: bearer(admin.token) })).status).toBe(200);
    expect((await t.app.request(`/api/v1/fields/${field.id}`, { method: 'DELETE', headers: bearer(admin.token) })).status).toBe(200);
    const actions = (await feed(admin.token, `/api/v1/tasks/${task.id}/activity`)).items.map((e) => e.action);
    expect(actions).toContain('tag.deleted');
    expect(actions).toContain('field.deleted');
  });
});
