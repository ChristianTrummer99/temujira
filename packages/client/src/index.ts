import { z } from "zod";
import {
  buildPath,
  ROUTES,
  type RouteId,
  type ErrorCode,
  type ActivityEvent,
  type ApiKey,
  type Attachment,
  type Comment,
  type InboxItem,
  type LinkRelation,
  type Status,
  type Tag,
  type TaskLink,
  type Task,
  type User,
  type Workspace,
} from "@temujira/shared";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: ErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ClientOptions {
  /**
   * Server origin, e.g. "http://localhost:3000". Leave empty in the browser to use
   * same-origin relative paths — required for the production static bundle to work on
   * any domain.
   */
  baseUrl?: string;
  /** API key (tmj_…) or session token (tms_…), sent as a Bearer header. */
  token?: string;
  /** Browser cookie mode: include credentials instead of a Bearer header. */
  useCookies?: boolean;
  fetch?: typeof fetch;
}

type Body = Record<string, unknown>;
type Query = Record<string, string | number | boolean | undefined>;

export interface UploadInput {
  /** File/Blob (browser) or raw bytes (Node). */
  data: Blob | Uint8Array;
  filename: string;
  contentType?: string;
}

export class TemujiraClient {
  private baseUrl: string;
  private token?: string;
  private useCookies: boolean;
  private fetchFn: typeof fetch;

  constructor(opts: ClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? "").replace(/\/+$/, "");
    this.token = opts.token;
    this.useCookies = opts.useCookies ?? false;
    // Bind to the global so `window.fetch` keeps its required `this` (avoids
    // "Failed to execute 'fetch' on 'Window': Illegal invocation" in browsers).
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
  }

  setToken(token: string | undefined) {
    this.token = token;
  }

  /** Raw escape hatch (also powers `tmj api`): path is under /api/v1, e.g. "/tasks/TEM-1". */
  async request(
    method: string,
    path: string,
    opts: { query?: Query; body?: Body; formData?: FormData } = {},
  ): Promise<unknown> {
    const res = await this.send(method, path, opts);
    return this.parse(res);
  }

  private async send(
    method: string,
    path: string,
    opts: { query?: Query; body?: Body; formData?: FormData } = {},
  ): Promise<Response> {
    const url = new URL(
      `${this.baseUrl}/api/v1${path}`,
      // Relative base for browser same-origin mode; harmless absolute fallback for Node.
      this.baseUrl ? undefined : typeof location !== "undefined" ? location.href : "http://localhost",
    );
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = {};
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    let body: BodyInit | undefined;
    if (opts.formData) {
      body = opts.formData;
    } else if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
    return this.fetchFn(url.toString(), {
      method,
      headers,
      body,
      credentials: this.useCookies ? "include" : "same-origin",
    });
  }

  private async parse(res: Response): Promise<unknown> {
    if (res.ok) {
      if (res.status === 204) return undefined;
      return res.json();
    }
    let code: ErrorCode = "server_error";
    let message = `HTTP ${res.status}`;
    let details: unknown;
    try {
      const parsed = (await res.json()) as { error?: { code?: ErrorCode; message?: string; details?: unknown } };
      if (parsed.error) {
        code = parsed.error.code ?? code;
        message = parsed.error.message ?? message;
        details = parsed.error.details;
      }
    } catch {
      // non-JSON error body; keep defaults
    }
    throw new ApiError(res.status, code, message, details);
  }

  private async call(id: RouteId, params: Record<string, string>, opts: { query?: Query; body?: Body; formData?: FormData } = {}): Promise<unknown> {
    const def = ROUTES[id];
    return this.request(def.method, buildPath(def.path, params), opts);
  }

  // ---- meta ----
  health() {
    return this.call("meta.health", {}) as Promise<{ ok: true; version: string }>;
  }
  openapi() {
    return this.call("meta.openapi", {}) as Promise<Record<string, unknown>>;
  }

  // ---- setup ----
  setupStatus() {
    return this.call("setup.status", {}) as Promise<{ needsSetup: boolean }>;
  }
  runSetup(body: { email: string; name: string; password: string }) {
    return this.call("setup.run", {}, { body }) as Promise<{ user: User; token: string }>;
  }

  // ---- auth ----
  login(body: { email: string; password: string }) {
    return this.call("auth.login", {}, { body }) as Promise<{ user: User; token: string }>;
  }
  logout() {
    return this.call("auth.logout", {}) as Promise<{ ok: true }>;
  }
  me() {
    return this.call("auth.me", {}) as Promise<{ user: User }>;
  }
  updateMe(body: { name?: string; current_password?: string; new_password?: string }) {
    return this.call("auth.updateMe", {}, { body }) as Promise<{ user: User }>;
  }

  // ---- api keys ----
  listApiKeys(query: { user_id?: string } = {}) {
    return this.call("apiKeys.list", {}, { query }) as Promise<{ items: ApiKey[] }>;
  }
  createApiKey(body: { name: string; user_id?: string }) {
    return this.call("apiKeys.create", {}, { body }) as Promise<{ apiKey: ApiKey; token: string }>;
  }
  revokeApiKey(id: string) {
    return this.call("apiKeys.revoke", { id }) as Promise<{ ok: true }>;
  }

  // ---- users ----
  listUsers(query: { include_deactivated?: boolean } = {}) {
    return this.call("users.list", {}, { query }) as Promise<{ items: User[] }>;
  }
  createUser(body: { email: string; name: string; role?: "admin" | "member"; is_agent?: boolean; password?: string }) {
    return this.call("users.create", {}, { body }) as Promise<{ user: User }>;
  }
  getUser(id: string) {
    return this.call("users.get", { id }) as Promise<{ user: User }>;
  }
  updateUser(id: string, body: { name?: string; role?: "admin" | "member"; password?: string; reactivate?: boolean }) {
    return this.call("users.update", { id }, { body }) as Promise<{ user: User }>;
  }
  deactivateUser(id: string) {
    return this.call("users.deactivate", { id }) as Promise<{ user: User }>;
  }
  /** Mention/assignee autocomplete over active users. */
  searchUsers(query: { q: string; limit?: number }) {
    return this.call("users.search", {}, { query }) as Promise<{ items: User[] }>;
  }

  // ---- workspaces ----
  listWorkspaces(query: { include_archived?: boolean } = {}) {
    return this.call("workspaces.list", {}, { query }) as Promise<{ items: Workspace[] }>;
  }
  createWorkspace(body: { name: string; key: string }) {
    return this.call("workspaces.create", {}, { body }) as Promise<{ workspace: Workspace }>;
  }
  getWorkspace(idOrKey: string) {
    return this.call("workspaces.get", { idOrKey }) as Promise<{ workspace: Workspace }>;
  }
  updateWorkspace(idOrKey: string, body: { name?: string; archived?: boolean }) {
    return this.call("workspaces.update", { idOrKey }, { body }) as Promise<{ workspace: Workspace }>;
  }

  // ---- statuses ----
  listStatuses(workspace: string) {
    return this.call("statuses.list", { idOrKey: workspace }) as Promise<{ items: Status[] }>;
  }
  createStatus(workspace: string, body: { name: string; color?: string }) {
    return this.call("statuses.create", { idOrKey: workspace }, { body }) as Promise<{ status: Status }>;
  }
  updateStatus(id: string, body: { name?: string; color?: string }) {
    return this.call("statuses.update", { id }, { body }) as Promise<{ status: Status }>;
  }
  reorderStatuses(workspace: string, body: { status_ids: string[] }) {
    return this.call("statuses.reorder", { idOrKey: workspace }, { body }) as Promise<{ items: Status[] }>;
  }
  deleteStatus(id: string, query: { move_to?: string } = {}) {
    return this.call("statuses.delete", { id }, { query }) as Promise<{ ok: true }>;
  }

  // ---- tags (admin-managed, per workspace) ----
  listTags(workspace: string) {
    return this.call("tags.list", { idOrKey: workspace }) as Promise<{ items: Tag[] }>;
  }
  createTag(workspace: string, body: { name: string; color?: string }) {
    return this.call("tags.create", { idOrKey: workspace }, { body }) as Promise<{ tag: Tag }>;
  }
  updateTag(id: string, body: { name?: string; color?: string }) {
    return this.call("tags.update", { id }, { body }) as Promise<{ tag: Tag }>;
  }
  deleteTag(id: string) {
    return this.call("tags.delete", { id }) as Promise<{ ok: true }>;
  }

  // ---- tasks ----
  listTasks(
    workspace: string,
    query: {
      status_id?: string;
      assignee_id?: string;
      tag_id?: string;
      q?: string;
      include_archived?: boolean;
      sort?: "created_at" | "updated_at" | "number" | "title";
      order?: "asc" | "desc";
      limit?: number;
      offset?: number;
      group_by?: "none" | "status" | "tag" | "assignee";
    } = {},
  ) {
    return this.call("tasks.list", { idOrKey: workspace }, { query }) as Promise<{
      items: Task[];
      total: number;
      limit: number;
      offset: number;
    }>;
  }
  /** Tasks the current user is associated with, across workspaces. */
  listMyTasks(query: { limit?: number; offset?: number } = {}) {
    return this.call("tasks.mine", {}, { query }) as Promise<{
      items: Task[];
      total: number;
      limit: number;
      offset: number;
    }>;
  }
  createTask(
    workspace: string,
    body: {
      title: string;
      description?: string;
      status_id?: string;
      assignee_id?: string | null;
      tag_ids?: string[];
    },
  ) {
    return this.call("tasks.create", { idOrKey: workspace }, { body }) as Promise<{ task: Task }>;
  }
  getTask(idOrKey: string) {
    return this.call("tasks.get", { idOrKey }) as Promise<{ task: Task }>;
  }
  updateTask(
    idOrKey: string,
    body: {
      title?: string;
      description?: string;
      status_id?: string;
      assignee_id?: string | null;
      archived?: boolean;
      tag_ids?: string[];
    },
  ) {
    return this.call("tasks.update", { idOrKey }, { body }) as Promise<{ task: Task }>;
  }

  // ---- task links ----
  /**
   * Link a task to another, e.g. createTaskLink("START-1", { type: "absorbs", task: "START-2" }).
   * `type` is the relation as seen from the task in the first argument; the inverse
   * spellings ("blocked_by", "absorbed_by") create the same canonical link from the far end.
   */
  createTaskLink(task: string, body: { type: LinkRelation; task: string }) {
    return this.call("links.create", { idOrKey: task }, { body }) as Promise<{ link: TaskLink }>;
  }
  /** Remove a link by id; it disappears from both tasks. */
  deleteTaskLink(id: string) {
    return this.call("links.delete", { id }) as Promise<{ ok: true }>;
  }

  // ---- comments (one level of threading; questions answered via child replies) ----
  listComments(task: string) {
    return this.call("comments.list", { idOrKey: task }) as Promise<{ items: Comment[] }>;
  }
  createComment(
    task: string,
    body: {
      body: string;
      parent_id?: string;
      question_options?: string[];
      answer_option_index?: number;
      mention_ids?: string[];
    },
  ) {
    return this.call("comments.create", { idOrKey: task }, { body }) as Promise<{ comment: Comment }>;
  }
  updateComment(id: string, body: { body?: string; question_options?: string[] | null }) {
    return this.call("comments.update", { id }, { body }) as Promise<{ comment: Comment }>;
  }
  deleteComment(id: string) {
    return this.call("comments.delete", { id }) as Promise<{ ok: true }>;
  }

  // ---- attachments ----
  private uploadForm(file: UploadInput): FormData {
    const fd = new FormData();
    const blob =
      file.data instanceof Blob
        ? file.data
        : new Blob([file.data as BlobPart], { type: file.contentType ?? "application/octet-stream" });
    fd.append("file", blob, file.filename);
    return fd;
  }
  uploadTaskAttachment(task: string, file: UploadInput) {
    return this.call("attachments.uploadToTask", { idOrKey: task }, { formData: this.uploadForm(file) }) as Promise<{
      attachment: Attachment;
    }>;
  }
  uploadCommentAttachment(commentId: string, file: UploadInput) {
    return this.call("attachments.uploadToComment", { id: commentId }, { formData: this.uploadForm(file) }) as Promise<{
      attachment: Attachment;
    }>;
  }
  getAttachment(id: string) {
    return this.call("attachments.get", { id }) as Promise<{ attachment: Attachment }>;
  }
  /** Returns the raw Response so callers can stream; throws ApiError on failure. */
  async downloadAttachment(id: string): Promise<Response> {
    const def = ROUTES["attachments.download"];
    const res = await this.send(def.method, buildPath(def.path, { id }));
    if (!res.ok) await this.parse(res); // throws
    return res;
  }
  deleteAttachment(id: string) {
    return this.call("attachments.delete", { id }) as Promise<{ ok: true }>;
  }

  // ---- activity ----
  listActivity(workspace: string, query: { mine?: boolean; limit?: number; offset?: number } = {}) {
    return this.call("activity.list", { idOrKey: workspace }, { query }) as Promise<{ items: ActivityEvent[] }>;
  }

  // ---- inbox (unified, cross-workspace) ----
  listInbox(query: { include_read?: boolean; limit?: number; offset?: number } = {}) {
    return this.call("inbox.list", {}, { query }) as Promise<{
      items: InboxItem[];
      unread: number;
      total: number;
      limit: number;
      offset: number;
    }>;
  }
  markInboxRead(query: { mark_read?: boolean } = { mark_read: true }) {
    return this.call("inbox.update", {}, { query }) as Promise<{ ok: true; updated: number }>;
  }
}

/**
 * Route id → client method name. The parity test asserts this map covers every route and
 * every named method exists on TemujiraClient.
 */
export const ROUTE_METHOD_MAP: Record<RouteId, keyof TemujiraClient> = {
  "meta.health": "health",
  "meta.openapi": "openapi",
  "setup.status": "setupStatus",
  "setup.run": "runSetup",
  "auth.login": "login",
  "auth.logout": "logout",
  "auth.me": "me",
  "auth.updateMe": "updateMe",
  "apiKeys.list": "listApiKeys",
  "apiKeys.create": "createApiKey",
  "apiKeys.revoke": "revokeApiKey",
  "users.list": "listUsers",
  "users.create": "createUser",
  "users.get": "getUser",
  "users.update": "updateUser",
  "users.deactivate": "deactivateUser",
  "users.search": "searchUsers",
  "workspaces.list": "listWorkspaces",
  "workspaces.create": "createWorkspace",
  "workspaces.get": "getWorkspace",
  "workspaces.update": "updateWorkspace",
  "statuses.list": "listStatuses",
  "statuses.create": "createStatus",
  "statuses.update": "updateStatus",
  "statuses.reorder": "reorderStatuses",
  "statuses.delete": "deleteStatus",
  "tags.list": "listTags",
  "tags.create": "createTag",
  "tags.update": "updateTag",
  "tags.delete": "deleteTag",
  "tasks.mine": "listMyTasks",
  "tasks.list": "listTasks",
  "tasks.create": "createTask",
  "tasks.get": "getTask",
  "tasks.update": "updateTask",
  "links.create": "createTaskLink",
  "links.delete": "deleteTaskLink",
  "comments.list": "listComments",
  "comments.create": "createComment",
  "comments.update": "updateComment",
  "comments.delete": "deleteComment",
  "attachments.uploadToTask": "uploadTaskAttachment",
  "attachments.uploadToComment": "uploadCommentAttachment",
  "attachments.get": "getAttachment",
  "attachments.download": "downloadAttachment",
  "attachments.delete": "deleteAttachment",
  "activity.list": "listActivity",
  "inbox.list": "listInbox",
  "inbox.update": "markInboxRead",
};

export type { ActivityEvent, ApiKey, Attachment, Comment, InboxItem, LinkRelation, Status, Tag, Task, TaskLink, User, Workspace, RouteId };
export { ROUTES, buildPath };
export { z };
