import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { SCOPE_IDS, type ScopeId } from "@temujira/shared";
import type { Db } from "./db";
import { userWorkspaces } from "./db/schema";
import { forbidden, notFound } from "./errors";
import type { UserRow } from "./serialize";

const SCOPE_SET = new Set<string>(SCOPE_IDS);

/** Parses the JSON scopes column, dropping anything that isn't a known scope id. */
export function parseScopes(raw: string): ScopeId[] {
  try {
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((s): s is ScopeId => typeof s === "string" && SCOPE_SET.has(s));
  } catch {
    return [];
  }
}

/** The scopes a user effectively holds (admins implicitly hold all of them). */
export function userScopes(user: UserRow): ScopeId[] {
  return user.role === "admin" ? [...SCOPE_IDS] : parseScopes(user.scopes);
}

export function hasScope(user: UserRow, scope: ScopeId): boolean {
  return user.role === "admin" || parseScopes(user.scopes).includes(scope);
}

export function requireScope(user: UserRow, scope: ScopeId): void {
  if (!hasScope(user, scope)) throw forbidden(`missing scope: ${scope}`);
}

/**
 * Workspace ids the user may see. `null` means every workspace — true for admins and for
 * users with `workspace_access_all` (the default).
 */
export function accessibleWorkspaceIds(db: Db, user: UserRow): string[] | null {
  if (user.role === "admin" || user.workspaceAccessAll) return null;
  return db
    .select({ id: userWorkspaces.workspaceId })
    .from(userWorkspaces)
    .where(eq(userWorkspaces.userId, user.id))
    .all()
    .map((r) => r.id);
}

/** SQL condition restricting `column` to the user's accessible workspaces (undefined = all). */
export function workspaceScopeWhere(column: AnySQLiteColumn, ids: string[] | null): SQL | undefined {
  if (ids === null) return undefined;
  if (ids.length === 0) return sql`1 = 0`;
  return inArray(column, ids);
}

export function canAccessWorkspace(db: Db, user: UserRow, workspaceId: string): boolean {
  if (user.role === "admin" || user.workspaceAccessAll) return true;
  const row = db
    .select({ userId: userWorkspaces.userId })
    .from(userWorkspaces)
    .where(and(eq(userWorkspaces.userId, user.id), eq(userWorkspaces.workspaceId, workspaceId)))
    .get();
  return !!row;
}

/**
 * Throws 404 (not 403) when the workspace isn't accessible, so a scoped user cannot probe
 * for the existence of workspaces they can't see. `what` names the looked-up resource.
 */
export function assertWorkspaceAccess(
  db: Db,
  user: UserRow,
  workspaceId: string,
  what = "workspace"
): void {
  if (!canAccessWorkspace(db, user, workspaceId)) throw notFound(what);
}
