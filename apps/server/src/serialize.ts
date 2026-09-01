import { LINK_INVERSE, type LinkType } from "@temujira/shared";
import type {
  ActivityEvent,
  ApiKey,
  Attachment,
  Comment,
  FieldDef,
  InboxItem,
  QueueEntry,
  Status,
  Tag,
  Task,
  TaskLink,
  User,
  Workspace,
} from "@temujira/shared";
import type {
  activityEvents,
  apiKeys,
  attachments,
  comments,
  fieldDefs,
  fieldValues,
  inboxItems,
  queueEntries,
  statuses,
  tags,
  taskLinks,
  tasks,
  users,
  workspaces,
} from "./db/schema";

export type UserRow = typeof users.$inferSelect;
export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type WorkspaceRow = typeof workspaces.$inferSelect;
export type StatusRow = typeof statuses.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type CommentRow = typeof comments.$inferSelect;
export type AttachmentRow = typeof attachments.$inferSelect;
export type TagRow = typeof tags.$inferSelect;
export type ActivityEventRow = typeof activityEvents.$inferSelect;
export type InboxItemRow = typeof inboxItems.$inferSelect;
export type TaskLinkRow = typeof taskLinks.$inferSelect;
export type FieldDefRow = typeof fieldDefs.$inferSelect;
export type FieldValueRow = typeof fieldValues.$inferSelect;
export type QueueEntryRow = typeof queueEntries.$inferSelect;

export function userToApi(u: UserRow): User {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role as User["role"],
    is_agent: !!u.isAgent,
    deactivated_at: u.deactivatedAt,
    created_at: u.createdAt,
    updated_at: u.updatedAt,
  };
}

export function apiKeyToApi(k: ApiKeyRow): ApiKey {
  return {
    id: k.id,
    user_id: k.userId,
    name: k.name,
    token_prefix: k.tokenPrefix,
    last_used_at: k.lastUsedAt,
    revoked_at: k.revokedAt,
    created_at: k.createdAt,
  };
}

export function workspaceToApi(w: WorkspaceRow): Workspace {
  return {
    id: w.id,
    name: w.name,
    key: w.key,
    archived_at: w.archivedAt,
    created_at: w.createdAt,
    updated_at: w.updatedAt,
  };
}

export function statusToApi(s: StatusRow): Status {
  return {
    id: s.id,
    workspace_id: s.workspaceId,
    name: s.name,
    color: s.color,
    position: s.position,
    created_at: s.createdAt,
  };
}

export function tagToApi(t: TagRow): Tag {
  return {
    id: t.id,
    workspace_id: t.workspaceId,
    name: t.name,
    color: t.color,
    created_at: t.createdAt,
  };
}

export function attachmentToApi(a: AttachmentRow): Attachment {
  return {
    id: a.id,
    task_id: a.taskId,
    comment_id: a.commentId,
    uploader_id: a.uploaderId,
    filename: a.filename,
    mime_type: a.mimeType,
    size: a.size,
    sha256: a.sha256,
    created_at: a.createdAt,
  };
}

/**
 * Serialize one stored link from the viewpoint of `perspectiveTaskId`.
 * The row is canonical ("src <type> dst"); the viewer on the dst side sees the inverse
 * relation. `other` MUST carry the far task's OWN workspace key — reusing the viewpoint
 * task's workspace key would mint wrong keys for cross-workspace links.
 */
export function taskLinkToApi(
  row: TaskLinkRow,
  perspectiveTaskId: string,
  other: { task: TaskRow; workspaceKey: string; status: StatusRow },
): TaskLink {
  const outward = row.srcTaskId === perspectiveTaskId;
  return {
    id: row.id,
    type: outward ? (row.type as LinkType) : LINK_INVERSE[row.type as LinkType],
    task: {
      id: other.task.id,
      key: `${other.workspaceKey}-${other.task.number}`,
      workspace_id: other.task.workspaceId,
      title: other.task.title,
      status: statusToApi(other.status),
      archived_at: other.task.archivedAt,
    },
    created_by: row.createdBy,
    created_at: row.createdAt,
  };
}

export function taskToApi(
  t: TaskRow,
  workspaceKey: string,
  status: StatusRow,
  assignee: UserRow | null,
  tagRows?: TagRow[],
  attachmentRows?: AttachmentRow[],
  links?: TaskLink[],
  fieldValues?: Record<string, string>,
): Task {
  return {
    id: t.id,
    workspace_id: t.workspaceId,
    number: t.number,
    key: `${workspaceKey}-${t.number}`,
    title: t.title,
    description: t.description,
    status_id: t.statusId,
    status: statusToApi(status),
    assignee_id: t.assigneeId,
    assignee: assignee ? userToApi(assignee) : null,
    created_by: t.createdBy,
    archived_at: t.archivedAt,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
    ...(tagRows ? { tags: tagRows.map(tagToApi) } : { tags: [] }),
    ...(attachmentRows ? { attachments: attachmentRows.map(attachmentToApi) } : {}),
    ...(links ? { links } : {}),
    field_values: fieldValues ?? {},
  };
}

export function fieldDefToApi(f: FieldDefRow): FieldDef {
  return {
    id: f.id,
    workspace_id: f.workspaceId,
    name: f.name,
    type: f.type as FieldDef["type"],
    options: asStringArray(f.options),
    position: f.position,
    created_at: f.createdAt,
  };
}

export function queueEntryToApi(
  e: QueueEntryRow,
  task: Task,
  blocked: boolean,
): QueueEntry {
  return {
    id: e.id,
    task,
    state: e.state as QueueEntry["state"],
    blocked,
    position: e.position,
    created_at: e.createdAt,
  };
}

export function commentToApi(
  c: CommentRow,
  author: UserRow,
  attachmentRows: AttachmentRow[],
  replies?: Comment[],
  replyTo?: Comment | null,
): Comment {
  return {
    id: c.id,
    task_id: c.taskId,
    parent_id: c.parentId ?? null,
    author_id: c.authorId,
    author: userToApi(author),
    body: c.body,
    question:
      c.questionOptions !== null && c.questionOptions !== undefined
        ? { options: asStringArray(c.questionOptions), answer_option_index: c.answerOptionIndex ?? null }
        : null,
    replies: replies ?? [],
    attachments: attachmentRows.map(attachmentToApi),
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  };
}

export function asStringArray(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map((s) => String(s)) : [];
  } catch {
    return [];
  }
}

export function activityEventToApi(e: ActivityEventRow, actor: UserRow, task?: { key?: string; title?: string } | null): ActivityEvent {
  return {
    id: e.id,
    workspace_id: e.workspaceId,
    task_id: e.taskId,
    task_key: e.taskId ? (task?.key ?? null) : null,
    task_title: e.taskId ? (task?.title ?? null) : null,
    actor_id: e.actorId,
    actor: userToApi(actor),
    action: e.action,
    metadata: parseJsonRecord(e.metadata),
    created_at: e.createdAt,
  };
}

export function inboxItemToApi(
  item: InboxItemRow,
  actor: UserRow,
  workspace: WorkspaceRow,
  task: TaskRow,
  workspaceKey: string,
  sourceComment: Comment,
  parentComment: Comment | null,
): InboxItem {
  return {
    id: item.id,
    user_id: item.userId,
    workspace_id: item.workspaceId,
    workspace: workspaceToApi(workspace),
    task_id: item.taskId,
    task_key: `${workspaceKey}-${task.number}`,
    task_title: task.title,
    actor_id: item.actorId,
    actor: userToApi(actor),
    kind: item.kind as "mention" | "reply",
    source_comment: sourceComment,
    parent_comment: parentComment,
    read_at: item.readAt,
    created_at: item.createdAt,
  };
}

function parseJsonRecord(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
