import type { TemujiraClient } from "@temujira/client";
import { CliError, EXIT_CODES } from "./exit";

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isUlid(value: string): boolean {
  return ULID_RE.test(value);
}

/**
 * Resolve --assignee/--user specs client-side, staying pure-API:
 *   "me"          → the authenticated user's id (auth.me)
 *   contains "@"  → exact case-insensitive email match over users.list (miss → exit 4)
 *   anything else → treated as a user id and passed through
 */
export async function resolveUserId(client: TemujiraClient, spec: string): Promise<string> {
  if (spec === "me") {
    const { user } = await client.me();
    return user.id;
  }
  if (spec.includes("@")) {
    const { items } = await client.listUsers();
    const needle = spec.toLowerCase();
    const user = items.find((u) => u.email.toLowerCase() === needle);
    if (!user) throw new CliError(`no user with email ${spec}`, EXIT_CODES.notFound);
    return user.id;
  }
  return spec;
}

/**
 * Resolve --tag specs client-side: ULIDs pass through; anything else is a
 * case-insensitive tag-name lookup within the workspace (miss → exit 4).
 * tags.list is fetched at most once, and only when a name is actually present.
 */
export async function resolveTagIds(
  client: TemujiraClient,
  workspace: string,
  specs: readonly string[],
): Promise<string[]> {
  if (specs.every(isUlid)) return [...specs];
  const { items } = await client.listTags(workspace);
  const byName = new Map(items.map((t) => [t.name.trim().toLowerCase(), t.id]));
  return specs.map((spec) => {
    if (isUlid(spec)) return spec;
    const id = byName.get(spec.trim().toLowerCase());
    if (!id) {
      throw new CliError(`no tag named "${spec}" in workspace ${workspace}`, EXIT_CODES.notFound);
    }
    return id;
  });
}

/** Single-spec form of {@link resolveTagIds} (e.g. the `task list --tag` filter). */
export async function resolveTagId(
  client: TemujiraClient,
  workspace: string,
  spec: string,
): Promise<string> {
  const [id] = await resolveTagIds(client, workspace, [spec]);
  return id as string;
}

/**
 * Resolve --status specs client-side: a ULID passes through; anything else is a
 * case-insensitive status-name lookup within the workspace (miss → exit 4).
 */
export async function resolveStatusId(
  client: TemujiraClient,
  workspace: string,
  spec: string,
): Promise<string> {
  if (isUlid(spec)) return spec;
  const { items } = await client.listStatuses(workspace);
  const needle = spec.trim().toLowerCase();
  const status = items.find((s) => s.name.toLowerCase() === needle);
  if (!status) {
    throw new CliError(`no status named "${spec}" in workspace ${workspace}`, EXIT_CODES.notFound);
  }
  return status.id;
}
