import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import type { z } from "zod";
import type {
  CreateUserInputSchema,
  ListUsersQuerySchema,
  MentionSearchQuerySchema,
  UpdateUserInputSchema,
} from "@temujira/shared";
import type { ScopeId } from "@temujira/shared";
import { accessibleWorkspaceIds, hasScope, userScopes } from "../access";
import { hashPassword, destroyUserSessions } from "../auth";
import type { Db } from "../db";
import { sessions, userWorkspaces, users, workspaces } from "../db/schema";
import { conflict, forbidden, notFound, validationError } from "../errors";
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

function workspaceIdsFor(db: Db, userId: string): string[] {
  return db
    .select({ id: userWorkspaces.workspaceId })
    .from(userWorkspaces)
    .where(eq(userWorkspaces.userId, userId))
    .all()
    .map((r) => r.id);
}

/** One query for a page of users; only called for viewers who may see access config. */
function workspaceIdsByUser(db: Db, userIds: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (userIds.length === 0) return map;
  const rows = db
    .select()
    .from(userWorkspaces)
    .where(inArray(userWorkspaces.userId, userIds))
    .all();
  for (const r of rows) {
    const list = map.get(r.userId) ?? [];
    list.push(r.workspaceId);
    map.set(r.userId, list);
  }
  return map;
}

/** Rejects workspace ids that don't exist (FK would otherwise 500). */
function assertWorkspacesExist(db: Db, ids: string[]): void {
  if (ids.length === 0) return;
  const found = db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(inArray(workspaces.id, ids))
    .all()
    .map((r) => r.id);
  const known = new Set(found);
  const missing = ids.filter((id) => !known.has(id));
  if (missing.length > 0) throw validationError(`unknown workspace: ${missing.join(", ")}`);
}

/**
 * Privilege-escalation guard for non-admin actors holding `users:manage`: they may only
 * grant scopes they themselves hold, may not create/change admin roles, may not touch
 * admin accounts, and may only grant workspace access they themselves have.
 */
function assertNoEscalation(
  db: Db,
  actor: typeof users.$inferSelect,
  target: typeof users.$inferSelect | null,
  input: { role?: unknown; scopes?: ScopeId[]; workspace_access_all?: boolean; workspace_ids?: string[] },
  mode: "create" | "update"
): void {
  if (actor.role === "admin") return;
  if (target && target.role === "admin")
    throw forbidden("only admins can modify admin accounts");
  if (mode === "create") {
    // CreateUserInputSchema defaults role to "member", so only the admin value is gated.
    if (input.role === "admin") throw forbidden("only admins can create admin accounts");
  } else if (input.role !== undefined) {
    throw forbidden("only admins can change roles");
  }
  if (input.scopes !== undefined) {
    const held = new Set(userScopes(actor));
    const missing = input.scopes.filter((s) => !held.has(s));
    if (missing.length > 0) throw forbidden(`cannot grant scopes you don't hold: ${missing.join(", ")}`);
  }
  const accessible = accessibleWorkspaceIds(db, actor);
  if (input.workspace_access_all === true && accessible !== null)
    throw forbidden("only admins can grant access to all workspaces");
  if (input.workspace_ids !== undefined && accessible !== null) {
    const allowed = new Set(accessible);
    const outside = input.workspace_ids.filter((id) => !allowed.has(id));
    if (outside.length > 0) throw forbidden("cannot grant workspaces you don't have access to");
  }
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
      const viewer = currentUser(c);
      const rows = ctx.db
        .select()
        .from(users)
        .where(q.include_deactivated ? undefined : isNull(users.deactivatedAt))
        .orderBy(asc(users.createdAt), asc(users.id))
        .all();
      const ids = hasScope(viewer, "users:manage")
        ? workspaceIdsByUser(ctx.db, rows.map((u) => u.id))
        : null;
      return c.json({ items: rows.map((u) => userToApi(u, ids?.get(u.id) ?? [])) });
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
      return c.json({ items: rows.map((u) => userToApi(u)) });
    },

    "users.create": async (c) => {
      const input = body<z.infer<typeof CreateUserInputSchema>>(c);
      const actor = currentUser(c);
      assertNoEscalation(ctx.db, actor, null, input, "create");
      assertWorkspacesExist(ctx.db, input.workspace_ids);
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
        scopes: JSON.stringify(input.scopes),
        workspaceAccessAll: input.workspace_access_all ? 1 : 0,
        isAgent: input.is_agent ? 1 : 0,
        deactivatedAt: null,
        createdAt: t,
        updatedAt: t,
      };
      ctx.db.transaction((tx) => {
        tx.insert(users).values(row).run();
        for (const workspaceId of input.workspace_ids) {
          tx.insert(userWorkspaces).values({ userId: row.id, workspaceId }).run();
        }
      });
      return c.json({ user: userToApi(row, input.workspace_ids) });
    },

    "users.get": (c) => {
      const id = c.req.param("id") ?? "";
      const row = ctx.db.select().from(users).where(eq(users.id, id)).get();
      if (!row) throw notFound("user");
      const viewer = currentUser(c);
      const ids = hasScope(viewer, "users:manage") ? workspaceIdsFor(ctx.db, id) : [];
      return c.json({ user: userToApi(row, ids) });
    },

    "users.update": async (c) => {
      const id = c.req.param("id") ?? "";
      const actor = currentUser(c);
      const target = ctx.db.select().from(users).where(eq(users.id, id)).get();
      if (!target) throw notFound("user");
      const input = body<z.infer<typeof UpdateUserInputSchema>>(c);
      assertNoEscalation(ctx.db, actor, target, input, "update");
      if (input.workspace_ids !== undefined) assertWorkspacesExist(ctx.db, input.workspace_ids);
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
      if (input.scopes !== undefined) updates.scopes = JSON.stringify(input.scopes);
      if (input.workspace_access_all !== undefined)
        updates.workspaceAccessAll = input.workspace_access_all ? 1 : 0;
      if (input.password !== undefined) {
        if (target.isAgent || target.passwordHash === null) {
          throw conflict(
            "agent accounts are API-key-only and cannot have a password",
          );
        }
        updates.passwordHash = await hashPassword(input.password);
      }
      if (input.reactivate === true) updates.deactivatedAt = null;
      const updated = ctx.db.transaction((tx) => {
        const row = tx
          .update(users)
          .set(updates)
          .where(eq(users.id, id))
          .returning()
          .get();
        if (input.workspace_ids !== undefined) {
          tx.delete(userWorkspaces).where(eq(userWorkspaces.userId, id)).run();
          for (const workspaceId of input.workspace_ids) {
            tx.insert(userWorkspaces).values({ userId: id, workspaceId }).run();
          }
        }
        return row;
      });
      if (input.password !== undefined) destroyUserSessions(ctx.db, id);
      const ids = input.workspace_ids ?? workspaceIdsFor(ctx.db, id);
      return c.json({ user: userToApi(updated!, ids) });
    },

    "users.deactivate": (c) => {
      const id = c.req.param("id") ?? "";
      const actor = currentUser(c);
      const target = ctx.db.select().from(users).where(eq(users.id, id)).get();
      if (!target) throw notFound("user");
      if (actor.role !== "admin" && target.role === "admin")
        throw forbidden("only admins can modify admin accounts");
      // Idempotent: deactivating an already-deactivated user is a no-op.
      if (target.deactivatedAt !== null)
        return c.json({ user: userToApi(target, workspaceIdsFor(ctx.db, id)) });
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
      return c.json({ user: userToApi(updated!, workspaceIdsFor(ctx.db, id)) });
    },
  };
}
