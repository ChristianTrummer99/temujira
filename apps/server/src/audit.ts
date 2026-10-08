import type { MiddlewareHandler } from "hono";
import { ROUTES, type RouteId } from "@temujira/shared";
import { auditContext, type ActivityRecord } from "./audit-context";
import { activityEvents } from "./db/schema";
import { newId, now } from "./util";
import type { AppContext, AppEnv, Ctx } from "./routes/types";

type MutationRoute = { [K in RouteId]: (typeof ROUTES)[K]["method"] extends "GET" ? never : K }[RouteId];

/** Exhaustive: adding a mutating API route requires an audit action at compile time. */
export const AUDIT_ACTIONS = {
  "setup.run": "instance.initialized",
  "auth.login": "auth.signed_in", "auth.logout": "auth.signed_out", "auth.updateMe": "profile.updated",
  "apiKeys.create": "api_key.created", "apiKeys.revoke": "api_key.revoked",
  "identitySessions.acquire": "identity.acquired", "identitySessions.release": "identity.released",
  "users.create": "user.created", "users.update": "user.updated", "users.deactivate": "user.deactivated",
  "workspaces.create": "workspace.created", "workspaces.update": "workspace.updated",
  "workspaces.delete": "workspace.deleted",
  "statuses.create": "status.created", "statuses.update": "status.updated", "statuses.delete": "status.deleted", "statuses.reorder": "statuses.reordered",
  "tags.create": "tag.created", "tags.update": "tag.updated", "tags.delete": "tag.deleted",
  "fields.create": "field.created", "fields.update": "field.updated", "fields.delete": "field.deleted", "fields.reorder": "fields.reordered",
  "tasks.create": "task.created", "tasks.update": "task.updated",
  "tasks.delete": "task.deleted",
  "tasks.bulkUpdate": "task.updated", "tasks.reorder": "task.reordered",
  "links.create": "task.linked", "links.delete": "task.unlinked",
  "comments.create": "comment.created", "comments.update": "comment.updated", "comments.delete": "comment.deleted",
  "attachments.uploadToTask": "attachment.uploaded", "attachments.uploadToComment": "attachment.uploaded", "attachments.delete": "attachment.deleted",
  "inbox.update": "inbox.read", "inbox.markRead": "inbox.read",
  "avatars.upload": "avatar.updated", "avatars.delete": "avatar.removed",
} as const satisfies Record<MutationRoute, string>;

type Row = Record<string, unknown>;
type Target = Omit<ActivityRecord, "actorId" | "action"> & { snapshot?: Row };
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const string = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;

/** Only a small allowlist of non-secret values can enter history; never serialize request/response bodies. */
function summary(row: Row): Row {
  const result: Row = {};
  for (const key of ["title", "name", "status_id", "assignee_id", "archived_at", "color", "position", "state", "deactivated_at", "exclusive_identity", "workspace_access_all"]) {
    if (row[key] !== undefined) result[key] = row[key];
  }
  for (const key of ["description", "body"]) {
    if (typeof row[key] === "string") result[`${key}_length`] = row[key].length;
  }
  if (row.status !== undefined) {
    result.status = string(row.status) ?? object(row.status).name ?? null;
    delete result.status_id;
  }
  if (row.assignee !== undefined) {
    result.assignee = string(row.assignee) ?? object(row.assignee).name ?? null;
    delete result.assignee_id;
  }
  return result;
}

/** Resolve indirect ids before deletion, so the history stays attached to the right ticket. */
function targets(ctx: AppContext, c: Ctx, route: MutationRoute, response: Row = {}): Target[] {
  const [group, verb] = route.split(".");
  const input = object(c.get("body"));
  const actor = c.get("user");
  const param = c.req.param("id") ?? c.req.param("userId");
  const ref = c.req.param("idOrKey");
  const one = (sql: string, ...args: unknown[]): Row => object(ctx.sqlite.prepare(sql).get(...args));
  const task = (id?: string): Target => {
    const row = id ? one(`SELECT t.*, w.key AS workspace_key, s.name AS status, u.name AS assignee
      FROM tasks t JOIN workspaces w ON w.id=t.workspace_id JOIN statuses s ON s.id=t.status_id
      LEFT JOIN users u ON u.id=t.assignee_id
      WHERE t.id=? OR w.key || '-' || t.number=?`, id, id) : {};
    return row.id ? { workspaceId: String(row.workspace_id), taskId: String(row.id), snapshot: summary(row) } : {};
  };
  const workspace = (id?: string): Target => {
    const row = id ? one("SELECT * FROM workspaces WHERE id=? OR key=?", id, id) : {};
    return row.id ? { workspaceId: String(row.id), snapshot: summary(row) } : {};
  };
  const entity = object(response[{ tasks: "task", comments: "comment", attachments: "attachment", workspaces: "workspace",
    users: "user", apiKeys: "apiKey", statuses: "status", fields: "field", tags: "tag", identitySessions: "session" }[group!] ?? ""]);
  const id = string(entity.id) ?? param;
  let row: Row = {};
  let result: Target[] = [];
  if (route === "tasks.bulkUpdate") result = (Array.isArray(input.task_ids) ? input.task_ids : []).map((id) => task(string(id)));
  else if (route === "tasks.reorder") result = [task(string(input.task_id))];
  else if (group === "tasks") result = [task(id ?? ref)];
  else if (group === "comments") {
    row = id ? one("SELECT * FROM comments WHERE id=?", id) : {};
    result = [task(string(row.task_id) ?? ref)];
    if (row.id) result[0]!.snapshot = summary(row);
  } else if (group === "attachments") {
    row = id ? one(`SELECT a.*, COALESCE(a.task_id,c.task_id) AS parent_task FROM attachments a
      LEFT JOIN comments c ON c.id=a.comment_id WHERE a.id=?`, id) : {};
    if (route === "attachments.uploadToComment" && !row.id) row = one("SELECT task_id AS parent_task FROM comments WHERE id=?", param);
    result = [task(string(row.parent_task) ?? ref)];
  } else if (group === "links") {
    row = id ? one("SELECT * FROM task_links WHERE id=?", id) : {};
    result = row.id ? [task(String(row.src_task_id)), task(String(row.dst_task_id))] : [task(ref), task(string(input.task))];
    if (result.length === 2) {
      result[0]!.relatedWorkspaceId = result[1]!.workspaceId;
      result[1]!.relatedWorkspaceId = result[0]!.workspaceId;
    }
  } else if (group === "workspaces") result = [workspace(id ?? ref)];
  else if (["statuses", "fields", "tags"].includes(group!)) {
    const table = group === "fields" ? "field_defs" : group!;
    row = id ? one(`SELECT * FROM ${table} WHERE id=?`, id) : {};
    result = [workspace(string(row.workspace_id) ?? ref)];
    if (row.id) result[0]!.snapshot = summary(row);
    if (verb === "delete" && row.id) {
      const query = group === "statuses" ? "SELECT id AS task_id FROM tasks WHERE status_id=?"
        : group === "fields" ? "SELECT task_id FROM field_values WHERE field_id=?" : "SELECT task_id FROM task_tags WHERE tag_id=?";
      const affected = ctx.sqlite.prepare(query).all(row.id) as Array<{ task_id: string }>;
      result.push(...affected.map((r) => task(r.task_id)));
    }
  } else if (group === "avatars") {
    result = [{ visibility: "private", ownerId: param }];
  } else if (group === "apiKeys") {
    row = id ? one("SELECT id,user_id,name FROM api_keys WHERE id=?", id) : {};
    result = [{ visibility: "private", ownerId: string(row.user_id) ?? string(input.user_id) ?? actor?.id }];
  } else if (group === "identitySessions") {
    result = [{ visibility: "private", ownerId: c.req.param("userId") }];
  } else if (group === "users") {
    row = id ? one("SELECT * FROM users WHERE id=?", id) : {};
    result = [{ visibility: "admin", snapshot: summary(row) }];
  } else {
    // Auth, self-profile, inbox and initial setup. Only that identity and admins see them.
    result = [{ visibility: "private", ownerId: actor?.id ?? string(object(response.user).id) }];
  }
  const label = string(row.filename) ?? string(row.name) ?? string(entity.filename) ?? string(entity.name);
  if (entity.id && result[0]) result[0].snapshot = summary(entity);
  return result.map((target) => ({
    ...target,
    metadata: { ...(id ? { target_id: id } : {}), ...(label ? { target_name: label } : {}) },
  }));
}

export function auditMutation(ctx: AppContext, routeId: RouteId): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (ROUTES[routeId].method === "GET") return next();
    const route = routeId as MutationRoute;
    const before = targets(ctx, c, route);
    const records: ActivityRecord[] = [];
    await auditContext.run(records, next);
    if (c.res.status >= 400) return;
    const response = object(await c.res.clone().json());
    const actorId = c.get("user")?.id ?? string(object(response.user).id);
    if (!actorId) throw new Error(`No actor for successful mutation ${route}`);
    const after = targets(ctx, c, route, response);
    const createsResource = route.endsWith('.create') || route.startsWith('attachments.upload') || route === 'identitySessions.acquire';
    const resolved = createsResource ? after : before.some((t) => t.workspaceId || t.snapshot) ? before : after;
    const input = object(c.get("body"));
    // Field names only, never arbitrary values (passwords, tokens, document bodies, etc.).
    const fields = Object.keys(input).filter((key) => !/password|token|secret/i.test(key));
    const metadata: Row = { route, ...(/update|setState|reorder/i.test(route) && fields.length ? { fields } : {}) };
    if ((route === "auth.updateMe" || route === "users.update") && Object.keys(input).some((key) => /password/.test(key))) metadata.password_changed = true;
    if (c.get("apiKeyId")) metadata.credential_id = c.get("apiKeyId");
    if (c.get("identitySession")) metadata.identity_session_id = c.get("identitySession")!.id;
    if (!records.length) {
      for (const target of resolved) records.push({
        ...target, actorId, action: AUDIT_ACTIONS[route], metadata: { ...target.metadata },
      });
    }
    // Both tickets need link history, including links within a single workspace.
    if (route.startsWith("links.")) {
      for (const target of resolved) {
        if (target.taskId && !records.some((r) => r.taskId === target.taskId)) {
          records.push({ ...target, actorId, action: AUDIT_ACTIONS[route], metadata: target.metadata });
        }
      }
    }
    ctx.db.transaction((tx) => {
      for (const record of records) {
        const target = resolved.find((t) => t.taskId === record.taskId) ?? resolved[0];
        const old = (before.find((t) => t.taskId === record.taskId) ?? before[0])?.snapshot ?? {};
        const current = (after.find((t) => t.taskId === record.taskId) ?? after[0])?.snapshot ?? {};
        const changes = Object.keys(current).filter((key) => old[key] !== undefined && old[key] !== current[key])
          .map((key) => ({ field: key, from: old[key], to: current[key] }));
        tx.insert(activityEvents).values({
          id: newId(), workspaceId: record.workspaceId ?? null, taskId: record.taskId ?? null,
          actorId: record.actorId, action: record.action,
          visibility: record.visibility ?? (record.workspaceId ? "workspace" : "admin"),
          ownerId: record.ownerId ?? null,
          relatedWorkspaceId: record.relatedWorkspaceId ?? target?.relatedWorkspaceId ?? null,
          metadata: JSON.stringify({ ...metadata, ...(changes.length ? { changes } : {}), ...record.metadata }), createdAt: now(),
        }).run();
      }
    });
  };
}
