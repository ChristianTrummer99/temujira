import { afterAll, beforeAll, expect, it } from "vitest";
import { type InboxEvent, ROUTES } from "@temujira/shared";
import { bearer, jsonReq, makeMember, makeTask, makeTestApp, makeWorkspace, setupAdmin } from "./helpers";

let t: Awaited<ReturnType<typeof makeTestApp>>;
let admin: Awaited<ReturnType<typeof setupAdmin>>;
beforeAll(async () => { t = await makeTestApp(); admin = await setupAdmin(t.app); });
afterAll(() => t?.cleanup());
async function watch(token: string, query = "") {
  const res = await t.app.request(`/api/v1/inbox/events${query}`, { headers: bearer(token) });
  expect(res.status).toBe(200);
  const data = await res.json();
  expect(ROUTES["inbox.watch"].response.safeParse(data).success).toBe(true);
  return data as { items: InboxEvent[]; cursor: number; has_more: boolean };
}

it("starts now, drains equal-time notifications in order, includes read items, and never reuses cursors", async () => {
  const ws = await makeWorkspace(t.app, admin.token, "WATCH");
  const task = await makeTask(t.app, admin.token, ws.id, { title: "Messages" });
  const member = await makeMember(t.app, admin.token);
  const start = await watch(member.token);
  expect(start.items).toEqual([]);
  const notify = async () => {
    const res = await t.app.request(`/api/v1/tasks/${task.id}/comments`, jsonReq("POST", { body: "@Member review", mention_ids: [member.userId] }, bearer(admin.token)));
    expect(res.status).toBe(200);
    return (await res.json() as { comment: { id: string } }).comment.id;
  };
  const comments = [await notify(), await notify(), await notify()];
  t.ctx.sqlite.prepare("UPDATE inbox_items SET created_at=1 WHERE user_id=?").run(member.userId);
  const page1 = await watch(member.token, `?after=${start.cursor}&limit=2`);
  expect(page1.items).toHaveLength(2);
  expect(page1.has_more).toBe(true);
  await t.app.request('/api/v1/inbox/read?mark_read=1', { method: 'POST', headers: bearer(member.token) });
  const page2 = await watch(member.token, `?after=${page1.cursor}&limit=2`);
  expect(page2.items).toHaveLength(1);
  expect(page2.items[0]!.item.read_at).not.toBeNull();
  expect([...page1.items, ...page2.items].map((x) => x.item.source_comment.id)).toEqual(comments);
  expect((await watch(member.token, `?after=${page2.cursor}`)).items).toEqual([]);
  for (const id of comments) await t.app.request(`/api/v1/comments/${id}`, { method: 'DELETE', headers: bearer(admin.token) });
  expect((await watch(member.token)).cursor).toBe(page2.cursor);
  await notify();
  const next = await watch(member.token, `?after=${page2.cursor}`);
  expect(next.items).toHaveLength(1);
  expect(next.cursor).toBeGreaterThan(page2.cursor);
});

it("filters each page for the current user and current workspace permissions", async () => {
  const ws = await makeWorkspace(t.app, admin.token, "VISIB");
  const hidden = await makeWorkspace(t.app, admin.token, "PRIV");
  const member = await makeMember(t.app, admin.token);
  for (const w of [ws, hidden]) {
    const task = await makeTask(t.app, admin.token, w.id, { title: w.key });
    await t.app.request(`/api/v1/tasks/${task.id}/comments`, jsonReq("POST", { body: "ping", mention_ids: [member.userId] }, bearer(admin.token)));
  }
  await t.app.request(`/api/v1/users/${member.userId}`, jsonReq("PATCH", { workspace_access_all: false, workspace_ids: [ws.id] }, bearer(admin.token)));
  const page = await watch(member.token, "?after=0&limit=1");
  expect(page.items).toHaveLength(1);
  expect(page.items[0]!.item.workspace_id).toBe(ws.id);
  expect(page.has_more).toBe(false);
  expect((await watch(admin.token, "?after=0")).items).toEqual([]);
  await t.app.request('/api/v1/inbox/read?mark_read=1', { method: 'POST', headers: bearer(member.token) });
  expect(t.ctx.sqlite.prepare('SELECT read_at FROM inbox_items WHERE user_id=? AND workspace_id=?').get(member.userId, hidden.id)).toEqual({ read_at: null });
});
