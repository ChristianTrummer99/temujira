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
} from "./helpers";

let t: Awaited<ReturnType<typeof makeTestApp>>;
let admin: { token: string; userId: string };
let member: { userId: string; token: string; email: string; password: string };

interface StatusJson {
  id: string;
  name: string;
  position: number;
}

const listStatuses = async (wsIdOrKey: string): Promise<StatusJson[]> => {
  const res = await t.app.request(`/api/v1/workspaces/${wsIdOrKey}/statuses`, { headers: bearer(admin.token) });
  return ((await res.json()) as { items: StatusJson[] }).items;
};

interface TaskListJson {
  items: TaskJson[];
  total: number;
  limit: number;
  offset: number;
}

const listTasks = async (wsIdOrKey: string, qs = ""): Promise<TaskListJson> => {
  const res = await t.app.request(`/api/v1/workspaces/${wsIdOrKey}/tasks${qs}`, { headers: bearer(admin.token) });
  expect(res.status).toBe(200);
  return (await res.json()) as TaskListJson;
};

beforeAll(async () => {
  t = await makeTestApp();
  admin = await setupAdmin(t.app);
  member = await makeMember(t.app, admin.token);
});
afterAll(() => t.cleanup());

describe("tasks.create", () => {
  it("creates with defaults: number 1, key WS-1, lowest-position status, empty description", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "TC");
    const task = await makeTask(t.app, admin.token, ws.id, { title: "First task" });
    expect(task.number).toBe(1);
    expect(task.key).toBe("TC-1");
    expect(task.description).toBe("");
    expect(task.status.name).toBe("Backlog");
    expect(task.assignee_id).toBeNull();
    expect(task.assignee).toBeNull();
    expect(task.archived_at).toBeNull();
  });

  it("honors an explicit status of the same workspace; rejects a foreign status", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "TD");
    const foreign = await makeWorkspace(t.app, admin.token, "TE");
    const done = (await listStatuses(ws.id)).find((s) => s.name === "Done")!;
    const task = await makeTask(t.app, admin.token, ws.id, { title: "Done already", status_id: done.id });
    expect(task.status_id).toBe(done.id);

    const foreignStatus = (await listStatuses(foreign.id))[0]!;
    const bad = await t.app.request(
      `/api/v1/workspaces/${ws.id}/tasks`,
      jsonReq("POST", { title: "Bad", status_id: foreignStatus.id }, bearer(admin.token)),
    );
    expect(bad.status).toBe(400);
  });

  it("validates the assignee: existing + active required; deactivated rejected", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "TF");
    const assigned = await makeTask(t.app, admin.token, ws.id, { title: "Mine", assignee_id: member.userId });
    expect(assigned.assignee?.id).toBe(member.userId);

    const ghost = await t.app.request(
      `/api/v1/workspaces/${ws.id}/tasks`,
      jsonReq("POST", { title: "Ghost", assignee_id: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }, bearer(admin.token)),
    );
    expect(ghost.status).toBe(400);

    const victim = await makeMember(t.app, admin.token);
    await t.app.request(`/api/v1/users/${victim.userId}`, { method: "DELETE", headers: bearer(admin.token) });
    const deactivated = await t.app.request(
      `/api/v1/workspaces/${ws.id}/tasks`,
      jsonReq("POST", { title: "Nope", assignee_id: victim.userId }, bearer(admin.token)),
    );
    expect(deactivated.status).toBe(400);

    // Explicit null assignee is fine (unassigned).
    const unassigned = await makeTask(t.app, admin.token, ws.id, { title: "Free", assignee_id: null });
    expect(unassigned.assignee_id).toBeNull();
  });

  it("allocates numbers monotonically under a burst of concurrent creates", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "TG");
    const results = await Promise.all(
      Array.from({ length: 15 }, (_, i) => makeTask(t.app, admin.token, ws.id, { title: `Burst ${i}` })),
    );
    const numbers = results.map((task) => task.number).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    expect(new Set(results.map((task) => task.key)).size).toBe(15);
  });

  it("allows creating in an archived workspace", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "TH");
    await t.app.request(`/api/v1/workspaces/${ws.id}`, jsonReq("PATCH", { archived: true }, bearer(admin.token)));
    const task = await makeTask(t.app, admin.token, ws.id, { title: "Still fine" });
    expect(task.number).toBe(1);
  });

  it("404s for an unknown workspace", async () => {
    const res = await t.app.request(
      "/api/v1/workspaces/NOPE/tasks",
      jsonReq("POST", { title: "Lost" }, bearer(admin.token)),
    );
    expect(res.status).toBe(404);
  });
});

describe("tasks.get", () => {
  it("resolves by ULID and by key, embedding status/assignee/attachments", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "TI");
    const created = await makeTask(t.app, admin.token, ws.id, { title: "Lookup me", assignee_id: member.userId });

    const byId = await t.app.request(`/api/v1/tasks/${created.id}`, { headers: bearer(admin.token) });
    expect(byId.status).toBe(200);
    const a = ((await byId.json()) as { task: TaskJson }).task;
    expect(a.key).toBe("TI-1");
    expect(a.status.name).toBe("Backlog");
    expect(a.assignee?.id).toBe(member.userId);
    expect(a.attachments).toEqual([]);

    const byKey = await t.app.request("/api/v1/tasks/TI-1", { headers: bearer(admin.token) });
    expect(byKey.status).toBe(200);
    expect(((await byKey.json()) as { task: TaskJson }).task.id).toBe(created.id);

    expect((await t.app.request("/api/v1/tasks/TI-999", { headers: bearer(admin.token) })).status).toBe(404);
    expect((await t.app.request("/api/v1/tasks/ZZ-1", { headers: bearer(admin.token) })).status).toBe(404);
    expect(
      (await t.app.request("/api/v1/tasks/01ARZ3NDEKTSV4RRFFQ69G5FAV", { headers: bearer(admin.token) })).status,
    ).toBe(404);
    expect((await t.app.request("/api/v1/tasks/garbage", { headers: bearer(admin.token) })).status).toBe(404);
  });
});

describe("tasks.update", () => {
  it("edits fields, moves status, (un)assigns, archives, and bumps updated_at", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "TJ");
    const inProgress = (await listStatuses(ws.id)).find((s) => s.name === "In Progress")!;
    const created = await makeTask(t.app, admin.token, ws.id, { title: "Original", assignee_id: member.userId });

    await new Promise((r) => setTimeout(r, 5)); // ensure a later updated_at
    const res = await t.app.request(
      "/api/v1/tasks/TJ-1",
      jsonReq(
        "PATCH",
        { title: "Edited", description: "New **body**", status_id: inProgress.id, assignee_id: null, archived: true },
        bearer(admin.token),
      ),
    );
    expect(res.status).toBe(200);
    const { task } = (await res.json()) as { task: TaskJson };
    expect(task.title).toBe("Edited");
    expect(task.description).toBe("New **body**");
    expect(task.status_id).toBe(inProgress.id);
    expect(task.status.name).toBe("In Progress");
    expect(task.assignee_id).toBeNull();
    expect(task.assignee).toBeNull();
    expect(task.archived_at).not.toBeNull();
    expect(task.updated_at).toBeGreaterThan(created.updated_at);

    const unarchive = await t.app.request(
      "/api/v1/tasks/TJ-1",
      jsonReq("PATCH", { archived: false, assignee_id: member.userId }, bearer(admin.token)),
    );
    const after = ((await unarchive.json()) as { task: TaskJson }).task;
    expect(after.archived_at).toBeNull();
    expect(after.assignee?.id).toBe(member.userId);
  });

  it("rejects a status from another workspace and a deactivated assignee", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "TK");
    const foreign = await makeWorkspace(t.app, admin.token, "TL");
    await makeTask(t.app, admin.token, ws.id, { title: "Guarded" });
    const foreignStatus = (await listStatuses(foreign.id))[0]!;

    const badStatus = await t.app.request(
      "/api/v1/tasks/TK-1",
      jsonReq("PATCH", { status_id: foreignStatus.id }, bearer(admin.token)),
    );
    expect(badStatus.status).toBe(400);

    const victim = await makeMember(t.app, admin.token);
    await t.app.request(`/api/v1/users/${victim.userId}`, { method: "DELETE", headers: bearer(admin.token) });
    const badAssignee = await t.app.request(
      "/api/v1/tasks/TK-1",
      jsonReq("PATCH", { assignee_id: victim.userId }, bearer(admin.token)),
    );
    expect(badAssignee.status).toBe(400);
  });

  it("404s on a missing task", async () => {
    const res = await t.app.request("/api/v1/tasks/ZZ-42", jsonReq("PATCH", { title: "X" }, bearer(admin.token)));
    expect(res.status).toBe(404);
  });
});

describe("tasks.list", () => {
  let ws: { id: string; key: string };
  let backlog: StatusJson;
  let inProgress: StatusJson;

  beforeAll(async () => {
    ws = await makeWorkspace(t.app, admin.token, "TLM");
    const sts = await listStatuses(ws.id);
    backlog = sts.find((s) => s.name === "Backlog")!;
    inProgress = sts.find((s) => s.name === "In Progress")!;
    // 1 alpha (assigned to member, in progress), 2 bravo, 3 charlie 50% done,
    // 4 delta 50x done, 5 archived echo — created in order.
    await makeTask(t.app, admin.token, ws.id, {
      title: "alpha Fix Login",
      status_id: inProgress.id,
      assignee_id: member.userId,
    });
    await makeTask(t.app, admin.token, ws.id, { title: "bravo task" });
    await makeTask(t.app, admin.token, ws.id, { title: "charlie 50% done" });
    await makeTask(t.app, admin.token, ws.id, { title: "delta 50x done" });
    await makeTask(t.app, admin.token, ws.id, { title: "echo archived" });
    await t.app.request(`/api/v1/tasks/${ws.key}-5`, jsonReq("PATCH", { archived: true }, bearer(admin.token)));
  });

  it("returns {items,total,limit,offset}, defaults: archived excluded, created_at desc", async () => {
    const data = await listTasks(ws.id);
    expect(data.total).toBe(4);
    expect(data.limit).toBe(50);
    expect(data.offset).toBe(0);
    expect(data.items.map((task) => task.number)).toEqual([4, 3, 2, 1]);
    expect(data.items.every((task) => task.archived_at === null)).toBe(true);
    // Embedded status + assignee come from joins.
    expect(data.items.find((task) => task.number === 1)!.status.name).toBe("In Progress");
    expect(data.items.find((task) => task.number === 1)!.assignee?.id).toBe(member.userId);
  });

  it("include_archived shows archived tasks", async () => {
    const data = await listTasks(ws.id, "?include_archived=1");
    expect(data.total).toBe(5);
    expect(data.items.some((task) => task.archived_at !== null)).toBe(true);
  });

  it("filters by status_id and assignee_id", async () => {
    const byStatus = await listTasks(ws.id, `?status_id=${inProgress.id}`);
    expect(byStatus.total).toBe(1);
    expect(byStatus.items[0]!.title).toBe("alpha Fix Login");

    const byAssignee = await listTasks(ws.id, `?assignee_id=${member.userId}`);
    expect(byAssignee.total).toBe(1);
    expect(byAssignee.items[0]!.number).toBe(1);

    const byBoth = await listTasks(ws.id, `?status_id=${backlog.id}&assignee_id=${member.userId}`);
    expect(byBoth.total).toBe(0);
    expect(byBoth.items).toEqual([]);
  });

  it("searches title case-insensitively and escapes LIKE wildcards", async () => {
    const ci = await listTasks(ws.id, `?q=${encodeURIComponent("FIX LOGIN")}`);
    expect(ci.total).toBe(1);
    expect(ci.items[0]!.title).toBe("alpha Fix Login");

    // %-escape: "50%" must not match "50x done".
    const pct = await listTasks(ws.id, `?q=${encodeURIComponent("50%")}`);
    expect(pct.total).toBe(1);
    expect(pct.items[0]!.title).toBe("charlie 50% done");

    // _-escape: "50_" must match nothing (no literal underscore in any title).
    const underscore = await listTasks(ws.id, `?q=${encodeURIComponent("50_")}`);
    expect(underscore.total).toBe(0);
  });

  it("sorts by number, title, and updated_at in both directions", async () => {
    const numAsc = await listTasks(ws.id, "?sort=number&order=asc");
    expect(numAsc.items.map((task) => task.number)).toEqual([1, 2, 3, 4]);

    const titleDesc = await listTasks(ws.id, "?sort=title&order=desc");
    expect(titleDesc.items.map((task) => task.title.split(" ")[0])).toEqual(["delta", "charlie", "bravo", "alpha"]);

    await t.app.request(`/api/v1/tasks/${ws.key}-2`, jsonReq("PATCH", { description: "touched" }, bearer(admin.token)));
    const updatedDesc = await listTasks(ws.id, "?sort=updated_at&order=desc");
    expect(updatedDesc.items[0]!.number).toBe(2);
  });

  it("paginates with limit/offset while total reflects the filtered set", async () => {
    const page1 = await listTasks(ws.id, "?sort=number&order=asc&limit=2&offset=0");
    expect(page1.total).toBe(4);
    expect(page1.limit).toBe(2);
    expect(page1.offset).toBe(0);
    expect(page1.items.map((task) => task.number)).toEqual([1, 2]);

    const page2 = await listTasks(ws.id, "?sort=number&order=asc&limit=2&offset=2");
    expect(page2.items.map((task) => task.number)).toEqual([3, 4]);

    const beyond = await listTasks(ws.id, "?sort=number&order=asc&limit=2&offset=10");
    expect(beyond.items).toEqual([]);
    expect(beyond.total).toBe(4);
  });

  it("rejects a limit above 200 and unknown sort fields (validation)", async () => {
    const tooBig = await t.app.request(`/api/v1/workspaces/${ws.id}/tasks?limit=500`, {
      headers: bearer(admin.token),
    });
    expect(tooBig.status).toBe(400);
    const badSort = await t.app.request(`/api/v1/workspaces/${ws.id}/tasks?sort=priority`, {
      headers: bearer(admin.token),
    });
    expect(badSort.status).toBe(400);
  });

  it("only returns tasks of the requested workspace", async () => {
    const other = await makeWorkspace(t.app, admin.token, "TN");
    await makeTask(t.app, admin.token, other.id, { title: "elsewhere" });
    const data = await listTasks(other.id);
    expect(data.total).toBe(1);
    expect(data.items[0]!.title).toBe("elsewhere");
    expect(data.items[0]!.key).toBe("TN-1");
  });
});

interface TagJson {
  id: string;
  workspace_id: string;
  name: string;
  color: string;
}

describe("task tags (tag_ids)", () => {
  let ws: { id: string; key: string };
  let foreignWs: { id: string; key: string };
  let bug: TagJson;
  let epic: TagJson;
  let foreignTag: TagJson;

  const makeTag = async (wsIdOrKey: string, name: string): Promise<TagJson> => {
    const res = await t.app.request(`/api/v1/workspaces/${wsIdOrKey}/tags`, jsonReq("POST", { name }, bearer(admin.token)));
    expect(res.status).toBe(200);
    return ((await res.json()) as { tag: TagJson }).tag;
  };

  beforeAll(async () => {
    ws = await makeWorkspace(t.app, admin.token, "TTG");
    foreignWs = await makeWorkspace(t.app, admin.token, "TTGB");
    bug = await makeTag(ws.id, "Bug");
    epic = await makeTag(ws.id, "Epic");
    foreignTag = await makeTag(foreignWs.id, "Foreign");
  });

  it("embeds tags on create, list and get (always an array, name-ordered)", async () => {
    const tagged = await makeTask(t.app, admin.token, ws.id, { title: "tagged", tag_ids: [epic.id, bug.id] });
    expect(tagged.tags.map((x) => x.name)).toEqual(["Bug", "Epic"]);
    expect(tagged.tags[0]!.workspace_id).toBe(ws.id);

    const plain = await makeTask(t.app, admin.token, ws.id, { title: "untagged" });
    expect(plain.tags).toEqual([]);

    const listed = await listTasks(ws.id);
    expect(listed.items.find((x) => x.id === tagged.id)!.tags.map((x) => x.name)).toEqual(["Bug", "Epic"]);

    const got = await t.app.request(`/api/v1/tasks/${tagged.id}`, { headers: bearer(admin.token) });
    expect(((await got.json()) as { task: TaskJson }).task.tags.map((x) => x.name)).toEqual(["Bug", "Epic"]);
  });

  it("rejects a tag from another workspace and an unknown tag (400, nothing written)", async () => {
    const foreign = await t.app.request(
      `/api/v1/workspaces/${ws.id}/tasks`,
      jsonReq("POST", { title: "bad tag", tag_ids: [foreignTag.id] }, bearer(admin.token)),
    );
    expect(foreign.status).toBe(400);

    const unknown = await t.app.request(
      `/api/v1/workspaces/${ws.id}/tasks`,
      jsonReq("POST", { title: "ghost tag", tag_ids: ["01ARZ3NDEKTSV4RRFFQ69G5FAV"] }, bearer(admin.token)),
    );
    expect(unknown.status).toBe(400);
    expect((await listTasks(ws.id)).items.some((x) => x.title === "bad tag" || x.title === "ghost tag")).toBe(false);
  });

  it("update replaces the whole set; [] clears it; a foreign tag is refused", async () => {
    const task = await makeTask(t.app, admin.token, ws.id, { title: "retagged", tag_ids: [bug.id] });

    const swapped = await t.app.request(`/api/v1/tasks/${task.id}`, jsonReq("PATCH", { tag_ids: [epic.id] }, bearer(admin.token)));
    expect(((await swapped.json()) as { task: TaskJson }).task.tags.map((x) => x.name)).toEqual(["Epic"]);

    const cleared = await t.app.request(`/api/v1/tasks/${task.id}`, jsonReq("PATCH", { tag_ids: [] }, bearer(admin.token)));
    expect(((await cleared.json()) as { task: TaskJson }).task.tags).toEqual([]);

    const bad = await t.app.request(
      `/api/v1/tasks/${task.id}`,
      jsonReq("PATCH", { tag_ids: [foreignTag.id] }, bearer(admin.token)),
    );
    expect(bad.status).toBe(400);

    // Omitting tag_ids leaves the set untouched.
    await t.app.request(`/api/v1/tasks/${task.id}`, jsonReq("PATCH", { tag_ids: [bug.id, epic.id] }, bearer(admin.token)));
    const untouched = await t.app.request(`/api/v1/tasks/${task.id}`, jsonReq("PATCH", { title: "renamed" }, bearer(admin.token)));
    expect(((await untouched.json()) as { task: TaskJson }).task.tags.map((x) => x.name)).toEqual(["Bug", "Epic"]);
  });

  it("filters the list by tag_id with an honest total, and accepts group_by as a hint", async () => {
    const filtered = await listTasks(ws.id, `?tag_id=${bug.id}`);
    expect(filtered.total).toBe(filtered.items.length);
    expect(filtered.items.every((x) => x.tags.some((tag) => tag.id === bug.id))).toBe(true);
    expect(filtered.items.length).toBeGreaterThan(0);

    const none = await listTasks(ws.id, `?tag_id=${foreignTag.id}`);
    expect(none.total).toBe(0);
    expect(none.items).toEqual([]);

    // group_by is presentational: the server still returns a flat list.
    const grouped = await listTasks(ws.id, "?group_by=tag");
    expect(Array.isArray(grouped.items)).toBe(true);
    expect(grouped.total).toBeGreaterThan(0);
    // group_by is an open string so a custom select field id can be passed (FR-34).
    const badGroup = await t.app.request(`/api/v1/workspaces/${ws.id}/tasks?group_by=priority`, {
      headers: bearer(admin.token),
    });
    expect(badGroup.status).toBe(200);
  });
});

describe("tasks.mine", () => {
  let ws: { id: string; key: string };
  let other: { id: string; key: string };
  let owner: { userId: string; token: string };
  let first: TaskJson;
  let second: TaskJson;
  let third: TaskJson;

  const mine = async (token: string, qs = ""): Promise<TaskListJson> => {
    const res = await t.app.request(`/api/v1/tasks/mine${qs}`, { headers: bearer(token) });
    expect(res.status).toBe(200);
    return (await res.json()) as TaskListJson;
  };

  beforeAll(async () => {
    ws = await makeWorkspace(t.app, admin.token, "TMN");
    other = await makeWorkspace(t.app, admin.token, "TMNB");
    owner = await makeMember(t.app, admin.token);
    first = await makeTask(t.app, owner.token, ws.id, { title: "mine first" });
    await new Promise((r) => setTimeout(r, 5));
    second = await makeTask(t.app, owner.token, ws.id, { title: "mine second" });
    await new Promise((r) => setTimeout(r, 5));
    // Association through assignment, in a different workspace.
    third = await makeTask(t.app, admin.token, other.id, { title: "assigned to me", assignee_id: owner.userId });
  });

  it("returns the caller's associated tasks newest-association-first, across workspaces", async () => {
    const data = await mine(owner.token);
    expect(data.total).toBe(3);
    expect(data.limit).toBe(100);
    expect(data.offset).toBe(0);
    expect(data.items.map((x) => x.id)).toEqual([third.id, second.id, first.id]);
    // Keys come from each task's own workspace.
    expect(data.items.map((x) => x.key)).toEqual([third.key, second.key, first.key]);
    expect(data.items[0]!.key.startsWith("TMNB-")).toBe(true);
    // Same embedded shape as tasks.list.
    expect(data.items[0]!.status.name).toBe("Backlog");
    expect(data.items[0]!.assignee?.id).toBe(owner.userId);
    expect(data.items[0]!.tags).toEqual([]);
  });

  it("does not leak other users' tasks", async () => {
    const stranger = await makeMember(t.app, admin.token);
    const data = await mine(stranger.token);
    expect(data.total).toBe(0);
    expect(data.items).toEqual([]);
  });

  it("excludes archived tasks", async () => {
    await t.app.request(`/api/v1/tasks/${first.id}`, jsonReq("PATCH", { archived: true }, bearer(admin.token)));
    const data = await mine(owner.token);
    expect(data.total).toBe(2);
    expect(data.items.map((x) => x.id)).toEqual([third.id, second.id]);

    await t.app.request(`/api/v1/tasks/${first.id}`, jsonReq("PATCH", { archived: false }, bearer(admin.token)));
    expect((await mine(owner.token)).total).toBe(3);
  });

  it("paginates and validates limit", async () => {
    const page1 = await mine(owner.token, "?limit=2");
    expect(page1.items.length).toBe(2);
    expect(page1.total).toBe(3);
    const page2 = await mine(owner.token, "?limit=2&offset=2");
    expect(page2.items.length).toBe(1);
    expect(page2.items[0]!.id).toBe(first.id);

    const bad = await t.app.request("/api/v1/tasks/mine?limit=500", { headers: bearer(owner.token) });
    expect(bad.status).toBe(400);
  });

  it("is not shadowed by /tasks/:idOrKey (the literal route wins)", async () => {
    const res = await t.app.request("/api/v1/tasks/mine", { headers: bearer(owner.token) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["items", "limit", "offset", "total"]);
    expect(body).not.toHaveProperty("task");
  });
});
