import { asc, eq, inArray, or } from "drizzle-orm";
import type { z } from "zod";
import type { CreateCommentInputSchema, UpdateCommentInputSchema } from "@temujira/shared";
import { attachments, comments, inboxItems, mentions, users } from "../db/schema";
import { forbidden, notFound, validationError } from "../errors";
import type { AttachmentRow, CommentRow, UserRow } from "../serialize";
import { newId, now } from "../util";
import { commentWithReplies, threadedComments } from "./commentSerialize";
import { associate, pushInbox, recordActivity } from "./engagement";
import { requireTask } from "./resolve";
import { body, currentUser, type AppContext, type Handlers } from "./types";

function requireComment(ctx: AppContext, id: string): CommentRow {
  const row = ctx.db.select().from(comments).where(eq(comments.id, id)).get();
  if (!row) throw notFound("comment");
  return row;
}

function assertAuthorOrAdmin(user: UserRow, comment: CommentRow, action: string): void {
  if (comment.authorId !== user.id && user.role !== "admin") {
    throw forbidden(`only the author or an admin can ${action} this comment`);
  }
}

function commentAttachments(ctx: AppContext, commentIds: string[]): AttachmentRow[] {
  if (commentIds.length === 0) return [];
  return ctx.db
    .select()
    .from(attachments)
    .where(inArray(attachments.commentId, commentIds))
    .orderBy(asc(attachments.createdAt), asc(attachments.id))
    .all();
}

function parseOptions(json: string | null): string[] {
  if (json === null) return [];
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.map((s) => String(s)) : [];
  } catch {
    return [];
  }
}

/**
 * Mentioned ids must resolve to existing users — all-or-nothing, checked before the insert
 * so a stale picker can never 500 on a foreign key. Deactivated users may still be
 * mentioned (the mention is recorded), they just get no inbox item.
 */
function resolveMentionIds(ctx: AppContext, ids: string[]): UserRow[] {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const rows = ctx.db.select().from(users).where(inArray(users.id, unique)).all();
  if (rows.length !== unique.length) {
    throw validationError("mention_ids must reference existing users");
  }
  return rows;
}

export function commentsHandlers(
  ctx: AppContext,
): Pick<Handlers, "comments.list" | "comments.create" | "comments.update" | "comments.delete"> {
  return {
    /** Roots only at the top level, each with its replies nested oldest-first. */
    "comments.list": (c) => {
      const { task } = requireTask(ctx.db, c.req.param("idOrKey") ?? "");
      return c.json({ items: threadedComments(ctx.db, task.id) });
    },

    "comments.create": (c) => {
      const user = currentUser(c);
      const { task, workspace } = requireTask(ctx.db, c.req.param("idOrKey") ?? "");
      const input = body<z.infer<typeof CreateCommentInputSchema>>(c);

      // ---- resolve the parent, coercing reply-to-reply up to the thread root ----
      let parent: CommentRow | null = null;
      let repliedTo: CommentRow | null = null; // the comment the user actually aimed at
      if (input.parent_id !== undefined) {
        const target = ctx.db.select().from(comments).where(eq(comments.id, input.parent_id)).get();
        if (!target) throw notFound("parent comment");
        if (target.taskId !== task.id) {
          throw validationError("parent_id must reference a comment on the same task");
        }
        repliedTo = target;
        if (target.parentId !== null) {
          // Exactly one level of depth (Slack-style): re-target the thread root.
          parent = ctx.db.select().from(comments).where(eq(comments.id, target.parentId)).get() ?? target;
        } else {
          parent = target;
        }
      }

      // ---- questions live on roots only ----
      if (input.question_options !== undefined && parent !== null) {
        throw validationError("question_options may only be set on a root comment (omit parent_id)");
      }

      // ---- an answer is a reply that picks one of the parent question's options ----
      if (input.answer_option_index !== undefined) {
        if (parent === null) {
          throw validationError("answer_option_index requires parent_id: answers are replies to a question comment");
        }
        const options = parseOptions(parent.questionOptions);
        if (options.length === 0) throw validationError("the parent comment is not a question");
        if (input.answer_option_index >= options.length) {
          throw validationError(
            `answer_option_index must be between 0 and ${options.length - 1} for the parent question`,
          );
        }
      }

      const t = now();
      const row: CommentRow = {
        id: newId(),
        taskId: task.id,
        parentId: parent?.id ?? null,
        authorId: user.id,
        body: input.body,
        questionOptions: input.question_options ? JSON.stringify(input.question_options) : null,
        answerOptionIndex: input.answer_option_index ?? null,
        createdAt: t,
        updatedAt: t,
      };
      const mentioned = resolveMentionIds(ctx, input.mention_ids ?? []);

      ctx.db.transaction((tx) => {
        tx.insert(comments).values(row).run();
        // Accepted answer on the question itself: last answer wins.
        if (input.answer_option_index !== undefined && parent) {
          tx.update(comments)
            .set({ answerOptionIndex: input.answer_option_index, updatedAt: t })
            .where(eq(comments.id, parent.id))
            .run();
        }
        for (const m of mentioned) {
          tx.insert(mentions)
            .values({ id: newId(), commentId: row.id, taskId: task.id, mentionedId: m.id, byId: user.id, createdAt: t })
            .run();
        }
      });

      // ---- side effects (each helper opens its own transaction; never nested) ----
      associate(ctx.db, task.id, [user.id], t);
      recordActivity(ctx.db, {
        workspaceId: workspace.id,
        taskId: task.id,
        actorId: user.id,
        action: parent ? "comment.replied" : "comment.created",
        metadata: parent ? { comment_id: row.id, parent_id: parent.id } : { comment_id: row.id },
      });

      if (parent) {
        // Notify the thread root's author and, when the reply was aimed at a nested
        // reply, that reply's author too. pushInbox skips self-notify and dedupes.
        const targets = [parent.authorId, repliedTo?.authorId].filter((id): id is string => !!id);
        associate(ctx.db, task.id, [...new Set(targets)], t);
        pushInbox(ctx.db, {
          userIds: [...new Set(targets)],
          workspaceId: workspace.id,
          taskId: task.id,
          actorId: user.id,
          kind: "reply",
          sourceCommentId: row.id,
          parentCommentId: parent.id,
        });
      }

      if (mentioned.length > 0) {
        const ids = mentioned.map((m) => m.id);
        // Deactivated users keep the mention record but get no inbox item.
        const notifiable = mentioned.filter((m) => m.deactivatedAt === null).map((m) => m.id);
        associate(ctx.db, task.id, ids, t);
        pushInbox(ctx.db, {
          userIds: notifiable,
          workspaceId: workspace.id,
          taskId: task.id,
          actorId: user.id,
          kind: "mention",
          sourceCommentId: row.id,
          parentCommentId: parent?.id ?? null,
        });
        recordActivity(ctx.db, {
          workspaceId: workspace.id,
          taskId: task.id,
          actorId: user.id,
          action: "comment.mentioned",
          metadata: { comment_id: row.id, mentioned_ids: ids },
        });
      }

      return c.json({ comment: commentWithReplies(ctx.db, row) });
    },

    "comments.update": (c) => {
      const user = currentUser(c);
      const comment = requireComment(ctx, c.req.param("id") ?? "");
      assertAuthorOrAdmin(user, comment, "edit");
      const input = body<z.infer<typeof UpdateCommentInputSchema>>(c);
      const updates: Partial<typeof comments.$inferInsert> = { updatedAt: now() };
      if (input.body !== undefined) updates.body = input.body;
      if (input.question_options !== undefined) {
        if (input.question_options === null) {
          // Clearing the question also drops the recorded accepted answer.
          updates.questionOptions = null;
          updates.answerOptionIndex = null;
        } else {
          if (comment.parentId !== null) {
            throw validationError("question_options may only be set on a root comment");
          }
          updates.questionOptions = JSON.stringify(input.question_options);
          // Re-asking the question drops the recorded answer: the old index addressed the
          // old option list and may not mean the same thing (or exist) any more.
          updates.answerOptionIndex = null;
        }
      }
      const updated = ctx.db.update(comments).set(updates).where(eq(comments.id, comment.id)).returning().get()!;
      return c.json({ comment: commentWithReplies(ctx.db, updated) });
    },

    /**
     * Deleting a root deletes its whole thread: the replies, every attachment on any of
     * them, and the mention/inbox rows that point at them (so the inbox can never render
     * a dangling comment).
     */
    "comments.delete": (c) => {
      const user = currentUser(c);
      const comment = requireComment(ctx, c.req.param("id") ?? "");
      assertAuthorOrAdmin(user, comment, "delete");
      const replyIds =
        comment.parentId === null
          ? ctx.db.select({ id: comments.id }).from(comments).where(eq(comments.parentId, comment.id)).all().map((r) => r.id)
          : [];
      const doomed = [comment.id, ...replyIds];
      const attRows = commentAttachments(ctx, doomed);
      // DB rows first (one transaction); bytes are unlinked only after commit so a crash
      // can never leave rows pointing at deleted files.
      ctx.db.transaction((tx) => {
        tx.delete(inboxItems)
          .where(or(inArray(inboxItems.sourceCommentId, doomed), inArray(inboxItems.parentCommentId, doomed)))
          .run();
        tx.delete(mentions).where(inArray(mentions.commentId, doomed)).run();
        tx.delete(attachments).where(inArray(attachments.commentId, doomed)).run();
        if (replyIds.length > 0) tx.delete(comments).where(inArray(comments.id, replyIds)).run();
        tx.delete(comments).where(eq(comments.id, comment.id)).run();
      });
      for (const a of attRows) ctx.storage.delete(a.id);
      return c.json({ ok: true as const });
    },
  };
}
