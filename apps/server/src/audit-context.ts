import { AsyncLocalStorage } from "node:async_hooks";

export interface ActivityRecord {
  workspaceId?: string | null;
  taskId?: string | null;
  actorId: string;
  action: string;
  metadata?: Record<string, unknown>;
  visibility?: "workspace" | "private" | "admin";
  ownerId?: string | null;
  relatedWorkspaceId?: string | null;
}

/** Request-local collection keeps existing semantic events without duplicate audit rows. */
export const auditContext = new AsyncLocalStorage<ActivityRecord[]>();
