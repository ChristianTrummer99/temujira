import type { Command } from "commander";
import { SCOPE_IDS, type ApiKey, type RouteId, type ScopeId } from "@temujira/shared";
import { getCtx } from "../context";
import { CliError, EXIT_CODES } from "../exit";
import { emit, table, truncate, ts } from "../output";
import { collect } from "../util";

export const COMMAND_ROUTES = {
  "apikey list": ["apiKeys.list"],
  "apikey create": ["apiKeys.create", "workspaces.get"],
  "apikey revoke": ["apiKeys.revoke"],
} as const satisfies Record<string, readonly RouteId[]>;

function scopeLimit(key: ApiKey): string {
  if (key.scopes === null) return "inherit";
  return key.scopes.length ? truncate(key.scopes.join(","), 32) : "none";
}

function workspaceLimit(key: ApiKey): string {
  if (key.workspace_ids === null) return "inherit";
  return key.workspace_ids.length ? `${key.workspace_ids.length} allowed` : "none";
}

export function registerApikey(program: Command): void {
  const apikey = program.command("apikey").description("Manage API keys");

  apikey
    .command("list")
    .description("List your API keys (admins: --user <id> or --all)")
    .option("--user <id>", "list another user's keys (admin only)")
    .option("--all", "list every user's keys (admin only)")
    .action(async (opts: { user?: string; all?: boolean }, cmd: Command) => {
      const ctx = getCtx(cmd);
      const res = await ctx.client.listApiKeys(
        opts.all ? { all: true } : opts.user ? { user_id: opts.user } : {}
      );
      emit(ctx.mode, {
        json: res,
        human: () =>
          table(
            opts.all
              ? ["ID", "USER", "NAME", "SCOPES", "WORKSPACES", "PREFIX", "LAST_USED", "REVOKED", "CREATED"]
              : ["ID", "NAME", "SCOPES", "WORKSPACES", "PREFIX", "LAST_USED", "REVOKED", "CREATED"],
            res.items.map((k) => [
              k.id,
              ...(opts.all ? [k.user_id] : []),
              k.name,
              scopeLimit(k),
              workspaceLimit(k),
              k.token_prefix,
              ts(k.last_used_at),
              ts(k.revoked_at),
              ts(k.created_at),
            ]),
          ),
        quiet: () => res.items.map((k) => k.id).join("\n"),
      });
    });

  apikey
    .command("create")
    .description("Create an API key; the token is shown exactly once")
    .requiredOption("--name <name>", "key name")
    .option("--user <id>", "mint the key for another user (api_keys:manage)")
    .option("--scope <scope>", "limit the key to this capability scope (repeatable; omit to inherit)", collect, [] as string[])
    .option("--no-scopes", "give the key no write scopes")
    .option("--workspace <idOrKey>", "limit the key to this workspace (repeatable; omit to inherit)", collect, [] as string[])
    .option("--no-workspaces", "give the key access to no workspaces")
    .action(async (opts: { name: string; user?: string; scope: string[]; scopes: boolean; workspace: string[]; workspaces: boolean }, cmd: Command) => {
      const unknown = opts.scope.filter((scope) => !(SCOPE_IDS as readonly string[]).includes(scope));
      if (unknown.length > 0) {
        throw new CliError(`unknown scope "${unknown[0]}" — expected one of: ${SCOPE_IDS.join(", ")}`, EXIT_CODES.usage);
      }
      const ctx = getCtx(cmd);
      const body: Parameters<typeof ctx.client.createApiKey>[0] = { name: opts.name };
      if (opts.user) body.user_id = opts.user;
      if (opts.scope.length > 0) body.scopes = [...new Set(opts.scope)] as ScopeId[];
      else if (!opts.scopes) body.scopes = [];
      if (opts.workspace.length > 0) {
        const ids: string[] = [];
        for (const ref of opts.workspace) ids.push((await ctx.client.getWorkspace(ref)).workspace.id);
        body.workspace_ids = [...new Set(ids)];
      } else if (!opts.workspaces) body.workspace_ids = [];
      const res = await ctx.client.createApiKey(body);
      emit(ctx.mode, {
        json: res,
        human: () =>
          [
            `created API key "${res.apiKey.name}" (${res.apiKey.id})`,
            `scopes: ${scopeLimit(res.apiKey)}`,
            `workspaces: ${workspaceLimit(res.apiKey)}`,
            "",
            `  ${res.token}`,
            "",
            "this token is shown only once — store it now",
          ].join("\n"),
        quiet: () => res.apiKey.id,
      });
    });

  apikey
    .command("revoke")
    .description("Revoke an API key (owner or admin)")
    .argument("<id>", "API key id")
    .action(async (id: string, _opts: Record<string, never>, cmd: Command) => {
      const ctx = getCtx(cmd);
      const res = await ctx.client.revokeApiKey(id);
      emit(ctx.mode, {
        json: res,
        human: () => `revoked API key ${id}`,
        quiet: () => id,
      });
    });
}
