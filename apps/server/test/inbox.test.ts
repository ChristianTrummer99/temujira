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
let reader: { userId: string; token: string };
let writer: { userId: string; token: string };
let taskA: TaskJson;
let taskB: TaskJson;

interface CommentJson {
  id: string;
  body: string;
  author: { id: string };
  attachments: Array<{ id: string }>;
  replies: CommentJson[];
  question: { options: string[]; answer_option_index: number | null } | null;
}

interface InboxJson {
  id: string;
  user_id: string;
  workspace: { id: string; key: string; name: string };
  task_id: string;
  task_key: string;
  task_title: string;
  actor: { id: string; name: string };
  kind: "mention" | "reply";
  source_comment: CommentJson;
  parent_comment: CommentJson | null;
  read_at: number | null;
  created_at: number;
}

interface InboxPage {
  items: InboxJson[];
  unread: number;
  total: number;
  limit: number;
  offset: number;
}

const post = async (
  token: string,
  taskId: string,
  input: { body: string; parent_id?: string; mention_ids?: string[] },
): Promise<CommentJson> => {
  const res = await t.app.request(`/api/v1/tasks/${taskId}/comments`, jsonReq("POST", input, bearer(token)));
  expect(res.status).toBe(200);
  return ((await res.json()) as { comment: CommentJson }).comment;
};

const inbox = async (token: string, qs = ""): Promise<InboxPage> => {
  const res = await t.app.request(`/api/v1/inbox${qs}`, { headers: bearer(token) });
  expect(res.status).toBe(200);
  return (await res.json()) as InboxPage;
};

const markRead = async (token: string, qs = "?mark_read=1"): Promise<{ ok: true; updated: number }> => {
  const res = await t.app.request(`/api/v1/inbox/read${qs}`, { method: "POST", headers: bearer(token) });
  expect(res.status).toBe(200);
  return (await res.json()) as { ok: true; updated: number };
};

beforeAll(async () => {
  t = await makeTestApp();
  admin = await setupAdmin(t.app);
  reader = await makeMember(t.app, admin.token, { name: "Reader" });
  writer = await makeMember(t.app, admin.token, { name: "Writer" });
  const wsA = await makeWorkspace(t.app, admin.token, "INA", "Inbox A");
  const wsB = await makeWorkspace(t.app, admin.token, "INB", "Inbox B");
  taskA = await makeTask(t.app, admin.token, wsA.id, { title: "A task" });
  taskB = await makeTask(t.app, admin.token, wsB.id, { title: "B task" });
});
afterAll(() => t.cleanup());

describe("inbox.list", () => {
  it("starts empty with the full envelope shape", async () => {
    const page = await inbox(reader.token);
    expect(page).toEqual({ items: [], unread: 0, total: 0, limit: 50, offset: 0 });
  });

  it("aggregates across workspaces, newest first, with everything embedded", async () => {
    const mention = await post(writer.token, taskA.id, { body: "@Reader in A", mention_ids: [reader.userId] });
    await new Promise((r) => setTimeout(r, 3));
    const root = await post(reader.token, taskB.id, { body: "reader's root in B" });
    await new Promise((r) => setTimeout(r, 3));
    const reply = await post(writer.token, taskB.id, { body: "writer replies in B", parent_id: root.id });

    const page = await inbox(reader.token);
    expect(page.total).toBe(2);
    expect(page.unread).toBe(2);
    expect(page.limit).toBe(50);
    expect(page.offset).toBe(0);
    // Newest first.
    expect(page.items.map((i) => i.source_comment.id)).toEqual([reply.id, mention.id]);
    expect(page.items.map((i) => i.workspace.key)).toEqual(["INB", "INA"]);
    expect(page.items.map((i) => i.kind)).toEqual(["reply", "mention"]);

    const replyItem = page.items[0]!;
    expect(replyItem.task_key).toBe(taskB.key);
    expect(replyItem.task_title).toBe("B task");
    expect(replyItem.workspace.name).toBe("Inbox B");
    expect(replyItem.actor.name).toBe("Writer");
    expect(replyItem.source_comment.author.id).toBe(writer.userId);
    expect(replyItem.source_comment.attachments).toEqual([]);
    expect(replyItem.source_comment.replies).toEqual([]); // shallow by design
    expect(replyItem.parent_comment?.id).toBe(root.id);
    expect(replyItem.parent_comment?.author.id).toBe(reader.userId);
    expect(replyItem.read_at).toBeNull();
  });

  it("is per-user: the writer sees none of the reader's items", async () => {
    const page = await inbox(writer.token);
    expect(page.items.every((i) => i.user_id === writer.userId)).toBe(true);
    expect(page.total).toBe(0);
  });

  it("paginates with limit/offset while total and unread stay global", async () => {
    const first = await inbox(reader.token, "?limit=1");
    expect(first.items.length).toBe(1);
    expect(first.limit).toBe(1);
    expect(first.total).toBe(2);
    expect(first.unread).toBe(2);

    const second = await inbox(reader.token, "?limit=1&offset=1");
    expect(second.offset).toBe(1);
    expect(second.items[0]!.id).not.toBe(first.items[0]!.id);

    const beyond = await inbox(reader.token, "?limit=1&offset=9");
    expect(beyond.items).toEqual([]);
    expect(beyond.total).toBe(2);
  });

  it("rejects an out-of-range limit", async () => {
    const res = await t.app.request("/api/v1/inbox?limit=500", { headers: bearer(reader.token) });
    expect(res.status).toBe(400);
  });
});

describe("inbox.update (mark read)", () => {
  it("marks every unread row read, is idempotent, and hides them unless include_read", async () => {
    const before = await inbox(reader.token);
    expect(before.unread).toBe(2);

    const first = await markRead(reader.token);
    expect(first).toEqual({ ok: true, updated: 2 });

    const after = await inbox(reader.token);
    expect(after.items).toEqual([]);
    expect(after.total).toBe(0);
    expect(after.unread).toBe(0);

    const withRead = await inbox(reader.token, "?include_read=1");
    expect(withRead.total).toBe(2);
    expect(withRead.unread).toBe(0);
    expect(withRead.items.every((i) => i.read_at !== null)).toBe(true);

    // Second call has nothing left to do.
    expect(await markRead(reader.token)).toEqual({ ok: true, updated: 0 });
  });

  it("a bare POST without mark_read changes nothing", async () => {
    await post(writer.token, taskA.id, { body: "@Reader again", mention_ids: [reader.userId] });
    expect((await inbox(reader.token)).unread).toBe(1);

    expect(await markRead(reader.token, "")).toEqual({ ok: true, updated: 0 });
    expect((await inbox(reader.token)).unread).toBe(1);
  });

  it("only touches the caller's rows", async () => {
    const root = await post(writer.token, taskA.id, { body: "writer's own root" });
    await post(reader.token, taskA.id, { body: "reader replies", parent_id: root.id });
    expect((await inbox(writer.token)).unread).toBe(1);

    await markRead(reader.token);
    expect((await inbox(writer.token)).unread).toBe(1);
    expect((await inbox(reader.token)).unread).toBe(0);
  });
});

describe("inbox rows never dangle", () => {
  it("deleting the source comment removes the inbox item it created", async () => {
    const mention = await post(writer.token, taskA.id, { body: "@Reader doomed", mention_ids: [reader.userId] });
    expect((await inbox(reader.token, "?include_read=1")).items.some((i) => i.source_comment.id === mention.id)).toBe(
      true,
    );

    const del = await t.app.request(`/api/v1/comments/${mention.id}`, {
      method: "DELETE",
      headers: bearer(writer.token),
    });
    expect(del.status).toBe(200);

    const page = await inbox(reader.token, "?include_read=1");
    expect(page.items.some((i) => i.source_comment.id === mention.id)).toBe(false);
  });

  it("deleting a root also clears the inbox items its replies created", async () => {
    const root = await post(reader.token, taskA.id, { body: "root that will die" });
    const reply = await post(writer.token, taskA.id, { body: "reply that notifies", parent_id: root.id });
    expect((await inbox(reader.token, "?include_read=1")).items.some((i) => i.source_comment.id === reply.id)).toBe(
      true,
    );

    const del = await t.app.request(`/api/v1/comments/${root.id}`, { method: "DELETE", headers: bearer(reader.token) });
    expect(del.status).toBe(200);

    const page = await inbox(reader.token, "?include_read=1");
    expect(page.items.some((i) => i.source_comment.id === reply.id)).toBe(false);
    expect(page.items.every((i) => i.source_comment.id !== root.id)).toBe(true);
  });
});
