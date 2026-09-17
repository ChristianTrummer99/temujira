import { and, eq } from "drizzle-orm";
import { assertWorkspaceAccess } from "../access";
import type { Db } from "../db";
import { tasks, workspaces } from "../db/schema";
import { notFound } from "../errors";
import type { TaskRow, UserRow, WorkspaceRow } from "../serialize";
import { TASK_KEY_RE, ULID_RE, WORKSPACE_KEY_RE } from "../util";

/** Resolve a workspace by ULID or by its uppercase key (e.g. "TEM"). */
export function findWorkspace(db: Db, idOrKey: string): WorkspaceRow | undefined {
  if (ULID_RE.test(idOrKey)) {
    return db.select().from(workspaces).where(eq(workspaces.id, idOrKey)).get();
  }
  if (WORKSPACE_KEY_RE.test(idOrKey)) {
    return db.select().from(workspaces).where(eq(workspaces.key, idOrKey)).get();
  }
  return undefined;
}

/** When `user` is given, inaccessible workspaces 404 so scoped users can't probe for them. */
export function requireWorkspace(db: Db, idOrKey: string, user?: UserRow): WorkspaceRow {
  const ws = findWorkspace(db, idOrKey);
  if (!ws) throw notFound("workspace");
  if (user) assertWorkspaceAccess(db, user, ws.id);
  return ws;
}

/** Assert access to the workspace a task belongs to, given only the task id. */
export function assertTaskIdAccess(db: Db, user: UserRow, taskId: string): void {
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) throw notFound("task");
  assertWorkspaceAccess(db, user, task.workspaceId, "task");
}

/** Resolve a task by ULID or by its display key (e.g. "TEM-42"). */
export function requireTask(
  db: Db,
  idOrKey: string,
  user?: UserRow
): { task: TaskRow; workspace: WorkspaceRow } {
  if (ULID_RE.test(idOrKey)) {
    const task = db.select().from(tasks).where(eq(tasks.id, idOrKey)).get();
    if (!task) throw notFound("task");
    const workspace = db.select().from(workspaces).where(eq(workspaces.id, task.workspaceId)).get();
    if (!workspace) throw notFound("task"); // FK guarantees this never happens
    if (user) assertWorkspaceAccess(db, user, workspace.id, "task");
    return { task, workspace };
  }
  const m = TASK_KEY_RE.exec(idOrKey);
  if (!m) throw notFound("task");
  const workspace = db.select().from(workspaces).where(eq(workspaces.key, m[1]!)).get();
  if (!workspace) throw notFound("task");
  const task = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.workspaceId, workspace.id), eq(tasks.number, Number(m[2]!))))
    .get();
  if (!task) throw notFound("task");
  if (user) assertWorkspaceAccess(db, user, workspace.id, "task");
  return { task, workspace };
}
