import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import type { z } from "zod";
import type {
  CreateUserInputSchema,
  ListUsersQuerySchema,
  MentionSearchQuerySchema,
  UpdateUserInputSchema,
} from "@temujira/shared";
import { hashPassword, destroyUserSessions } from "../auth";
import { sessions, users } from "../db/schema";
import { conflict, notFound } from "../errors";
import { userToApi } from "../serialize";
import { newId, now } from "../util";
import {
  body,
  currentUser,
  query,
  type AppContext,
  type Handlers,
} from "./types";

function activeAdminCount(ctx: AppContext): number {
  return (
    ctx.db
      .select({ c: count() })
      .from(users)
      .where(and(eq(users.role, "admin"), isNull(users.deactivatedAt)))
      .get()?.c ?? 0
  );
}

export function usersHandlers(
  ctx: AppContext,
): Pick<
  Handlers,
  | "users.list"
  | "users.create"
  | "users.get"
  | "users.update"
  | "users.deactivate"
  | "users.search"
> {
  return {
    "users.list": (c) => {
      const q = query<z.infer<typeof ListUsersQuerySchema>>(c);
      const rows = ctx.db
        .select()
        .from(users)
        .where(q.include_deactivated ? undefined : isNull(users.deactivatedAt))
        .orderBy(asc(users.createdAt), asc(users.id))
        .all();
      return c.json({ items: rows.map(userToApi) });
    },

    /** Mention/assignee autocomplete: active users whose name OR email contains `q`. */
    "users.search": (c) => {
      const q = query<z.infer<typeof MentionSearchQuerySchema>>(c);
      // Escape LIKE wildcards so a literal % or _ in the query matches itself.
      const escaped = q.q.replace(/[\\%_]/g, (m) => `\\${m}`);
      const pattern = `%${escaped}%`;
      const rows = ctx.db
        .select()
        .from(users)
        .where(
          and(
            isNull(users.deactivatedAt),
            sql`(${users.name} LIKE ${pattern} ESCAPE '\\' OR ${users.email} LIKE ${pattern} ESCAPE '\\')`,
          ),
        )
        // Stable: name first, id breaks ties.
        .orderBy(asc(users.name), asc(users.id))
        .limit(q.limit)
        .all();
      return c.json({ items: rows.map(userToApi) });
    },

    "users.create": async (c) => {
      const input = body<z.infer<typeof CreateUserInputSchema>>(c);
      const existing = ctx.db
        .select()
        .from(users)
        .where(eq(users.email, input.email))
        .get();
      if (existing)
        throw conflict(`a user with email ${input.email} already exists`);
      const t = now();
      const row: typeof users.$inferSelect = {
        id: newId(),
        email: input.email,
        name: input.name,
        // Agent accounts have no password: web login structurally refused, API keys only.
        passwordHash: input.is_agent
          ? null
          : await hashPassword(input.password!),
        role: input.role,
        isAgent: input.is_agent ? 1 : 0,
        deactivatedAt: null,
        createdAt: t,
        updatedAt: t,
      };
      ctx.db.insert(users).values(row).run();
      return c.json({ user: userToApi(row) });
    },

    "users.get": (c) => {
      const id = c.req.param("id") ?? "";
      const row = ctx.db.select().from(users).where(eq(users.id, id)).get();
      if (!row) throw notFound("user");
      return c.json({ user: userToApi(row) });
    },

    "users.update": async (c) => {
      const id = c.req.param("id") ?? "";
      const target = ctx.db.select().from(users).where(eq(users.id, id)).get();
      if (!target) throw notFound("user");
      const input = body<z.infer<typeof UpdateUserInputSchema>>(c);
      const updates: Partial<typeof users.$inferInsert> = { updatedAt: now() };
      if (input.name !== undefined) updates.name = input.name;
      if (input.role !== undefined && input.role !== target.role) {
        if (
          target.role === "admin" &&
          input.role === "member" &&
          target.deactivatedAt === null &&
          activeAdminCount(ctx) <= 1
        ) {
          throw conflict("cannot demote the last active admin");
        }
        updates.role = input.role;
      }
      if (input.password !== undefined) {
        if (target.isAgent || target.passwordHash === null) {
          throw conflict(
            "agent accounts are API-key-only and cannot have a password",
          );
        }
        updates.passwordHash = await hashPassword(input.password);
      }
      if (input.reactivate === true) updates.deactivatedAt = null;
      const updated = ctx.db
        .update(users)
        .set(updates)
        .where(eq(users.id, id))
        .returning()
        .get();
      if (input.password !== undefined) destroyUserSessions(ctx.db, id);
      return c.json({ user: userToApi(updated!) });
    },

    "users.deactivate": (c) => {
      const id = c.req.param("id") ?? "";
      const target = ctx.db.select().from(users).where(eq(users.id, id)).get();
      if (!target) throw notFound("user");
      // Idempotent: deactivating an already-deactivated user is a no-op.
      if (target.deactivatedAt !== null)
        return c.json({ user: userToApi(target) });
      if (target.role === "admin" && activeAdminCount(ctx) <= 1) {
        throw conflict("cannot deactivate the last active admin");
      }
      const t = now();
      ctx.db.transaction((tx) => {
        tx.update(users)
          .set({ deactivatedAt: t, updatedAt: t })
          .where(eq(users.id, id))
          .run();
        tx.delete(sessions).where(eq(sessions.userId, id)).run();
      });
      const updated = ctx.db.select().from(users).where(eq(users.id, id)).get();
      return c.json({ user: userToApi(updated!) });
    },
  };
}
