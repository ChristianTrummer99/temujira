import { z } from "zod";

/**
 * Named capability scopes. Admins implicitly hold every scope; members hold only what is
 * assigned to them (users.scopes). Workspace *access* is separate: see
 * `users.workspace_access_all` / the `user_workspaces` allowlist.
 */
export const SCOPES = [
  {
    id: "users:manage",
    label: "Manage users",
    description: "Create, edit, and deactivate users, and assign their scopes and workspace access.",
  },
  {
    id: "api_keys:manage",
    label: "Manage others' API keys",
    description: "Mint and revoke API keys on behalf of other users.",
  },
  {
    id: "reservations:manage",
    label: "Manage agent reservations",
    description:
      "Admit managed agent identities and claim or release exclusive identity+ticket reservations.",
  },
  {
    id: "workspaces:create",
    label: "Create workspaces",
    description: "Create new workspaces.",
  },
  {
    id: "workspaces:manage",
    label: "Manage workspace settings",
    description: "Rename and archive workspaces; manage their statuses, fields, and tags.",
  },
  {
    id: "tasks:write",
    label: "Write tasks",
    description: "Create and edit tasks, links, comments, and attachments.",
  },
] as const;

export const SCOPE_IDS = SCOPES.map((s) => s.id) as [ScopeId, ...ScopeId[]];

export type ScopeId = (typeof SCOPES)[number]["id"];

export const ScopeSchema = z.enum(SCOPE_IDS);
export type Scope = z.infer<typeof ScopeSchema>;

export const scopeLabel = (id: string): string =>
  SCOPES.find((s) => s.id === id)?.label ?? id;
