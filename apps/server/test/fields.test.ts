import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FieldDefSchema, TaskSchema } from "@temujira/shared";
import {
  bearer,
  jsonReq,
  makeTask,
  makeTestApp,
  makeWorkspace,
  makeMember,
  setupAdmin,
  type TaskJson,
  type WorkspaceJson,
} from "./helpers";

let t: Awaited<ReturnType<typeof makeTestApp>>;
let admin: { token: string; userId: string };
let member: { token: string };
let ws: WorkspaceJson;

interface FieldJson {
  id: string;
  workspace_id: string;
  name: string;
  type: string;
  options: string[];
  position: number;
  created_at: number;
}

const createField = async (token: string, input: unknown): Promise<FieldJson> => {
  const res = await t.app.request(`/api/v1/workspaces/${ws.id}/fields`, jsonReq("POST", input, bearer(token)));
  expect(res.status).toBe(200);
  const field = ((await res.json()) as { field: FieldJson }).field;
  expect(FieldDefSchema.safeParse(field).success).toBe(true);
  return field;
};

const listFields = async (token = admin.token): Promise<FieldJson[]> => {
  const res = await t.app.request(`/api/v1/workspaces/${ws.id}/fields`, { headers: bearer(token) });
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: FieldJson[] }).items;
};

const makeTaskWithField = async (token: string, fieldValues: Record<string, string>): Promise<{ task: TaskJson & { field_values: Record<string, string> }; field: FieldJson }> => {
  const field = await createField(token, { name: `F${new Date().getTime()}`, type: "select", options: ["A", "B"] });
  const task = await makeTask(t.app, token, ws.id, { title: `field task ${new Date().getTime()}` });
  const res = await t.app.request(`/api/v1/tasks/${task.id}`, jsonReq("PATCH", { field_values: fieldValues }, bearer(token)));
  expect(res.status).toBe(200);
  return { task: ((await res.json()) as { task: TaskJson & { field_values: Record<string, string> } }).task, field };
};

const errCode = async (res: Response): Promise<string> =>
  ((await res.json()) as { error: { code: string } }).error.code;

beforeAll(async () => {
  t = await makeTestApp();
  admin = await setupAdmin(t.app);
  member = await makeMember(t.app, admin.token, { name: "Field Member" });
  ws = await makeWorkspace(t.app, admin.token, "FLD");
});
afterAll(() => t.cleanup());

describe("fields CRUD", () => {
  it("creates a select field (appended), a text field, and a number field", async () => {
    const select = await createField(admin.token, { name: "Priority", type: "select", options: ["low", "High", "low"] });
    expect(select.type).toBe("select");
    // options are trimmed + deduped in a stable order
    expect(select.options).toEqual(["low", "High"]);
    const text = await createField(admin.token, { name: "Notes", type: "text" });
    expect(text.type).toBe("text");
    expect(text.options).toEqual([]);
    const num = await createField(admin.token, { name: "Estimate", type: "number" });
    expect(num.position).toBeGreaterThan(select.position);
    expect((await listFields()).map((f) => f.name)).toEqual(["Priority", "Notes", "Estimate"]);
    void text;
    void num;
  });

  it("defaults to select and rejects a no-option select", async () => {
    const def = await createField(admin.token, { name: "DefaultSelect", options: ["x"] });
    expect(def.type).toBe("select");
    const res = await t.app.request(`/api/v1/workspaces/${ws.id}/fields`, jsonReq("POST", { name: "EmptySelect", type: "select" }, bearer(admin.token)));
    expect(res.status).toBe(400);
  });

  it("rejects duplicate names within the workspace", async () => {
    // "Priority" already exists from the first test.
    const res = await t.app.request(`/api/v1/workspaces/${ws.id}/fields`, jsonReq("POST", { name: "Priority", type: "text" }, bearer(admin.token)));
    expect(res.status).toBe(409);
  });

  it("renames and replaces option sets on update", async () => {
    const f = await createField(admin.token, { name: "RenameMe", type: "select", options: ["a", "b"] });
    const renamed = await t.app.request(`/api/v1/fields/${f.id}`, jsonReq("PATCH", { name: "Renamed", options: ["c", "d", "a"] }, bearer(admin.token)));
    expect(renamed.status).toBe(200);
    const updated = ((await renamed.json()) as { field: FieldJson }).field;
    expect(updated.name).toBe("Renamed");
    expect(updated.options).toEqual(["c", "d", "a"]);
  });

  it("refuses to set options on a text field and an empty option set on a select", async () => {
    const f = await createField(admin.token, { name: "NoOptions", type: "text" });
    const res = await t.app.request(`/api/v1/fields/${f.id}`, jsonReq("PATCH", { options: ["a"] }, bearer(admin.token)));
    expect(await errCode(res)).toBe("validation_error");
    const s = await createField(admin.token, { name: "Opts", type: "select", options: ["z"] });
    const empty = await t.app.request(`/api/v1/fields/${s.id}`, jsonReq("PATCH", { options: [] }, bearer(admin.token)));
    expect(empty.status).toBe(400);
  });

  it("reorders fields only with the exact full array", async () => {
    const fields = await listFields();
    const ids = fields.map((f) => f.id);
    const reversed = [...ids].reverse();
    const res = await t.app.request(`/api/v1/workspaces/${ws.id}/fields/order`, jsonReq("PUT", { field_ids: reversed }, bearer(admin.token)));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { items: FieldJson[] }).items.map((f) => f.id)).toEqual(reversed);
    // missing one -> 400
    const bad = await t.app.request(`/api/v1/workspaces/${ws.id}/fields/order`, jsonReq("PUT", { field_ids: reversed.slice(1) }, bearer(admin.token)));
    expect(bad.status).toBe(400);
    // foreign id -> 400
    const foreign = ws.id;
    const dodgy = await t.app.request(`/api/v1/workspaces/${ws.id}/fields/order`, jsonReq("PUT", { field_ids: [...reversed.slice(1), foreign] }, bearer(admin.token)));
    expect(dodgy.status).toBe(400);
  });
});

describe("field values on tasks", () => {
  it("embeds field_values on every serialization (shape checks against TaskSchema)", async () => {
    const field = await createField(admin.token, { name: `P${new Date().getTime()}`, type: "select", options: ["A", "B", "C"] });
    const taskRes = await t.app.request(
      `/api/v1/workspaces/${ws.id}/tasks`,
      jsonReq("POST", { title: "value task", field_values: { [field.id]: "B" } }, bearer(admin.token)),
    );
    expect(taskRes.status).toBe(200);
    const created = ((await taskRes.json()) as { task: TaskJson & { field_values: Record<string, string> } }).task;
    expect(created.field_values[field.id]).toBe("B");
    expect(TaskSchema.safeParse(created).success).toBe(true);
    // get embeds it too
    const gotRes = await t.app.request(`/api/v1/tasks/${created.id}`, { headers: bearer(admin.token) });
    const got = ((await gotRes.json()) as { task: TaskJson & { field_values: Record<string, string> } }).task;
    expect(got.field_values[field.id]).toBe("B");
  });

  it("validates values: unknown field, disallowed select option, malformed number", async () => {
    const sel = await createField(admin.token, { name: `S${new Date().getTime()}`, type: "select", options: ["x", "y"] });
    const num = await createField(admin.token, { name: `N${new Date().getTime()}`, type: "number" });
    const task = await makeTask(t.app, admin.token, ws.id, { title: "validator task" });

    const unknown = await t.app.request(`/api/v1/tasks/${task.id}`, jsonReq("PATCH", { field_values: { [ws.id]: "oops" } }, bearer(admin.token)));
    expect(await errCode(unknown)).toBe("validation_error");

    const badOption = await t.app.request(`/api/v1/tasks/${task.id}`, jsonReq("PATCH", { field_values: { [sel.id]: "nope" } }, bearer(admin.token)));
    expect(await errCode(badOption)).toBe("validation_error");

    const badNum = await t.app.request(`/api/v1/tasks/${task.id}`, jsonReq("PATCH", { field_values: { [num.id]: "12abc" } }, bearer(admin.token)));
    expect(await errCode(badNum)).toBe("validation_error");

    const good = await t.app.request(`/api/v1/tasks/${task.id}`, jsonReq("PATCH", { field_values: { [num.id]: " 3.50 ", [sel.id]: "y" } }, bearer(admin.token)));
    expect(good.status).toBe(200);
    const updated = ((await good.json()) as { task: TaskJson & { field_values: Record<string, string> } }).task;
    expect(updated.field_values[num.id]).toBe("3.50");
    expect(updated.field_values[sel.id]).toBe("y");

    // Partial updates: touching one field leaves the other untouched.
    const partial = await t.app.request(`/api/v1/tasks/${task.id}`, jsonReq("PATCH", { field_values: { [num.id]: "" } }, bearer(admin.token)));
    const after = ((await partial.json()) as { task: TaskJson & { field_values: Record<string, string> } }).task;
    expect(after.field_values[num.id]).toBeUndefined();
    expect(after.field_values[sel.id]).toBe("y");
  });

  it("deleting a field definition drops its values from tasks", async () => {
    const { task, field } = await makeTaskWithField(admin.token, {});
    // set a value first
    const set = await t.app.request(`/api/v1/tasks/${task.id}`, jsonReq("PATCH", { field_values: { [field.id]: "A" } }, bearer(admin.token)));
    expect(((await set.json()) as { task: { field_values: Record<string, string> } }).task.field_values[field.id]).toBe("A");
    const del = await t.app.request(`/api/v1/fields/${field.id}`, { method: "DELETE", headers: bearer(admin.token) });
    expect(del.status).toBe(200);
    const gotRes = await t.app.request(`/api/v1/tasks/${task.id}`, { headers: bearer(admin.token) });
    const got = ((await gotRes.json()) as { task: TaskJson & { field_values: Record<string, string> } }).task;
    expect(got.field_values[field.id]).toBeUndefined();
  });
});

describe("tasks.list field filter (FR-34)", () => {
  it("filters by field_id (any value) and field_id+field_value (exact)", async () => {
    const a = await createField(admin.token, { name: `L${new Date().getTime()}`, type: "select", options: ["green", "red"] });
    const t1 = await makeTask(t.app, admin.token, ws.id, { title: "green task" });
    await t.app.request(`/api/v1/tasks/${t1.id}`, jsonReq("PATCH", { field_values: { [a.id]: "green" } }, bearer(admin.token)));
    const t2 = await makeTask(t.app, admin.token, ws.id, { title: "red task" });
    await t.app.request(`/api/v1/tasks/${t2.id}`, jsonReq("PATCH", { field_values: { [a.id]: "red" } }, bearer(admin.token)));
    await makeTask(t.app, admin.token, ws.id, { title: "untagged task" });

    const any = await t.app.request(`/api/v1/workspaces/${ws.id}/tasks?field_id=${a.id}`, { headers: bearer(admin.token) });
    const anyItems = ((await any.json()) as { items: { id: string }[] }).items;
    expect(anyItems.map((x) => x.id).sort()).toEqual([t1.id, t2.id].sort());

    const green = await t.app.request(`/api/v1/workspaces/${ws.id}/tasks?field_id=${a.id}&field_value=green`, { headers: bearer(admin.token) });
    const greenItems = ((await green.json()) as { items: { id: string }[] }).items;
    expect(greenItems.map((x) => x.id)).toEqual([t1.id]);

    const none = await t.app.request(`/api/v1/workspaces/${ws.id}/tasks?field_id=${a.id}&field_value=blue`, { headers: bearer(admin.token) });
    expect(((await none.json()) as { items: unknown[] }).items).toEqual([]);
  });

  it("groups the flat list by a custom select field id via group_by", async () => {
    const f = await createField(admin.token, { name: `G${new Date().getTime()}`, type: "select", options: ["one", "two"] });
    const make = async (value: string): Promise<TaskJson> => {
      const tt = await makeTask(t.app, admin.token, ws.id, { title: `g ${value}` });
      const patch = await t.app.request(`/api/v1/tasks/${tt.id}`, jsonReq("PATCH", { field_values: { [f.id]: value } }, bearer(admin.token)));
      expect(patch.status).toBe(200);
      return tt;
    };
    const one: TaskJson = (await make("one")) as TaskJson;
    const two: TaskJson = (await make("two")) as TaskJson;
    const res = await t.app.request(`/api/v1/workspaces/${ws.id}/tasks?group_by=${f.id}&limit=200`, { headers: bearer(admin.token) });
    expect(res.status).toBe(200);
    const items = ((await res.json()) as { items: (TaskJson & { field_values: Record<string, string> })[] }).items;
    expect(items.find((x) => x.id === one.id)?.field_values[f.id]).toBe("one");
    expect(items.find((x) => x.id === two.id)?.field_values[f.id]).toBe("two");
    void member;
  });
});