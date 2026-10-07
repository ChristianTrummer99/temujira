import { and, asc, count, desc, eq, gt, isNull, type SQL } from "drizzle-orm";
import type { z } from "zod";
import type { InboxItem, ListInboxQuerySchema, UpdateInboxQuerySchema, WatchInboxQuerySchema } from "@temujira/shared";
import { accessibleWorkspaceIds, workspaceScopeWhere } from "../access";
import { inboxEvents, inboxItems, tasks, users, workspaces } from "../db/schema";
import { notFound, validationError } from "../errors";
import { inboxItemToApi } from "../serialize";
import { now } from "../util";
import { loadCommentsById } from "./commentSerialize";
import { currentUser, query, type AppContext, type Handlers } from "./types";

export function inboxHandlers(ctx: AppContext): Pick<Handlers, "inbox.list" | "inbox.update" | "inbox.watch" | "inbox.markRead"> {
  return {
    "inbox.markRead": (c) => {
      const user = currentUser(c);
      const where = and(
        eq(inboxItems.id, c.req.param("id") ?? ""),
        eq(inboxItems.userId, user.id),
        workspaceScopeWhere(inboxItems.workspaceId, accessibleWorkspaceIds(ctx.db, user)),
      );
      if (!ctx.db.select({ id: inboxItems.id }).from(inboxItems).where(where).get()) throw notFound("inbox item");
      const result = ctx.db.update(inboxItems).set({ readAt: now() })
        .where(and(where, isNull(inboxItems.readAt))).run();
      return c.json({ ok: true as const, updated: result.changes });
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
     * The current user's unified, cross-workspace inbox: newest first, unread only unless
     * `include_read=1`. `unread` counts ALL of the user's unread rows, not just this page.
     */
    "inbox.list": (c) => {
      const user = currentUser(c);
      const q = query<z.infer<typeof ListInboxQuerySchema>>(c);
      // Scoped users never see inbox rows for workspaces they can't access (badge included).
      const wsScope = workspaceScopeWhere(inboxItems.workspaceId, accessibleWorkspaceIds(ctx.db, user));
      const conds: (SQL | undefined)[] = [eq(inboxItems.userId, user.id), wsScope];
      if (!q.include_read) conds.push(isNull(inboxItems.readAt));
      const where = and(...conds);
      const total = ctx.db.select({ c: count() }).from(inboxItems).where(where).get()?.c ?? 0;
      const unread =
        ctx.db
          .select({ c: count() })
          .from(inboxItems)
          .where(and(eq(inboxItems.userId, user.id), isNull(inboxItems.readAt), wsScope))
          .get()?.c ?? 0;
      const rows = ctx.db
        .select({ item: inboxItems, actor: users, workspace: workspaces, task: tasks })
        .from(inboxItems)
        .innerJoin(users, eq(inboxItems.actorId, users.id))
        .innerJoin(workspaces, eq(inboxItems.workspaceId, workspaces.id))
        .innerJoin(tasks, eq(inboxItems.taskId, tasks.id))
        .where(where)
        .orderBy(desc(inboxItems.createdAt), desc(inboxItems.id))
        .limit(q.limit)
        .offset(q.offset)
        .all();

      // Source + parent comments are serialized flat (author + attachments, replies []).
      const commentIds = rows.flatMap((r) =>
        r.item.parentCommentId ? [r.item.sourceCommentId, r.item.parentCommentId] : [r.item.sourceCommentId],
      );
      const byId = loadCommentsById(ctx.db, commentIds);

      const items: InboxItem[] = [];
      for (const r of rows) {
        const source = byId.get(r.item.sourceCommentId);
        if (!source) continue; // defensive: comment deletion cleans its inbox rows up
        const parent = r.item.parentCommentId ? (byId.get(r.item.parentCommentId) ?? null) : null;
        items.push(
          inboxItemToApi(r.item, r.actor, r.workspace, r.task, r.workspace.key, source, parent),
        );
      }
      return c.json({ items, unread, total, limit: q.limit, offset: q.offset });
    },

    /** `?mark_read=1` marks every unread row of the current user read; idempotent. */
    "inbox.update": (c) => {
      const user = currentUser(c);
      const q = query<z.infer<typeof UpdateInboxQuerySchema>>(c);
      if (!q.mark_read) return c.json({ ok: true as const, updated: 0 });
      const res = ctx.db
        .update(inboxItems)
        .set({ readAt: now() })
        .where(and(eq(inboxItems.userId, user.id), isNull(inboxItems.readAt),
          workspaceScopeWhere(inboxItems.workspaceId, accessibleWorkspaceIds(ctx.db, user))))
        .run();
      return c.json({ ok: true as const, updated: res.changes });
    },
  };
}
