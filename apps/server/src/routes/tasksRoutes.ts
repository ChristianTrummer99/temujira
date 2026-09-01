import { and, asc, count, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import type {
  CreateTaskInputSchema,
  ListMyTasksQuerySchema,
  ListTasksQuerySchema,
  UpdateTaskInputSchema,
} from "@temujira/shared";
import type { Db } from "../db";
import {
  attachments,
  fieldDefs,
  fieldValues as fieldValuesTable,
  statuses,
  tags,
  taskAssociations,
  taskTags,
  tasks,
  users,
  workspaces,
} from "../db/schema";
import { conflict, validationError } from "../errors";
import {
  asStringArray,
  taskToApi,
  type FieldDefRow,
  type StatusRow,
  type TagRow,
  type TaskRow,
  type UserRow,
} from "../serialize";
import { newId, now } from "../util";
import { associate, recordActivity } from "./engagement";
import { loadLinksForTask } from "./linksRoutes";
import { requireTask, requireWorkspace } from "./resolve";
import { body, currentUser, query, type AppContext, type Handlers } from "./types";

const SORT_COLUMNS = {
  created_at: tasks.createdAt,
  updated_at: tasks.updatedAt,
  number: tasks.number,
  title: tasks.title,
} as const;

/** Assignees must exist and not be deactivated. */
function requireActiveAssignee(db: Db, id: string): UserRow {
  const u = db.select().from(users).where(eq(users.id, id)).get();
  if (!u) throw validationError("assignee_id must reference an existing user");
  if (u.deactivatedAt !== null) throw validationError("assignee_id must reference an active (non-deactivated) user");
  return u;
}

function statusOfWorkspace(db: Db, statusId: string, workspaceId: string): StatusRow {
  const st = db.select().from(statuses).where(eq(statuses.id, statusId)).get();
  if (!st || st.workspaceId !== workspaceId) {
    throw validationError("status_id must be a status of this workspace");
  }
  return st;
}

/** Tag rows per task id (one query), name-ordered so embedded `tags` is stable. */
export function loadTagsForTasks(db: Db, taskIds: string[]): Map<string, TagRow[]> {
  const byTask = new Map<string, TagRow[]>();
  if (taskIds.length === 0) return byTask;
  const rows = db
    .select({ taskId: taskTags.taskId, tag: tags })
    .from(taskTags)
    .innerJoin(tags, eq(taskTags.tagId, tags.id))
    .where(inArray(taskTags.taskId, [...new Set(taskIds)]))
    .orderBy(asc(tags.name), asc(tags.id))
    .all();
  for (const r of rows) {
    const list = byTask.get(r.taskId) ?? [];
    list.push(r.tag);
    byTask.set(r.taskId, list);
  }
  return byTask;
}

/** Every tag_id must be a tag of the task's own workspace. Returns the deduped id list. */
function validateTagIds(db: Db, workspaceId: string, tagIds: string[]): string[] {
  const unique = [...new Set(tagIds)];
  if (unique.length === 0) return unique;
  const rows = db.select().from(tags).where(inArray(tags.id, unique)).all();
  const ok = new Set(rows.filter((t) => t.workspaceId === workspaceId).map((t) => t.id));
  if (ok.size !== unique.length) {
    throw validationError("tag_ids must all reference tags of this task's workspace");
  }
  return unique;
}

/** Field id → value per task (one query for a whole batch). */
export function loadFieldValuesForTasks(db: Db, taskIds: string[]): Map<string, Record<string, string>> {
  const byTask = new Map<string, Record<string, string>>();
  if (taskIds.length === 0) return byTask;
  const rows = db.select().from(fieldValuesTable).where(inArray(fieldValuesTable.taskId, [...new Set(taskIds)])).all();
  for (const r of rows) {
    const map = byTask.get(r.taskId) ?? {};
    map[r.fieldId] = r.value;
    byTask.set(r.taskId, map);
  }
  return byTask;
}

/**
 * Validate + normalize a task's incoming `field_values`. Empty-string values are dropped
 * (the caller deletes those cells); remaining values are checked per def type: select
 * must be one of the def's options, number must parse numerically.
 */
function validateFieldValues(db: Db, workspaceId: string, fieldValues: Record<string, string>): Record<string, string> {
  const defs = db.select().from(fieldDefs).where(eq(fieldDefs.workspaceId, workspaceId)).all();
  const byId = new Map(defs.map((f) => [f.id, f]));
  const result: Record<string, string> = {};
  for (const [fieldId, rawValue] of Object.entries(fieldValues)) {
    const def = byId.get(fieldId);
    if (!def) throw validationError(`field_values references an unknown field: ${fieldId}`);
    if (rawValue === "") continue;
    if (def.type === "select") {
      if (!new Set(asStringArray(def.options)).has(rawValue)) {
        throw validationError(`"${rawValue}" is not an allowed value for field "${def.name}"`);
      }
      result[fieldId] = rawValue;
    } else if (def.type === "number") {
      if (!/^-?\d+(\.\d+)?$/.test(rawValue.trim())) {
        throw validationError(`"${rawValue}" is not a valid number for field "${def.name}"`);
      }
      result[fieldId] = rawValue.trim();
    } else {
      result[fieldId] = rawValue.trim();
    }
  }
  return result;
}

/** Write a task's non-empty field values (upsert on the unique task+field pair). */
function upsertFieldValues(tx: Db, taskId: string, fieldValues: Record<string, string>, by: string, t: number): void {
  for (const [fieldId, value] of Object.entries(fieldValues)) {
    tx.insert(fieldValuesTable)
      .values({ id: newId(), taskId, fieldId, value, createdBy: by, createdAt: t, updatedAt: t })
      .onConflictDoUpdate({
        target: [fieldValuesTable.taskId, fieldValuesTable.fieldId],
        set: { value, updatedAt: t },
      })
      .run();
  }
}

/** Delete the cleared (empty-string) cells for a task. */
function deleteClearedFieldValues(tx: Db, taskId: string, fieldValues: Record<string, string>): void {
  for (const fieldId of Object.keys(fieldValues)) {
    tx.delete(fieldValuesTable)
      .where(and(eq(fieldValuesTable.taskId, taskId), eq(fieldValuesTable.fieldId, fieldId)))
      .run();
  }
}

function sameRecord(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => a[k] === b[k]);
}

export function tasksHandlers(
  ctx: AppContext,
): Pick<Handlers, "tasks.list" | "tasks.mine" | "tasks.create" | "tasks.get" | "tasks.update"> {
  return {
    "tasks.list": (c) => {
      const ws = requireWorkspace(ctx.db, c.req.param("idOrKey") ?? "");
      const q = query<z.infer<typeof ListTasksQuerySchema>>(c);
      const conds: (SQL | undefined)[] = [eq(tasks.workspaceId, ws.id)];
      if (!q.include_archived) conds.push(isNull(tasks.archivedAt));
      if (q.status_id !== undefined) conds.push(eq(tasks.statusId, q.status_id));
      if (q.assignee_id !== undefined) conds.push(eq(tasks.assigneeId, q.assignee_id));
      if (q.tag_id !== undefined) {
        // Semi-join: keeps `total` honest and never duplicates a task row.
        conds.push(
          sql`EXISTS (SELECT 1 FROM ${taskTags} WHERE ${taskTags.taskId} = ${tasks.id} AND ${taskTags.tagId} = ${q.tag_id})`,
        );
      }
      if (q.field_id !== undefined) {
        // Custom-field filter (FR-34): field_id alone = "has any value"; plus field_value = exact option.
        conds.push(
          q.field_value !== undefined
            ? sql`EXISTS (SELECT 1 FROM ${fieldValuesTable} WHERE ${fieldValuesTable.taskId} = ${tasks.id} AND ${fieldValuesTable.fieldId} = ${q.field_id} AND ${fieldValuesTable.value} = ${q.field_value})`
            : sql`EXISTS (SELECT 1 FROM ${fieldValuesTable} WHERE ${fieldValuesTable.taskId} = ${tasks.id} AND ${fieldValuesTable.fieldId} = ${q.field_id})`,
        );
      }
      if (q.q !== undefined && q.q !== "") {
        // Case-insensitive substring match; escape LIKE wildcards so they match literally.
        const escaped = q.q.replace(/[\\%_]/g, (m) => `\\${m}`);
        conds.push(sql`${tasks.title} LIKE ${`%${escaped}%`} ESCAPE '\\'`);
      }
      const where = and(...conds);
      const total = ctx.db.select({ c: count() }).from(tasks).where(where).get()?.c ?? 0;
      const dir = q.order === "asc" ? asc : desc;
      const rows = ctx.db
        .select({ task: tasks, status: statuses, assignee: users })
        .from(tasks)
        .innerJoin(statuses, eq(tasks.statusId, statuses.id))
        .leftJoin(users, eq(tasks.assigneeId, users.id))
        .where(where)
        // Secondary sort on number (unique per workspace) keeps ordering deterministic.
        .orderBy(dir(SORT_COLUMNS[q.sort]), dir(tasks.number))
        .limit(q.limit)
        .offset(q.offset)
        .all();
      // group_by is a presentational hint for the client; the server always returns a flat list.
      const tagsByTask = loadTagsForTasks(ctx.db, rows.map((r) => r.task.id));
      const fieldByTask = loadFieldValuesForTasks(ctx.db, rows.map((r) => r.task.id));
      return c.json({
        items: rows.map((r) =>
          taskToApi(
            r.task,
            ws.key,
            r.status,
            r.assignee,
            tagsByTask.get(r.task.id) ?? [],
            undefined,
            undefined,
            fieldByTask.get(r.task.id),
          ),
        ),
        total,
        limit: q.limit,
        offset: q.offset,
      });
    },

    /** Tasks the current user is associated with (created / assigned / commented / mentioned). */
    "tasks.mine": (c) => {
      const user = currentUser(c);
      const q = query<z.infer<typeof ListMyTasksQuerySchema>>(c);
      // Archived tasks stay out of "my tasks", matching tasks.list's default.
      const where = and(eq(taskAssociations.userId, user.id), isNull(tasks.archivedAt));
      const total =
        ctx.db
          .select({ c: count() })
          .from(taskAssociations)
          .innerJoin(tasks, eq(taskAssociations.taskId, tasks.id))
          .where(where)
          .get()?.c ?? 0;
      const rows = ctx.db
        .select({ task: tasks, status: statuses, assignee: users, workspace: workspaces })
        .from(taskAssociations)
        .innerJoin(tasks, eq(taskAssociations.taskId, tasks.id))
        .innerJoin(workspaces, eq(tasks.workspaceId, workspaces.id))
        .innerJoin(statuses, eq(tasks.statusId, statuses.id))
        .leftJoin(users, eq(tasks.assigneeId, users.id))
        .where(where)
        // Newest association first; task creation time breaks ties deterministically.
        .orderBy(desc(taskAssociations.associatedAt), desc(tasks.createdAt))
        .limit(q.limit)
        .offset(q.offset)
        .all();
      const tagsByTask = loadTagsForTasks(ctx.db, rows.map((r) => r.task.id));
      const fieldByTask = loadFieldValuesForTasks(ctx.db, rows.map((r) => r.task.id));
      return c.json({
        items: rows.map((r) =>
          taskToApi(
            r.task,
            r.workspace.key,
            r.status,
            r.assignee,
            tagsByTask.get(r.task.id) ?? [],
            undefined,
            undefined,
            fieldByTask.get(r.task.id),
          ),
        ),
        total,
        limit: q.limit,
        offset: q.offset,
      });
    },

    "tasks.create": (c) => {
      const user = currentUser(c);
      const ws = requireWorkspace(ctx.db, c.req.param("idOrKey") ?? "");
      const input = body<z.infer<typeof CreateTaskInputSchema>>(c);
      let status: StatusRow;
      if (input.status_id !== undefined) {
        status = statusOfWorkspace(ctx.db, input.status_id, ws.id);
      } else {
        const first = ctx.db
          .select()
          .from(statuses)
          .where(eq(statuses.workspaceId, ws.id))
          .orderBy(asc(statuses.position))
          .limit(1)
          .get();
        if (!first) throw conflict("workspace has no statuses"); // unreachable by invariant
        status = first;
      }
      const assignee = input.assignee_id != null ? requireActiveAssignee(ctx.db, input.assignee_id) : null;
      const tagIds = input.tag_ids !== undefined ? validateTagIds(ctx.db, ws.id, input.tag_ids) : [];
      const fieldValues = input.field_values !== undefined ? validateFieldValues(ctx.db, ws.id, input.field_values) : {};
      // Allocate the task number atomically: read next_task_number, bump it, and insert
      // inside one synchronous transaction so bursts of creates never collide.
      const row = ctx.db.transaction((tx): TaskRow => {
        const fresh = tx.select().from(workspaces).where(eq(workspaces.id, ws.id)).get()!;
        const number = fresh.nextTaskNumber;
        tx.update(workspaces).set({ nextTaskNumber: number + 1 }).where(eq(workspaces.id, ws.id)).run();
        const t = now();
        const taskRow: TaskRow = {
          id: newId(),
          workspaceId: ws.id,
          number,
          title: input.title,
          description: input.description,
          statusId: status.id,
          assigneeId: assignee?.id ?? null,
          createdBy: user.id,
          archivedAt: null,
          createdAt: t,
          updatedAt: t,
        };
        tx.insert(tasks).values(taskRow).run();
        for (const tagId of tagIds) tx.insert(taskTags).values({ taskId: taskRow.id, tagId }).run();
        upsertFieldValues(tx, taskRow.id, fieldValues, user.id, t);
        return taskRow;
      });
      // The creator (and any initial assignee) follow the task from birth.
      associate(ctx.db, row.id, [...new Set([user.id, ...(assignee ? [assignee.id] : [])])], row.createdAt);
      recordActivity(ctx.db, {
        workspaceId: ws.id,
        taskId: row.id,
        actorId: user.id,
        action: "task.created",
        metadata: { title: row.title, ...(assignee ? { assignee_id: assignee.id } : {}) },
      });
      const tagRows = loadTagsForTasks(ctx.db, [row.id]).get(row.id) ?? [];
      return c.json({ task: taskToApi(row, ws.key, status, assignee, tagRows, undefined, undefined, fieldValues) });
    },

    "tasks.get": (c) => {
      const { task, workspace } = requireTask(ctx.db, c.req.param("idOrKey") ?? "");
      const status = ctx.db.select().from(statuses).where(eq(statuses.id, task.statusId)).get()!;
      const assignee = task.assigneeId
        ? (ctx.db.select().from(users).where(eq(users.id, task.assigneeId)).get() ?? null)
        : null;
      const attachmentRows = ctx.db
        .select()
        .from(attachments)
        .where(eq(attachments.taskId, task.id))
        .orderBy(asc(attachments.createdAt), asc(attachments.id))
        .all();
      const tagRows = loadTagsForTasks(ctx.db, [task.id]).get(task.id) ?? [];
      // Links are embedded on tasks.get only (attachments precedent): list/mine/create/update
      // stay a single query per task.
      const links = loadLinksForTask(ctx.db, task.id);
      const fieldValues = loadFieldValuesForTasks(ctx.db, [task.id]).get(task.id);
      return c.json({
        task: taskToApi(task, workspace.key, status, assignee, tagRows, attachmentRows, links, fieldValues),
      });
    },

    "tasks.update": (c) => {
      const user = currentUser(c);
      const { task, workspace } = requireTask(ctx.db, c.req.param("idOrKey") ?? "");
      const input = body<z.infer<typeof UpdateTaskInputSchema>>(c);
      const t = now();
      const updates: Partial<typeof tasks.$inferInsert> = { updatedAt: t };
      const changed: string[] = [];
      if (input.title !== undefined) {
        updates.title = input.title;
        if (input.title !== task.title) changed.push("title");
      }
      if (input.description !== undefined) {
        updates.description = input.description;
        if (input.description !== task.description) changed.push("description");
      }
      if (input.status_id !== undefined) {
        updates.statusId = statusOfWorkspace(ctx.db, input.status_id, task.workspaceId).id;
        if (updates.statusId !== task.statusId) changed.push("status");
      }
      let newAssignee: UserRow | null = null;
      let assigneeChanged = false;
      if (input.assignee_id !== undefined) {
        newAssignee = input.assignee_id === null ? null : requireActiveAssignee(ctx.db, input.assignee_id);
        updates.assigneeId = newAssignee?.id ?? null;
        assigneeChanged = (newAssignee?.id ?? null) !== task.assigneeId;
      }
      if (input.archived === true && task.archivedAt === null) {
        updates.archivedAt = t;
        changed.push("archived");
      }
      if (input.archived === false) {
        updates.archivedAt = null;
        if (task.archivedAt !== null) changed.push("archived");
      }
      let tagIds: string[] | undefined;
      if (input.tag_ids !== undefined) {
        tagIds = validateTagIds(ctx.db, task.workspaceId, input.tag_ids);
        const current = new Set((loadTagsForTasks(ctx.db, [task.id]).get(task.id) ?? []).map((r) => r.id));
        const next = new Set(tagIds);
        if (current.size !== next.size || [...next].some((id) => !current.has(id))) changed.push("tags");
      }
      // Custom field values: only present keys are touched; "" clears the cell.
      let fieldValuesIn: Record<string, string> | undefined;
      if (input.field_values !== undefined) {
        const normalized = validateFieldValues(ctx.db, task.workspaceId, input.field_values);
        fieldValuesIn = normalized;
        const before = loadFieldValuesForTasks(ctx.db, [task.id]).get(task.id) ?? {};
        const after: Record<string, string> = { ...before };
        for (const [fieldId, value] of Object.entries(normalized)) after[fieldId] = value;
        for (const fieldId of Object.keys(input.field_values)) {
          if (input.field_values[fieldId] === "") delete after[fieldId];
        }
        if (!sameRecord(before, after)) changed.push("field_value");
      }

      const updated = ctx.db.transaction((tx): TaskRow => {
        const row = tx.update(tasks).set(updates).where(eq(tasks.id, task.id)).returning().get()!;
        if (tagIds !== undefined) {
          // Full replacement of the task's tag set.
          tx.delete(taskTags).where(eq(taskTags.taskId, task.id)).run();
          for (const tagId of tagIds) tx.insert(taskTags).values({ taskId: task.id, tagId }).run();
        }
        if (fieldValuesIn !== undefined) {
          deleteClearedFieldValues(tx, task.id, input.field_values!);
          upsertFieldValues(tx, task.id, fieldValuesIn, user.id, t);
        }
        return row;
      });

      if (changed.length > 0) {
        recordActivity(ctx.db, {
          workspaceId: workspace.id,
          taskId: task.id,
          actorId: user.id,
          action: "task.updated",
          metadata: { fields: changed },
        });
      }
      if (assigneeChanged) {
        if (newAssignee) {
          associate(ctx.db, task.id, [newAssignee.id], t);
          recordActivity(ctx.db, {
            workspaceId: workspace.id,
            taskId: task.id,
            actorId: user.id,
            action: "task.assigned",
            metadata: { assignee_id: newAssignee.id, assignee_name: newAssignee.name },
          });
        } else {
          recordActivity(ctx.db, {
            workspaceId: workspace.id,
            taskId: task.id,
            actorId: user.id,
            action: "task.unassigned",
            metadata: { previous_assignee_id: task.assigneeId },
          });
        }
      }

      const status = ctx.db.select().from(statuses).where(eq(statuses.id, updated.statusId)).get()!;
      const assignee = updated.assigneeId
        ? (ctx.db.select().from(users).where(eq(users.id, updated.assigneeId)).get() ?? null)
        : null;
      const tagRows = loadTagsForTasks(ctx.db, [updated.id]).get(updated.id) ?? [];
      const fieldValues = loadFieldValuesForTasks(ctx.db, [updated.id]).get(updated.id);
      return c.json({ task: taskToApi(updated, workspace.key, status, assignee, tagRows, undefined, undefined, fieldValues) });
    },
  };
}
