import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

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
    /** Root comment when NULL. Only one level of depth: replies have a root parent. */
    parentId: text("parent_id").references((): AnySQLiteColumn => comments.id),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    /** When set, this comment is a multiple-choice question (JSON string array of options). */
    questionOptions: text("question_options"),
    /** On a reply: the 0-based option index chosen from the parent's question. */
    answerOptionIndex: integer("answer_option_index"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("comments_task_id_idx").on(t.taskId),
    index("comments_parent_id_idx").on(t.parentId),
  ],
);

export const mentions = sqliteTable(
  "mentions",
  {
    id: text("id").primaryKey(),
    commentId: text("comment_id")
      .notNull()
      .references(() => comments.id),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    mentionedId: text("mentioned_id")
      .notNull()
      .references(() => users.id),
    /** The user who wrote the mentioning comment. */
    byId: text("by_id")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("mentions_mentioned_id_idx").on(t.mentionedId),
    index("mentions_comment_id_idx").on(t.commentId),
    index("mentions_task_id_idx").on(t.taskId),
  ],
);

/**
 * Unified cross-workspace inbox: a row per (user, source comment) directed at them.
 * kind: "mention" (someone mentioned me) or "reply" (someone replied to my comment).
 * sourceCommentId is the comment that triggered the inbox entry (the mentioned/reply comment).
 * parentCommentId is the conversation root the reply/mention sits under.
 */
export const inboxItems = sqliteTable(
  "inbox_items",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind").notNull(),
    sourceCommentId: text("source_comment_id")
      .notNull()
      .references(() => comments.id),
    parentCommentId: text("parent_comment_id").references(() => comments.id),
    readAt: integer("read_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("inbox_items_user_id_idx").on(t.userId),
    index("inbox_items_source_comment_id_idx").on(t.sourceCommentId),
    index("inbox_items_workspace_id_idx").on(t.workspaceId),
  ],
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

/** Per-workspace tag (e.g. "Epic", "Bug", "P1"). Created/managed by admins. */
export const tags = sqliteTable(
  "tags",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    name: text("name").notNull(),
    color: text("color").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("tags_workspace_name_unique").on(t.workspaceId, t.name),
    index("tags_workspace_id_idx").on(t.workspaceId),
  ],
);

/** Many-to-many tags ↔ tasks. */
export const taskTags = sqliteTable(
  "task_tags",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id),
  },
  (t) => [
    index("task_tags_task_id_idx").on(t.taskId),
    index("task_tags_tag_id_idx").on(t.tagId),
  ],
);

/**
 * Typed edge between two tasks: "src <type> dst" (e.g. src absorbs dst).
 * Only canonical types are stored (relates/blocks/absorbs); inverse spellings
 * (blocked_by/absorbed_by) exist only on the wire, computed per viewpoint at
 * serialization. `relates` rows are stored src < dst (ULID order) so the unique
 * index dedupes both directions. Links are pure metadata: no side effects,
 * no enforcement, task rows untouched.
 */
export const taskLinks = sqliteTable(
  "task_links",
  {
    id: text("id").primaryKey(),
    srcTaskId: text("src_task_id")
      .notNull()
      .references(() => tasks.id),
    type: text("type").notNull(),
    dstTaskId: text("dst_task_id")
      .notNull()
      .references(() => tasks.id),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("task_links_edge_unique").on(t.srcTaskId, t.type, t.dstTaskId),
    index("task_links_src_idx").on(t.srcTaskId),
    index("task_links_dst_idx").on(t.dstTaskId),
    check("task_links_type_check", sql`${t.type} IN ('relates','blocks','absorbs')`),
    check("task_links_no_self_check", sql`${t.srcTaskId} != ${t.dstTaskId}`),
  ],
);

/**
 * Catch-all association: a user is "associated" with a task when they created it, are
 * assigned, commented on it, or were mentioned. Used by the per-user "my activity" feed.
 */
export const taskAssociations = sqliteTable(
  "task_associations",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    /** When the user first became associated, for ordering. */
    associatedAt: integer("associated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.userId] }),
    index("task_associations_task_id_idx").on(t.taskId),
    index("task_associations_user_id_idx").on(t.userId),
  ],
);

/** Append-only action stream per workspace, powering the Activity view. */
export const activityEvents = sqliteTable(
  "activity_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    taskId: text("task_id").references(() => tasks.id),
    /** The user who performed the action. */
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id),
    action: text("action").notNull(),
    /** Optional target user(s) / detail, stored as JSON. */
    metadata: text("metadata").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("activity_events_workspace_id_idx").on(t.workspaceId),
    index("activity_events_task_id_idx").on(t.taskId),
    index("activity_events_actor_id_idx").on(t.actorId),
  ],
);
