import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bearer,
  fileUpload,
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
let author: { userId: string; token: string };
let other: { userId: string; token: string };
let task: TaskJson;

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

beforeAll(async () => {
  t = await makeTestApp();
  admin = await setupAdmin(t.app);
  author = await makeMember(t.app, admin.token);
  other = await makeMember(t.app, admin.token);
  const ws = await makeWorkspace(t.app, admin.token, "COM");
  task = await makeTask(t.app, admin.token, ws.id, { title: "Discussed task" });
});
afterAll(() => t.cleanup());

const createComment = async (token: string, body: string, parentId?: string): Promise<CommentJson> => {
  const res = await t.app.request(
    `/api/v1/tasks/${task.id}/comments`,
    jsonReq("POST", parentId === undefined ? { body } : { body, parent_id: parentId }, bearer(token)),
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as { comment: CommentJson }).comment;
};

const listComments = async (idOrKey: string = task.id): Promise<CommentJson[]> => {
  const res = await t.app.request(`/api/v1/tasks/${idOrKey}/comments`, { headers: bearer(author.token) });
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: CommentJson[] }).items;
};

describe("comment ordering", () => {
  it("orders replies top-down by insertion even within the same millisecond", async () => {
    // Own workspace + task: this test seeds rows directly and must not disturb the
    // shared thread the other tests assert on.
    const ws = await makeWorkspace(t.app, admin.token, "ORD");
    const own = await makeTask(t.app, admin.token, ws.id, { title: "Ordering task" });
    const created = await t.app.request(
      `/api/v1/tasks/${own.id}/comments`,
      jsonReq("POST", { body: "Ordering root" }, bearer(author.token)),
    );
    expect(created.status).toBe(200);
    const root = ((await created.json()) as { comment: CommentJson }).comment;
    const { comments: commentsTable } = await import("../src/db/schema");
    const createdAt = Date.now();
    // Inserted directly so both rows share createdAt, with the LATER insert carrying the
    // lexicographically SMALLER id — exactly what a random ULID suffix can produce within
    // one millisecond. Ordering by id would put the newest reply on top; insertion order
    // (rowid) must win instead.
    t.ctx.db
      .insert(commentsTable)
      .values([
        {
          id: "01ZZZZZZZZZZZZZZZZZZZZZZZ9",
          taskId: own.id,
          parentId: root.id,
          authorId: author.userId,
          body: "first inserted",
          questionOptions: null,
          answerOptionIndex: null,
          createdAt,
          updatedAt: createdAt,
        },
        {
          id: "01AAAAAAAAAAAAAAAAAAAAAAAA",
          taskId: own.id,
          parentId: root.id,
          authorId: author.userId,
          body: "second inserted",
          questionOptions: null,
          answerOptionIndex: null,
          createdAt,
          updatedAt: createdAt,
        },
      ])
      .run();

    const listed = await t.app.request(`/api/v1/tasks/${own.id}/comments`, {
      headers: bearer(author.token),
    });
    expect(listed.status).toBe(200);
    const items = ((await listed.json()) as { items: CommentJson[] }).items;
    const ordered = items.find((c) => c.id === root.id)!;
    expect(ordered.replies.map((r) => r.body)).toEqual(["first inserted", "second inserted"]);
  });
});

describe("comments.create + list", () => {
  it("creates a root comment authored by the current user; embeds the author", async () => {
    const comment = await createComment(author.token, "First!");
    expect(comment.task_id).toBe(task.id);
    expect(comment.author_id).toBe(author.userId);
    expect(comment.author.id).toBe(author.userId);
    expect(comment.attachments).toEqual([]);
    // Threading fields: a plain comment is an unanswered, childless root.
    expect(comment.parent_id).toBeNull();
    expect(comment.question).toBeNull();
    expect(comment.replies).toEqual([]);
  });

  it("404s when the task does not exist and 400s on an empty body", async () => {
    const missing = await t.app.request(
      "/api/v1/tasks/ZZ-9/comments",
      jsonReq("POST", { body: "hello" }, bearer(author.token)),
    );
    expect(missing.status).toBe(404);

    const empty = await t.app.request(
      `/api/v1/tasks/${task.id}/comments`,
      jsonReq("POST", { body: "" }, bearer(author.token)),
    );
    expect(empty.status).toBe(400);
  });

  it("lists roots chronologically ascending with authors embedded (task key works too)", async () => {
    await new Promise((r) => setTimeout(r, 3)); // distinct created_at millis
    await createComment(other.token, "Second");
    await new Promise((r) => setTimeout(r, 3));
    await createComment(admin.token, "Third");

    const items = await listComments(task.key);
    expect(items.length).toBe(3);
    expect(items.map((c) => c.body)).toEqual(["First!", "Second", "Third"]);
    expect(items.map((c) => c.author.id)).toEqual([author.userId, other.userId, admin.userId]);
    expect(items.every((c) => c.parent_id === null && c.replies.length === 0)).toBe(true);
    for (let i = 1; i < items.length; i++) {
      expect(items[i]!.created_at).toBeGreaterThanOrEqual(items[i - 1]!.created_at);
    }
  });

  it("nests replies under their root instead of adding them to the top level", async () => {
    const roots = await listComments();
    const first = roots[0]!;
    await new Promise((r) => setTimeout(r, 3));
    const reply = await createComment(other.token, "Reply to First!", first.id);
    expect(reply.parent_id).toBe(first.id);

    const after = await listComments();
    // Still three top-level comments, in the same order.
    expect(after.map((c) => c.body)).toEqual(["First!", "Second", "Third"]);
    expect(after.some((c) => c.id === reply.id)).toBe(false);
    expect(after[0]!.replies.map((c) => c.body)).toEqual(["Reply to First!"]);
    expect(after[0]!.replies[0]!.author.id).toBe(other.userId);
  });
});

describe("comments.update", () => {
  it("author can edit; a non-author member gets 403; admin can edit", async () => {
    const comment = await createComment(author.token, "editable");

    const forbidden = await t.app.request(
      `/api/v1/comments/${comment.id}`,
      jsonReq("PATCH", { body: "hijacked" }, bearer(other.token)),
    );
    expect(forbidden.status).toBe(403);

    const own = await t.app.request(
      `/api/v1/comments/${comment.id}`,
      jsonReq("PATCH", { body: "edited by author" }, bearer(author.token)),
    );
    expect(own.status).toBe(200);
    const edited = ((await own.json()) as { comment: CommentJson }).comment;
    expect(edited.body).toBe("edited by author");
    expect(edited.updated_at).toBeGreaterThanOrEqual(comment.updated_at);

    const byAdmin = await t.app.request(
      `/api/v1/comments/${comment.id}`,
      jsonReq("PATCH", { body: "edited by admin" }, bearer(admin.token)),
    );
    expect(byAdmin.status).toBe(200);
    expect(((await byAdmin.json()) as { comment: CommentJson }).comment.body).toBe("edited by admin");
  });

  it("404s on a missing comment", async () => {
    const res = await t.app.request(
      "/api/v1/comments/01ARZ3NDEKTSV4RRFFQ69G5FAV",
      jsonReq("PATCH", { body: "ghost" }, bearer(admin.token)),
    );
    expect(res.status).toBe(404);
  });
});

describe("comments.delete", () => {
  it("non-author member gets 403; author can delete", async () => {
    const comment = await createComment(author.token, "delete me");

    const forbidden = await t.app.request(`/api/v1/comments/${comment.id}`, {
      method: "DELETE",
      headers: bearer(other.token),
    });
    expect(forbidden.status).toBe(403);

    const ok = await t.app.request(`/api/v1/comments/${comment.id}`, {
      method: "DELETE",
      headers: bearer(author.token),
    });
    expect(ok.status).toBe(200);

    const gone = await t.app.request(
      `/api/v1/comments/${comment.id}`,
      jsonReq("PATCH", { body: "?" }, bearer(author.token)),
    );
    expect(gone.status).toBe(404);
  });

  it("admin can delete another user's comment", async () => {
    const comment = await createComment(author.token, "admin will remove this");
    const res = await t.app.request(`/api/v1/comments/${comment.id}`, {
      method: "DELETE",
      headers: bearer(admin.token),
    });
    expect(res.status).toBe(200);
  });

  it("deleting a comment removes its attachments (rows and bytes)", async () => {
    const comment = await createComment(author.token, "has an attachment");
    const upload = await t.app.request(
      `/api/v1/comments/${comment.id}/attachments`,
      fileUpload("attached text", "note.txt", "text/plain", bearer(author.token)),
    );
    expect(upload.status).toBe(200);
    const { attachment } = (await upload.json()) as { attachment: { id: string } };
    const filePath = join(t.ctx.config.dataDir, "uploads", attachment.id);
    expect(existsSync(filePath)).toBe(true);

    const del = await t.app.request(`/api/v1/comments/${comment.id}`, {
      method: "DELETE",
      headers: bearer(author.token),
    });
    expect(del.status).toBe(200);

    const meta = await t.app.request(`/api/v1/attachments/${attachment.id}`, { headers: bearer(author.token) });
    expect(meta.status).toBe(404);
    expect(existsSync(filePath)).toBe(false);
  });
});
