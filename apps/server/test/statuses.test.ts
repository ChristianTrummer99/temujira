import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, jsonReq, makeTask, makeTestApp, makeWorkspace, setupAdmin } from "./helpers";

let t: Awaited<ReturnType<typeof makeTestApp>>;
let admin: { token: string; userId: string };

interface StatusJson {
  id: string;
  workspace_id: string;
  name: string;
  color: string;
  position: number;
}

const listStatuses = async (wsIdOrKey: string): Promise<StatusJson[]> => {
  const res = await t.app.request(`/api/v1/workspaces/${wsIdOrKey}/statuses`, { headers: bearer(admin.token) });
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: StatusJson[] }).items;
};

beforeAll(async () => {
  t = await makeTestApp();
  admin = await setupAdmin(t.app);
});
afterAll(() => t.cleanup());

describe("statuses.create + list + update", () => {
  it("appends new statuses at the end and defaults the color", async () => {
    await makeWorkspace(t.app, admin.token, "STA");
    const res = await t.app.request(
      "/api/v1/workspaces/STA/statuses",
      jsonReq("POST", { name: "Review" }, bearer(admin.token)),
    );
    expect(res.status).toBe(200);
    const { status } = (await res.json()) as { status: StatusJson };
    expect(status.name).toBe("Review");
    expect(status.position).toBe(3); // after Backlog(0) / In Progress(1) / Done(2)
    expect(status.color).toBe("#6b7280");

    const items = await listStatuses("STA");
    expect(items.map((s) => s.name)).toEqual(["Backlog", "In Progress", "Done", "Review"]);
  });

  it("409s on a duplicate name within the workspace, but allows it in another workspace", async () => {
    const dup = await t.app.request(
      "/api/v1/workspaces/STA/statuses",
      jsonReq("POST", { name: "Review" }, bearer(admin.token)),
    );
    expect(dup.status).toBe(409);

    await makeWorkspace(t.app, admin.token, "STB");
    const other = await t.app.request(
      "/api/v1/workspaces/STB/statuses",
      jsonReq("POST", { name: "Review" }, bearer(admin.token)),
    );
    expect(other.status).toBe(200);
  });

  it("renames and recolors; rename to an existing name 409s", async () => {
    const items = await listStatuses("STA");
    const backlog = items.find((s) => s.name === "Backlog")!;

    const rename = await t.app.request(
      `/api/v1/statuses/${backlog.id}`,
      jsonReq("PATCH", { name: "Icebox", color: "#ff0000" }, bearer(admin.token)),
    );
    expect(rename.status).toBe(200);
    const renamed = ((await rename.json()) as { status: StatusJson }).status;
    expect(renamed.name).toBe("Icebox");
    expect(renamed.color).toBe("#ff0000");

    const clash = await t.app.request(
      `/api/v1/statuses/${backlog.id}`,
      jsonReq("PATCH", { name: "Done" }, bearer(admin.token)),
    );
    expect(clash.status).toBe(409);

    const missing = await t.app.request(
      "/api/v1/statuses/01ARZ3NDEKTSV4RRFFQ69G5FAV",
      jsonReq("PATCH", { name: "Ghost" }, bearer(admin.token)),
    );
    expect(missing.status).toBe(404);
  });
});

describe("statuses.reorder", () => {
  it("reorders with the exact id set and returns the new order", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "ORD");
    const before = await listStatuses(ws.id);
    const reversed = [...before].reverse().map((s) => s.id);

    const res = await t.app.request(
      `/api/v1/workspaces/${ws.id}/statuses/order`,
      jsonReq("PUT", { status_ids: reversed }, bearer(admin.token)),
    );
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as { items: StatusJson[] };
    expect(items.map((s) => s.id)).toEqual(reversed);
    expect(items.map((s) => s.position)).toEqual([0, 1, 2]);
    expect(items.map((s) => s.name)).toEqual(["Done", "In Progress", "Backlog"]);
  });

  it("rejects a subset, a superset, duplicates, and foreign ids (validation_error)", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "ORE");
    const other = await makeWorkspace(t.app, admin.token, "ORF");
    const ids = (await listStatuses(ws.id)).map((s) => s.id);
    const otherIds = (await listStatuses(other.id)).map((s) => s.id);

    const attempts: Array<{ label: string; status_ids: string[] }> = [
      { label: "subset", status_ids: ids.slice(0, 2) },
      { label: "superset", status_ids: [...ids, otherIds[0]!] },
      { label: "duplicate", status_ids: [ids[0]!, ids[0]!, ids[1]!] },
      { label: "foreign id", status_ids: [ids[0]!, ids[1]!, otherIds[0]!] },
    ];
    for (const { label, status_ids } of attempts) {
      const res = await t.app.request(
        `/api/v1/workspaces/${ws.id}/statuses/order`,
        jsonReq("PUT", { status_ids }, bearer(admin.token)),
      );
      expect(res.status, label).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code, label).toBe("validation_error");
    }
    // Order unchanged after all rejected attempts.
    expect((await listStatuses(ws.id)).map((s) => s.id)).toEqual(ids);
  });
});

describe("statuses.delete", () => {
  it("deletes an unused status", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "DEL");
    const [backlog] = await listStatuses(ws.id);
    const res = await t.app.request(`/api/v1/statuses/${backlog!.id}`, {
      method: "DELETE",
      headers: bearer(admin.token),
    });
    expect(res.status).toBe(200);
    expect((await listStatuses(ws.id)).length).toBe(2);
  });

  it("refuses to delete the last status of a workspace (409)", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "LAS");
    const items = await listStatuses(ws.id);
    for (const s of items.slice(0, 2)) {
      const res = await t.app.request(`/api/v1/statuses/${s.id}`, { method: "DELETE", headers: bearer(admin.token) });
      expect(res.status).toBe(200);
    }
    const last = items[2]!;
    const res = await t.app.request(`/api/v1/statuses/${last.id}`, {
      method: "DELETE",
      headers: bearer(admin.token),
    });
    expect(res.status).toBe(409);
  });

  it("409s (mentioning move_to) when tasks still use the status", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "MOV");
    const [backlog] = await listStatuses(ws.id);
    await makeTask(t.app, admin.token, ws.id, { title: "Uses backlog" });

    const res = await t.app.request(`/api/v1/statuses/${backlog!.id}`, {
      method: "DELETE",
      headers: bearer(admin.token),
    });
    expect(res.status).toBe(409);
    const { error } = (await res.json()) as { error: { message: string } };
    expect(error.message).toContain("move_to");
  });

  it("validates move_to: same status or another workspace's status → validation_error", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "MVA");
    const foreign = await makeWorkspace(t.app, admin.token, "MVB");
    const [backlog] = await listStatuses(ws.id);
    const [foreignBacklog] = await listStatuses(foreign.id);
    await makeTask(t.app, admin.token, ws.id, { title: "Pinned" });

    const self = await t.app.request(`/api/v1/statuses/${backlog!.id}?move_to=${backlog!.id}`, {
      method: "DELETE",
      headers: bearer(admin.token),
    });
    expect(self.status).toBe(400);

    const cross = await t.app.request(`/api/v1/statuses/${backlog!.id}?move_to=${foreignBacklog!.id}`, {
      method: "DELETE",
      headers: bearer(admin.token),
    });
    expect(cross.status).toBe(400);
  });

  it("moves tasks to move_to and deletes in one go", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "MVC");
    const [backlog, inProgress] = await listStatuses(ws.id);
    const task1 = await makeTask(t.app, admin.token, ws.id, { title: "One" });
    const task2 = await makeTask(t.app, admin.token, ws.id, { title: "Two" });
    expect(task1.status_id).toBe(backlog!.id);

    const res = await t.app.request(`/api/v1/statuses/${backlog!.id}?move_to=${inProgress!.id}`, {
      method: "DELETE",
      headers: bearer(admin.token),
    });
    expect(res.status).toBe(200);

    for (const id of [task1.id, task2.id]) {
      const got = await t.app.request(`/api/v1/tasks/${id}`, { headers: bearer(admin.token) });
      const { task } = (await got.json()) as { task: { status_id: string } };
      expect(task.status_id).toBe(inProgress!.id);
    }
    expect((await listStatuses(ws.id)).some((s) => s.id === backlog!.id)).toBe(false);
  });

  it("404s on a missing status", async () => {
    const res = await t.app.request("/api/v1/statuses/01ARZ3NDEKTSV4RRFFQ69G5FAV", {
      method: "DELETE",
      headers: bearer(admin.token),
    });
    expect(res.status).toBe(404);
  });
});
