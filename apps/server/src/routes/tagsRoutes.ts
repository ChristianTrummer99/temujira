import { and, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import type { CreateTagInputSchema, UpdateTagInputSchema } from "@temujira/shared";
import { tags, taskTags, tasks } from "../db/schema";
import { conflict, notFound } from "../errors";
import { tagToApi, type TagRow } from "../serialize";
import { newId, now } from "../util";
import { requireWorkspace } from "./resolve";
import { body, type AppContext, type Handlers } from "./types";

function requireTag(ctx: AppContext, id: string): TagRow {
  const row = ctx.db.select().from(tags).where(eq(tags.id, id)).get();
  if (!row) throw notFound("tag");
  return row;
}

function nameTaken(ctx: AppContext, workspaceId: string, name: string, excludeId?: string): boolean {
  const row = ctx.db
    .select()
    .from(tags)
    .where(and(eq(tags.workspaceId, workspaceId), eq(tags.name, name)))
    .get();
  return row !== undefined && row.id !== excludeId;
}

export function tagsHandlers(
  ctx: AppContext,
): Pick<Handlers, "tags.list" | "tags.create" | "tags.update" | "tags.delete"> {
  return {
    "tags.list": (c) => {
      const ws = requireWorkspace(ctx.db, c.req.param("idOrKey") ?? "");
      const rows = ctx.db
        .select()
        .from(tags)
        .where(eq(tags.workspaceId, ws.id))
        .orderBy(tags.name)
        .all();
      return c.json({ items: rows.map(tagToApi) });
    },

    "tags.create": (c) => {
      const ws = requireWorkspace(ctx.db, c.req.param("idOrKey") ?? "");
      const input = body<z.infer<typeof CreateTagInputSchema>>(c);
      if (nameTaken(ctx, ws.id, input.name)) {
        throw conflict(`a tag named "${input.name}" already exists in this workspace`);
      }
      const row: TagRow = {
        id: newId(),
        workspaceId: ws.id,
        name: input.name,
        color: input.color,
        createdAt: now(),
      };
      ctx.db.insert(tags).values(row).run();
      return c.json({ tag: tagToApi(row) });
    },

    "tags.update": (c) => {
      const tag = requireTag(ctx, c.req.param("id") ?? "");
      const input = body<z.infer<typeof UpdateTagInputSchema>>(c);
      const updates: Partial<typeof tags.$inferInsert> = {};
      if (input.name !== undefined && input.name !== tag.name) {
        if (nameTaken(ctx, tag.workspaceId, input.name, tag.id)) {
          throw conflict(`a tag named "${input.name}" already exists in this workspace`);
        }
        updates.name = input.name;
      }
      if (input.color !== undefined) updates.color = input.color;
      if (Object.keys(updates).length === 0) return c.json({ tag: tagToApi(tag) });
      const updated = ctx.db.update(tags).set(updates).where(eq(tags.id, tag.id)).returning().get();
      return c.json({ tag: tagToApi(updated!) });
    },

    "tags.delete": (c) => {
      const tag = requireTag(ctx, c.req.param("id") ?? "");
      ctx.db.transaction((tx) => {
        tx.delete(taskTags).where(inArray(taskTags.tagId, [tag.id])).run();
        tx.delete(tags).where(eq(tags.id, tag.id)).run();
      });
      return c.json({ ok: true as const });
    },
  };
}
