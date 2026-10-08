import { afterAll, beforeAll, expect, it } from "vitest";
import { ACTIVITY_CATEGORIES } from "@temujira/shared";
import { AUDIT_ACTIONS } from "../src/audit";
import { bearer, fileUpload, jsonReq, makeMember, makeTask, makeTestApp, makeWorkspace, setupAdmin } from "./helpers";

let t: Awaited<ReturnType<typeof makeTestApp>>;
let admin: Awaited<ReturnType<typeof setupAdmin>>;
beforeAll(async () => { t = await makeTestApp(); admin = await setupAdmin(t.app); });
afterAll(() => t?.cleanup());
async function feed(token: string, path: string) {
  const response = await t.app.request(`/api/v1${path}`, { headers: bearer(token) });
  expect(response.status).toBe(200);
  return await response.json() as { items: Array<{ id: string; action: string; task_id: string; visibility: string }>; total: number };
}

it("provides a filter group for every audited action", () => {
  const actions = new Set<string>(ACTIVITY_CATEGORIES.flatMap((category) => [...category.actions]));
  for (const action of Object.values(AUDIT_ACTIONS)) expect(actions.has(action), action).toBe(true);
});

it("filters action groups before counts and pagination on global, workspace and ticket feeds", async () => {
  const ws = await makeWorkspace(t.app, admin.token, "FILTER");
  const task = await makeTask(t.app, admin.token, ws.id, { title: "Filtered history" });
  const post = (body: object) => t.app.request(`/api/v1/tasks/${task.id}/comments`, jsonReq("POST", body, bearer(admin.token)));
  const root = (await (await post({ body: "Original" })).json() as { comment: { id: string } }).comment;
  await post({ body: "Response", parent_id: root.id });
  await t.app.request(`/api/v1/comments/${root.id}`, jsonReq("PATCH", { body: "Revised" }, bearer(admin.token)));
  await t.app.request(`/api/v1/tasks/${task.id}/attachments`, fileUpload("file", "note.txt", "text/plain", bearer(admin.token)));
  const all = await feed(admin.token, `/activity?workspace=${ws.id}&categories=comments,replies&limit=1`);
  expect(all.total).toBe(3);
  expect(all.items).toHaveLength(1);
  expect(all.items[0]!.action).toBe("comment.updated");
  const second = await feed(admin.token, `/activity?workspace=${ws.id}&categories=comments,replies&limit=1&offset=1`);
  expect(second.total).toBe(3); expect(second.items[0]!.id).not.toBe(all.items[0]!.id);
  expect((await feed(admin.token, `/tasks/${task.id}/activity?categories=files`)).items.map((e) => e.action)).toEqual(["attachment.uploaded"]);
  expect((await feed(admin.token, `/workspaces/${ws.id}/activity?categories=replies,files`)).items.map((e) => e.action).sort()).toEqual(["attachment.uploaded", "comment.replied"]);
  expect((await feed(admin.token, `/tasks/${task.id}/activity?categories=comments&action=comment.updated`)).total).toBe(1);
  expect((await feed(admin.token, `/tasks/${task.id}/activity?categories=files&action=comment.updated`)).total).toBe(0);
  expect((await t.app.request('/api/v1/activity?categories=unknown', { headers: bearer(admin.token) })).status).toBe(400);
});

it("does not expose hidden workspace or private account events through category filters", async () => {
  const visible = await makeWorkspace(t.app, admin.token, "VISIBL");
  const hidden = await makeWorkspace(t.app, admin.token, "HIDDEN");
  const reader = await makeMember(t.app, admin.token, { workspace_access_all: false, workspace_ids: [visible.id] });
  const allowed = await makeTask(t.app, admin.token, visible.id, { title: "Allowed" });
  const secret = await makeTask(t.app, admin.token, hidden.id, { title: "Hidden" });
  for (const task of [allowed, secret]) await t.app.request(`/api/v1/tasks/${task.id}/comments`, jsonReq("POST", { body: task.title }, bearer(admin.token)));
  await t.app.request('/api/v1/auth/me', jsonReq("PATCH", { name: "Operator" }, bearer(admin.token)));
  const comments = await feed(reader.token, '/activity?categories=comments&limit=1');
  expect(comments.total).toBe(1);
  expect(comments.items.map((e) => e.task_id)).toEqual([allowed.id]);
  expect((await feed(reader.token, '/activity?categories=accounts')).items.some((e) => e.action === 'profile.updated' || e.action === 'user.created')).toBe(false);
  expect((await t.app.request(`/api/v1/tasks/${secret.id}/activity?categories=comments`, { headers: bearer(reader.token) })).status).toBe(404);
});
