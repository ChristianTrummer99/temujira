import { and, asc, count, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { z } from "zod";
import type { InboxConversation, ListInboxQuerySchema, UpdateInboxQuerySchema, WatchInboxQuerySchema } from "@temujira/shared";
import { accessibleWorkspaceIds, workspaceScopeWhere } from "../access";
import { inboxEvents, inboxItems, tasks, users, workspaces } from "../db/schema";
import { notFound, validationError } from "../errors";
import { inboxItemToApi } from "../serialize";
import { now } from "../util";
import { loadCommentsById } from "./commentSerialize";
import { currentUser, query, type AppContext, type Handlers } from "./types";

const threadId = sql<string>`coalesce(${inboxItems.parentCommentId}, ${inboxItems.sourceCommentId})`;
const needsDecision = sql`EXISTS (SELECT 1 FROM comments decision WHERE decision.id = ${threadId}
  AND decision.question_options IS NOT NULL AND decision.answer_option_index IS NULL
  AND json_array_length(CASE WHEN json_valid(decision.question_options) THEN decision.question_options ELSE '[]' END) >= 2)`;

export function inboxHandlers(ctx: AppContext): Pick<Handlers, "inbox.list" | "inbox.update" | "inbox.watch" | "inbox.markRead"> {
  return {
    "inbox.markRead": (c) => {
      const user = currentUser(c);
      const where = and(
        eq(inboxItems.id, c.req.param("id") ?? ""),
        eq(inboxItems.userId, user.id),
        workspaceScopeWhere(inboxItems.workspaceId, accessibleWorkspaceIds(ctx.db, user)),
      );
      const item = ctx.db.select({ threadId }).from(inboxItems).where(where).get();
      if (!item) throw notFound("inbox item");
      const result = ctx.db.update(inboxItems).set({ readAt: now() })
        .where(and(eq(inboxItems.userId, user.id), eq(threadId, item.threadId), isNull(inboxItems.readAt),
          workspaceScopeWhere(inboxItems.workspaceId, accessibleWorkspaceIds(ctx.db, user)))).run();
      return c.json({ ok: true as const, updated: result.changes ? 1 : 0 });
    },
    "inbox.watch": (c) => {
      const user = currentUser(c);
      const q = query<z.infer<typeof WatchInboxQuerySchema>>(c);
      // Read the durable high-water mark, even when the newest inbox item was deleted.
      // This handler is synchronous: the mark and page come from the same DB state.
      const high = (ctx.sqlite.prepare("SELECT seq FROM sqlite_sequence WHERE name='inbox_events'").get() as { seq: number } | undefined)?.seq ?? 0;
      const after = q.after ?? high;
      if (after > high) throw validationError("cursor is ahead of this server; use after=0 to replay");
      const rows = ctx.db.select({ sequence: inboxEvents.sequence, item: inboxItems, actor: users, workspace: workspaces, task: tasks })
        .from(inboxEvents).innerJoin(inboxItems, eq(inboxEvents.inboxId, inboxItems.id))
        .innerJoin(users, eq(inboxItems.actorId, users.id))
        .innerJoin(workspaces, eq(inboxItems.workspaceId, workspaces.id))
        .innerJoin(tasks, eq(inboxItems.taskId, tasks.id))
        .where(and(gt(inboxEvents.sequence, after), eq(inboxItems.userId, user.id),
          workspaceScopeWhere(inboxItems.workspaceId, accessibleWorkspaceIds(ctx.db, user))))
        .orderBy(asc(inboxEvents.sequence)).limit(q.limit + 1).all();
      const has_more = rows.length > q.limit;
      const page = rows.slice(0, q.limit);
      const byId = loadCommentsById(ctx.db, page.flatMap((r) => [r.item.sourceCommentId, ...(r.item.parentCommentId ? [r.item.parentCommentId] : [])]));
      const items = page.flatMap((r) => {
        const source = byId.get(r.item.sourceCommentId);
        if (!source) return [];
        const parent = r.item.parentCommentId ? byId.get(r.item.parentCommentId) ?? null : null;
        return [{ cursor: r.sequence, item: inboxItemToApi(r.item, r.actor, r.workspace, r.task, r.workspace.key, source, parent) }];
      });
      return c.json({ items, cursor: has_more ? page[page.length - 1]!.sequence : high, has_more });
    },
    /**
     * Group before filtering/paging so neither duplicates nor split pages inflate the
     * inbox. Retain raw notification rows for the cursor-based event stream and history.
     */
    "inbox.list": (c) => {
      const user = currentUser(c);
      const q = query<z.infer<typeof ListInboxQuerySchema>>(c);
      const wsScope = workspaceScopeWhere(inboxItems.workspaceId, accessibleWorkspaceIds(ctx.db, user));
      const conversations = ctx.db.$with("inbox_conversations").as(ctx.db.select({
        latestId: inboxItems.id,
        threadId: threadId.as("thread_id"),
        // Stable while retained: a new reply updates this row instead of making a second card.
        id: sql<string>`first_value(${inboxItems.id}) OVER (PARTITION BY ${threadId} ORDER BY ${inboxItems}.rowid)`.as("conversation_id"),
        rank: sql<number>`row_number() OVER (PARTITION BY ${threadId} ORDER BY ${inboxItems.createdAt} DESC, ${inboxItems}.rowid DESC)`.as("latest_rank"),
        unread: sql<number>`sum(CASE WHEN ${inboxItems.readAt} IS NULL THEN 1 ELSE 0 END) OVER (PARTITION BY ${threadId})`.as("thread_unread"),
        readAt: sql<number | null>`max(${inboxItems.readAt}) OVER (PARTITION BY ${threadId})`.as("thread_read_at"),
      }).from(inboxItems).where(and(eq(inboxItems.userId, user.id), wsScope, q.needs_decision ? needsDecision : undefined)));
      const where = and(eq(conversations.rank, 1), q.include_read ? undefined : gt(conversations.unread, 0));
      const total = ctx.db.with(conversations).select({ n: count() }).from(conversations).where(where).get()!.n;
      const unread = ctx.db.with(conversations).select({ n: count() }).from(conversations)
        .where(and(eq(conversations.rank, 1), gt(conversations.unread, 0))).get()!.n;
      const rows = ctx.db.with(conversations)
        .select({ item: inboxItems, actor: users, workspace: workspaces, task: tasks,
          id: conversations.id, threadId: conversations.threadId, unread: conversations.unread, readAt: conversations.readAt })
        .from(conversations)
        .innerJoin(inboxItems, eq(conversations.latestId, inboxItems.id))
        .innerJoin(users, eq(inboxItems.actorId, users.id))
        .innerJoin(workspaces, eq(inboxItems.workspaceId, workspaces.id))
        .innerJoin(tasks, eq(inboxItems.taskId, tasks.id))
        .where(where)
        .orderBy(desc(inboxItems.createdAt), sql`${inboxItems}.rowid DESC`)
        .limit(q.limit)
        .offset(q.offset)
        .all();

      // Source + parent comments are serialized flat (author + attachments, replies []).
      const commentIds = rows.flatMap((r) =>
        r.item.parentCommentId ? [r.item.sourceCommentId, r.item.parentCommentId] : [r.item.sourceCommentId],
      );
      const byId = loadCommentsById(ctx.db, commentIds);

      const items: InboxConversation[] = [];
      for (const r of rows) {
        const source = byId.get(r.item.sourceCommentId);
        if (!source) continue; // defensive: comment deletion cleans its inbox rows up
        const parent = r.item.parentCommentId ? (byId.get(r.item.parentCommentId) ?? null) : null;
        items.push({
          ...inboxItemToApi(r.item, r.actor, r.workspace, r.task, r.workspace.key, source, parent),
          id: r.id, thread_id: r.threadId, read_at: r.unread > 0 ? null : r.readAt,
        });
      }
      return c.json({ items, unread, total, limit: q.limit, offset: q.offset });
    },

    /** `?mark_read=1` acknowledges matching, accessible conversations; idempotent. */
    "inbox.update": (c) => {
      const user = currentUser(c);
      const q = query<z.infer<typeof UpdateInboxQuerySchema>>(c);
      if (!q.mark_read) return c.json({ ok: true as const, updated: 0 });
      const where = and(eq(inboxItems.userId, user.id), isNull(inboxItems.readAt),
        workspaceScopeWhere(inboxItems.workspaceId, accessibleWorkspaceIds(ctx.db, user)),
        q.needs_decision ? needsDecision : undefined);
      const updated = ctx.db.select({ n: sql<number>`count(DISTINCT ${threadId})` }).from(inboxItems).where(where).get()!.n;
      ctx.db
        .update(inboxItems)
        .set({ readAt: now() })
        .where(where)
        .run();
      return c.json({ ok: true as const, updated });
    },
  };
}
