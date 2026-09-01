import { and, asc, count, eq, max } from "drizzle-orm";
import type { z } from "zod";
import type {
  CreateStatusInputSchema,
  DeleteStatusQuerySchema,
  ReorderStatusesInputSchema,
  UpdateStatusInputSchema,
} from "@temujira/shared";
import { statuses, tasks } from "../db/schema";
import { conflict, notFound, validationError } from "../errors";
import { statusToApi, type StatusRow } from "../serialize";
import { newId, now } from "../util";
import { requireWorkspace } from "./resolve";
import { body, query, type AppContext, type Handlers } from "./types";

function requireStatus(ctx: AppContext, id: string): StatusRow {
  const row = ctx.db.select().from(statuses).where(eq(statuses.id, id)).get();
  if (!row) throw notFound("status");
  return row;
}

function nameTaken(ctx: AppContext, workspaceId: string, name: string, excludeId?: string): boolean {
  const row = ctx.db
    .select()
    .from(statuses)
    .where(and(eq(statuses.workspaceId, workspaceId), eq(statuses.name, name)))
    .get();
  return row !== undefined && row.id !== excludeId;
}

export function statusesHandlers(
  ctx: AppContext,
): Pick<Handlers, "statuses.list" | "statuses.create" | "statuses.update" | "statuses.reorder" | "statuses.delete"> {
  return {
    "statuses.list": (c) => {
      const ws = requireWorkspace(ctx.db, c.req.param("idOrKey") ?? "");
      const rows = ctx.db
        .select()
        .from(statuses)
        .where(eq(statuses.workspaceId, ws.id))
        .orderBy(asc(statuses.position))
        .all();
      return c.json({ items: rows.map(statusToApi) });
    },

    "statuses.create": (c) => {
      const ws = requireWorkspace(ctx.db, c.req.param("idOrKey") ?? "");
      const input = body<z.infer<typeof CreateStatusInputSchema>>(c);
      if (nameTaken(ctx, ws.id, input.name)) {
        throw conflict(`a status named "${input.name}" already exists in this workspace`);
      }
      const maxPos =
        ctx.db.select({ m: max(statuses.position) }).from(statuses).where(eq(statuses.workspaceId, ws.id)).get()?.m ??
        -1;
      const row: StatusRow = {
        id: newId(),
        workspaceId: ws.id,
        name: input.name,
        color: input.color,
        position: maxPos + 1,
        createdAt: now(),
      };
      ctx.db.insert(statuses).values(row).run();
      return c.json({ status: statusToApi(row) });
    },

    "statuses.update": (c) => {
      const st = requireStatus(ctx, c.req.param("id") ?? "");
      const input = body<z.infer<typeof UpdateStatusInputSchema>>(c);
      const updates: Partial<typeof statuses.$inferInsert> = {};
      if (input.name !== undefined && input.name !== st.name) {
        if (nameTaken(ctx, st.workspaceId, input.name, st.id)) {
          throw conflict(`a status named "${input.name}" already exists in this workspace`);
        }
        updates.name = input.name;
      }
      if (input.color !== undefined) updates.color = input.color;
      if (Object.keys(updates).length === 0) return c.json({ status: statusToApi(st) });
      const updated = ctx.db.update(statuses).set(updates).where(eq(statuses.id, st.id)).returning().get();
      return c.json({ status: statusToApi(updated!) });
    },

    "statuses.reorder": (c) => {
      const ws = requireWorkspace(ctx.db, c.req.param("idOrKey") ?? "");
      const input = body<z.infer<typeof ReorderStatusesInputSchema>>(c);
      const rows = ctx.db.select().from(statuses).where(eq(statuses.workspaceId, ws.id)).all();
      const currentIds = new Set(rows.map((r) => r.id));
      const submitted = new Set(input.status_ids);
      const exactSet =
        input.status_ids.length === currentIds.size &&
        submitted.size === input.status_ids.length &&
        input.status_ids.every((id) => currentIds.has(id));
      if (!exactSet) {
        throw validationError(
          `status_ids must contain exactly this workspace's ${currentIds.size} status id(s), each exactly once (expected: ${[...currentIds].join(", ")})`,
        );
      }
      ctx.db.transaction((tx) => {
        input.status_ids.forEach((id, i) => {
          tx.update(statuses).set({ position: i }).where(eq(statuses.id, id)).run();
        });
      });
      const reordered = ctx.db
        .select()
        .from(statuses)
        .where(eq(statuses.workspaceId, ws.id))
        .orderBy(asc(statuses.position))
        .all();
      return c.json({ items: reordered.map(statusToApi) });
    },

    "statuses.delete": (c) => {
      const st = requireStatus(ctx, c.req.param("id") ?? "");
      const q = query<z.infer<typeof DeleteStatusQuerySchema>>(c);
      const siblingCount =
        ctx.db.select({ c: count() }).from(statuses).where(eq(statuses.workspaceId, st.workspaceId)).get()?.c ?? 0;
      if (siblingCount <= 1) throw conflict("cannot delete the last status of a workspace");
      let moveTo: StatusRow | undefined;
      if (q.move_to !== undefined) {
        if (q.move_to === st.id) throw validationError("move_to must be a different status than the one being deleted");
        moveTo = ctx.db.select().from(statuses).where(eq(statuses.id, q.move_to)).get();
        if (!moveTo || moveTo.workspaceId !== st.workspaceId) {
          throw validationError("move_to must be a status of the same workspace");
        }
      }
      const taskCount = ctx.db.select({ c: count() }).from(tasks).where(eq(tasks.statusId, st.id)).get()?.c ?? 0;
      if (taskCount > 0 && !moveTo) {
        throw conflict(
          `${taskCount} task(s) still use this status; pass ?move_to=<status_id> to reassign them before deletion`,
        );
      }
      ctx.db.transaction((tx) => {
        if (taskCount > 0 && moveTo) {
          tx.update(tasks).set({ statusId: moveTo.id, updatedAt: now() }).where(eq(tasks.statusId, st.id)).run();
        }
        tx.delete(statuses).where(eq(statuses.id, st.id)).run();
      });
      return c.json({ ok: true as const });
    },
  };
}
