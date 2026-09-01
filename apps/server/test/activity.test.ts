import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bearer,
  jsonReq,
  makeMember,
  makeTask,
  makeTestApp,
  makeWorkspace,
  setupAdmin,
  type TaskJson,
  type WorkspaceJson,
} from "./helpers";

let t: Awaited<ReturnType<typeof makeTestApp>>;
let admin: { token: string; userId: string };
let member: { userId: string; token: string };
let ws: WorkspaceJson;
let otherWs: WorkspaceJson;
let mine: TaskJson;
let theirs: TaskJson;

interface ActivityJson {
  id: string;
  workspace_id: string;
  task_id: string | null;
  task_key: string | null;
  task_title: string | null;
  actor_id: string;
  actor: { id: string; name: string };
  action: string;
  metadata: Record<string, unknown>;
  created_at: number;
}

const feed = async (token: string, wsIdOrKey: string, qs = ""): Promise<ActivityJson[]> => {
  const res = await t.app.request(`/api/v1/workspaces/${wsIdOrKey}/activity${qs}`, { headers: bearer(token) });
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: ActivityJson[] }).items;
};

beforeAll(async () => {
  t = await makeTestApp();
  admin = await setupAdmin(t.app);
  member = await makeMember(t.app, admin.token, { name: "Feed Member" });
  ws = await makeWorkspace(t.app, admin.token, "ACT");
  otherWs = await makeWorkspace(t.app, admin.token, "ACTB");

  // The member creates one task (so they are associated with it) …
  mine = await makeTask(t.app, member.token, ws.id, { title: "Member's own" });
  await new Promise((r) => setTimeout(r, 3));
  // … and the admin creates another the member never touches.
  theirs = await makeTask(t.app, admin.token, ws.id, { title: "Admin's own" });
  await new Promise((r) => setTimeout(r, 3));
  await t.app.request(`/api/v1/tasks/${theirs.id}`, jsonReq("PATCH", { title: "Admin's own, edited" }, bearer(admin.token)));
  await new Promise((r) => setTimeout(r, 3));
  await t.app.request(`/api/v1/tasks/${mine.id}`, jsonReq("PATCH", { assignee_id: admin.userId }, bearer(admin.token)));
  await makeTask(t.app, admin.token, otherWs.id, { title: "Elsewhere entirely" });
});
afterAll(() => t.cleanup());

describe("activity.list", () => {
  it("returns an items-only envelope, newest first, with actor and task embedded", async () => {
    const res = await t.app.request(`/api/v1/workspaces/${ws.id}/activity`, { headers: bearer(admin.token) });
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["items"]);

    const items = body.items as ActivityJson[];
    expect(items.length).toBe(4); // 2 creates + 1 update + 1 assign
    for (let i = 1; i < items.length; i++) {
      expect(items[i]!.created_at).toBeLessThanOrEqual(items[i - 1]!.created_at);
    }
    expect(items[0]!.action).toBe("task.assigned");
    expect(items[0]!.task_key).toBe(mine.key);
    expect(items[0]!.task_title).toBe("Member's own");
    expect(items[0]!.actor.id).toBe(admin.userId);
    expect(items[0]!.metadata.assignee_id).toBe(admin.userId);
    expect(items.every((e) => e.workspace_id === ws.id)).toBe(true);
  });

  it("resolves the workspace by key and stays scoped to it", async () => {
    const byKey = await feed(admin.token, ws.key);
    expect(byKey.length).toBe(4);
    expect(byKey.every((e) => e.task_key?.startsWith("ACT-"))).toBe(true);

    const elsewhere = await feed(admin.token, otherWs.key);
    expect(elsewhere.map((e) => e.task_title)).toEqual(["Elsewhere entirely"]);
  });

  it("?mine=1 keeps only events on the caller's associated tasks", async () => {
    const all = await feed(member.token, ws.id);
    expect(all.length).toBe(4);

    const onlyMine = await feed(member.token, ws.id, "?mine=1");
    expect(onlyMine.length).toBe(2); // created + assigned, both on the member's task
    expect(onlyMine.every((e) => e.task_id === mine.id)).toBe(true);
    expect(onlyMine.map((e) => e.action)).toEqual(["task.assigned", "task.created"]);

    // The admin is associated with both tasks (creator of one, assignee of the other).
    const adminMine = await feed(admin.token, ws.id, "?mine=1");
    expect(adminMine.length).toBe(4);
  });

  it("paginates with limit/offset", async () => {
    const page1 = await feed(admin.token, ws.id, "?limit=2");
    expect(page1.length).toBe(2);
    const page2 = await feed(admin.token, ws.id, "?limit=2&offset=2");
    expect(page2.length).toBe(2);
    expect(page1.map((e) => e.id)).not.toEqual(page2.map((e) => e.id));

    const beyond = await feed(admin.token, ws.id, "?limit=2&offset=50");
    expect(beyond).toEqual([]);
  });

  it("404s on an unknown workspace and 400s on a bad limit", async () => {
    const missing = await t.app.request("/api/v1/workspaces/NOPE/activity", { headers: bearer(admin.token) });
    expect(missing.status).toBe(404);
    const bad = await t.app.request(`/api/v1/workspaces/${ws.id}/activity?limit=500`, { headers: bearer(admin.token) });
    expect(bad.status).toBe(400);
  });
});
