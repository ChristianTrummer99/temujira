import { and, asc, eq, inArray, or } from "drizzle-orm";
import type { z } from "zod";
import {
  LINK_CANONICAL,
  LINK_INVERSE,
  type CreateTaskLinkInputSchema,
  type LinkRelation,
  type LinkType,
  type TaskLink,
} from "@temujira/shared";
import type { Db } from "../db";
import { statuses, taskLinks, tasks, workspaces } from "../db/schema";
import { conflict, notFound, validationError } from "../errors";
import { taskLinkToApi, type StatusRow, type TaskLinkRow, type TaskRow, type WorkspaceRow } from "../serialize";
import { newId, now } from "../util";
import { recordActivity } from "./engagement";
import { requireTask } from "./resolve";
import { body, currentUser, type AppContext, type Handlers } from "./types";

/** The far endpoint of a link relative to `taskId`. */
const farEndOf = (row: TaskLinkRow, taskId: string): string =>
  row.srcTaskId === taskId ? row.dstTaskId : row.srcTaskId;

/** The relation a link shows when read from `taskId`'s side. */
const relationFrom = (row: TaskLinkRow, taskId: string): LinkRelation =>
  row.srcTaskId === taskId ? (row.type as LinkType) : LINK_INVERSE[row.type as LinkType];

/**
 * Every link touching `taskId`, serialized from that task's viewpoint.
 * Two queries total (loadTagsForTasks batching precedent): the edges, then one
 * `inArray` join for the far ends — each far task carries its OWN workspace key, so
 * cross-workspace links serialize correct keys.
 */
export function loadLinksForTask(db: Db, taskId: string): TaskLink[] {
  const rows = db
    .select()
    .from(taskLinks)
    .where(or(eq(taskLinks.srcTaskId, taskId), eq(taskLinks.dstTaskId, taskId)))
    .orderBy(asc(taskLinks.createdAt), asc(taskLinks.id))
    .all();
  if (rows.length === 0) return [];
  const farIds = [...new Set(rows.map((r) => farEndOf(r, taskId)))];
  const far = db
    .select({ task: tasks, workspace: workspaces, status: statuses })
    .from(tasks)
    .innerJoin(workspaces, eq(tasks.workspaceId, workspaces.id))
    .innerJoin(statuses, eq(tasks.statusId, statuses.id))
    .where(inArray(tasks.id, farIds))
    .all();
  const byId = new Map(far.map((r) => [r.task.id, r]));
  const out: TaskLink[] = [];
  for (const row of rows) {
    const other = byId.get(farEndOf(row, taskId));
    if (!other) continue; // FK guarantees this never happens
    out.push(taskLinkToApi(row, taskId, { task: other.task, workspaceKey: other.workspace.key, status: other.status }));
  }
  return out;
}

interface Endpoint {
  task: TaskRow;
  workspace: WorkspaceRow;
}

const keyOf = (e: Endpoint): string => `${e.workspace.key}-${e.task.number}`;

/**
 * Map the posted relation onto the single canonical row it describes:
 * `flip` swaps the endpoints, and symmetric `relates` is additionally ordered
 * (src,dst) = (min,max) by ULID so "A relates B" and "B relates A" are one row.
 */
function canonicalize(
  relation: LinkRelation,
  urlEnd: Endpoint,
  otherEnd: Endpoint,
): { type: LinkType; src: Endpoint; dst: Endpoint } {
  const { type, flip } = LINK_CANONICAL[relation];
  let src = flip ? otherEnd : urlEnd;
  let dst = flip ? urlEnd : otherEnd;
  if (type === "relates" && src.task.id > dst.task.id) [src, dst] = [dst, src];
  return { type, src, dst };
}

/**
 * `task.linked` / `task.unlinked`, anchored on `anchor` in its own workspace with the
 * relation as seen from there. Cross-workspace links get a second mirrored event so both
 * per-workspace feeds report the fact, each viewpoint-correct.
 */
function recordLinkActivity(
  db: Db,
  opts: {
    action: "task.linked" | "task.unlinked";
    row: TaskLinkRow;
    actorId: string;
    anchor: Endpoint;
    other: Endpoint;
  },
): void {
  const { action, row, actorId, anchor, other } = opts;
  recordActivity(db, {
    workspaceId: anchor.workspace.id,
    taskId: anchor.task.id,
    actorId,
    action,
    metadata: {
      link_id: row.id,
      type: relationFrom(row, anchor.task.id),
      other_task_id: other.task.id,
      other_task_key: keyOf(other),
    },
  });
  if (anchor.workspace.id === other.workspace.id) return;
  recordActivity(db, {
    workspaceId: other.workspace.id,
    taskId: other.task.id,
    actorId,
    action,
    metadata: {
      link_id: row.id,
      type: relationFrom(row, other.task.id),
      other_task_id: anchor.task.id,
      other_task_key: keyOf(anchor),
    },
  });
}

function statusOf(db: Db, statusId: string): StatusRow {
  return db.select().from(statuses).where(eq(statuses.id, statusId)).get()!;
}

export function linksHandlers(ctx: AppContext): Pick<Handlers, "links.create" | "links.delete"> {
  return {
    "links.create": (c) => {
      const user = currentUser(c);
      const urlEnd = requireTask(ctx.db, c.req.param("idOrKey") ?? "");
      const input = body<z.infer<typeof CreateTaskLinkInputSchema>>(c);
      const otherEnd = requireTask(ctx.db, input.task);
      // Compare resolved ULIDs: "START-1" and its own id are the same task.
      if (otherEnd.task.id === urlEnd.task.id) throw validationError("a task cannot link to itself");

      const { type, src, dst } = canonicalize(input.type, urlEnd, otherEnd);

      // One transaction for the duplicate/inverse checks and the insert, so the unique
      // index can only ever be a backstop (never a raw SQLITE_CONSTRAINT 500).
      const row = ctx.db.transaction((tx): TaskLinkRow => {
        const existing = tx
          .select()
          .from(taskLinks)
          .where(
            and(eq(taskLinks.srcTaskId, src.task.id), eq(taskLinks.type, type), eq(taskLinks.dstTaskId, dst.task.id)),
          )
          .get();
        if (existing) throw conflict(`these tasks are already linked as ${input.type}`);
        // A directional type cannot hold both ways at once: "A blocks B" + "B blocks A"
        // is always a mistake. Symmetric `relates` is exempt — canonicalization already
        // collapsed both spellings into the row checked above.
        if (type !== "relates") {
          const inverse = tx
            .select()
            .from(taskLinks)
            .where(
              and(eq(taskLinks.srcTaskId, dst.task.id), eq(taskLinks.type, type), eq(taskLinks.dstTaskId, src.task.id)),
            )
            .get();
          if (inverse) {
            throw conflict(`${keyOf(dst)} already ${type} ${keyOf(src)} — remove that link first`);
          }
        }
        const created: TaskLinkRow = {
          id: newId(),
          srcTaskId: src.task.id,
          type,
          dstTaskId: dst.task.id,
          createdBy: user.id,
          createdAt: now(),
        };
        tx.insert(taskLinks).values(created).run();
        return created;
      });

      // Links are pure metadata: no archive, no status gate, and neither task's
      // updated_at moves. No inbox (links target tasks, not people), no associate().
      recordLinkActivity(ctx.db, {
        action: "task.linked",
        row,
        actorId: user.id,
        anchor: urlEnd,
        other: otherEnd,
      });

      return c.json({
        link: taskLinkToApi(row, urlEnd.task.id, {
          task: otherEnd.task,
          workspaceKey: otherEnd.workspace.key,
          status: statusOf(ctx.db, otherEnd.task.statusId),
        }),
      });
    },

    "links.delete": (c) => {
      const user = currentUser(c);
      const id = c.req.param("id") ?? "";
      const row = ctx.db.select().from(taskLinks).where(eq(taskLinks.id, id)).get();
      if (!row) throw notFound("link");
      const ends = ctx.db
        .select({ task: tasks, workspace: workspaces })
        .from(tasks)
        .innerJoin(workspaces, eq(tasks.workspaceId, workspaces.id))
        .where(inArray(tasks.id, [row.srcTaskId, row.dstTaskId]))
        .all();
      const src = ends.find((e) => e.task.id === row.srcTaskId)!;
      const dst = ends.find((e) => e.task.id === row.dstTaskId)!;
      // One row, both sides: any authenticated user may unlink (created_by is audit only).
      ctx.db.delete(taskLinks).where(eq(taskLinks.id, row.id)).run();
      recordLinkActivity(ctx.db, {
        action: "task.unlinked",
        row,
        actorId: user.id,
        anchor: src,
        other: dst,
      });
      return c.json({ ok: true as const });
    },
  };
}
