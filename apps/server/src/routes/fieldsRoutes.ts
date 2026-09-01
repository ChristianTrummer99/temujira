import { and, asc, eq, max } from "drizzle-orm";
import type { z } from "zod";
import type {
  CreateFieldInputSchema,
  ReorderFieldsInputSchema,
  UpdateFieldInputSchema,
} from "@temujira/shared";
import { fieldDefs, fieldValues } from "../db/schema";
import { conflict, notFound, validationError } from "../errors";
import { fieldDefToApi, type FieldDefRow } from "../serialize";
import { newId, now } from "../util";
import { requireWorkspace } from "./resolve";
import { body, currentUser, type AppContext, type Handlers } from "./types";

function requireField(ctx: AppContext, id: string, workspaceId?: string): FieldDefRow {
  const row = ctx.db.select().from(fieldDefs).where(eq(fieldDefs.id, id)).get();
  if (!row) throw notFound("field");
  if (workspaceId !== undefined && row.workspaceId !== workspaceId) throw notFound("field");
  return row;
}

function nameTaken(ctx: AppContext, workspaceId: string, name: string, excludeId?: string): boolean {
  const row = ctx.db
    .select()
    .from(fieldDefs)
    .where(and(eq(fieldDefs.workspaceId, workspaceId), eq(fieldDefs.name, name)))
    .get();
  return row !== undefined && row.id !== excludeId;
}

export function fieldsHandlers(
  ctx: AppContext,
): Pick<Handlers, "fields.list" | "fields.create" | "fields.update" | "fields.reorder" | "fields.delete"> {
  return {
    "fields.list": (c) => {
      const ws = requireWorkspace(ctx.db, c.req.param("idOrKey") ?? "");
      const rows = ctx.db
        .select()
        .from(fieldDefs)
        .where(eq(fieldDefs.workspaceId, ws.id))
        .orderBy(asc(fieldDefs.position))
        .all();
      return c.json({ items: rows.map(fieldDefToApi) });
    },

    "fields.create": (c) => {
      const ws = requireWorkspace(ctx.db, c.req.param("idOrKey") ?? "");
      const input = body<z.infer<typeof CreateFieldInputSchema>>(c);
      if (nameTaken(ctx, ws.id, input.name)) {
        throw conflict(`a field named "${input.name}" already exists in this workspace`);
      }
      const options = input.type === "select" ? dedupeOptions(input.options ?? []) : [];
      if (input.type === "select" && options.length === 0) {
        throw validationError("select fields need at least one option");
      }
      const maxPos =
        ctx.db.select({ m: max(fieldDefs.position) }).from(fieldDefs).where(eq(fieldDefs.workspaceId, ws.id)).get()?.m ??
        -1;
      const row: FieldDefRow = {
        id: newId(),
        workspaceId: ws.id,
        name: input.name,
        type: input.type,
        options: JSON.stringify(options),
        position: maxPos + 1,
        createdBy: currentUser(c).id,
        createdAt: now(),
      };
      ctx.db.insert(fieldDefs).values(row).run();
      return c.json({ field: fieldDefToApi(row) });
    },

    "fields.update": (c) => {
      const st = requireField(ctx, c.req.param("id") ?? "");
      const input = body<z.infer<typeof UpdateFieldInputSchema>>(c);
      const updates: Partial<typeof fieldDefs.$inferInsert> = {};
      if (input.name !== undefined && input.name !== st.name) {
        if (nameTaken(ctx, st.workspaceId, input.name, st.id)) {
          throw conflict(`a field named "${input.name}" already exists in this workspace`);
        }
        updates.name = input.name;
      }
      if (input.options !== undefined) {
        if (st.type !== "select") {
          throw validationError("only select fields carry options");
        }
        const options = dedupeOptions(input.options);
        if (options.length === 0) {
          throw validationError("select fields need at least one option");
        }
        updates.options = JSON.stringify(options);
      }
      if (Object.keys(updates).length === 0) return c.json({ field: fieldDefToApi(st) });
      const updated = ctx.db.update(fieldDefs).set(updates).where(eq(fieldDefs.id, st.id)).returning().get();
      return c.json({ field: fieldDefToApi(updated!) });
    },

    "fields.reorder": (c) => {
      const ws = requireWorkspace(ctx.db, c.req.param("idOrKey") ?? "");
      const input = body<z.infer<typeof ReorderFieldsInputSchema>>(c);
      const rows = ctx.db.select().from(fieldDefs).where(eq(fieldDefs.workspaceId, ws.id)).all();
      const currentIds = new Set(rows.map((r) => r.id));
      const submitted = new Set(input.field_ids);
      const exactSet =
        input.field_ids.length === currentIds.size &&
        submitted.size === input.field_ids.length &&
        input.field_ids.every((id) => currentIds.has(id));
      if (!exactSet) {
        throw validationError(
          `field_ids must contain exactly this workspace's ${currentIds.size} field id(s), each exactly once (expected: ${[...currentIds].join(", ")})`,
        );
      }
      ctx.db.transaction((tx) => {
        input.field_ids.forEach((id, i) => {
          tx.update(fieldDefs).set({ position: i }).where(eq(fieldDefs.id, id)).run();
        });
      });
      const reordered = ctx.db
        .select()
        .from(fieldDefs)
        .where(eq(fieldDefs.workspaceId, ws.id))
        .orderBy(asc(fieldDefs.position))
        .all();
      return c.json({ items: reordered.map(fieldDefToApi) });
    },

    "fields.delete": (c) => {
      const st = requireField(ctx, c.req.param("id") ?? "");
      ctx.db.transaction((tx) => {
        tx.delete(fieldValues).where(eq(fieldValues.fieldId, st.id)).run();
        tx.delete(fieldDefs).where(eq(fieldDefs.id, st.id)).run();
      });
      return c.json({ ok: true as const });
    },
  };
}

function dedupeOptions(options: string[]): string[] {
  return [...new Set(options.map((o) => o.trim()))].filter((o) => o.length > 0);
}