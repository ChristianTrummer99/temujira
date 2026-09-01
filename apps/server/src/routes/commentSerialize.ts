import { asc, eq, inArray } from "drizzle-orm";
import type { Comment } from "@temujira/shared";
import type { Db } from "../db";
import { attachments, comments, users } from "../db/schema";
import { commentToApi, type AttachmentRow, type CommentRow, type UserRow } from "../serialize";

/**
 * Shared comment serialization. `comments.list` needs one-level threading; the inbox needs
 * a single comment (plus its thread root) with author + attachments embedded. Both go
 * through here so the wire shape can never drift between the two endpoints.
 */

/** Attachments grouped by comment id, chronological within each comment. */
export function attachmentsByComment(db: Db, commentIds: string[]): Map<string, AttachmentRow[]> {
  const byComment = new Map<string, AttachmentRow[]>();
  if (commentIds.length === 0) return byComment;
  const rows = db
    .select()
    .from(attachments)
    .where(inArray(attachments.commentId, commentIds))
    .orderBy(asc(attachments.createdAt), asc(attachments.id))
    .all();
  for (const a of rows) {
    if (!a.commentId) continue;
    const list = byComment.get(a.commentId) ?? [];
    list.push(a);
    byComment.set(a.commentId, list);
  }
  return byComment;
}

/** User rows keyed by id (single query, deduped). */
export function usersByIds(db: Db, ids: string[]): Map<string, UserRow> {
  const unique = [...new Set(ids)];
  const byId = new Map<string, UserRow>();
  if (unique.length === 0) return byId;
  for (const u of db.select().from(users).where(inArray(users.id, unique)).all()) byId.set(u.id, u);
  return byId;
}

/**
 * Serialize rows without threading: `replies` is always an empty array. Used for inbox
 * payloads (source/parent comments) where nesting the whole thread would be wasteful.
 */
export function serializeFlat(db: Db, rows: CommentRow[]): Map<string, Comment> {
  const out = new Map<string, Comment>();
  if (rows.length === 0) return out;
  const authors = usersByIds(db, rows.map((r) => r.authorId));
  const atts = attachmentsByComment(db, rows.map((r) => r.id));
  for (const row of rows) {
    const author = authors.get(row.authorId);
    if (!author) continue; // FK makes this unreachable
    out.set(row.id, commentToApi(row, author, atts.get(row.id) ?? [], []));
  }
  return out;
}

/** Load comments by id and serialize them flat (replies omitted). */
export function loadCommentsById(db: Db, ids: string[]): Map<string, Comment> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = db.select().from(comments).where(inArray(comments.id, unique)).all();
  return serializeFlat(db, rows);
}

/**
 * A task's comments as a one-level thread: roots in chronological order, each with its
 * replies nested oldest-first. Replies never appear at the top level. A reply whose parent
 * is missing (should not happen — deleting a root cascades) is promoted to a root so it
 * can never silently vanish.
 */
export function threadedComments(db: Db, taskId: string): Comment[] {
  const rows = db
    .select({ comment: comments, author: users })
    .from(comments)
    .innerJoin(users, eq(comments.authorId, users.id))
    .where(eq(comments.taskId, taskId))
    .orderBy(asc(comments.createdAt), asc(comments.id))
    .all();
  if (rows.length === 0) return [];
  const atts = attachmentsByComment(db, rows.map((r) => r.comment.id));
  const byId = new Map<string, Comment>();
  for (const r of rows) {
    byId.set(r.comment.id, commentToApi(r.comment, r.author, atts.get(r.comment.id) ?? [], []));
  }
  const roots: Comment[] = [];
  for (const r of rows) {
    const api = byId.get(r.comment.id)!;
    const parent = r.comment.parentId ? byId.get(r.comment.parentId) : undefined;
    if (parent) parent.replies.push(api);
    else roots.push(api);
  }
  return roots;
}

/** One comment serialized the way `comments.list` would render it (replies nested for roots). */
export function commentWithReplies(db: Db, row: CommentRow): Comment {
  const author = db.select().from(users).where(eq(users.id, row.authorId)).get()!;
  const replyRows =
    row.parentId === null
      ? db
          .select()
          .from(comments)
          .where(eq(comments.parentId, row.id))
          .orderBy(asc(comments.createdAt), asc(comments.id))
          .all()
      : [];
  const flat = serializeFlat(db, replyRows);
  const replies = replyRows.map((r) => flat.get(r.id)).filter((r): r is Comment => r !== undefined);
  return commentToApi(row, author, attachmentsByComment(db, [row.id]).get(row.id) ?? [], replies);
}
