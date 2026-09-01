import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pushInbox } from "../src/routes/engagement";
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
let alice: { userId: string; token: string };
let bob: { userId: string; token: string };
let ws: WorkspaceJson;
let task: TaskJson;

interface CommentJson {
  id: string;
  parent_id: string | null;
  body: string;
  author: { id: string };
  question: { options: string[]; answer_option_index: number | null } | null;
  replies: CommentJson[];
  attachments: Array<{ id: string }>;
}

interface InboxJson {
  id: string;
  user_id: string;
  workspace_id: string;
  workspace: { id: string; key: string };
  task_id: string;
  task_key: string;
  task_title: string;
  actor_id: string;
  actor: { id: string; name: string };
  kind: "mention" | "reply";
  source_comment: CommentJson;
  parent_comment: CommentJson | null;
  read_at: number | null;
}

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

const post = async (
  token: string,
  taskId: string,
  input: { body: string; parent_id?: string; mention_ids?: string[]; question_options?: string[] },
): Promise<CommentJson> => {
  const res = await t.app.request(`/api/v1/tasks/${taskId}/comments`, jsonReq("POST", input, bearer(token)));
  expect(res.status).toBe(200);
  return ((await res.json()) as { comment: CommentJson }).comment;
};

const inbox = async (token: string, qs = ""): Promise<{ items: InboxJson[]; unread: number; total: number }> => {
  const res = await t.app.request(`/api/v1/inbox${qs}`, { headers: bearer(token) });
  expect(res.status).toBe(200);
  return (await res.json()) as { items: InboxJson[]; unread: number; total: number };
};

const activity = async (token: string, wsIdOrKey: string, qs = ""): Promise<ActivityJson[]> => {
  const res = await t.app.request(`/api/v1/workspaces/${wsIdOrKey}/activity${qs}`, { headers: bearer(token) });
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: ActivityJson[] }).items;
};

beforeAll(async () => {
  t = await makeTestApp();
  admin = await setupAdmin(t.app);
  alice = await makeMember(t.app, admin.token, { name: "Alice Eng" });
  bob = await makeMember(t.app, admin.token, { name: "Bob Eng" });
  ws = await makeWorkspace(t.app, admin.token, "ENG");
  task = await makeTask(t.app, admin.token, ws.id, { title: "Engagement task" });
});
afterAll(() => t.cleanup());

describe("mentions", () => {
  it("delivers an inbox item to each mentioned user with the source comment embedded", async () => {
    const comment = await post(alice.token, task.id, { body: "@Bob Eng please look", mention_ids: [bob.userId] });

    const bobInbox = await inbox(bob.token);
    const item = bobInbox.items.find((i) => i.source_comment.id === comment.id)!;
    expect(item).toBeDefined();
    expect(item.kind).toBe("mention");
    expect(item.user_id).toBe(bob.userId);
    expect(item.actor.id).toBe(alice.userId);
    expect(item.workspace.key).toBe(ws.key);
    expect(item.task_key).toBe(task.key);
    expect(item.task_title).toBe("Engagement task");
    expect(item.source_comment.body).toBe("@Bob Eng please look");
    expect(item.source_comment.author.id).toBe(alice.userId);
    expect(item.parent_comment).toBeNull();
    expect(item.read_at).toBeNull();

    // Nobody else gets it.
    expect((await inbox(admin.token)).items.some((i) => i.source_comment.id === comment.id)).toBe(false);
  });

  it("skips self-notification and dedupes a repeated mention of the same user", async () => {
    const before = (await inbox(alice.token)).total;
    const comment = await post(alice.token, task.id, {
      body: "@Alice Eng @Alice Eng talking to myself",
      mention_ids: [alice.userId, alice.userId],
    });
    const after = await inbox(alice.token);
    expect(after.total).toBe(before);
    expect(after.items.some((i) => i.source_comment.id === comment.id)).toBe(false);
  });

  it("mentioning two users creates exactly one item each", async () => {
    const comment = await post(admin.token, task.id, {
      body: "@Alice Eng @Bob Eng huddle",
      mention_ids: [alice.userId, bob.userId],
    });
    for (const who of [alice, bob]) {
      const items = (await inbox(who.token)).items.filter((i) => i.source_comment.id === comment.id);
      expect(items.length).toBe(1);
      expect(items[0]!.kind).toBe("mention");
    }
  });

  it("rejects an unknown mention id and writes no comment", async () => {
    const res = await t.app.request(
      `/api/v1/tasks/${task.id}/comments`,
      jsonReq("POST", { body: "ghost", mention_ids: ["01ARZ3NDEKTSV4RRFFQ69G5FAV"] }, bearer(alice.token)),
    );
    expect(res.status).toBe(400);
    const list = await t.app.request(`/api/v1/tasks/${task.id}/comments`, { headers: bearer(alice.token) });
    const items = ((await list.json()) as { items: CommentJson[] }).items;
    expect(items.some((c) => c.body === "ghost")).toBe(false);
  });

  it("records the mention but no inbox item for a deactivated user", async () => {
    const ghost = await makeMember(t.app, admin.token, { name: "Ghost Eng" });
    await t.app.request(`/api/v1/users/${ghost.userId}`, { method: "DELETE", headers: bearer(admin.token) });
    const comment = await post(alice.token, task.id, { body: "@Ghost Eng?", mention_ids: [ghost.userId] });
    expect(comment.id).toBeTruthy();
    // No 500, no inbox row (the user cannot log in anyway).
    const rows = t.ctx.sqlite
      .prepare("SELECT count(*) AS c FROM inbox_items WHERE user_id = ?")
      .get(ghost.userId) as { c: number };
    expect(rows.c).toBe(0);
    const mentioned = t.ctx.sqlite
      .prepare("SELECT count(*) AS c FROM mentions WHERE mentioned_id = ?")
      .get(ghost.userId) as { c: number };
    expect(mentioned.c).toBe(1);
  });
});

describe("replies", () => {
  it("notifies the root author with the parent comment embedded", async () => {
    const root = await post(alice.token, task.id, { body: "alice's root" });
    const reply = await post(bob.token, task.id, { body: "bob replies", parent_id: root.id });

    const item = (await inbox(alice.token)).items.find((i) => i.source_comment.id === reply.id)!;
    expect(item).toBeDefined();
    expect(item.kind).toBe("reply");
    expect(item.actor.id).toBe(bob.userId);
    expect(item.parent_comment?.id).toBe(root.id);
    expect(item.parent_comment?.author.id).toBe(alice.userId);
  });

  it("does not notify a user replying to their own comment", async () => {
    const root = await post(alice.token, task.id, { body: "self thread" });
    const before = (await inbox(alice.token)).total;
    const reply = await post(alice.token, task.id, { body: "self reply", parent_id: root.id });
    const after = await inbox(alice.token);
    expect(after.total).toBe(before);
    expect(after.items.some((i) => i.source_comment.id === reply.id)).toBe(false);
  });

  it("notifies both the root author and the reply the user actually aimed at", async () => {
    const root = await post(alice.token, task.id, { body: "root by alice" });
    const first = await post(bob.token, task.id, { body: "reply by bob", parent_id: root.id });
    const nested = await post(admin.token, task.id, { body: "aimed at bob", parent_id: first.id });

    const forAlice = (await inbox(alice.token)).items.find((i) => i.source_comment.id === nested.id);
    const forBob = (await inbox(bob.token)).items.find((i) => i.source_comment.id === nested.id);
    expect(forAlice?.kind).toBe("reply");
    expect(forBob?.kind).toBe("reply");
    // Both point at the thread root, which is where the reply was stored.
    expect(forAlice?.parent_comment?.id).toBe(root.id);
    expect(forBob?.parent_comment?.id).toBe(root.id);
  });

  it("a reply that also mentions the root author yields two items (one per kind)", async () => {
    const root = await post(alice.token, task.id, { body: "root for double" });
    const reply = await post(bob.token, task.id, {
      body: "@Alice Eng replying and mentioning",
      parent_id: root.id,
      mention_ids: [alice.userId],
    });
    const items = (await inbox(alice.token)).items.filter((i) => i.source_comment.id === reply.id);
    expect(items.map((i) => i.kind).sort()).toEqual(["mention", "reply"]);
  });
});

describe("pushInbox dedupe (called directly)", () => {
  it("is idempotent per (user, kind, source comment)", async () => {
    const root = await post(alice.token, task.id, { body: "dedupe source" });
    const count = () =>
      (
        t.ctx.sqlite
          .prepare("SELECT count(*) AS c FROM inbox_items WHERE user_id = ? AND source_comment_id = ? AND kind = ?")
          .get(bob.userId, root.id, "mention") as { c: number }
      ).c;

    const opts = {
      userIds: [bob.userId],
      workspaceId: ws.id,
      taskId: task.id,
      actorId: alice.userId,
      kind: "mention" as const,
      sourceCommentId: root.id,
      parentCommentId: null,
    };
    pushInbox(t.ctx.db, opts);
    expect(count()).toBe(1);
    pushInbox(t.ctx.db, opts);
    pushInbox(t.ctx.db, opts);
    expect(count()).toBe(1);

    // A different kind for the same source is a separate item.
    pushInbox(t.ctx.db, { ...opts, kind: "reply" });
    const replies = t.ctx.sqlite
      .prepare("SELECT count(*) AS c FROM inbox_items WHERE user_id = ? AND source_comment_id = ? AND kind = 'reply'")
      .get(bob.userId, root.id) as { c: number };
    expect(replies.c).toBe(1);
  });

  it("never self-notifies the actor", async () => {
    const root = await post(alice.token, task.id, { body: "self push" });
    pushInbox(t.ctx.db, {
      userIds: [alice.userId],
      workspaceId: ws.id,
      taskId: task.id,
      actorId: alice.userId,
      kind: "mention",
      sourceCommentId: root.id,
      parentCommentId: null,
    });
    const rows = t.ctx.sqlite
      .prepare("SELECT count(*) AS c FROM inbox_items WHERE user_id = ? AND source_comment_id = ?")
      .get(alice.userId, root.id) as { c: number };
    expect(rows.c).toBe(0);
  });
});

describe("activity events are recorded for engagement", () => {
  it("records task.created, task.assigned, comment.created, comment.replied and comment.mentioned", async () => {
    const feedWs = await makeWorkspace(t.app, admin.token, "ENGB");
    const created = await makeTask(t.app, admin.token, feedWs.id, { title: "Feed task" });
    await t.app.request(`/api/v1/tasks/${created.id}`, jsonReq("PATCH", { assignee_id: bob.userId }, bearer(admin.token)));
    const root = await post(alice.token, created.id, { body: "first" });
    await post(bob.token, created.id, { body: "@Alice Eng see above", parent_id: root.id, mention_ids: [alice.userId] });

    const actions = (await activity(admin.token, feedWs.id)).map((e) => e.action);
    expect(actions).toContain("task.created");
    expect(actions).toContain("task.assigned");
    expect(actions).toContain("comment.created");
    expect(actions).toContain("comment.replied");
    expect(actions).toContain("comment.mentioned");

    const assigned = (await activity(admin.token, feedWs.id)).find((e) => e.action === "task.assigned")!;
    expect(assigned.metadata.assignee_id).toBe(bob.userId);
    expect(assigned.task_key).toBe(created.key);
    expect(assigned.task_title).toBe("Feed task");
    expect(assigned.actor.id).toBe(admin.userId);
  });
});

describe("associations follow engagement", () => {
  it("commenting and being mentioned put the task in tasks.mine", async () => {
    const assocWs = await makeWorkspace(t.app, admin.token, "ENGC");
    const commented = await makeTask(t.app, admin.token, assocWs.id, { title: "Bob comments here" });
    const mentioned = await makeTask(t.app, admin.token, assocWs.id, { title: "Bob is mentioned here" });

    await post(bob.token, commented.id, { body: "bob was here" });
    await post(alice.token, mentioned.id, { body: "@Bob Eng ping", mention_ids: [bob.userId] });

    const res = await t.app.request("/api/v1/tasks/mine", { headers: bearer(bob.token) });
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as { items: TaskJson[] };
    const ids = items.map((x) => x.id);
    expect(ids).toContain(commented.id);
    expect(ids).toContain(mentioned.id);
  });
});
