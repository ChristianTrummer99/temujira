import os from "node:os";
import type { Command } from "commander";
import { TemujiraClient } from "@temujira/client";
import type { RouteId } from "@temujira/shared";
import { clearConfig, configPath, readConfig, writeConfig } from "../config";
import { getCtx, type GlobalOpts } from "../context";
import { emit, resolveMode, userLine } from "../output";
import { promptHidden } from "../prompt";

export const COMMAND_ROUTES = {
  "auth login": ["auth.login", "apiKeys.create", "auth.logout"],
  "auth whoami": ["auth.me"],
  "auth logout": ["apiKeys.revoke"],
} as const satisfies Record<string, readonly RouteId[]>;

export function registerAuth(program: Command): void {
  const auth = program.command("auth").description("Log in / out and inspect the current user");

  auth
    .command("login")
    .description("Log in with email+password, mint a CLI API key, and save it to the config file")
    .requiredOption("--email <email>", "account email")
    .option("--password <password>", "password (omitted: prompted with hidden echo)")
    .action(async (opts: { email: string; password?: string }, cmd: Command) => {
      const ctx = getCtx(cmd, { requireAuth: false });
      const password = opts.password ?? (await promptHidden("Password: "));
      const { user, token: sessionToken } = await ctx.client.login({
        email: opts.email,
        password,
      });
      ctx.client.setToken(sessionToken);
      const keyName = `cli@${os.hostname()}`;
      const key = await ctx.client.createApiKey({ name: keyName });
      try {
        await ctx.client.logout(); // destroy the bootstrap session; the API key takes over
      } catch {
        // best effort
      }
      ctx.client.setToken(key.token);
      const file = writeConfig({ url: ctx.url, api_key: key.token, api_key_id: key.apiKey.id });
      emit(ctx.mode, {
        json: { user, apiKey: key.apiKey, token: key.token },
        human: () =>
          [`logged in as ${userLine(user)}`, `API key "${keyName}" saved to ${file}`].join("\n"),
        quiet: () => user.id,
      });
    });

  auth
    .command("whoami")
    .description("Show the authenticated user")
    .action(async (_opts: Record<string, never>, cmd: Command) => {
      const ctx = getCtx(cmd);
      const { user } = await ctx.client.me();
      emit(ctx.mode, {
        json: { user },
        human: () => userLine(user),
        quiet: () => user.id,
      });
    });

  auth
    .command("logout")
    .description("Revoke the saved CLI API key server-side and delete the config file")
    .action(async (_opts: Record<string, never>, cmd: Command) => {
      const mode = resolveMode(cmd.optsWithGlobals<GlobalOpts>());
      const cfg = readConfig();
      if (!cfg.url && !cfg.api_key) {
        emit(mode, {
          json: { ok: true, revoked: false },
          human: () => "no saved credentials — nothing to do",
          quiet: () => undefined,
        });
        return;
      }
      let revoked = false;
      if (cfg.url && cfg.api_key && cfg.api_key_id) {
        const client = new TemujiraClient({ baseUrl: cfg.url, token: cfg.api_key });
        try {
          await client.revokeApiKey(cfg.api_key_id);
          revoked = true;
        } catch {
          // already revoked or unreachable — still clear the local config
        }
      }
      clearConfig();
      emit(mode, {
        json: { ok: true, revoked },
        human: () =>
          `logged out (${revoked ? "API key revoked" : "API key not revoked server-side"}); removed ${configPath()}`,
        quiet: () => undefined,
      });
    });
}
