import type { RouteId } from "@temujira/shared";
import { COMMAND_ROUTES as ACTIVITY_ROUTES } from "./commands/activity";
import { COMMAND_ROUTES as API_ROUTES } from "./commands/api";
import { COMMAND_ROUTES as APIKEY_ROUTES } from "./commands/apikey";
import { COMMAND_ROUTES as ATTACH_ROUTES } from "./commands/attach";
import { COMMAND_ROUTES as AUTH_ROUTES } from "./commands/auth";
import { COMMAND_ROUTES as COMMENT_ROUTES } from "./commands/comment";
import { COMMAND_ROUTES as INBOX_ROUTES } from "./commands/inbox";
import { COMMAND_ROUTES as ME_ROUTES } from "./commands/me";
import { COMMAND_ROUTES as SETUP_ROUTES } from "./commands/setup";
import { COMMAND_ROUTES as STATUS_ROUTES } from "./commands/status";
import { COMMAND_ROUTES as TAG_ROUTES } from "./commands/tag";
import { COMMAND_ROUTES as TASK_ROUTES } from "./commands/task";
import { COMMAND_ROUTES as USER_ROUTES } from "./commands/user";
import { COMMAND_ROUTES as WORKSPACE_ROUTES } from "./commands/workspace";

/**
 * "group cmd" → the registry route ids that command exercises.
 * The parity test asserts every RouteId in ROUTES appears here at least once.
 */
export const COMMAND_ROUTE_MAP: Record<string, readonly RouteId[]> = {
  ...SETUP_ROUTES,
  ...AUTH_ROUTES,
  ...ME_ROUTES,
  ...APIKEY_ROUTES,
  ...USER_ROUTES,
  ...WORKSPACE_ROUTES,
  ...STATUS_ROUTES,
  ...TAG_ROUTES,
  ...TASK_ROUTES,
  ...COMMENT_ROUTES,
  ...ATTACH_ROUTES,
  ...ACTIVITY_ROUTES,
  ...INBOX_ROUTES,
  ...API_ROUTES,
};
