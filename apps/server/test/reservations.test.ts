import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import {
  bearer,
  fileUpload,
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
const agentName = () => `Scientist ${++agentCounter}`;

const api = {
  admit: (token: string, userId: string, note?: string) =>
    t.app.request(
      "/api/v1/managed-agents",
      jsonReq("POST", { user_id: userId, ...(note ? { note } : {}) }, bearer(token)),
    ),
  agents: (token: string, q = "") =>
    t.app.request(`/api/v1/managed-agents${q}`, { headers: bearer(token) }),
  claim: (
    token: string,
    body: { agent_user_id: string; task: string; run_reference: string; request_id: string; adopt_existing_assignment?: boolean },
  ) => t.app.request("/api/v1/reservations", jsonReq("POST", body, bearer(token))),
  release: (token: string, id: string, reason?: string) =>
    t.app.request(`/api/v1/reservations/${id}/release`, jsonReq("POST", reason ? { reason } : {}, bearer(token))),
  reservations: (token: string, q = "") =>
    t.app.request(`/api/v1/reservations${q}`, { headers: bearer(token) }),
  lookup: (token: string, requestId: string) =>
    t.app.request(`/api/v1/reservations/lookup?request_id=${encodeURIComponent(requestId)}`, {
      headers: bearer(token),
    }),
  current: (token: string) => t.app.request("/api/v1/reservations/current", { headers: bearer(token) }),
  getReservation: (token: string, id: string) =>
    t.app.request(`/api/v1/reservations/${id}`, { headers: bearer(token) }),
  task: (token: string, key: string) => t.app.request(`/api/v1/tasks/${key}`, { headers: bearer(token) }),
  updateTask: (token: string, key: string, body: unknown) =>
    t.app.request(`/api/v1/tasks/${key}`, jsonReq("PATCH", body, bearer(token))),
  comment: (token: string, key: string, body: string) =>
    t.app.request(`/api/v1/tasks/${key}/comments`, jsonReq("POST", { body }, bearer(token))),
  link: (token: string, key: string, body: unknown) =>
    t.app.request(`/api/v1/tasks/${key}/links`, jsonReq("POST", body, bearer(token))),
  uploadToTask: (token: string, key: string, filename = "note.txt") =>
    t.app.request(`/api/v1/tasks/${key}/attachments`, fileUpload(new Uint8Array([1, 2, 3]), filename, "text/plain", bearer(token))),
  listKeys: (token: string) => t.app.request("/api/v1/api-keys?all=true", { headers: bearer(token) }),
};

type ClaimJson = {
  reservation: {
    id: string;
    status: string;
    agent_user_id: string;
    task_id: string;
    task_key: string;
    run_reference: string;
    request_id: string;
    api_key_id: string;
  };
  token: string | null;
  replayed: boolean;
};

async function makeManagedAgent(managerToken = admin.token) {
  const agent = await makeAgentWithKey(t.app, admin.token, agentName());
  const admit = await api.admit(managerToken, agent.userId);
  expect(admit.status).toBe(200);
  return agent;
}

describe("reservation claims", () => {
  it("claims an available identity + ticket and mints a working worker key", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "RESA");
    const task = await makeTask(t.app, admin.token, ws.id, { title: "Cut the first part" });
    const agent = await makeManagedAgent();

    const res = await api.claim(admin.token, {
      agent_user_id: agent.userId,
      task: task.key,
      run_reference: "batch-4/run-001",
      request_id: "req-basic-1",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ClaimJson;
    expect(body.replayed).toBe(false);
    expect(body.token).toMatch(/^tmj_/);
    expect(body.reservation.status).toBe("active");
    expect(body.reservation.task_key).toBe(task.key);

    // Ticket is assigned to the identity.
    const taskRes = await api.task(admin.token, task.key);
    const taskBody = (await taskRes.json()) as { task: { assignee_id: string | null } };
    expect(taskBody.task.assignee_id).toBe(agent.userId);

    // The worker key identifies its own reservation and can do allowed work.
    const current = await api.current(body.token!);
    expect(current.status).toBe(200);
    const currentBody = (await current.json()) as {
      user: { id: string };
      reservation: { id: string; run_reference: string } | null;
      task: { key: string } | null;
    };
    expect(currentBody.user.id).toBe(agent.userId);
    expect(currentBody.reservation?.id).toBe(body.reservation.id);
    expect(currentBody.reservation?.run_reference).toBe("batch-4/run-001");
    expect(currentBody.task?.key).toBe(task.key);

    const update = await api.updateTask(body.token!, task.key, { title: "Cut the first part (v2)" });
    expect(update.status).toBe(200);
    const comment = await api.comment(body.token!, task.key, "Started the run.");
    expect(comment.status).toBe(200);
    const upload = await api.uploadToTask(body.token!, task.key);
    expect(upload.status).toBe(200);

    // Release for the rest of the file's cleanliness.
    const release = await api.release(admin.token, body.reservation.id, "test cleanup");
    expect(release.status).toBe(200);
  });

  it("concurrent claims of one identity for two tickets: exactly one wins", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "RESB");
    const x = await makeTask(t.app, admin.token, ws.id, { title: "Ticket X" });
    const y = await makeTask(t.app, admin.token, ws.id, { title: "Ticket Y" });
    const agent = await makeManagedAgent();

    const [rx, ry] = await Promise.all([
      api.claim(admin.token, { agent_user_id: agent.userId, task: x.key, run_reference: "run-x", request_id: "req-race-agent-x" }),
      api.claim(admin.token, { agent_user_id: agent.userId, task: y.key, run_reference: "run-y", request_id: "req-race-agent-y" }),
    ]);
    const statuses = [rx.status, ry.status].sort();
    expect(statuses).toEqual([200, 409]);

    // No partial state: exactly one active reservation, one assigned ticket, one worker key.
    const list = (await (await api.reservations(admin.token, `?agent_user_id=${agent.userId}&status=active`)).json()) as {
      items: { id: string }[];
    };
    expect(list.items).toHaveLength(1);
    const keys = (await (await api.listKeys(admin.token)).json()) as {
      items: { user_id: string; name: string }[];
    };
    const workerKeys = keys.items.filter((k) => k.user_id === agent.userId && k.name.startsWith("reservation "));
    expect(workerKeys).toHaveLength(1);
    const tx = (await (await api.task(admin.token, x.key)).json()) as { task: { assignee_id: string | null } };
    const ty = (await (await api.task(admin.token, y.key)).json()) as { task: { assignee_id: string | null } };
    const assigned = [tx.task.assignee_id, ty.task.assignee_id].filter((a) => a === agent.userId);
    expect(assigned).toHaveLength(1);

    await api.release(admin.token, list.items[0]!.id, "cleanup");
  });

  it("concurrent claims of one ticket by two identities: exactly one wins", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "RESC");
    const task = await makeTask(t.app, admin.token, ws.id, { title: "Contested ticket" });
    const a = await makeManagedAgent();
    const b = await makeManagedAgent();

    const [ra, rb] = await Promise.all([
      api.claim(admin.token, { agent_user_id: a.userId, task: task.key, run_reference: "run-a", request_id: "req-race-task-a" }),
      api.claim(admin.token, { agent_user_id: b.userId, task: task.key, run_reference: "run-b", request_id: "req-race-task-b" }),
    ]);
    expect([ra.status, rb.status].sort()).toEqual([200, 409]);

    const list = (await (await api.reservations(admin.token, `?task=${task.key}&status=active`)).json()) as {
      items: { id: string }[];
    };
    expect(list.items).toHaveLength(1);
    await api.release(admin.token, list.items[0]!.id, "cleanup");
  });

  it("cannot steal a ticket assigned to a human, and same-agent legacy work needs adoption", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "RESD");
    const human = await makeMember(t.app, admin.token);
    const stolen = await makeTask(t.app, admin.token, ws.id, { title: "Human ticket", assignee_id: human.userId });
    const agent = await makeManagedAgent();

    const denied = await api.claim(admin.token, {
      agent_user_id: agent.userId,
      task: stolen.key,
      run_reference: "run-steal",
      request_id: "req-steal",
    });
    expect(denied.status).toBe(409);
    expect(((await denied.json()) as { error: { code: string } }).error.code).toBe("conflict");
    const after = (await (await api.task(admin.token, stolen.key)).json()) as { task: { assignee_id: string | null } };
    expect(after.task.assignee_id).toBe(human.userId);

    // Legacy same-agent assignment: explicit adoption is required, never assumed.
    // Simulated the real way: the ticket was assigned before the identity was admitted.
    const legacyAgent = await makeAgentWithKey(t.app, admin.token, agentName());
    const legacy = await makeTask(t.app, admin.token, ws.id, {
      title: "Legacy agent work",
      assignee_id: legacyAgent.userId,
    });
    expect((await api.admit(admin.token, legacyAgent.userId)).status).toBe(200);
    const noAdopt = await api.claim(admin.token, {
      agent_user_id: legacyAgent.userId,
      task: legacy.key,
      run_reference: "run-legacy",
      request_id: "req-legacy-1",
    });
    expect(noAdopt.status).toBe(409);
    const adopted = await api.claim(admin.token, {
      agent_user_id: legacyAgent.userId,
      task: legacy.key,
      run_reference: "run-legacy",
      request_id: "req-legacy-2",
      adopt_existing_assignment: true,
    });
    expect(adopted.status).toBe(200);
    const adoptedBody = (await adopted.json()) as ClaimJson;
    await api.release(admin.token, adoptedBody.reservation.id, "cleanup");
  });
});

describe("worker credential boundaries", () => {
  it("ordinary keys cannot act as the reserved identity; other agents cannot impersonate", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "RESE");
    const task = await makeTask(t.app, admin.token, ws.id, { title: "Bound ticket" });
    const agent = await makeManagedAgent(); // includes an ordinary key
    const other = await makeManagedAgent();

    const claim = (await (await api.claim(admin.token, {
      agent_user_id: agent.userId,
      task: task.key,
      run_reference: "run-bound",
      request_id: "req-bound",
    })).json()) as ClaimJson;

    // The agent's ordinary key is not a worker credential: reads are fine, job writes are not.
    const ordinaryCurrent = await api.current(agent.keyToken);
    expect(ordinaryCurrent.status).toBe(200);
    expect(((await ordinaryCurrent.json()) as { reservation: unknown }).reservation).toBeNull();
    const ordinaryWrite = await api.updateTask(agent.keyToken, task.key, { title: "nope" });
    expect(ordinaryWrite.status).toBe(403);
    const ordinaryComment = await api.comment(agent.keyToken, task.key, "nope");
    expect(ordinaryComment.status).toBe(403);

    // Another agent's key cannot touch this ticket.
    const otherKey = await api.updateTask(other.keyToken, task.key, { title: "nope" });
    expect(otherKey.status).toBe(403);

    // Management/key surfaces are closed to worker credentials.
    const workerMint = await t.app.request("/api/v1/api-keys", jsonReq("POST", { name: "self-serve" }, bearer(claim.token!)));
    expect(workerMint.status).toBe(403);
    const workerManage = await t.app.request(
      "/api/v1/reservations",
      jsonReq("POST", { agent_user_id: other.userId, task: task.key, run_reference: "x", request_id: "req-worker-manage" }, bearer(claim.token!)),
    );
    expect(workerManage.status).toBe(403);
    const workerEscalate = await t.app.request(
      `/api/v1/users/${agent.userId}`,
      jsonReq("PATCH", { scopes: ["tasks:write", "reservations:manage"] }, bearer(claim.token!)),
    );
    expect(workerEscalate.status).toBe(403);

    await api.release(admin.token, claim.reservation.id, "cleanup");
  });

  it("ordinary assignment cannot create a job for a managed identity", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "RESF");
    const agent = await makeManagedAgent();
    const plain = await makeTask(t.app, admin.token, ws.id, { title: "Plain ticket" });

    const assign = await api.updateTask(admin.token, plain.key, { assignee_id: agent.userId });
    expect(assign.status).toBe(409);
    const create = await t.app.request(
      `/api/v1/workspaces/${ws.id}/tasks`,
      jsonReq("POST", { title: "Sneaky", assignee_id: agent.userId }, bearer(admin.token)),
    );
    expect(create.status).toBe(409);
  });

  it("workers cannot write unrelated tickets through any path; human review still works", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "RESG");
    const reserved = await makeTask(t.app, admin.token, ws.id, { title: "Reserved" });
    const unrelated = await makeTask(t.app, admin.token, ws.id, { title: "Unrelated" });
    const otherUnrelated = await makeTask(t.app, admin.token, ws.id, { title: "Also unrelated" });
    const agent = await makeManagedAgent();
    const human = await makeMember(t.app, admin.token);

    const claim = (await (await api.claim(admin.token, {
      agent_user_id: agent.userId,
      task: reserved.key,
      run_reference: "run-scope",
      request_id: "req-scope",
    })).json()) as ClaimJson;
    const key = claim.token!;

    expect((await api.updateTask(key, unrelated.key, { title: "nope" })).status).toBe(403);
    expect((await api.comment(key, unrelated.key, "nope")).status).toBe(403);
    expect((await api.uploadToTask(key, unrelated.key)).status).toBe(403);
    // Links must involve the reserved ticket.
    expect((await api.link(key, unrelated.key, { type: "relates", task: otherUnrelated.key })).status).toBe(403);
    // ...but a dependency link that involves it is fine.
    expect((await api.link(key, reserved.key, { type: "blocked_by", task: unrelated.key })).status).toBe(200);
    // Workers cannot archive/restore their ticket either.
    expect((await api.updateTask(key, reserved.key, { archived: true })).status).toBe(403);

    // Human review on the reserved ticket is untouched.
    expect((await api.comment(human.token, reserved.key, "Human review note.")).status).toBe(200);
    expect((await api.updateTask(human.token, reserved.key, { title: "Reviewed title" })).status).toBe(200);

    await api.release(admin.token, claim.reservation.id, "cleanup");
  });

  it("assignee changes on a reserved ticket are blocked until release", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "RESH");
    const task = await makeTask(t.app, admin.token, ws.id, { title: "Locked ticket" });
    const human = await makeMember(t.app, admin.token);
    const agent = await makeManagedAgent();
    const claim = (await (await api.claim(admin.token, {
      agent_user_id: agent.userId,
      task: task.key,
      run_reference: "run-lock",
      request_id: "req-lock",
    })).json()) as ClaimJson;

    const reassign = await api.updateTask(admin.token, task.key, { assignee_id: human.userId });
    expect(reassign.status).toBe(409);
    const unassign = await api.updateTask(admin.token, task.key, { assignee_id: null });
    expect(unassign.status).toBe(409);
    // Idempotent self-assignment by the worker is allowed.
    const self = await api.updateTask(claim.token!, task.key, { assignee_id: agent.userId });
    expect(self.status).toBe(200);

    await api.release(admin.token, claim.reservation.id, "cleanup");
  });
});

describe("release, recovery and retries", () => {
  it("release revokes the key, clears the assignment, and reuse mints a fresh key", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "RESI");
    const task = await makeTask(t.app, admin.token, ws.id, { title: "Reusable" });
    const agent = await makeManagedAgent();
    const first = (await (await api.claim(admin.token, {
      agent_user_id: agent.userId,
      task: task.key,
      run_reference: "run-1",
      request_id: "req-reuse-1",
    })).json()) as ClaimJson;

    const release = await api.release(admin.token, first.reservation.id, "job finished");
    expect(release.status).toBe(200);
    const released = (await release.json()) as ClaimJson;
    expect(released.reservation.status).toBe("released");

    // K1 is dead; the assignment was cleared; the ticket status/history is untouched.
    expect((await api.current(first.token!)).status).toBe(401);
    expect((await api.updateTask(first.token!, task.key, { title: "late" })).status).toBe(401);
    const cleared = (await (await api.task(admin.token, task.key)).json()) as { task: { assignee_id: string | null } };
    expect(cleared.task.assignee_id).toBeNull();

    // A new claim gets K2; K1 never becomes valid again.
    const second = (await (await api.claim(admin.token, {
      agent_user_id: agent.userId,
      task: task.key,
      run_reference: "run-2",
      request_id: "req-reuse-2",
    })).json()) as ClaimJson;
    expect(second.reservation.id).not.toBe(first.reservation.id);
    expect(second.token).not.toBe(first.token);
    expect((await api.current(second.token!)).status).toBe(200);
    expect((await api.current(first.token!)).status).toBe(401);

    // A stale release of the old reservation must not touch the new one.
    const stale = await api.release(admin.token, first.reservation.id);
    expect(stale.status).toBe(200);
    const stillActive = await api.getReservation(admin.token, second.reservation.id);
    expect(((await stillActive.json()) as ClaimJson).reservation.status).toBe("active");
    await api.release(admin.token, second.reservation.id, "cleanup");
  });

  it("claim retries are idempotent, conflicting reuse of a request id is rejected", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "RESJ");
    const task = await makeTask(t.app, admin.token, ws.id, { title: "Retry ticket" });
    const other = await makeTask(t.app, admin.token, ws.id, { title: "Other ticket" });
    const agent = await makeManagedAgent();

    const body = {
      agent_user_id: agent.userId,
      task: task.key,
      run_reference: "run-retry",
      request_id: "req-retry-1",
    };
    const first = (await (await api.claim(admin.token, body)).json()) as ClaimJson;
    const replay = await api.claim(admin.token, body);
    expect(replay.status).toBe(200);
    const replayBody = (await replay.json()) as ClaimJson;
    expect(replayBody.replayed).toBe(true);
    expect(replayBody.reservation.id).toBe(first.reservation.id);
    expect(replayBody.token).toBeNull();

    // Same request id, different inputs: conflict.
    const mismatch = await api.claim(admin.token, { ...body, task: other.key });
    expect(mismatch.status).toBe(409);

    // Recovery by request id discovers the committed claim.
    const lookup = await api.lookup(admin.token, "req-retry-1");
    expect(lookup.status).toBe(200);
    expect(((await lookup.json()) as { reservation: { id: string } | null }).reservation?.id).toBe(first.reservation.id);

    // Repeated release is harmless.
    expect((await api.release(admin.token, first.reservation.id)).status).toBe(200);
    expect((await api.release(admin.token, first.reservation.id)).status).toBe(200);
  });

  it("state survives an app restart and idle/status changes never auto-release", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "RESK");
    const task = await makeTask(t.app, admin.token, ws.id, { title: "Durable ticket" });
    const agent = await makeManagedAgent();
    const claim = (await (await api.claim(admin.token, {
      agent_user_id: agent.userId,
      task: task.key,
      run_reference: "run-durable",
      request_id: "req-durable",
    })).json()) as ClaimJson;

    // Status changes and quiet time do not release anything.
    const statuses = (await (await t.app.request(`/api/v1/workspaces/${ws.key}/statuses`, { headers: bearer(admin.token) })).json()) as {
      items: { id: string; name: string }[];
    };
    const done = statuses.items.find((s) => s.name === "Done")!;
    expect((await api.updateTask(admin.token, task.key, { status_id: done.id })).status).toBe(200);
    const still = await api.getReservation(admin.token, claim.reservation.id);
    expect(((await still.json()) as ClaimJson).reservation.status).toBe("active");

    // A second app over the same data dir sees the same reservation (restart durability).
    const restarted = await buildApp({
      dataDir: t.ctx.config.dataDir,
      maxUploadMb: 5,
      cookieSecure: false,
      devOrigins: [],
      version: "test",
    });
    const after = await restarted.app.request(`/api/v1/reservations/${claim.reservation.id}`, {
      headers: bearer(admin.token),
    });
    expect(after.status).toBe(200);
    expect(((await after.json()) as ClaimJson).reservation.status).toBe("active");
    restarted.ctx.sqlite.close();

    await api.release(admin.token, claim.reservation.id, "cleanup");
  });

  it("revoked keys and deactivated workers stay inspectable and recoverable", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "RESL");
    const task = await makeTask(t.app, admin.token, ws.id, { title: "Crashy ticket" });
    const agent = await makeManagedAgent();
    const claim = (await (await api.claim(admin.token, {
      agent_user_id: agent.userId,
      task: task.key,
      run_reference: "run-crash",
      request_id: "req-crash",
    })).json()) as ClaimJson;

    // Independent key revocation: the reservation stays visible, the identity is not free.
    const revoke = await t.app.request(`/api/v1/api-keys/${claim.reservation.api_key_id}`, {
      method: "DELETE",
      headers: bearer(admin.token),
    });
    expect(revoke.status).toBe(200);
    const listed = (await (await api.agents(admin.token)).json()) as {
      items: { user_id: string; available: boolean; reservation: { id: string } | null }[];
    };
    const agentRow = listed.items.find((a) => a.user_id === agent.userId)!;
    expect(agentRow.available).toBe(false);
    expect(agentRow.reservation?.id).toBe(claim.reservation.id);
    // A new claim for the same identity conflicts while the reservation exists.
    const blocked = await api.claim(admin.token, {
      agent_user_id: agent.userId,
      task: task.key,
      run_reference: "run-crash-2",
      request_id: "req-crash-2",
    });
    expect(blocked.status).toBe(409);

    // Deactivating the worker does not silently free it, and release still works.
    const deactivate = await t.app.request(`/api/v1/users/${agent.userId}`, {
      method: "DELETE",
      headers: bearer(admin.token),
    });
    expect(deactivate.status).toBe(200);
    const afterDeactivate = (await (await api.agents(admin.token, "?include_deactivated=true")).json()) as {
      items: { user_id: string; available: boolean; deactivated: boolean; conflicts: string[] }[];
    };
    const row = afterDeactivate.items.find((a) => a.user_id === agent.userId)!;
    expect(row.deactivated).toBe(true);
    expect(row.available).toBe(false);
    expect(row.conflicts).toContain("identity is deactivated");
    expect((await api.release(admin.token, claim.reservation.id, "forced recovery")).status).toBe(200);
    const unadmit = await t.app.request(`/api/v1/managed-agents/${agent.userId}`, {
      method: "DELETE",
      headers: bearer(admin.token),
    });
    expect(unadmit.status).toBe(200);
  });
});

describe("authority and hygiene", () => {
  it("requires the reservations:manage scope and workspace access", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "RESM");
    const task = await makeTask(t.app, admin.token, ws.id, { title: "Guarded ticket" });
    const agent = await makeManagedAgent();

    const plain = await makeMember(t.app, admin.token); // tasks:write only
    const denied = await api.claim(plain.token, {
      agent_user_id: agent.userId,
      task: task.key,
      run_reference: "run-guard",
      request_id: "req-guard-1",
    });
    expect(denied.status).toBe(403);

    const limited = await makeMember(t.app, admin.token, {
      scopes: ["tasks:write", "reservations:manage"],
      workspace_access_all: false,
      workspace_ids: [],
    });
    const noAccess = await api.claim(limited.token, {
      agent_user_id: agent.userId,
      task: task.key,
      run_reference: "run-guard",
      request_id: "req-guard-2",
    });
    expect(noAccess.status).toBe(404);

    // A scoped manager with access works.
    const manager = await makeMember(t.app, admin.token, {
      scopes: ["tasks:write", "reservations:manage"],
    });
    const ok = await api.claim(manager.token, {
      agent_user_id: agent.userId,
      task: task.key,
      run_reference: "run-guard",
      request_id: "req-guard-3",
    });
    expect(ok.status).toBe(200);
    const claim = (await ok.json()) as ClaimJson;
    await api.release(manager.token, claim.reservation.id, "cleanup");
  });

  it("keeps unmanaged users unaffected and never leaks tokens in lists", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "RESN");
    const task = await makeTask(t.app, admin.token, ws.id, { title: "Normal ticket" });
    const member = await makeMember(t.app, admin.token);

    // Ordinary flows keep working for unmanaged users.
    expect((await api.updateTask(member.token, task.key, { title: "Edited by a human" })).status).toBe(200);
    expect((await api.comment(member.token, task.key, "Normal comment")).status).toBe(200);

    const agentsJson = await (await api.agents(admin.token)).text();
    expect(agentsJson).not.toContain("tmj_");
    const reservationsJson = await (await api.reservations(admin.token)).text();
    expect(reservationsJson).not.toContain("tmj_");
  });

  it("admission is explicit and idempotent; un-admission requires a free identity", async () => {
    const ws = await makeWorkspace(t.app, admin.token, "RESO");
    const task = await makeTask(t.app, admin.token, ws.id, { title: "Admission ticket" });
    const agent = await makeAgentWithKey(t.app, admin.token, agentName());

    // Unadmitted agents are not claimable.
    const beforeAdmit = await api.claim(admin.token, {
      agent_user_id: agent.userId,
      task: task.key,
      run_reference: "run-admit",
      request_id: "req-admit-1",
    });
    expect(beforeAdmit.status).toBe(409);
    expect(((await beforeAdmit.json()) as { error: { message: string } }).error.message).toContain("not admitted");

    expect((await api.admit(admin.token, agent.userId, "reconciled: no keys in use")).status).toBe(200);
    expect((await api.admit(admin.token, agent.userId)).status).toBe(200); // idempotent

    const claim = (await (await api.claim(admin.token, {
      agent_user_id: agent.userId,
      task: task.key,
      run_reference: "run-admit",
      request_id: "req-admit-2",
    })).json()) as ClaimJson;
    const busyRemove = await t.app.request(`/api/v1/managed-agents/${agent.userId}`, {
      method: "DELETE",
      headers: bearer(admin.token),
    });
    expect(busyRemove.status).toBe(409);
    await api.release(admin.token, claim.reservation.id, "cleanup");
    expect(
      (await t.app.request(`/api/v1/managed-agents/${agent.userId}`, {
        method: "DELETE",
        headers: bearer(admin.token),
      })).status
    ).toBe(200);
  });
});
