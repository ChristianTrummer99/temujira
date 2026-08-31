import { HttpError } from "../errors";
import type { AppContext, Handlers, RouteHandler } from "./types";

const nyi = (id: string): RouteHandler => () => {
  throw new HttpError("server_error", `${id} is not implemented yet`);
};

/**
 * Placeholder handlers for the resources built in Phase 1. Each stub 500s loudly; the
 * server implementation agent replaces this file with real per-resource route modules.
 */
export function stubHandlers(_ctx: AppContext): Omit<
  Handlers,
  | "meta.health"
  | "meta.openapi"
  | "setup.status"
  | "setup.run"
  | "auth.login"
  | "auth.logout"
  | "auth.me"
  | "auth.updateMe"
  | "apiKeys.list"
  | "apiKeys.create"
  | "apiKeys.revoke"
> {
  return {
    "users.list": nyi("users.list"),
    "users.create": nyi("users.create"),
    "users.get": nyi("users.get"),
    "users.update": nyi("users.update"),
    "users.deactivate": nyi("users.deactivate"),
    "workspaces.list": nyi("workspaces.list"),
    "workspaces.create": nyi("workspaces.create"),
    "workspaces.get": nyi("workspaces.get"),
    "workspaces.update": nyi("workspaces.update"),
    "statuses.list": nyi("statuses.list"),
    "statuses.create": nyi("statuses.create"),
    "statuses.update": nyi("statuses.update"),
    "statuses.reorder": nyi("statuses.reorder"),
    "statuses.delete": nyi("statuses.delete"),
    "tasks.list": nyi("tasks.list"),
    "tasks.create": nyi("tasks.create"),
    "tasks.get": nyi("tasks.get"),
    "tasks.update": nyi("tasks.update"),
    "comments.list": nyi("comments.list"),
    "comments.create": nyi("comments.create"),
    "comments.update": nyi("comments.update"),
    "comments.delete": nyi("comments.delete"),
    "attachments.uploadToTask": nyi("attachments.uploadToTask"),
    "attachments.uploadToComment": nyi("attachments.uploadToComment"),
    "attachments.get": nyi("attachments.get"),
    "attachments.download": nyi("attachments.download"),
    "attachments.delete": nyi("attachments.delete"),
  };
}
