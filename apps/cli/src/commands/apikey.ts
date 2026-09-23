import type { Command } from "commander";
import type { RouteId } from "@temujira/shared";
import { getCtx } from "../context";
import { emit, table, ts } from "../output";

export const COMMAND_ROUTES = {
  "apikey list": ["apiKeys.list"],
  "apikey create": ["apiKeys.create"],
  "apikey revoke": ["apiKeys.revoke"],
} as const satisfies Record<string, readonly RouteId[]>;

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
              ? ["ID", "USER", "NAME", "PREFIX", "LAST_USED", "REVOKED", "CREATED"]
              : ["ID", "NAME", "PREFIX", "LAST_USED", "REVOKED", "CREATED"],
            res.items.map((k) => [
              k.id,
              ...(opts.all ? [k.user_id] : []),
              k.name,
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
    .option("--user <id>", "mint the key for another user (admin only)")
    .action(async (opts: { name: string; user?: string }, cmd: Command) => {
      const ctx = getCtx(cmd);
      const res = await ctx.client.createApiKey({
        name: opts.name,
        ...(opts.user ? { user_id: opts.user } : {}),
      });
      emit(ctx.mode, {
        json: res,
        human: () =>
          [
            `created API key "${res.apiKey.name}" (${res.apiKey.id})`,
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
