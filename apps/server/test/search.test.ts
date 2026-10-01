import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { bearer, fileUpload, jsonReq, makeMember, makeTask, makeTestApp, makeWorkspace, setupAdmin } from "./helpers";

let t: Awaited<ReturnType<typeof makeTestApp>>;
let admin: Awaited<ReturnType<typeof setupAdmin>>;
beforeAll(async () => { t = await makeTestApp(); admin = await setupAdmin(t.app); });
afterAll(() => t?.cleanup());

async function search(token: string, q: string, extra = "") {
  const res = await t.app.request(`/api/v1/search?q=${encodeURIComponent(q)}${extra}`, { headers: bearer(token) });
  expect(res.status).toBe(200);
  return await res.json() as { items: Array<{ id: string; type: string; snippet: string; task_id: string; comment_id: string | null }>; total: number };
}

describe("full-text search", () => {
  it("indexes titles, descriptions, replies, filenames and file contents with workspace/type filters", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "SRCH");
    const task = await makeTask(t.app, admin.token, ws.id, { title: "Alloy report", description: "metallurgical analysis" });
    const comment = await t.app.request(`/api/v1/tasks/${task.id}/comments`, jsonReq("POST", { body: "micrometer calibration" }, bearer(admin.token)));
    const { comment: root } = await comment.json() as { comment: { id: string } };
    const reply = await t.app.request(`/api/v1/tasks/${task.id}/comments`, jsonReq("POST", { body: "thermoplastic note", parent_id: root.id }, bearer(admin.token)));
    const { comment: child } = await reply.json() as { comment: { id: string } };
    const upload = await t.app.request(`/api/v1/comments/${child.id}/attachments`, fileUpload(new TextEncoder().encode('a,b\n1,spectrometer'), "diagnostics.csv", "text/csv", bearer(admin.token)));
    expect(upload.status).toBe(200);
    const { attachment } = await upload.json() as { attachment: { id: string } };

    expect((await search(admin.token, "Alloy")).items.some((r) => r.id === task.id)).toBe(true);
    expect((await search(admin.token, "metallurg")).items[0]?.type).toBe("task");
    expect((await search(admin.token, '"micrometer calibration"')).items[0]?.id).toBe(root.id);
    expect((await search(admin.token, "thermoplastic")).items[0]?.id).toBe(child.id);
    expect((await search(admin.token, "diagnostics")).items[0]?.id).toBe(attachment.id);
    expect((await search(admin.token, "spectrometer")).items[0]).toMatchObject({ id: attachment.id, type: "attachment", comment_id: child.id });
    expect((await search(admin.token, "spectrometer", "&type=task")).total).toBe(0);
    expect((await search(admin.token, "spectrometer", `&workspace=${ws.key}`)).total).toBe(1);
    expect((await search(admin.token, task.key)).items.some((r) => r.id === task.id)).toBe(true);
    const filtered = await t.app.request(`/api/v1/workspaces/${ws.id}/tasks?q=spectrometer`, { headers: bearer(admin.token) });
    expect((await filtered.json() as { items: Array<{ id: string }> }).items.map((x) => x.id)).toContain(task.id);
  });

  it("filters permissions before totals, snippets and pagination, including inherited comment attachments", async () => {
    const publicWs = await makeWorkspace(t.app, admin.token, "PUBS");
    const privateWs = await makeWorkspace(t.app, admin.token, "PRIS");
    const visible = await makeTask(t.app, admin.token, publicWs.id, { title: "needle visible" });
    const hidden = await makeTask(t.app, admin.token, privateWs.id, { title: "needle confidential" });
    const res = await t.app.request(`/api/v1/tasks/${hidden.id}/comments`, jsonReq("POST", { body: "needle private discussion" }, bearer(admin.token)));
    const { comment } = await res.json() as { comment: { id: string } };
    await t.app.request(`/api/v1/comments/${comment.id}/attachments`, fileUpload(new TextEncoder().encode("needle secret bytes"), "needle-secret.txt", "text/plain", bearer(admin.token)));
    const member = await makeMember(t.app, admin.token, { workspace_access_all: false, workspace_ids: [publicWs.id] });
    const page = await search(member.token, "needle", "&limit=1");
    expect(page.total).toBe(1);
    expect(page.items.map((r) => r.id)).toEqual([visible.id]);
    expect(JSON.stringify(page)).not.toMatch(/confidential|secret|private discussion/);
    expect((await search(member.token, "needle", "&offset=1")).items).toEqual([]);
    expect((await t.app.request(`/api/v1/search?q=needle&workspace=${privateWs.key}`, { headers: bearer(member.token) })).status).toBe(404);
    await t.app.request(`/api/v1/users/${member.userId}`, jsonReq("PATCH", { workspace_ids: [] }, bearer(admin.token)));
    expect((await search(member.token, "needle")).total).toBe(0);
  });

  it("keeps edits/deletes/archives current and removes reply-file matches on thread deletion", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "SYNC");
    const task = await makeTask(t.app, admin.token, ws.id, { title: "initialmarker" });
    await t.app.request(`/api/v1/tasks/${task.id}`, jsonReq("PATCH", { title: "replacementmarker" }, bearer(admin.token)));
    expect((await search(admin.token, "initialmarker")).total).toBe(0);
    expect((await search(admin.token, "replacementmarker")).total).toBe(1);
    const rootRes = await t.app.request(`/api/v1/tasks/${task.id}/comments`, jsonReq("POST", { body: "removeparent" }, bearer(admin.token)));
    const { comment } = await rootRes.json() as { comment: { id: string } };
    await t.app.request(`/api/v1/comments/${comment.id}/attachments`, fileUpload(new TextEncoder().encode("removebytes"), "removefile.txt", "text/plain", bearer(admin.token)));
    expect((await search(admin.token, "removebytes")).total).toBe(1);
    await t.app.request(`/api/v1/comments/${comment.id}`, { method: "DELETE", headers: bearer(admin.token) });
    expect((await search(admin.token, "removebytes")).total).toBe(0);
    await t.app.request(`/api/v1/tasks/${task.id}`, jsonReq("PATCH", { archived: true }, bearer(admin.token)));
    expect((await search(admin.token, "replacementmarker")).total).toBe(0);
    expect((await search(admin.token, "replacementmarker", "&include_archived=true")).total).toBe(1);
  });

  it("treats queries as literal terms, never SQL or FTS operators", async () => {
    for (const q of ['"', '*', 'AND OR NOT', "title:yes NEAR(bad)", "') OR 1=1 --", '[]{}:%_']) {
      await search(admin.token, q);
    }
  });

  it("backfills attachment content on startup and supports filename-only binary files", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "FILE");
    const task = await makeTask(t.app, admin.token, ws.id, { title: "Documents" });
    const res = await t.app.request(`/api/v1/tasks/${task.id}/attachments`, fileUpload(new TextEncoder().encode("backfillword"), "notes.txt", "text/plain", bearer(admin.token)));
    const { attachment } = await res.json() as { attachment: { id: string } };
    t.ctx.sqlite.prepare("UPDATE attachments SET search_text=NULL WHERE id=?").run(attachment.id);
    const second = await buildApp(t.ctx.config);
    try {
      const found = await second.app.request('/api/v1/search?q=backfillword', { headers: bearer(admin.token) });
      expect((await found.json() as { total: number }).total).toBe(1);
    } finally { second.ctx.sqlite.close(); }
    const binary = await t.app.request(`/api/v1/tasks/${task.id}/attachments`, fileUpload(new Uint8Array([0, 1, 2]), "binarydiagram.pdf", "application/pdf", bearer(admin.token)));
    expect(binary.status).toBe(200);
    expect((await search(admin.token, "binarydiagram")).total).toBe(1);
  });
});
