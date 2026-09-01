import { and, asc, eq, inArray, max } from "drizzle-orm";
import type { z } from "zod";
import type {
  AddTaskToQueueInputSchema,
  QueueEntry,
  QueueStateInputSchema,
  ReorderQueueInputSchema,
} from "@temujira/shared";
import { queueEntries, statuses, taskLinks, tasks, users, workspaces } from "../db/schema";
import { conflict, notFound, validationError } from "../errors";
import { queueEntryToApi, taskToApi, type QueueEntryRow } from "../serialize";
import { newId, now } from "../util";
import { requireTask } from "./resolve";
import { loadFieldValuesForTasks, loadTagsForTasks } from "./tasksRoutes";
import { body, currentUser, type AppContext, type Handlers } from "./types";

function requireOwnEntry(ctx: AppContext, userId: string, id: string): QueueEntryRow {
  const row = ctx.db.select().from(queueEntries).where(eq(queueEntries.id, id)).get();
  if (!row || row.userId !== userId) throw notFound("queue entry");
  return row;
}

/**
 * The current user's queue as API entries. Loads each task with its workspace key,
 * status, assignee, tags and field values, plus the derived `blocked` flag from the
 * links graph (true when some task has a `blocks` edge to it).
 */
export function loadQueueForUser(ctx: AppContext, userId: string): QueueEntry[] {
  const rows = ctx.db
    .select({ entry: queueEntries, task: tasks })
    .from(queueEntries)
    .innerJoin(tasks, eq(queueEntries.taskId, tasks.id))
    .where(eq(queueEntries.userId, userId))
    .orderBy(asc(queueEntries.position), asc(queueEntries.createdAt))
    .all();
  if (rows.length === 0) return [];
  const taskIds = rows.map((r) => r.task.id);
  const ctxRows = ctx.db
    .select({ task: tasks, workspace: workspaces, status: statuses, assignee: users })
    .from(tasks)
    .innerJoin(workspaces, eq(tasks.workspaceId, workspaces.id))
    .innerJoin(statuses, eq(tasks.statusId, statuses.id))
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .where(inArray(tasks.id, taskIds))
    .all();
  const byId = new Map(ctxRows.map((r) => [r.task.id, r]));
  const tagsByTask = loadTagsForTasks(ctx.db, taskIds);
  const fieldByTask = loadFieldValuesForTasks(ctx.db, taskIds);
  const blockedRows = ctx.db
    .select({ dst: taskLinks.dstTaskId })
    .from(taskLinks)
    .where(and(eq(taskLinks.type, "blocks"), inArray(taskLinks.dstTaskId, taskIds)))
    .all();
  const blockedSet = new Set(blockedRows.map((r) => r.dst));
  return rows.map(({ entry, task }) => {
    const r = byId.get(task.id)!;
    return queueEntryToApi(
      entry,
      taskToApi(
        task,
        r.workspace.key,
        r.status,
        r.assignee,
        tagsByTask.get(task.id) ?? [],
        undefined,
        undefined,
        fieldByTask.get(task.id),
      ),
      blockedSet.has(task.id),
    );
  });
}

export function queueHandlers(
  ctx: AppContext,
): Pick<Handlers, "queue.get" | "queue.next" | "queue.add" | "queue.setState" | "queue.remove" | "queue.reorder"> {
  return {
    "queue.get": (c) => {
      const user = currentUser(c);
      return c.json({ items: loadQueueForUser(ctx, user.id) });
    },

    "queue.next": (c) => {
      const user = currentUser(c);
      const items = loadQueueForUser(ctx, user.id);
      // running > ready > queued; first match wins. Blocked is advisory (flagged, not skipped).
      const pick = (state: string) => items.find((e) => e.state === state) ?? null;
      return c.json({ entry: pick("running") ?? pick("ready") ?? pick("queued") });
    },

    "queue.add": (c) => {
      const user = currentUser(c);
      const input = body<z.infer<typeof AddTaskToQueueInputSchema>>(c);
      const { task } = requireTask(ctx.db, input.task);
      const existing = ctx.db
        .select()
        .from(queueEntries)
        .where(and(eq(queueEntries.userId, user.id), eq(queueEntries.taskId, task.id)))
        .get();
      if (existing) throw conflict("this task is already in your queue");
      const maxPos =
        ctx.db
          .select({ m: max(queueEntries.position) })
          .from(queueEntries)
          .where(eq(queueEntries.userId, user.id))
          .get()?.m ?? -1;
      const t = now();
      const id = newId();
      ctx.db
        .insert(queueEntries)
        .values({
          id,
          userId: user.id,
          taskId: task.id,
          position: maxPos + 1,
          state: "queued",
          addedBy: user.id,
          createdAt: t,
          updatedAt: t,
        })
        .run();
      const entry = loadQueueForUser(ctx, user.id).find((e) => e.id === id)!;
      return c.json({ entry });
    },

    "queue.setState": (c) => {
      const user = currentUser(c);
      const row = requireOwnEntry(ctx, user.id, c.req.param("id") ?? "");
      const input = body<z.infer<typeof QueueStateInputSchema>>(c);
      ctx.db
        .update(queueEntries)
        .set({ state: input.state, updatedAt: now() })
        .where(eq(queueEntries.id, row.id))
        .run();
      const entry = loadQueueForUser(ctx, user.id).find((e) => e.id === row.id)!;
      return c.json({ entry });
    },

    "queue.remove": (c) => {
      const user = currentUser(c);
      const row = requireOwnEntry(ctx, user.id, c.req.param("id") ?? "");
      ctx.db.delete(queueEntries).where(eq(queueEntries.id, row.id)).run();
      return c.json({ ok: true as const });
    },

    "queue.reorder": (c) => {
      const user = currentUser(c);
      const input = body<z.infer<typeof ReorderQueueInputSchema>>(c);
      const rows = ctx.db.select().from(queueEntries).where(eq(queueEntries.userId, user.id)).all();
      const currentIds = new Set(rows.map((r) => r.id));
      const submitted = new Set(input.entry_ids);
      const exactSet =
        input.entry_ids.length === currentIds.size &&
        submitted.size === input.entry_ids.length &&
        input.entry_ids.every((id) => currentIds.has(id));
      if (!exactSet) {
        throw validationError(
          `entry_ids must contain exactly your ${currentIds.size} queue entry id(s), each exactly once`,
        );
      }
      const t = now();
      ctx.db.transaction((tx) => {
        input.entry_ids.forEach((id, i) => {
          tx.update(queueEntries).set({ position: i, updatedAt: t }).where(eq(queueEntries.id, id)).run();
        });
      });
      return c.json({ items: loadQueueForUser(ctx, user.id) });
    },
  };
}