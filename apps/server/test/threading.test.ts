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
let alice: { userId: string; token: string };
let bob: { userId: string; token: string };
let task: TaskJson;
let otherTask: TaskJson;

interface CommentJson {
  id: string;
  task_id: string;
  parent_id: string | null;
  author_id: string;
  author: { id: string; name: string };
  body: string;
  question: { options: string[]; answer_option_index: number | null } | null;
  replies: CommentJson[];
  attachments: Array<{ id: string }>;
  created_at: number;
  updated_at: number;
}

interface CreateComment {
  body: string;
  parent_id?: string;
  question_options?: string[];
  answer_option_index?: number;
  mention_ids?: string[];
}

const post = async (token: string, taskIdOrKey: string, input: CreateComment): Promise<Response> =>
  t.app.request(`/api/v1/tasks/${taskIdOrKey}/comments`, jsonReq("POST", input, bearer(token)));

const okComment = async (res: Response): Promise<CommentJson> => {
  expect(res.status).toBe(200);
  return ((await res.json()) as { comment: CommentJson }).comment;
};

const list = async (taskIdOrKey: string): Promise<CommentJson[]> => {
  const res = await t.app.request(`/api/v1/tasks/${taskIdOrKey}/comments`, { headers: bearer(admin.token) });
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: CommentJson[] }).items;
};

beforeAll(async () => {
  t = await makeTestApp();
  admin = await setupAdmin(t.app);
  alice = await makeMember(t.app, admin.token, { name: "Alice" });
  bob = await makeMember(t.app, admin.token, { name: "Bob" });
  const ws = await makeWorkspace(t.app, admin.token, "THR");
  task = await makeTask(t.app, admin.token, ws.id, { title: "Threaded" });
  otherTask = await makeTask(t.app, admin.token, ws.id, { title: "Elsewhere" });
});
afterAll(() => t.cleanup());

describe("one-level threading", () => {
  it("nests replies under their root and never lists a reply at the top level", async () => {
    const root = await okComment(await post(alice.token, task.id, { body: "root one" }));
    expect(root.parent_id).toBeNull();
    expect(root.replies).toEqual([]);

    const reply = await okComment(await post(bob.token, task.id, { body: "reply one", parent_id: root.id }));
    expect(reply.parent_id).toBe(root.id);

    const items = await list(task.id);
    const mine = items.find((c) => c.id === root.id)!;
    expect(items.map((c) => c.id)).not.toContain(reply.id);
    expect(mine.replies.map((r) => r.id)).toEqual([reply.id]);
    // Replies embed their own author + attachments.
    expect(mine.replies[0]!.author.id).toBe(bob.userId);
    expect(mine.replies[0]!.attachments).toEqual([]);
  });

  it("coerces a reply-to-a-reply up to the thread root (Slack style)", async () => {
    const root = await okComment(await post(alice.token, task.id, { body: "coerce root" }));
    const first = await okComment(await post(bob.token, task.id, { body: "first level", parent_id: root.id }));
    await new Promise((r) => setTimeout(r, 3));
    const nested = await okComment(await post(admin.token, task.id, { body: "aimed at the reply", parent_id: first.id }));

    expect(nested.parent_id).toBe(root.id);
    const rootRow = (await list(task.id)).find((c) => c.id === root.id)!;
    expect(rootRow.replies.map((r) => r.id)).toEqual([first.id, nested.id]); // oldest first
    expect(rootRow.replies.every((r) => r.replies.length === 0)).toBe(true);
  });

  it("rejects a parent on another task (400) and an unknown parent (404)", async () => {
    const foreign = await okComment(await post(alice.token, otherTask.id, { body: "over here" }));
    const crossTask = await post(alice.token, task.id, { body: "wrong task", parent_id: foreign.id });
    expect(crossTask.status).toBe(400);

    const ghost = await post(alice.token, task.id, { body: "no parent", parent_id: "01ARZ3NDEKTSV4RRFFQ69G5FAV" });
    expect(ghost.status).toBe(404);
  });
});

describe("multiple-choice questions answered by child replies", () => {
  it("stores options on a root comment and starts unanswered", async () => {
    const q = await okComment(
      await post(alice.token, task.id, { body: "Ship it?", question_options: ["Yes", "No", "Later"] }),
    );
    expect(q.question).toEqual({ options: ["Yes", "No", "Later"], answer_option_index: null });
  });

  it("refuses question_options on a reply", async () => {
    const root = await okComment(await post(alice.token, task.id, { body: "plain root" }));
    const res = await post(bob.token, task.id, {
      body: "nested question",
      parent_id: root.id,
      question_options: ["a", "b"],
    });
    expect(res.status).toBe(400);
  });

  it("answers via a child reply and records the accepted answer on the question (last wins)", async () => {
    const q = await okComment(
      await post(alice.token, task.id, { body: "Deploy today?", question_options: ["Yes", "No"] }),
    );
    const answer = await okComment(
      await post(bob.token, task.id, { body: "Yes from me", parent_id: q.id, answer_option_index: 0 }),
    );
    expect(answer.parent_id).toBe(q.id);

    let rendered = (await list(task.id)).find((c) => c.id === q.id)!;
    expect(rendered.question).toEqual({ options: ["Yes", "No"], answer_option_index: 0 });
    expect(rendered.replies.map((r) => r.id)).toEqual([answer.id]);

    await new Promise((r) => setTimeout(r, 3));
    const second = await okComment(
      await post(admin.token, task.id, { body: "Actually no", parent_id: q.id, answer_option_index: 1 }),
    );
    rendered = (await list(task.id)).find((c) => c.id === q.id)!;
    expect(rendered.question!.answer_option_index).toBe(1); // last answer wins
    expect(rendered.replies.map((r) => r.id)).toEqual([answer.id, second.id]);
  });

  it("answering a reply of a question still answers the question (parent coercion)", async () => {
    const q = await okComment(await post(alice.token, task.id, { body: "Pick one", question_options: ["A", "B"] }));
    const chatter = await okComment(await post(bob.token, task.id, { body: "hmm", parent_id: q.id }));
    const answer = await okComment(
      await post(admin.token, task.id, { body: "B please", parent_id: chatter.id, answer_option_index: 1 }),
    );
    expect(answer.parent_id).toBe(q.id);
    expect((await list(task.id)).find((c) => c.id === q.id)!.question!.answer_option_index).toBe(1);
  });

  it("rejects an out-of-range index, an answer with no parent, and an answer to a non-question", async () => {
    const q = await okComment(await post(alice.token, task.id, { body: "Two options", question_options: ["A", "B"] }));
    expect((await post(bob.token, task.id, { body: "x", parent_id: q.id, answer_option_index: 2 })).status).toBe(400);
    expect((await post(bob.token, task.id, { body: "x", answer_option_index: 0 })).status).toBe(400);
    expect((await post(bob.token, task.id, { body: "x", parent_id: q.id, answer_option_index: -1 })).status).toBe(400);

    const plain = await okComment(await post(alice.token, task.id, { body: "not a question" }));
    expect((await post(bob.token, task.id, { body: "x", parent_id: plain.id, answer_option_index: 0 })).status).toBe(400);

    // The rejected answers left no trace.
    expect((await list(task.id)).find((c) => c.id === q.id)!.replies).toEqual([]);
  });
});

describe("comments.update with questions", () => {
  it("edits the body without touching the question", async () => {
    const q = await okComment(await post(alice.token, task.id, { body: "v1", question_options: ["A", "B"] }));
    const edited = await okComment(
      await t.app.request(`/api/v1/comments/${q.id}`, jsonReq("PATCH", { body: "v2" }, bearer(alice.token))),
    );
    expect(edited.body).toBe("v2");
    expect(edited.question).toEqual({ options: ["A", "B"], answer_option_index: null });
  });

  it("null question_options clears the question and its accepted answer", async () => {
    const q = await okComment(await post(alice.token, task.id, { body: "clear me", question_options: ["A", "B"] }));
    await okComment(await post(bob.token, task.id, { body: "A", parent_id: q.id, answer_option_index: 0 }));

    const cleared = await okComment(
      await t.app.request(`/api/v1/comments/${q.id}`, jsonReq("PATCH", { question_options: null }, bearer(alice.token))),
    );
    expect(cleared.question).toBeNull();
    // Replies survive the question being withdrawn.
    expect(cleared.replies.length).toBe(1);
  });

  it("new options reset the recorded answer; options on a reply are rejected", async () => {
    const q = await okComment(await post(alice.token, task.id, { body: "reask", question_options: ["A", "B"] }));
    await okComment(await post(bob.token, task.id, { body: "A", parent_id: q.id, answer_option_index: 0 }));

    const reasked = await okComment(
      await t.app.request(
        `/api/v1/comments/${q.id}`,
        jsonReq("PATCH", { question_options: ["X", "Y", "Z"] }, bearer(alice.token)),
      ),
    );
    expect(reasked.question).toEqual({ options: ["X", "Y", "Z"], answer_option_index: null });

    const reply = await okComment(await post(bob.token, task.id, { body: "child", parent_id: q.id }));
    const bad = await t.app.request(
      `/api/v1/comments/${reply.id}`,
      jsonReq("PATCH", { question_options: ["A", "B"] }, bearer(bob.token)),
    );
    expect(bad.status).toBe(400);
  });

  it("an empty patch is a 200 no-op", async () => {
    const root = await okComment(await post(alice.token, task.id, { body: "untouched" }));
    const same = await okComment(
      await t.app.request(`/api/v1/comments/${root.id}`, jsonReq("PATCH", {}, bearer(alice.token))),
    );
    expect(same.body).toBe("untouched");
    expect(same.question).toBeNull();
  });
});

describe("comments.delete cascades a thread", () => {
  it("deleting a root deletes its replies too", async () => {
    const root = await okComment(await post(alice.token, task.id, { body: "doomed root" }));
    const reply = await okComment(await post(bob.token, task.id, { body: "doomed reply", parent_id: root.id }));

    const del = await t.app.request(`/api/v1/comments/${root.id}`, {
      method: "DELETE",
      headers: bearer(alice.token),
    });
    expect(del.status).toBe(200);

    const items = await list(task.id);
    expect(items.some((c) => c.id === root.id)).toBe(false);
    expect(items.flatMap((c) => c.replies).some((r) => r.id === reply.id)).toBe(false);
    // The reply row is really gone, not merely unlinked.
    const ghost = await t.app.request(`/api/v1/comments/${reply.id}`, jsonReq("PATCH", { body: "?" }, bearer(bob.token)));
    expect(ghost.status).toBe(404);
  });

  it("deleting a single reply leaves the root and its siblings alone", async () => {
    const root = await okComment(await post(alice.token, task.id, { body: "surviving root" }));
    const keep = await okComment(await post(bob.token, task.id, { body: "keep", parent_id: root.id }));
    const drop = await okComment(await post(bob.token, task.id, { body: "drop", parent_id: root.id }));

    const del = await t.app.request(`/api/v1/comments/${drop.id}`, { method: "DELETE", headers: bearer(bob.token) });
    expect(del.status).toBe(200);

    const rendered = (await list(task.id)).find((c) => c.id === root.id)!;
    expect(rendered.replies.map((r) => r.id)).toEqual([keep.id]);
  });
});
