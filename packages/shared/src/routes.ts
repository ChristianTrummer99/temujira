import { z } from "zod";
import {
  ActivityEventSchema,
  ApiKeySchema,
  AttachmentSchema,
  CommentSchema,
  CreateApiKeyInputSchema,
  CreateCommentInputSchema,
  CreateStatusInputSchema,
  CreateTagInputSchema,
  CreateTaskInputSchema,
  CreateUserInputSchema,
  CreateWorkspaceInputSchema,
  DeleteStatusQuerySchema,
  InboxItemSchema,
  ListActivityQuerySchema,
  ListApiKeysQuerySchema,
  ListInboxQuerySchema,
  ListMyTasksQuerySchema,
  ListTagsQuerySchema,
  ListTasksQuerySchema,
  ListUsersQuerySchema,
  ListWorkspacesQuerySchema,
  LoginInputSchema,
  MentionSearchQuerySchema,
  ReorderStatusesInputSchema,
  SetupInputSchema,
  StatusSchema,
  TagSchema,
  TaskSchema,
  UpdateCommentInputSchema,
  UpdateInboxQuerySchema,
  UpdateMeInputSchema,
  UpdateStatusInputSchema,
  UpdateTagInputSchema,
  UpdateTaskInputSchema,
  UpdateUserInputSchema,
  UpdateWorkspaceInputSchema,
  UserSchema,
  WorkspaceSchema,
} from "./entities";

export type RouteMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/**
 * public: no credentials required.
 * user:   any authenticated, non-deactivated user (session cookie, Bearer tms_ session
 *         token, or Bearer tmj_ API key). Handlers may apply finer owner-or-admin rules.
 * admin:  authenticated user with role=admin.
 */
export type AuthLevel = "public" | "user" | "admin";

export interface RouteDef {
  method: RouteMethod;
  /** Hono-style path under /api/v1, e.g. "/tasks/:idOrKey". */
  path: string;
  auth: AuthLevel;
  summary: string;
  query?: z.ZodType;
  body?: z.ZodType;
  /** "multipart" routes accept a single `file` field via multipart/form-data. */
  bodyType?: "json" | "multipart";
  /** "binary" marks a streamed file response. */
  response: z.ZodType | "binary";
}

const okResponse = z.object({ ok: z.literal(true) });
const listOf = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) });

/**
 * THE CONTRACT. Every API endpoint is declared here; the server mounts handlers via an
 * exhaustive Record<RouteId, …>, the client exposes one method per id, and the CLI maps
 * every id to a command. Do not add endpoints anywhere else.
 */
export const ROUTES = {
  // ---- meta ----
  "meta.health": {
    method: "GET",
    path: "/health",
    auth: "public",
    summary: "Liveness check and version",
    response: z.object({ ok: z.literal(true), version: z.string() }),
  },
  "meta.openapi": {
    method: "GET",
    path: "/openapi.json",
    auth: "public",
    summary: "OpenAPI document generated from the route registry",
    response: z.record(z.string(), z.unknown()),
  },

  // ---- setup ----
  "setup.status": {
    method: "GET",
    path: "/setup",
    auth: "public",
    summary: "Whether first-run setup is still needed (no users exist yet)",
    response: z.object({ needsSetup: z.boolean() }),
  },
  "setup.run": {
    method: "POST",
    path: "/setup",
    auth: "public",
    summary: "Create the first admin account; self-disables after any user exists",
    body: SetupInputSchema,
    response: z.object({ user: UserSchema, token: z.string() }),
  },

  // ---- auth ----
  "auth.login": {
    method: "POST",
    path: "/auth/login",
    auth: "public",
    summary: "Email+password login; sets a session cookie and returns the session token",
    body: LoginInputSchema,
    response: z.object({ user: UserSchema, token: z.string() }),
  },
  "auth.logout": {
    method: "POST",
    path: "/auth/logout",
    auth: "user",
    summary: "Destroy the current session",
    response: okResponse,
  },
  "auth.me": {
    method: "GET",
    path: "/auth/me",
    auth: "user",
    summary: "The authenticated user",
    response: z.object({ user: UserSchema }),
  },
  "auth.updateMe": {
    method: "PATCH",
    path: "/auth/me",
    auth: "user",
    summary: "Update own name or password (requires current_password)",
    body: UpdateMeInputSchema,
    response: z.object({ user: UserSchema }),
  },

  // ---- api keys ----
  "apiKeys.list": {
    method: "GET",
    path: "/api-keys",
    auth: "user",
    summary: "List own API keys (admin: ?user_id= lists another user's)",
    query: ListApiKeysQuerySchema,
    response: listOf(ApiKeySchema),
  },
  "apiKeys.create": {
    method: "POST",
    path: "/api-keys",
    auth: "user",
    summary: "Create an API key (admin may pass user_id to provision an agent); token returned once",
    body: CreateApiKeyInputSchema,
    response: z.object({ apiKey: ApiKeySchema, token: z.string() }),
  },
  "apiKeys.revoke": {
    method: "DELETE",
    path: "/api-keys/:id",
    auth: "user",
    summary: "Revoke an API key (owner or admin)",
    response: okResponse,
  },

  // ---- users ----
  "users.list": {
    method: "GET",
    path: "/users",
    auth: "user",
    summary: "List users (assignee pickers need this; ?include_deactivated=1 for admins)",
    query: ListUsersQuerySchema,
    response: listOf(UserSchema),
  },
  "users.create": {
    method: "POST",
    path: "/users",
    auth: "admin",
    summary: "Create a human (password required) or agent (API-key-only) account",
    body: CreateUserInputSchema,
    response: z.object({ user: UserSchema }),
  },
  // Declared before users.get: routes mount in registry order and Hono dispatches by
  // registration order, so the literal /users/search must precede /users/:id.
  "users.search": {
    method: "GET",
    path: "/users/search",
    auth: "user",
    summary: "Mention/assignee autocomplete: search active users by name or email",
    query: MentionSearchQuerySchema,
    response: listOf(UserSchema),
  },
  "users.get": {
    method: "GET",
    path: "/users/:id",
    auth: "user",
    summary: "Get one user",
    response: z.object({ user: UserSchema }),
  },
  "users.update": {
    method: "PATCH",
    path: "/users/:id",
    auth: "admin",
    summary: "Update name/role, reset password, or reactivate",
    body: UpdateUserInputSchema,
    response: z.object({ user: UserSchema }),
  },
  "users.deactivate": {
    method: "DELETE",
    path: "/users/:id",
    auth: "admin",
    summary: "Deactivate (soft): login and API keys refused; history stays intact",
    response: z.object({ user: UserSchema }),
  },

  // ---- workspaces ----
  "workspaces.list": {
    method: "GET",
    path: "/workspaces",
    auth: "user",
    summary: "List workspaces (sidebar), newest last",
    query: ListWorkspacesQuerySchema,
    response: listOf(WorkspaceSchema),
  },
  "workspaces.create": {
    method: "POST",
    path: "/workspaces",
    auth: "user",
    summary: "Create a workspace; seeds Backlog / In Progress / Done statuses",
    body: CreateWorkspaceInputSchema,
    response: z.object({ workspace: WorkspaceSchema }),
  },
  "workspaces.get": {
    method: "GET",
    path: "/workspaces/:idOrKey",
    auth: "user",
    summary: "Get a workspace by ULID or key (e.g. TEM)",
    response: z.object({ workspace: WorkspaceSchema }),
  },
  "workspaces.update": {
    method: "PATCH",
    path: "/workspaces/:idOrKey",
    auth: "user",
    summary: "Rename, archive (archived: true) or unarchive (archived: false)",
    body: UpdateWorkspaceInputSchema,
    response: z.object({ workspace: WorkspaceSchema }),
  },

  // ---- statuses ----
  "statuses.list": {
    method: "GET",
    path: "/workspaces/:idOrKey/statuses",
    auth: "user",
    summary: "List a workspace's statuses ordered by position",
    response: listOf(StatusSchema),
  },
  "statuses.create": {
    method: "POST",
    path: "/workspaces/:idOrKey/statuses",
    auth: "user",
    summary: "Create a status (appended at the end)",
    body: CreateStatusInputSchema,
    response: z.object({ status: StatusSchema }),
  },
  "statuses.update": {
    method: "PATCH",
    path: "/statuses/:id",
    auth: "user",
    summary: "Rename or recolor a status",
    body: UpdateStatusInputSchema,
    response: z.object({ status: StatusSchema }),
  },
  "statuses.reorder": {
    method: "PUT",
    path: "/workspaces/:idOrKey/statuses/order",
    auth: "user",
    summary: "Reorder statuses: full ordered array of all status ids",
    body: ReorderStatusesInputSchema,
    response: listOf(StatusSchema),
  },
  "statuses.delete": {
    method: "DELETE",
    path: "/statuses/:id",
    auth: "user",
    summary: "Delete a status; ?move_to= required (409 otherwise) when tasks reference it",
    query: DeleteStatusQuerySchema,
    response: okResponse,
  },

  // ---- tags ----
  "tags.list": {
    method: "GET",
    path: "/workspaces/:idOrKey/tags",
    auth: "user",
    summary: "List a workspace's tags",
    query: ListTagsQuerySchema,
    response: listOf(TagSchema),
  },
  "tags.create": {
    method: "POST",
    path: "/workspaces/:idOrKey/tags",
    auth: "admin",
    summary: "Create a per-workspace tag (admin)",
    body: CreateTagInputSchema,
    response: z.object({ tag: TagSchema }),
  },
  "tags.update": {
    method: "PATCH",
    path: "/tags/:id",
    auth: "admin",
    summary: "Rename or recolor a tag (admin)",
    body: UpdateTagInputSchema,
    response: z.object({ tag: TagSchema }),
  },
  "tags.delete": {
    method: "DELETE",
    path: "/tags/:id",
    auth: "admin",
    summary: "Delete a tag and unlink it from all tasks (admin)",
    response: okResponse,
  },

  // ---- tasks ----
  "tasks.mine": {
    method: "GET",
    path: "/tasks/mine",
    auth: "user",
    summary: "Tasks the current user is associated with (created/assigned/commented/mentioned)",
    query: ListMyTasksQuerySchema,
    response: z.object({
      items: z.array(TaskSchema),
      total: z.number().int(),
      limit: z.number().int(),
      offset: z.number().int(),
    }),
  },
  "tasks.list": {
    method: "GET",
    path: "/workspaces/:idOrKey/tasks",
    auth: "user",
    summary: "List tasks (stacked rows view): filters, search, sort, pagination",
    query: ListTasksQuerySchema,
    response: z.object({
      items: z.array(TaskSchema),
      total: z.number().int(),
      limit: z.number().int(),
      offset: z.number().int(),
    }),
  },
  "tasks.create": {
    method: "POST",
    path: "/workspaces/:idOrKey/tasks",
    auth: "user",
    summary: "Create a task; number allocated transactionally (key like TEM-42)",
    body: CreateTaskInputSchema,
    response: z.object({ task: TaskSchema }),
  },
  "tasks.get": {
    method: "GET",
    path: "/tasks/:idOrKey",
    auth: "user",
    summary: "Get a task by ULID or key (TEM-42); embeds status, assignee, attachments",
    response: z.object({ task: TaskSchema }),
  },
  "tasks.update": {
    method: "PATCH",
    path: "/tasks/:idOrKey",
    auth: "user",
    summary: "Edit title/description, move status, (un)assign, archive/unarchive",
    body: UpdateTaskInputSchema,
    response: z.object({ task: TaskSchema }),
  },

  // ---- comments ----
  "comments.list": {
    method: "GET",
    path: "/tasks/:idOrKey/comments",
    auth: "user",
    summary: "List a task's comments chronologically; authors and attachments embedded",
    response: listOf(CommentSchema),
  },
  "comments.create": {
    method: "POST",
    path: "/tasks/:idOrKey/comments",
    auth: "user",
    summary: "Add a markdown comment",
    body: CreateCommentInputSchema,
    response: z.object({ comment: CommentSchema }),
  },
  "comments.update": {
    method: "PATCH",
    path: "/comments/:id",
    auth: "user",
    summary: "Edit a comment (author or admin)",
    body: UpdateCommentInputSchema,
    response: z.object({ comment: CommentSchema }),
  },
  "comments.delete": {
    method: "DELETE",
    path: "/comments/:id",
    auth: "user",
    summary: "Delete a comment and its attachments (author or admin)",
    response: okResponse,
  },

  // ---- attachments ----
  "attachments.uploadToTask": {
    method: "POST",
    path: "/tasks/:idOrKey/attachments",
    auth: "user",
    summary: "Attach a file to a task (multipart field `file`)",
    bodyType: "multipart",
    response: z.object({ attachment: AttachmentSchema }),
  },
  "attachments.uploadToComment": {
    method: "POST",
    path: "/comments/:id/attachments",
    auth: "user",
    summary: "Attach a file to a comment (multipart field `file`)",
    bodyType: "multipart",
    response: z.object({ attachment: AttachmentSchema }),
  },
  "attachments.get": {
    method: "GET",
    path: "/attachments/:id",
    auth: "user",
    summary: "Attachment metadata",
    response: z.object({ attachment: AttachmentSchema }),
  },
  "attachments.download": {
    method: "GET",
    path: "/attachments/:id/download",
    auth: "user",
    summary: "Authenticated file stream (nosniff; attachment disposition outside image/pdf safelist)",
    response: "binary",
  },
  "attachments.delete": {
    method: "DELETE",
    path: "/attachments/:id",
    auth: "user",
    summary: "Delete an attachment and its bytes (uploader or admin)",
    response: okResponse,
  },

  // ---- activity ----
  "activity.list": {
    method: "GET",
    path: "/workspaces/:idOrKey/activity",
    auth: "user",
    summary: "Workspace action feed (create/assign/comment/mention), newest first; ?mine=1 filters to the current user's tasks",
    query: ListActivityQuerySchema,
    response: listOf(ActivityEventSchema),
  },

  // ---- inbox ----
  "inbox.list": {
    method: "GET",
    path: "/inbox",
    auth: "user",
    summary: "Unified cross-workspace inbox: mentions and replies directed at the current user",
    query: ListInboxQuerySchema,
    response: z.object({
      items: z.array(InboxItemSchema),
      unread: z.number().int(),
      total: z.number().int(),
      limit: z.number().int(),
      offset: z.number().int(),
    }),
  },
  "inbox.update": {
    method: "POST",
    path: "/inbox/read",
    auth: "user",
    summary: "Mark all of the current user's inbox items as read (?mark_read=1)",
    query: UpdateInboxQuerySchema,
    response: z.object({ ok: z.literal(true), updated: z.number().int() }),
  },
} as const satisfies Record<string, RouteDef>;

export type RouteId = keyof typeof ROUTES;
export const ROUTE_IDS = Object.keys(ROUTES) as RouteId[];

/** Substitute :params in a route path template. */
export function buildPath(template: string, params: Record<string, string>): string {
  return template.replace(/:([A-Za-z]+)/g, (_, name: string) => {
    const v = params[name];
    if (v === undefined) throw new Error(`missing path param ${name} for ${template}`);
    return encodeURIComponent(v);
  });
}
