import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    // NULL = agent account: cannot log in with a password, API keys only.
    passwordHash: text("password_hash"),
    role: text("role").notNull(),
    isAgent: integer("is_agent").notNull().default(0),
    deactivatedAt: integer("deactivated_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("users_email_unique").on(t.email),
    check("users_role_check", sql`${t.role} IN ('admin','member')`),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
  },
  (t) => [uniqueIndex("sessions_token_hash_unique").on(t.tokenHash), index("sessions_user_id_idx").on(t.userId)],
);

export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenPrefix: text("token_prefix").notNull(),
    lastUsedAt: integer("last_used_at"),
    revokedAt: integer("revoked_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("api_keys_token_hash_unique").on(t.tokenHash), index("api_keys_user_id_idx").on(t.userId)],
);

export const workspaces = sqliteTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    key: text("key").notNull(),
    nextTaskNumber: integer("next_task_number").notNull().default(1),
    archivedAt: integer("archived_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("workspaces_key_unique").on(t.key)],
);

export const statuses = sqliteTable(
  "statuses",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    name: text("name").notNull(),
    color: text("color").notNull(),
    position: integer("position").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("statuses_workspace_name_unique").on(t.workspaceId, t.name),
    index("statuses_workspace_id_idx").on(t.workspaceId),
  ],
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    statusId: text("status_id")
      .notNull()
      .references(() => statuses.id),
    assigneeId: text("assignee_id").references(() => users.id),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    archivedAt: integer("archived_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("tasks_workspace_number_unique").on(t.workspaceId, t.number),
    index("tasks_workspace_archived_idx").on(t.workspaceId, t.archivedAt),
    index("tasks_status_id_idx").on(t.statusId),
    index("tasks_assignee_id_idx").on(t.assigneeId),
  ],
);

export const comments = sqliteTable(
  "comments",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("comments_task_id_idx").on(t.taskId)],
);

export const attachments = sqliteTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").references(() => tasks.id),
    commentId: text("comment_id").references(() => comments.id),
    uploaderId: text("uploader_id")
      .notNull()
      .references(() => users.id),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    sha256: text("sha256").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("attachments_task_id_idx").on(t.taskId),
    index("attachments_comment_id_idx").on(t.commentId),
    check("attachments_one_parent_check", sql`(${t.taskId} IS NULL) != (${t.commentId} IS NULL)`),
  ],
);
