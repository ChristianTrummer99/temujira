import { asc, eq, isNull } from "drizzle-orm";
import type { z } from "zod";
import type {
  CreateWorkspaceInputSchema,
  ListWorkspacesQuerySchema,
  UpdateWorkspaceInputSchema,
} from "@temujira/shared";
import type { Db } from "../db";
import { workspaces } from "../db/schema";
import { conflict } from "../errors";
import { seedDefaultStatuses } from "../seed";
import { workspaceToApi } from "../serialize";
import { newId, now } from "../util";
import { requireWorkspace } from "./resolve";
import { body, query, type AppContext, type Handlers } from "./types";

export function workspacesHandlers(
  ctx: AppContext,
): Pick<Handlers, "workspaces.list" | "workspaces.create" | "workspaces.get" | "workspaces.update"> {
  return {
    "workspaces.list": (c) => {
      const q = query<z.infer<typeof ListWorkspacesQuerySchema>>(c);
      const rows = ctx.db
        .select()
        .from(workspaces)
        .where(q.include_archived ? undefined : isNull(workspaces.archivedAt))
        .orderBy(asc(workspaces.createdAt), asc(workspaces.id))
        .all();
      return c.json({ items: rows.map(workspaceToApi) });
    },

    "workspaces.create": (c) => {
      const input = body<z.infer<typeof CreateWorkspaceInputSchema>>(c);
      const existing = ctx.db.select().from(workspaces).where(eq(workspaces.key, input.key)).get();
      if (existing) throw conflict(`workspace key ${input.key} is already in use`);
      const t = now();
      const row: typeof workspaces.$inferSelect = {
        id: newId(),
        name: input.name,
        key: input.key,
        nextTaskNumber: 1,
        archivedAt: null,
        createdAt: t,
        updatedAt: t,
      };
      ctx.db.transaction((tx) => {
        tx.insert(workspaces).values(row).run();
        seedDefaultStatuses(tx as unknown as Db, row.id);
      });
      return c.json({ workspace: workspaceToApi(row) });
    },

    "workspaces.get": (c) => {
      const ws = requireWorkspace(ctx.db, c.req.param("idOrKey") ?? "");
      return c.json({ workspace: workspaceToApi(ws) });
    },

    "workspaces.update": (c) => {
      const ws = requireWorkspace(ctx.db, c.req.param("idOrKey") ?? "");
      const input = body<z.infer<typeof UpdateWorkspaceInputSchema>>(c);
      const t = now();
      const updates: Partial<typeof workspaces.$inferInsert> = { updatedAt: t };
      if (input.name !== undefined) updates.name = input.name;
      if (input.archived === true && ws.archivedAt === null) updates.archivedAt = t;
      if (input.archived === false) updates.archivedAt = null;
      const updated = ctx.db.update(workspaces).set(updates).where(eq(workspaces.id, ws.id)).returning().get();
      return c.json({ workspace: workspaceToApi(updated!) });
    },
  };
}
