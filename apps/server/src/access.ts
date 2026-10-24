import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { SCOPE_IDS, type ScopeId } from "@temujira/shared";
import type { Db } from "./db";
import { userWorkspaces } from "./db/schema";
import { forbidden, notFound } from "./errors";
import type { UserRow } from "./serialize";

const SCOPE_SET = new Set<string>(SCOPE_IDS);

/** A user row plus optional API-key limits. Undefined = inherit the user's access. */
export type ScopedUser = UserRow & { keyScopes?: ScopeId[]; keyWorkspaceIds?: string[] };

/** Parses a key's scopes column: null inherits, [] denies every write scope. */
export function parseKeyScopes(raw: string | null): ScopeId[] | undefined {
  if (raw === null) return undefined;
  try {
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return [...new Set(arr.filter((s): s is ScopeId => typeof s === "string" && SCOPE_SET.has(s)))];
  } catch { return []; }
}

/** Parses a key's workspace allowlist: null inherits, [] denies every workspace. */
export function parseKeyWorkspaceIds(raw: string | null): string[] | undefined {
  if (raw === null) return undefined;
  try {
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return [...new Set(arr.filter((s): s is string => typeof s === "string"))];
  } catch { return []; }
}

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

/** The scopes a user effectively holds (admins implicitly hold all of them, then key limits apply). */
export function userScopes(user: ScopedUser): ScopeId[] {
  const held = user.role === "admin" ? [...SCOPE_IDS] : parseScopes(user.scopes);
  return user.keyScopes === undefined ? held : held.filter((s) => user.keyScopes!.includes(s));
}

export function hasScope(user: ScopedUser, scope: ScopeId): boolean {
  if (user.keyScopes !== undefined && !user.keyScopes.includes(scope)) return false;
  return user.role === "admin" || parseScopes(user.scopes).includes(scope);
}

export function requireScope(user: ScopedUser, scope: ScopeId): void {
  if (!hasScope(user, scope)) throw forbidden(`missing scope: ${scope}`);
}

/**
 * Workspace ids the user may see. `null` means every workspace — true for admins and for
 * users with `workspace_access_all` (the default). A scoped API key narrows this further.
 */
export function accessibleWorkspaceIds(db: Db, user: ScopedUser): string[] | null {
  let ids: string[] | null;
  if (user.role === "admin" || user.workspaceAccessAll) {
    ids = null;
  } else {
    ids = db
      .select({ id: userWorkspaces.workspaceId })
      .from(userWorkspaces)
      .where(eq(userWorkspaces.userId, user.id))
      .all()
      .map((r) => r.id);
  }
  if (user.keyWorkspaceIds === undefined) return ids;
  return ids === null ? [...user.keyWorkspaceIds] : ids.filter((id) => user.keyWorkspaceIds!.includes(id));
}

/** SQL condition restricting `column` to the user's accessible workspaces (undefined = all). */
export function workspaceScopeWhere(column: AnySQLiteColumn, ids: string[] | null): SQL | undefined {
  if (ids === null) return undefined;
  if (ids.length === 0) return sql`1 = 0`;
  return inArray(column, ids);
}

export function canAccessWorkspace(db: Db, user: ScopedUser, workspaceId: string): boolean {
  if (user.keyWorkspaceIds !== undefined && !user.keyWorkspaceIds.includes(workspaceId)) return false;
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
  user: ScopedUser,
  workspaceId: string,
  what = "workspace"
): void {
  if (!canAccessWorkspace(db, user, workspaceId)) throw notFound(what);
}
