import type {
  ApiKey,
  Attachment,
  Comment,
  Status,
  Task,
  User,
  Workspace,
} from "@temujira/shared";
import type { apiKeys, attachments, comments, statuses, tasks, users, workspaces } from "./db/schema";

export type UserRow = typeof users.$inferSelect;
export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type WorkspaceRow = typeof workspaces.$inferSelect;
export type StatusRow = typeof statuses.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type CommentRow = typeof comments.$inferSelect;
export type AttachmentRow = typeof attachments.$inferSelect;

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

export function taskToApi(
  t: TaskRow,
  workspaceKey: string,
  status: StatusRow,
  assignee: UserRow | null,
  attachmentRows?: AttachmentRow[],
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
    ...(attachmentRows ? { attachments: attachmentRows.map(attachmentToApi) } : {}),
  };
}

export function commentToApi(c: CommentRow, author: UserRow, attachmentRows: AttachmentRow[]): Comment {
  return {
    id: c.id,
    task_id: c.taskId,
    author_id: c.authorId,
    author: userToApi(author),
    body: c.body,
    attachments: attachmentRows.map(attachmentToApi),
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  };
}
