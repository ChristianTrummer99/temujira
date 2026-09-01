import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TaskLinkSchema, TaskSchema } from "@temujira/shared";
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

interface LinkJson {
  id: string;
  type: string;
  task: {
    id: string;
    key: string;
    workspace_id: string;
    title: string;
    status: { id: string; name: string; color: string; position: number };
    archived_at: number | null;
  };
  created_by: string;
  created_at: number;
}

interface ActivityJson {
  id: string;
  workspace_id: string;
  task_id: string | null;
  task_key: string | null;
  action: string;
  metadata: Record<string, unknown>;
}

let taskCounter = 0;
const newTask = (wsIdOrKey: string, token = admin.token): Promise<TaskJson> =>
  makeTask(t.app, token, wsIdOrKey, { title: `Link subject ${++taskCounter}` });

const link = async (token: string, idOrKey: string, input: unknown): Promise<Response> =>
  await t.app.request(`/api/v1/tasks/${idOrKey}/links`, jsonReq("POST", input, bearer(token)));

const unlink = async (token: string, linkId: string): Promise<Response> =>
  await t.app.request(`/api/v1/links/${linkId}`, { method: "DELETE", headers: bearer(token) });

const okLink = async (res: Response): Promise<LinkJson> => {
  expect(res.status).toBe(200);
  const parsed = ((await res.json()) as { link: LinkJson }).link;
  // The wire shape must satisfy the shared contract, not just our local interface.
  expect(TaskLinkSchema.safeParse(parsed).success).toBe(true);
  return parsed;
};

const errCode = async (res: Response): Promise<string> =>
  ((await res.json()) as { error: { code: string } }).error.code;

const getTask = async (idOrKey: string, token = admin.token): Promise<TaskJson & { links?: LinkJson[] }> => {
  const res = await t.app.request(`/api/v1/tasks/${idOrKey}`, { headers: bearer(token) });
  expect(res.status).toBe(200);
  const task = ((await res.json()) as { task: TaskJson & { links?: LinkJson[] } }).task;
  expect(TaskSchema.safeParse(task).success).toBe(true);
  return task;
};

const linksOf = async (idOrKey: string): Promise<LinkJson[]> => (await getTask(idOrKey)).links ?? [];

const feed = async (wsIdOrKey: string): Promise<ActivityJson[]> => {
  const res = await t.app.request(`/api/v1/workspaces/${wsIdOrKey}/activity?limit=100`, {
    headers: bearer(admin.token),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: ActivityJson[] }).items;
};

beforeAll(async () => {
  t = await makeTestApp();
  admin = await setupAdmin(t.app);
  member = await makeMember(t.app, admin.token, { name: "Link Member" });
  ws = await makeWorkspace(t.app, admin.token, "LNK");
  otherWs = await makeWorkspace(t.app, admin.token, "LNKB");
});
afterAll(() => t.cleanup());

describe("links.create — happy path and viewpoint", () => {
  it("creates an outward link and echoes the posted relation with the far task's key", async () => {
    const a = await newTask(ws.id);
    const b = await newTask(ws.id);
    const created = await okLink(await link(admin.token, a.key, { type: "absorbs", task: b.key }));
    expect(created.type).toBe("absorbs");
    expect(created.task.id).toBe(b.id);
    expect(created.task.key).toBe(b.key);
    expect(created.task.workspace_id).toBe(ws.id);
    expect(created.task.title).toBe(b.title);
    expect(created.task.archived_at).toBeNull();
    expect(created.created_by).toBe(admin.userId);
  });

  it("shows the inverse relation from the far side, with the same link id", async () => {
    const a = await newTask(ws.id);
    const b = await newTask(ws.id);
    const created = await okLink(await link(admin.token, a.key, { type: "absorbs", task: b.key }));

    const [fromA] = await linksOf(a.key);
    expect(fromA!.id).toBe(created.id);
    expect(fromA!.type).toBe("absorbs");
    expect(fromA!.task.key).toBe(b.key);

    const [fromB] = await linksOf(b.key);
    expect(fromB!.id).toBe(created.id);
    expect(fromB!.type).toBe("absorbed_by");
    expect(fromB!.task.key).toBe(a.key);
  });

  it("blocks/blocked_by invert the same way", async () => {
    const a = await newTask(ws.id);
    const b = await newTask(ws.id);
    await okLink(await link(admin.token, a.key, { type: "blocks", task: b.key }));
    expect((await linksOf(a.key))[0]!.type).toBe("blocks");
    expect((await linksOf(b.key))[0]!.type).toBe("blocked_by");
  });

  it("accepts the far task as a ULID as well as a key", async () => {
    const a = await newTask(ws.id);
    const b = await newTask(ws.id);
    const created = await okLink(await link(admin.token, a.id, { type: "relates", task: b.id }));
    expect(created.task.key).toBe(b.key);
    expect((await linksOf(b.id))[0]!.id).toBe(created.id);
  });

  it("lets any member (not just an admin) link tasks", async () => {
    const a = await newTask(ws.id);
    const b = await newTask(ws.id);
    const created = await okLink(await link(member.token, a.key, { type: "relates", task: b.key }));
    expect(created.created_by).toBe(member.userId);
  });
});

describe("links.create — canonicalization", () => {
  it("collapses outward and inward spellings into one canonical row", async () => {
    const a = await newTask(ws.id);
    const b = await newTask(ws.id);
    // "A absorbs B" and "B absorbed_by A" are the same fact.
    const created = await okLink(await link(admin.token, a.key, { type: "absorbs", task: b.key }));
    const dup = await link(admin.token, b.key, { type: "absorbed_by", task: a.key });
    expect(dup.status).toBe(409);
    expect(await errCode(dup)).toBe("conflict");
    expect((await linksOf(a.key)).map((l) => l.id)).toEqual([created.id]);
  });

  it("collapses the inward spelling posted first, too", async () => {
    const a = await newTask(ws.id);
    const b = await newTask(ws.id);
    // Post from B's side first: stores "A absorbs B".
    const created = await okLink(await link(admin.token, b.key, { type: "absorbed_by", task: a.key }));
    expect(created.type).toBe("absorbed_by");
    expect((await linksOf(a.key))[0]!.type).toBe("absorbs");
    const dup = await link(admin.token, a.key, { type: "absorbs", task: b.key });
    expect(dup.status).toBe(409);
  });

  it("canonicalizes symmetric `relates` by ULID order, both directions", async () => {
    const a = await newTask(ws.id);
    const b = await newTask(ws.id);
    await okLink(await link(admin.token, a.key, { type: "relates", task: b.key }));
    const reverse = await link(admin.token, b.key, { type: "relates", task: a.key });
    expect(reverse.status).toBe(409);
    expect(await errCode(reverse)).toBe("conflict");
    // Symmetric on the wire from either end.
    expect((await linksOf(a.key))[0]!.type).toBe("relates");
    expect((await linksOf(b.key))[0]!.type).toBe("relates");
  });

  it("canonicalizes `relates` posted from the higher-ULID side first", async () => {
    const x = await newTask(ws.id);
    const y = await newTask(ws.id);
    // Explicitly post from whichever end sorts second: the stored row is still (min, max).
    const [lo, hi] = x.id < y.id ? [x, y] : [y, x];
    await okLink(await link(admin.token, hi.key, { type: "relates", task: lo.key }));
    expect((await link(admin.token, lo.key, { type: "relates", task: hi.key })).status).toBe(409);
  });
});

describe("links.create — rejections", () => {
  it("rejects a self-link by key and by ULID with 400", async () => {
    const a = await newTask(ws.id);
    const byKey = await link(admin.token, a.key, { type: "relates", task: a.key });
    expect(byKey.status).toBe(400);
    expect(await errCode(byKey)).toBe("validation_error");
    // Mixed spellings resolve to the same task: still a self-link.
    const byUlid = await link(admin.token, a.key, { type: "blocks", task: a.id });
    expect(byUlid.status).toBe(400);
    expect(await errCode(byUlid)).toBe("validation_error");
    expect(await linksOf(a.key)).toEqual([]);
  });

  it("rejects an exact duplicate with 409", async () => {
    const a = await newTask(ws.id);
    const b = await newTask(ws.id);
    await okLink(await link(admin.token, a.key, { type: "blocks", task: b.key }));
    const dup = await link(admin.token, a.key, { type: "blocks", task: b.key });
    expect(dup.status).toBe(409);
    expect(await errCode(dup)).toBe("conflict");
    expect((await linksOf(a.key)).length).toBe(1);
  });

  it("rejects the direct inverse of a directional link, in either spelling", async () => {
    const a = await newTask(ws.id);
    const b = await newTask(ws.id);
    await okLink(await link(admin.token, a.key, { type: "blocks", task: b.key }));

    const reverse = await link(admin.token, b.key, { type: "blocks", task: a.key });
    expect(reverse.status).toBe(409);
    const msg = ((await reverse.json()) as { error: { message: string } }).error.message;
    expect(msg).toContain(a.key);
    expect(msg).toContain(b.key);

    // Same contradiction spelled from A's side.
    const spelled = await link(admin.token, a.key, { type: "blocked_by", task: b.key });
    expect(spelled.status).toBe(409);
    expect((await linksOf(a.key)).length).toBe(1);
  });

  it("rejects the direct inverse of `absorbs` too", async () => {
    const a = await newTask(ws.id);
    const b = await newTask(ws.id);
    await okLink(await link(admin.token, a.key, { type: "absorbs", task: b.key }));
    expect((await link(admin.token, b.key, { type: "absorbs", task: a.key })).status).toBe(409);
  });

  it("404s on an unknown far task and 400s on a malformed reference", async () => {
    const a = await newTask(ws.id);
    const unknownKey = await link(admin.token, a.key, { type: "relates", task: "NOPE-99" });
    expect(unknownKey.status).toBe(404);
    expect(await errCode(unknownKey)).toBe("not_found");

    const unknownUlid = await link(admin.token, a.key, { type: "relates", task: "01ARZ3NDEKTSV4RRFFQ69G5FAV" });
    expect(unknownUlid.status).toBe(404);

    const garbage = await link(admin.token, a.key, { type: "relates", task: "not a task" });
    expect(garbage.status).toBe(400);
    expect(await errCode(garbage)).toBe("validation_error");
  });

  it("400s on a relation outside LINK_RELATIONS", async () => {
    const a = await newTask(ws.id);
    const b = await newTask(ws.id);
    const bad = await link(admin.token, a.key, { type: "supersedes", task: b.key });
    expect(bad.status).toBe(400);
    expect(await errCode(bad)).toBe("validation_error");
  });

  it("404s when the task in the URL does not exist", async () => {
    const b = await newTask(ws.id);
    expect((await link(admin.token, "NOPE-1", { type: "relates", task: b.key })).status).toBe(404);
  });
});

describe("links.create — allowances", () => {
  it("allows the same pair to carry a second, different type", async () => {
    const a = await newTask(ws.id);
    const b = await newTask(ws.id);
    await okLink(await link(admin.token, a.key, { type: "blocks", task: b.key }));
    await okLink(await link(admin.token, a.key, { type: "relates", task: b.key }));
    const types = (await linksOf(a.key)).map((l) => l.type).sort();
    expect(types).toEqual(["blocks", "relates"]);
  });

  it("allows a longer cycle (A blocks B blocks C blocks A) — links carry no enforcement", async () => {
    const a = await newTask(ws.id);
    const b = await newTask(ws.id);
    const c = await newTask(ws.id);
    await okLink(await link(admin.token, a.key, { type: "blocks", task: b.key }));
    await okLink(await link(admin.token, b.key, { type: "blocks", task: c.key }));
    await okLink(await link(admin.token, c.key, { type: "blocks", task: a.key }));
    expect((await linksOf(a.key)).length).toBe(2);
  });

  it("allows linking to and from an archived task, exposing archived_at on the ref", async () => {
    const a = await newTask(ws.id);
    const archived = await newTask(ws.id);
    const patch = await t.app.request(
      `/api/v1/tasks/${archived.id}`,
      jsonReq("PATCH", { archived: true }, bearer(admin.token)),
    );
    expect(patch.status).toBe(200);

    const created = await okLink(await link(admin.token, a.key, { type: "relates", task: archived.key }));
    expect(created.task.archived_at).not.toBeNull();
    // …and from the archived task's own side.
    const b = await newTask(ws.id);
    await okLink(await link(admin.token, archived.key, { type: "blocks", task: b.key }));
    expect((await linksOf(b.key))[0]!.task.archived_at).not.toBeNull();
  });
});

describe("links — cross-workspace", () => {
  it("links across workspaces and renders each far end with its OWN workspace key", async () => {
    const here = await newTask(ws.id);
    const there = await newTask(otherWs.id);
    expect(here.key.startsWith("LNK-")).toBe(true);
    expect(there.key.startsWith("LNKB-")).toBe(true);

    const created = await okLink(await link(admin.token, here.key, { type: "blocks", task: there.key }));
    expect(created.task.key).toBe(there.key);
    expect(created.task.workspace_id).toBe(otherWs.id);

    const fromHere = (await linksOf(here.key))[0]!;
    expect(fromHere.type).toBe("blocks");
    expect(fromHere.task.key).toBe(there.key);
    expect(fromHere.task.workspace_id).toBe(otherWs.id);

    const fromThere = (await linksOf(there.key))[0]!;
    expect(fromThere.type).toBe("blocked_by");
    expect(fromThere.task.key).toBe(here.key);
    expect(fromThere.task.workspace_id).toBe(ws.id);
  });
});

describe("links — activity", () => {
  it("records one viewpoint-correct task.linked event for a same-workspace link", async () => {
    const a = await newTask(ws.id);
    const b = await newTask(ws.id);
    const created = await okLink(await link(admin.token, a.key, { type: "absorbs", task: b.key }));

    const events = (await feed(ws.id)).filter((e) => e.metadata.link_id === created.id);
    expect(events.length).toBe(1);
    const [e] = events;
    expect(e!.action).toBe("task.linked");
    expect(e!.task_id).toBe(a.id);
    expect(e!.workspace_id).toBe(ws.id);
    expect(e!.metadata).toMatchObject({
      link_id: created.id,
      type: "absorbs",
      other_task_id: b.id,
      other_task_key: b.key,
    });
  });

  it("mirrors the event into the other workspace, viewpoint-correct on each side", async () => {
    const here = await newTask(ws.id);
    const there = await newTask(otherWs.id);
    const created = await okLink(await link(admin.token, here.key, { type: "blocks", task: there.key }));

    const mine = (await feed(ws.id)).filter((e) => e.metadata.link_id === created.id);
    expect(mine.length).toBe(1);
    expect(mine[0]!.task_id).toBe(here.id);
    expect(mine[0]!.metadata).toMatchObject({ type: "blocks", other_task_id: there.id, other_task_key: there.key });

    const theirs = (await feed(otherWs.id)).filter((e) => e.metadata.link_id === created.id);
    expect(theirs.length).toBe(1);
    expect(theirs[0]!.task_id).toBe(there.id);
    expect(theirs[0]!.metadata).toMatchObject({
      type: "blocked_by",
      other_task_id: here.id,
      other_task_key: here.key,
    });

    const del = await unlink(admin.token, created.id);
    expect(del.status).toBe(200);
    const unlinked = [...(await feed(ws.id)), ...(await feed(otherWs.id))].filter(
      (e) => e.action === "task.unlinked" && e.metadata.link_id === created.id,
    );
    expect(unlinked.length).toBe(2);
  });

  it("does not create inbox items", async () => {
    const a = await newTask(ws.id);
    const b = await newTask(ws.id);
    await okLink(await link(member.token, a.key, { type: "relates", task: b.key }));
    const res = await t.app.request("/api/v1/inbox", { headers: bearer(admin.token) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { total: number }).total).toBe(0);
  });
});

describe("links — no side effects", () => {
  it("does not bump either task's updated_at, archive anything, or gate status", async () => {
    const a = await newTask(ws.id);
    const b = await newTask(ws.id);
    const beforeA = (await getTask(a.key)).updated_at;
    const beforeB = (await getTask(b.key)).updated_at;
    await new Promise((r) => setTimeout(r, 5));

    const created = await okLink(await link(admin.token, a.key, { type: "absorbs", task: b.key }));
    expect((await getTask(a.key)).updated_at).toBe(beforeA);
    const afterB = await getTask(b.key);
    expect(afterB.updated_at).toBe(beforeB);
    expect(afterB.archived_at).toBeNull();

    // A blocked task still moves status freely.
    const statusesRes = await t.app.request(`/api/v1/workspaces/${ws.id}/statuses`, { headers: bearer(admin.token) });
    const statuses = ((await statusesRes.json()) as { items: Array<{ id: string }> }).items;
    const moved = await t.app.request(
      `/api/v1/tasks/${b.id}`,
      jsonReq("PATCH", { status_id: statuses.at(-1)!.id }, bearer(admin.token)),
    );
    expect(moved.status).toBe(200);

    await new Promise((r) => setTimeout(r, 5));
    const beforeUnlinkA = (await getTask(a.key)).updated_at;
    const beforeUnlinkB = (await getTask(b.key)).updated_at;
    expect((await unlink(admin.token, created.id)).status).toBe(200);
    expect((await getTask(a.key)).updated_at).toBe(beforeUnlinkA);
    expect((await getTask(b.key)).updated_at).toBe(beforeUnlinkB);
  });
});

describe("links — embedding contract", () => {
  it("embeds links on tasks.get only, ordered created_at then id", async () => {
    const a = await newTask(ws.id);
    const b = await newTask(ws.id);
    const c = await newTask(ws.id);
    const first = await okLink(await link(admin.token, a.key, { type: "relates", task: b.key }));
    await new Promise((r) => setTimeout(r, 3));
    const second = await okLink(await link(admin.token, a.key, { type: "blocks", task: c.key }));
    expect((await linksOf(a.key)).map((l) => l.id)).toEqual([first.id, second.id]);

    const list = await t.app.request(`/api/v1/workspaces/${ws.id}/tasks?limit=100`, { headers: bearer(admin.token) });
    const items = ((await list.json()) as { items: Array<Record<string, unknown>> }).items;
    const listed = items.find((x) => x.id === a.id)!;
    expect("links" in listed).toBe(false);

    const mine = await t.app.request("/api/v1/tasks/mine?limit=100", { headers: bearer(admin.token) });
    for (const x of ((await mine.json()) as { items: Array<Record<string, unknown>> }).items) {
      expect("links" in x).toBe(false);
    }

    const updated = await t.app.request(`/api/v1/tasks/${a.id}`, jsonReq("PATCH", { title: "Renamed" }, bearer(admin.token)));
    expect("links" in ((await updated.json()) as { task: Record<string, unknown> }).task).toBe(false);

    const createdTask = await t.app.request(
      `/api/v1/workspaces/${ws.id}/tasks`,
      jsonReq("POST", { title: "Fresh" }, bearer(admin.token)),
    );
    expect("links" in ((await createdTask.json()) as { task: Record<string, unknown> }).task).toBe(false);
  });

  it("returns an empty array for a task with no links", async () => {
    const a = await newTask(ws.id);
    expect(await linksOf(a.key)).toEqual([]);
  });
});

describe("links.delete", () => {
  it("removes the link from both sides in one call, by a user who did not create it", async () => {
    const a = await newTask(ws.id);
    const b = await newTask(ws.id);
    const created = await okLink(await link(admin.token, a.key, { type: "absorbs", task: b.key }));
    expect((await linksOf(a.key)).length).toBe(1);
    expect((await linksOf(b.key)).length).toBe(1);

    // created_by is audit only: any authenticated user may unlink.
    const res = await unlink(member.token, created.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await linksOf(a.key)).toEqual([]);
    expect(await linksOf(b.key)).toEqual([]);
  });

  it("404s on a second delete and on an unknown id", async () => {
    const a = await newTask(ws.id);
    const b = await newTask(ws.id);
    const created = await okLink(await link(admin.token, a.key, { type: "relates", task: b.key }));
    expect((await unlink(admin.token, created.id)).status).toBe(200);
    const again = await unlink(admin.token, created.id);
    expect(again.status).toBe(404);
    expect(await errCode(again)).toBe("not_found");
    expect((await unlink(admin.token, "01ARZ3NDEKTSV4RRFFQ69G5FAV")).status).toBe(404);
  });

  it("frees the pair so the same link can be recreated", async () => {
    const a = await newTask(ws.id);
    const b = await newTask(ws.id);
    const created = await okLink(await link(admin.token, a.key, { type: "blocks", task: b.key }));
    expect((await unlink(admin.token, created.id)).status).toBe(200);
    // The reverse direction is no longer contradictory once the original is gone.
    const reversed = await okLink(await link(admin.token, b.key, { type: "blocks", task: a.key }));
    expect(reversed.type).toBe("blocks");
    expect((await linksOf(a.key))[0]!.type).toBe("blocked_by");
  });
});
