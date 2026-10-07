import { readdirSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { UserSchema, type User } from "@temujira/shared";
import { buildApp } from "../src/app";
import { bearer, fileUpload, makeAgentWithKey, makeMember, makeTestApp, setupAdmin } from "./helpers";

const PNG = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJQAAAABJRU5ErkJggg==", "base64"));
let t: Awaited<ReturnType<typeof makeTestApp>>;
let admin: Awaited<ReturnType<typeof setupAdmin>>;
beforeAll(async () => { t = await makeTestApp(); admin = await setupAdmin(t.app); });
afterAll(() => t?.cleanup());
const upload = (user: string, token: string, bytes = PNG, mime = "image/png") => t.app.request(`/api/v1/users/${user}/avatar`, fileUpload(bytes, "picture.png", mime, bearer(token)));

it("allows self-service pictures without a write scope, replaces/removes bytes, and preserves them on restart", async () => {
  const person = await makeMember(t.app, admin.token, { scopes: [] });
  const response = await upload(person.userId, person.token);
  expect(response.status).toBe(200);
  const { user } = await response.json() as { user: User };
  expect(UserSchema.safeParse(user).success).toBe(true);
  expect(user.avatar_id).not.toBeNull();
  expect(t.ctx.storage.exists(user.avatar_id!)).toBe(true);
  expect((await t.app.request(`/api/v1/users/${user.id}/avatar`)).status).toBe(401);
  const picture = await t.app.request(`/api/v1/users/${user.id}/avatar`, { headers: bearer(admin.token) });
  expect(picture.headers.get("content-type")).toBe("image/png");
  expect(picture.headers.get("x-content-type-options")).toBe("nosniff");
  expect(new Uint8Array(await picture.arrayBuffer())).toEqual(PNG);
  const updated = await (await upload(user.id, person.token, PNG, "text/html")).json() as { user: User };
  expect(updated.user.avatar_id).not.toBe(user.avatar_id);
  expect(t.ctx.storage.exists(user.avatar_id!)).toBe(false);
  const reopened = await buildApp(t.ctx.config);
  try {
    expect(reopened.ctx.storage.exists(updated.user.avatar_id!)).toBe(true);
    expect((await reopened.app.request(`/api/v1/users/${user.id}/avatar`, { headers: bearer(person.token) })).status).toBe(200);
  } finally { reopened.ctx.sqlite.close(); }
  const removed = await t.app.request(`/api/v1/users/${user.id}/avatar`, { method: "DELETE", headers: bearer(person.token) });
  expect((await removed.json() as { user: User }).user.avatar_id).toBeNull();
  expect(t.ctx.storage.exists(updated.user.avatar_id!)).toBe(false);
  expect((await t.app.request(`/api/v1/users/${user.id}/avatar`, { headers: bearer(person.token) })).status).toBe(404);
});

it("enforces ownership and user-manager limits, including agent accounts", async () => {
  const person = await makeMember(t.app, admin.token);
  const manager = await makeMember(t.app, admin.token, { scopes: ["users:manage"] });
  const agent = await makeAgentWithKey(t.app, admin.token, "Picture agent");
  expect((await upload(agent.userId, person.token)).status).toBe(403);
  expect((await t.app.request(`/api/v1/users/${agent.userId}/avatar`, { method: "DELETE", headers: bearer(person.token) })).status).toBe(403);
  expect((await upload(admin.userId, manager.token)).status).toBe(403);
  expect((await upload(agent.userId, manager.token)).status).toBe(200);
  expect((await upload(agent.userId, agent.keyToken)).status).toBe(200);
});

it("rejects unsafe types and oversized pictures without losing the current picture or temp files", async () => {
  const person = await makeMember(t.app, admin.token);
  const before = await (await upload(person.userId, person.token)).json() as { user: User };
  expect((await upload(person.userId, person.token, new TextEncoder().encode('<svg onload="alert(1)"/>'), "image/png")).status).toBe(400);
  expect((await upload(person.userId, person.token, new Uint8Array(2 * 1024 * 1024 + 1))).status).toBe(413);
  const after = await (await t.app.request(`/api/v1/users/${person.userId}`, { headers: bearer(person.token) })).json() as { user: User };
  expect(after.user.avatar_id).toBe(before.user.avatar_id);
  expect(t.ctx.storage.exists(before.user.avatar_id!)).toBe(true);
  expect(readdirSync(t.ctx.storage.path(".")).some((name) => name.startsWith(".tmp-"))).toBe(false);
});
