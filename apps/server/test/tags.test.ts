import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bearer,
  jsonReq,
  makeMember,
  makeTask,
  makeTestApp,
  makeWorkspace,
  setupAdmin,
  type WorkspaceJson,
} from "./helpers";

let t: Awaited<ReturnType<typeof makeTestApp>>;
let admin: { token: string; userId: string };
let member: { userId: string; token: string };
let ws: WorkspaceJson;
let other: WorkspaceJson;

interface TagJson {
  id: string;
  workspace_id: string;
  name: string;
  color: string;
  created_at: number;
}

const createTag = async (
  token: string,
  wsIdOrKey: string,
  input: { name: string; color?: string },
): Promise<Response> =>
  t.app.request(`/api/v1/workspaces/${wsIdOrKey}/tags`, jsonReq("POST", input, bearer(token)));

const listTags = async (token: string, wsIdOrKey: string): Promise<TagJson[]> => {
  const res = await t.app.request(`/api/v1/workspaces/${wsIdOrKey}/tags`, { headers: bearer(token) });
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: TagJson[] }).items;
};

const okTag = async (res: Response): Promise<TagJson> => {
  expect(res.status).toBe(200);
  return ((await res.json()) as { tag: TagJson }).tag;
};

beforeAll(async () => {
  t = await makeTestApp();
  admin = await setupAdmin(t.app);
  member = await makeMember(t.app, admin.token);
  ws = await makeWorkspace(t.app, admin.token, "TAG");
  other = await makeWorkspace(t.app, admin.token, "TAGB");
});
afterAll(() => t.cleanup());

describe("tags.create + tags.list", () => {
  it("an admin creates a tag with a default color; it is scoped to its workspace", async () => {
    const bug = await okTag(await createTag(admin.token, ws.id, { name: "Bug" }));
    expect(bug.workspace_id).toBe(ws.id);
    expect(bug.name).toBe("Bug");
    expect(bug.color).toBe("#6b7280");

    expect((await listTags(admin.token, ws.id)).map((x) => x.name)).toEqual(["Bug"]);
    expect(await listTags(admin.token, other.id)).toEqual([]);
  });

  it("lists alphabetically and resolves the workspace by key too", async () => {
    await okTag(await createTag(admin.token, ws.key, { name: "Epic", color: "#3b82f6" }));
    await okTag(await createTag(admin.token, ws.key, { name: "Alpha", color: "#ff0000" }));
    expect((await listTags(admin.token, ws.key)).map((x) => x.name)).toEqual(["Alpha", "Bug", "Epic"]);
  });

  it("enforces per-workspace name uniqueness (409) but allows the same name elsewhere", async () => {
    const dup = await createTag(admin.token, ws.id, { name: "Bug" });
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as { error: { code: string } }).error.code).toBe("conflict");

    const elsewhere = await okTag(await createTag(admin.token, other.id, { name: "Bug" }));
    expect(elsewhere.workspace_id).toBe(other.id);
  });

  it("404s for an unknown workspace and 400s on an invalid color", async () => {
    expect((await createTag(admin.token, "NOPE", { name: "X" })).status).toBe(404);
    expect((await createTag(admin.token, ws.id, { name: "X", color: "red" })).status).toBe(400);
  });
});

describe("tags are admin-managed (members may read, not write)", () => {
  it("a member can list but gets 403 on create/update/delete", async () => {
    const tag = await okTag(await createTag(admin.token, ws.id, { name: "MemberProbe" }));
    expect((await listTags(member.token, ws.id)).some((x) => x.id === tag.id)).toBe(true);

    expect((await createTag(member.token, ws.id, { name: "Sneaky" })).status).toBe(403);

    const update = await t.app.request(`/api/v1/tags/${tag.id}`, jsonReq("PATCH", { name: "Nope" }, bearer(member.token)));
    expect(update.status).toBe(403);

    const del = await t.app.request(`/api/v1/tags/${tag.id}`, { method: "DELETE", headers: bearer(member.token) });
    expect(del.status).toBe(403);

    // Nothing changed.
    expect((await listTags(admin.token, ws.id)).find((x) => x.id === tag.id)!.name).toBe("MemberProbe");
  });
});

describe("tags.update", () => {
  it("renames and recolors; a no-op patch returns the tag unchanged", async () => {
    const tag = await okTag(await createTag(admin.token, ws.id, { name: "Renameable", color: "#111111" }));
    const renamed = await okTag(
      await t.app.request(`/api/v1/tags/${tag.id}`, jsonReq("PATCH", { name: "Renamed", color: "#222222" }, bearer(admin.token))),
    );
    expect(renamed.name).toBe("Renamed");
    expect(renamed.color).toBe("#222222");

    const noop = await okTag(await t.app.request(`/api/v1/tags/${tag.id}`, jsonReq("PATCH", {}, bearer(admin.token))));
    expect(noop.name).toBe("Renamed");
  });

  it("409s when renaming onto a sibling name and 404s on a missing tag", async () => {
    const clash = await t.app.request(
      `/api/v1/tags/${(await listTags(admin.token, ws.id)).find((x) => x.name === "Alpha")!.id}`,
      jsonReq("PATCH", { name: "Bug" }, bearer(admin.token)),
    );
    expect(clash.status).toBe(409);

    const missing = await t.app.request(
      "/api/v1/tags/01ARZ3NDEKTSV4RRFFQ69G5FAV",
      jsonReq("PATCH", { name: "Ghost" }, bearer(admin.token)),
    );
    expect(missing.status).toBe(404);
  });
});

describe("tags.delete", () => {
  it("deletes the tag and unlinks it from every task, leaving the tasks intact", async () => {
    const doomed = await okTag(await createTag(admin.token, ws.id, { name: "Doomed" }));
    const keeper = await okTag(await createTag(admin.token, ws.id, { name: "Keeper" }));
    const a = await makeTask(t.app, admin.token, ws.id, { title: "tagged A", tag_ids: [doomed.id, keeper.id] });
    const b = await makeTask(t.app, admin.token, ws.id, { title: "tagged B", tag_ids: [doomed.id] });
    expect(a.tags.map((x) => x.name).sort()).toEqual(["Doomed", "Keeper"]);

    const del = await t.app.request(`/api/v1/tags/${doomed.id}`, { method: "DELETE", headers: bearer(admin.token) });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ ok: true });

    expect((await listTags(admin.token, ws.id)).some((x) => x.id === doomed.id)).toBe(false);

    const afterA = await t.app.request(`/api/v1/tasks/${a.id}`, { headers: bearer(admin.token) });
    expect(((await afterA.json()) as { task: { tags: TagJson[] } }).task.tags.map((x) => x.name)).toEqual(["Keeper"]);
    const afterB = await t.app.request(`/api/v1/tasks/${b.id}`, { headers: bearer(admin.token) });
    expect(((await afterB.json()) as { task: { tags: TagJson[] } }).task.tags).toEqual([]);
  });

  it("404s on a missing tag", async () => {
    const res = await t.app.request("/api/v1/tags/01ARZ3NDEKTSV4RRFFQ69G5FAV", {
      method: "DELETE",
      headers: bearer(admin.token),
    });
    expect(res.status).toBe(404);
  });
});
