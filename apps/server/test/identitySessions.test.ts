import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import {
  bearer,
  jsonReq,
  makeAgentWithKey,
  makeMember,
  makeTask,
  makeTestApp,
  makeWorkspace,
  setupAdmin,
} from "./helpers";

let t: Awaited<ReturnType<typeof makeTestApp>>;
let admin: { token: string; userId: string };

beforeAll(async () => {
  t = await makeTestApp();
  admin = await setupAdmin(t.app);
});
afterAll(() => t.cleanup());

let agentCounter = 0;

const api = {
  configure: (token: string, userId: string, exclusive: boolean) =>
    t.app.request(
      `/api/v1/users/${userId}`,
      jsonReq("PATCH", { exclusive_identity: exclusive }, bearer(token))
    ),
  acquire: (token: string, userId: string) =>
    t.app.request(`/api/v1/identities/${userId}/session`, jsonReq("POST", {}, bearer(token))),
  release: (token: string, userId: string, reason?: string) =>
    t.app.request(
      `/api/v1/identities/${userId}/session/release`,
      jsonReq("POST", reason ? { reason } : {}, bearer(token))
    ),
  getSession: (token: string, userId: string) =>
    t.app.request(`/api/v1/identities/${userId}/session`, { headers: bearer(token) }),
  listSessions: (token: string) =>
    t.app.request("/api/v1/identity-sessions", { headers: bearer(token) }),
  current: (token: string) =>
    t.app.request("/api/v1/identity-sessions/current", { headers: bearer(token) }),
  myTasks: (token: string) => t.app.request("/api/v1/tasks/mine", { headers: bearer(token) }),
  inbox: (token: string) => t.app.request("/api/v1/inbox", { headers: bearer(token) }),
  task: (token: string, key: string) =>
    t.app.request(`/api/v1/tasks/${key}`, { headers: bearer(token) }),
  updateTask: (token: string, key: string, body: unknown) =>
    t.app.request(`/api/v1/tasks/${key}`, jsonReq("PATCH", body, bearer(token))),
  comment: (token: string, key: string, body: string) =>
    t.app.request(`/api/v1/tasks/${key}/comments`, jsonReq("POST", { body }, bearer(token))),
  mintKey: (token: string, userId: string, name: string) =>
    t.app.request("/api/v1/api-keys", jsonReq("POST", { name, user_id: userId }, bearer(token))),
  listKeys: (token: string) =>
    t.app.request("/api/v1/api-keys?all=true", { headers: bearer(token) }),
  getUser: (token: string, userId: string) =>
    t.app.request(`/api/v1/users/${userId}`, { headers: bearer(token) }),
};

/** Admin-create an agent with given scopes plus one ordinary key. */
async function makeAgent(scopes: string[] = ["tasks:write"]) {
  const name = `Worker ${++agentCounter}`;
  const created = await t.app.request(
    "/api/v1/users",
    jsonReq("POST", { name, is_agent: true, scopes }, bearer(admin.token))
  );
  expect(created.status).toBe(200);
  const { user } = (await created.json()) as { user: { id: string } };
  const key = await api.mintKey(admin.token, user.id, `${name} key`);
  expect(key.status).toBe(200);
  const { token } = (await key.json()) as { token: string };
  return { userId: user.id, name, keyToken: token };
}

async function makeManager() {
  return makeMember(t.app, admin.token, {
    scopes: ["tasks:write", "api_keys:manage"],
  });
}

type SessionJson = {
  session: {
    id: string;
    user_id: string;
    api_key_id: string;
    status: string;
    release_reason: string | null;
  } | null;
};

describe("shared mode (default) compatibility", () => {
  it("lets multiple keys use the same identity concurrently", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "IDS1");
    const task = await makeTask(t.app, admin.token, ws.id, { title: "Shared work" });
    const agent = await makeAgent();
    const second = await api.mintKey(admin.token, agent.userId, "second key");
    const { token: key2 } = (await second.json()) as { token: string };

    expect((await api.getUser(admin.token, agent.userId)).status).toBe(200);
    const user = (await (await api.getUser(admin.token, agent.userId)).json()) as {
      user: { exclusive_identity: boolean };
    };
    expect(user.user.exclusive_identity).toBe(false);

    // Both keys read and write concurrently.
    expect((await api.myTasks(agent.keyToken)).status).toBe(200);
    expect((await api.myTasks(key2)).status).toBe(200);
    expect((await api.updateTask(agent.keyToken, task.key, { title: "via key 1" })).status).toBe(200);
    expect((await api.comment(key2, task.key, "via key 2")).status).toBe(200);
    expect((await api.updateTask(key2, task.key, { title: "via key 2" })).status).toBe(200);
  });

  it("keeps ticket assignment and status untouched by acquire/release", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "IDS2");
    const assignee = await makeMember(t.app, admin.token);
    const task = await makeTask(t.app, admin.token, ws.id, {
      title: "Owned work",
      assignee_id: assignee.userId,
    });
    const before = (await (await api.task(admin.token, task.key)).json()) as {
      task: { assignee_id: string | null; status_id: string };
    };

    const agent = await makeAgent();
    expect((await api.configure(admin.token, agent.userId, true)).status).toBe(200);
    const acquired = await api.acquire(admin.token, agent.userId);
    expect(acquired.status).toBe(200);
    const { token } = (await acquired.json()) as { token: string };
    expect((await api.release(token, agent.userId)).status).toBe(200);

    const after = (await (await api.task(admin.token, task.key)).json()) as {
      task: { assignee_id: string | null; status_id: string };
    };
    expect(after.task.assignee_id).toBe(before.task.assignee_id);
    expect(after.task.status_id).toBe(before.task.status_id);
  });
});

describe("policy configuration", () => {
  it("requires users:manage, agent accounts, and stays a management decision", async () => {
    const agent = await makeAgent();
    const human = await makeMember(t.app, admin.token);

    // Non-managers cannot configure the policy.
    const plain = await makeMember(t.app, admin.token);
    expect((await api.configure(plain.token, agent.userId, true)).status).toBe(403);

    // Humans cannot be exclusive identities.
    const humanAttempt = await api.configure(admin.token, human.userId, true);
    expect(humanAttempt.status).toBe(400);

    // A manager with users:manage can.
    const manager = await makeMember(t.app, admin.token, {
      scopes: ["tasks:write", "users:manage"],
    });
    expect((await api.configure(manager.token, agent.userId, true)).status).toBe(200);
    const user = (await (await api.getUser(admin.token, agent.userId)).json()) as {
      user: { exclusive_identity: boolean };
    };
    expect(user.user.exclusive_identity).toBe(true);
  });

  it("does not let a session key turn exclusivity off", async () => {
    // Give the agent users:manage so the only thing stopping it is the session rule.
    const agent = await makeAgent(["tasks:write", "users:manage"]);
    expect((await api.configure(admin.token, agent.userId, true)).status).toBe(200);
    const acquired = (await (await api.acquire(admin.token, agent.userId)).json()) as {
      token: string;
    };
    const attempt = await api.configure(acquired.token, agent.userId, false);
    expect(attempt.status).toBe(403);
    expect(((await attempt.json()) as { error: { message: string } }).error.message).toContain(
      "identity-session keys cannot change the exclusivity policy"
    );
    await api.release(acquired.token, agent.userId);
  });
});

describe("exclusive mode enforcement", () => {
  it("rejects every non-session key, reads included, with or without an active session", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "IDS3");
    const task = await makeTask(t.app, admin.token, ws.id, { title: "Exclusive work" });
    const agent = await makeAgent();
    expect((await api.configure(admin.token, agent.userId, true)).status).toBe(200);

    // No session yet: ordinary keys are already rejected everywhere.
    expect((await api.myTasks(agent.keyToken)).status).toBe(403);
    expect((await api.inbox(agent.keyToken)).status).toBe(403);
    expect((await api.updateTask(agent.keyToken, task.key, { title: "nope" })).status).toBe(403);
    expect((await api.comment(agent.keyToken, task.key, "nope")).status).toBe(403);
    expect((await api.current(agent.keyToken)).status).toBe(403);

    // With a session, still rejected.
    const acquired = (await (await api.acquire(admin.token, agent.userId)).json()) as {
      token: string;
      session: { id: string };
    };
    expect((await api.myTasks(agent.keyToken)).status).toBe(403);
    expect((await api.comment(agent.keyToken, task.key, "nope")).status).toBe(403);

    // The session key can do all of it.
    expect((await api.myTasks(acquired.token)).status).toBe(200);
    expect((await api.inbox(acquired.token)).status).toBe(200);
    expect((await api.comment(acquired.token, task.key, "working")).status).toBe(200);
    const current = await api.current(acquired.token);
    expect(current.status).toBe(200);
    expect(((await current.json()) as SessionJson).session?.id).toBe(acquired.session.id);

    await api.release(acquired.token, agent.userId);
  });

  it("acquires atomically: concurrent callers cannot both win", async () => {
    const agent = await makeAgent();
    expect((await api.configure(admin.token, agent.userId, true)).status).toBe(200);
    const manager = await makeManager();

    const [a, b] = await Promise.all([
      api.acquire(admin.token, agent.userId),
      api.acquire(manager.token, agent.userId),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);

    const list = (await (await api.listSessions(admin.token)).json()) as {
      items: { id: string; user_id: string }[];
    };
    expect(list.items.filter((s) => s.user_id === agent.userId)).toHaveLength(1);
    const keys = (await (await api.listKeys(admin.token)).json()) as {
      items: { user_id: string; name: string }[];
    };
    const sessionKeys = keys.items.filter(
      (k) => k.user_id === agent.userId && k.name.startsWith("identity session ")
    );
    expect(sessionKeys).toHaveLength(1);

    // Acquisition conflicts while the session is held.
    expect((await api.acquire(admin.token, agent.userId)).status).toBe(409);
    const conflictBody = (await (await api.acquire(admin.token, agent.userId)).json()) as {
      error: { details?: { session_id?: string } };
    };
    expect(conflictBody.error.details?.session_id).toBeTruthy();

    const winner = a.status === 200 ? a : b;
    const { token } = (await winner.json()) as { token: string };
    await api.release(token, agent.userId);
  });

  it("lets the worker release its own session without management permission", async () => {
    const agent = await makeAgent();
    expect((await api.configure(admin.token, agent.userId, true)).status).toBe(200);
    const acquired = (await (await api.acquire(admin.token, agent.userId)).json()) as {
      token: string;
      session: { id: string };
    };

    const release = await api.release(acquired.token, agent.userId, "worker done");
    expect(release.status).toBe(200);
    const released = (await release.json()) as SessionJson;
    expect(released.session?.status).toBe("released");

    // Key is dead, identity is free, policy is unchanged (still exclusive).
    expect((await api.current(acquired.token)).status).toBe(401);
    expect(((await (await api.getSession(admin.token, agent.userId)).json()) as SessionJson).session).toBeNull();
    const user = (await (await api.getUser(admin.token, agent.userId)).json()) as {
      user: { exclusive_identity: boolean };
    };
    expect(user.user.exclusive_identity).toBe(true);
    expect((await api.acquire(admin.token, agent.userId)).status).toBe(200);
  });

  it("old credentials cannot regain access or release a newer session", async () => {
    const agent = await makeAgent();
    expect((await api.configure(admin.token, agent.userId, true)).status).toBe(200);
    const first = (await (await api.acquire(admin.token, agent.userId)).json()) as {
      token: string;
      session: { id: string };
    };
    expect((await api.release(first.token, agent.userId)).status).toBe(200);

    const second = (await (await api.acquire(admin.token, agent.userId)).json()) as {
      token: string;
      session: { id: string };
    };
    expect(second.session.id).not.toBe(first.session.id);

    // Old key cannot authenticate, and therefore cannot release the newer session.
    expect((await api.current(first.token)).status).toBe(401);
    expect((await api.release(first.token, agent.userId)).status).toBe(401);
    const still = (await (await api.getSession(admin.token, agent.userId)).json()) as SessionJson;
    expect(still.session?.id).toBe(second.session.id);
    expect((await api.current(second.token)).status).toBe(200);
    await api.release(second.token, agent.userId);
  });

  it("lets authorized management recover an abandoned session", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "IDS4");
    const task = await makeTask(t.app, admin.token, ws.id, { title: "Abandoned work" });
    const agent = await makeAgent();
    expect((await api.configure(admin.token, agent.userId, true)).status).toBe(200);
    const acquired = (await (await api.acquire(admin.token, agent.userId)).json()) as {
      token: string;
      session: { id: string };
    };

    // A caller without management authority cannot force-release.
    const plain = await makeMember(t.app, admin.token);
    expect((await api.release(plain.token, agent.userId)).status).toBe(403);

    // A manager with api_keys:manage can.
    const manager = await makeManager();
    const recovery = await api.release(manager.token, agent.userId, "worker disappeared");
    expect(recovery.status).toBe(200);
    const body = (await recovery.json()) as SessionJson;
    expect(body.session?.release_reason).toBe("worker disappeared");
    expect((await api.current(acquired.token)).status).toBe(401);
    expect((await api.updateTask(acquired.token, task.key, { title: "late" })).status).toBe(401);

    // The identity can be acquired again afterwards.
    expect((await api.acquire(admin.token, agent.userId)).status).toBe(200);
  });

  it("handles mode transitions explicitly", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "IDS5");
    const task = await makeTask(t.app, admin.token, ws.id, { title: "Transition work" });
    const agent = await makeAgent();

    // shared -> exclusive suspends existing keys without deleting them.
    expect((await api.updateTask(agent.keyToken, task.key, { title: "shared write" })).status).toBe(200);
    expect((await api.configure(admin.token, agent.userId, true)).status).toBe(200);
    expect((await api.myTasks(agent.keyToken)).status).toBe(403);

    // exclusive -> shared is refused while a session is active.
    const acquired = (await (await api.acquire(admin.token, agent.userId)).json()) as {
      token: string;
    };
    const refused = await api.configure(admin.token, agent.userId, false);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toContain(
      "release the active identity session first"
    );

    // After release, the switch works and the suspended key works again.
    await api.release(acquired.token, agent.userId);
    expect((await api.configure(admin.token, agent.userId, false)).status).toBe(200);
    expect((await api.myTasks(agent.keyToken)).status).toBe(200);
    expect((await api.updateTask(agent.keyToken, task.key, { title: "shared again" })).status).toBe(200);
  });

  it("survives an app restart", async () => {
    const agent = await makeAgent();
    expect((await api.configure(admin.token, agent.userId, true)).status).toBe(200);
    const acquired = (await (await api.acquire(admin.token, agent.userId)).json()) as {
      token: string;
      session: { id: string };
    };

    const restarted = await buildApp({
      dataDir: t.ctx.config.dataDir,
      maxUploadMb: 5,
      cookieSecure: false,
      devOrigins: [],
      version: "test",
    });
    const after = await restarted.app.request(`/api/v1/identities/${agent.userId}/session`, {
      headers: bearer(admin.token),
    });
    expect(after.status).toBe(200);
    expect(((await after.json()) as SessionJson).session?.id).toBe(acquired.session.id);
    // The session key still works, and the suspended key is still suspended.
    const current = await restarted.app.request("/api/v1/identity-sessions/current", {
      headers: bearer(acquired.token),
    });
    expect(current.status).toBe(200);
    const blocked = await restarted.app.request("/api/v1/tasks/mine", {
      headers: bearer(agent.keyToken),
    });
    expect(blocked.status).toBe(403);
    restarted.ctx.sqlite.close();

    await api.release(acquired.token, agent.userId);
  });
});
