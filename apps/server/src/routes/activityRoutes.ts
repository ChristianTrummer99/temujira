import { and, count, desc, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import type { ListActivityQuerySchema, ListGlobalActivityQuerySchema } from "@temujira/shared";
import { accessibleWorkspaceIds, workspaceScopeWhere } from "../access";
import { activityEvents, taskAssociations, tasks, users, workspaces } from "../db/schema";
import { activityEventToApi, type UserRow } from "../serialize";
import { requireTask, requireWorkspace } from "./resolve";
import { currentUser, query, type AppContext, type Ctx, type Handlers } from "./types";

/** Apply the same visibility rule in global, workspace and ticket feeds, before pagination. */
function visibility(ctx: AppContext, user: UserRow): SQL | undefined {
  if (user.role === "admin") return undefined;
  const ids = accessibleWorkspaceIds(ctx.db, user);
  return and(
    or(
      and(eq(activityEvents.visibility, "workspace"), sql`${activityEvents.workspaceId} IS NOT NULL`),
      and(eq(activityEvents.visibility, "private"), eq(activityEvents.ownerId, user.id))
    ),
    or(isNull(activityEvents.workspaceId), workspaceScopeWhere(activityEvents.workspaceId, ids) ?? sql`1=1`),
    or(isNull(activityEvents.relatedWorkspaceId), workspaceScopeWhere(activityEvents.relatedWorkspaceId, ids) ?? sql`1=1`),
    // Legacy link events predate related_workspace_id. Do not leak the far end through metadata.
    sql`(json_extract(${activityEvents.metadata}, '$.other_task_id') IS NULL OR EXISTS (
      SELECT 1 FROM tasks linked WHERE linked.id = json_extract(${activityEvents.metadata}, '$.other_task_id')
      AND ${ids === null ? sql`1=1` : ids.length ? sql`linked.workspace_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})` : sql`0=1`}
    ))`,
  );
}

export function activityHandlers(ctx: AppContext): Pick<Handlers, "activity.list" | "activity.global" | "activity.task"> {
  function feed(c: Ctx, scope: "global" | "workspace" | "task") {
    const user = currentUser(c);
    const q = query<z.infer<typeof ListGlobalActivityQuerySchema>>(c);
    const conds: (SQL | undefined)[] = [visibility(ctx, user)];
    const workspaceRef = scope === "workspace" ? c.req.param("idOrKey") : q.workspace;
    const taskRef = scope === "task" ? c.req.param("idOrKey") : q.task;
    if (workspaceRef) conds.push(eq(activityEvents.workspaceId, requireWorkspace(ctx.db, workspaceRef, user).id));
    if (taskRef) conds.push(eq(activityEvents.taskId, requireTask(ctx.db, taskRef, user).task.id));
    if (q.actor_id) conds.push(eq(activityEvents.actorId, q.actor_id));
    if (q.action) conds.push(eq(activityEvents.action, q.action));
    if (q.mine) conds.push(sql`EXISTS (SELECT 1 FROM ${taskAssociations}
      WHERE ${taskAssociations.taskId}=${activityEvents.taskId} AND ${taskAssociations.userId}=${user.id})`);
    const where = and(...conds);
    const total = ctx.db.select({ n: count() }).from(activityEvents).where(where).get()!.n;
    const rows = ctx.db.select({ event: activityEvents, actor: users, task: tasks, workspaceKey: workspaces.key })
      .from(activityEvents).innerJoin(users, eq(activityEvents.actorId, users.id))
      .leftJoin(tasks, eq(activityEvents.taskId, tasks.id))
      .leftJoin(workspaces, eq(activityEvents.workspaceId, workspaces.id))
      .where(where).orderBy(desc(activityEvents.createdAt), sql`${activityEvents}.rowid DESC`)
      .limit(q.limit).offset(q.offset).all();
    const items = rows.map((r) => ({
      ...activityEventToApi(r.event, r.actor, r.task ? { key: `${r.workspaceKey}-${r.task.number}`, title: r.task.title } : null),
      workspace_key: r.workspaceKey,
    }));
    return scope === "workspace" ? c.json({ items }) : c.json({ items, total, limit: q.limit, offset: q.offset });
  }
  return {
    "activity.list": (c) => feed(c, "workspace"),
    "activity.global": (c) => feed(c, "global"),
    "activity.task": (c) => feed(c, "task"),
  };
}
