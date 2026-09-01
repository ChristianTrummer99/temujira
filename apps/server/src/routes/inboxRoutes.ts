import { and, count, desc, eq, isNull, type SQL } from "drizzle-orm";
import type { z } from "zod";
import type { InboxItem, ListInboxQuerySchema, UpdateInboxQuerySchema } from "@temujira/shared";
import { inboxItems, tasks, users, workspaces } from "../db/schema";
import { inboxItemToApi } from "../serialize";
import { now } from "../util";
import { loadCommentsById } from "./commentSerialize";
import { currentUser, query, type AppContext, type Handlers } from "./types";

export function inboxHandlers(ctx: AppContext): Pick<Handlers, "inbox.list" | "inbox.update"> {
  return {
    /**
     * The current user's unified, cross-workspace inbox: newest first, unread only unless
     * `include_read=1`. `unread` counts ALL of the user's unread rows, not just this page.
     */
    "inbox.list": (c) => {
      const user = currentUser(c);
      const q = query<z.infer<typeof ListInboxQuerySchema>>(c);
      const conds: (SQL | undefined)[] = [eq(inboxItems.userId, user.id)];
      if (!q.include_read) conds.push(isNull(inboxItems.readAt));
      const where = and(...conds);
      const total = ctx.db.select({ c: count() }).from(inboxItems).where(where).get()?.c ?? 0;
      const unread =
        ctx.db
          .select({ c: count() })
          .from(inboxItems)
          .where(and(eq(inboxItems.userId, user.id), isNull(inboxItems.readAt)))
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
        .where(and(eq(inboxItems.userId, user.id), isNull(inboxItems.readAt)))
        .run();
      return c.json({ ok: true as const, updated: res.changes });
    },
  };
}
