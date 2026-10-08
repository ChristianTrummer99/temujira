import { eq } from "drizzle-orm";
import { tasks } from "../db/schema";
import type { TaskRow } from "../serialize";
import { recordActivity } from "./engagement";
import { requireTask, requireWorkspace } from "./resolve";
import { currentUser, type AppContext, type Handlers } from "./types";

/** Called inside the deletion transaction. Return file IDs to unlink after commit.
 * Subqueries avoid parameter limits for tickets with many comments/attachments. */
function removeTask(ctx: AppContext, task: TaskRow, workspaceKey: string): string[] {
  const db = ctx.sqlite;
  const files = db.prepare(`SELECT id FROM attachments WHERE task_id=? OR comment_id IN
    (SELECT id FROM comments WHERE task_id=?)`).all(task.id, task.id) as Array<{ id: string }>;
  db.prepare(`UPDATE activity_events SET task_id=NULL, metadata=json_set(metadata,
    '$.deleted_task_id', ?, '$.deleted_task_key', ?, '$.deleted_task_title', ?) WHERE task_id=?`)
    .run(task.id, `${workspaceKey}-${task.number}`, task.title, task.id);
  db.prepare("DELETE FROM inbox_items WHERE task_id=?").run(task.id); // cascades inbox_events
  db.prepare("DELETE FROM mentions WHERE task_id=?").run(task.id);
  db.prepare("DELETE FROM attachments WHERE task_id=? OR comment_id IN (SELECT id FROM comments WHERE task_id=?)").run(task.id, task.id);
  db.prepare("DELETE FROM comments WHERE task_id=? AND parent_id IS NOT NULL").run(task.id);
  db.prepare("DELETE FROM comments WHERE task_id=?").run(task.id);
  db.prepare("DELETE FROM task_links WHERE src_task_id=? OR dst_task_id=?").run(task.id, task.id);
  for (const table of ["task_tags", "field_values", "task_associations", "queue_entries"]) {
    db.prepare(`DELETE FROM ${table} WHERE task_id=?`).run(task.id);
  }
  db.prepare("DELETE FROM tasks WHERE id=?").run(task.id);
  return files.map((file) => file.id);
}

export function deleteHandlers(ctx: AppContext): Pick<Handlers, "tasks.delete" | "workspaces.delete"> {
  return {
    "tasks.delete": (c) => {
      const actor = currentUser(c);
      const { task, workspace } = requireTask(ctx.db, c.req.param("idOrKey") ?? "", actor);
      const files = ctx.db.transaction(() => removeTask(ctx, task, workspace.key));
      for (const id of files) ctx.storage.delete(id);
      recordActivity(ctx.db, {
        workspaceId: workspace.id, actorId: actor.id, action: "task.deleted",
        metadata: { deleted_task_id: task.id, deleted_task_key: `${workspace.key}-${task.number}`, deleted_task_title: task.title, files_removed: files.length },
      });
      return c.json({ ok: true as const });
    },
    "workspaces.delete": (c) => {
      const actor = currentUser(c);
      const workspace = requireWorkspace(ctx.db, c.req.param("idOrKey") ?? "", actor);
      const children = ctx.db.select().from(tasks).where(eq(tasks.workspaceId, workspace.id)).all();
      const files = ctx.db.transaction(() => {
        const removed = children.flatMap((task) => removeTask(ctx, task, workspace.key));
        const db = ctx.sqlite;
        db.prepare("DELETE FROM field_values WHERE field_id IN (SELECT id FROM field_defs WHERE workspace_id=?)").run(workspace.id);
        db.prepare("DELETE FROM task_tags WHERE tag_id IN (SELECT id FROM tags WHERE workspace_id=?)").run(workspace.id);
        for (const table of ["field_defs", "tags", "statuses", "inbox_items", "user_workspaces"]) {
          db.prepare(`DELETE FROM ${table} WHERE workspace_id=?`).run(workspace.id);
        }
        // Deleted workspace membership cannot be checked after removing its grants.
        // Preserve history as admin-only, including cross-workspace link history.
        db.prepare(`UPDATE activity_events SET related_workspace_id=NULL, visibility='admin',
          metadata=json_set(metadata, '$.deleted_related_workspace_key', ?) WHERE related_workspace_id=?`)
          .run(workspace.key, workspace.id);
        db.prepare(`UPDATE activity_events SET workspace_id=NULL, visibility='admin',
          metadata=json_set(metadata, '$.deleted_workspace_key', ?, '$.deleted_workspace_name', ?) WHERE workspace_id=?`)
          .run(workspace.key, workspace.name, workspace.id);
        db.prepare("DELETE FROM workspaces WHERE id=?").run(workspace.id);
        return removed;
      });
      for (const id of files) ctx.storage.delete(id);
      recordActivity(ctx.db, {
        actorId: actor.id, action: "workspace.deleted", visibility: "admin",
        metadata: { target_id: workspace.id, target_name: workspace.name, deleted_workspace_key: workspace.key, tasks_removed: children.length, files_removed: files.length },
      });
      return c.json({ ok: true as const });
    },
  };
}
