import os from "node:os";
import fs from "node:fs";
import type { Command } from "commander";
import { TemujiraClient } from "@temujira/client";
import type { RouteId } from "@temujira/shared";
import { clearConfig, clearDirectoryConfig, configPath, readConfig, resolveSettings, writeConfig, writeDirectoryConfig } from "../config";
import { CliError, EXIT_CODES } from "../exit";
import { getCtx, type GlobalOpts } from "../context";
import { emit, resolveMode, userLine } from "../output";
import { promptHidden } from "../prompt";

export const COMMAND_ROUTES = {
  "auth login": ["auth.login", "apiKeys.create", "auth.logout"],
  "auth whoami": ["auth.me"],
  "auth logout": ["apiKeys.revoke"],
  "auth use-key": ["auth.me"],
  "auth status": ["auth.me"],
  "auth forget": [],
} as const satisfies Record<string, readonly RouteId[]>;

export function registerAuth(program: Command): void {
  const auth = program.command("auth").description("Log in / out and inspect the current user");

  auth.command("use-key")
    .description("Verify and save an existing shared API key; never prints or creates a key")
    .requiredOption("--key-stdin", "read the API key from standard input")
    .option("--directory <path>", "use this key only in this directory and its children")
    .action(async (opts: { directory?: string }, cmd: Command) => {
      if (process.stdin.isTTY) throw new CliError("pipe the API key to standard input", EXIT_CODES.usage);
      const key = fs.readFileSync(0, "utf8").trim();
      if (!key.startsWith("tmj_") || /\s/.test(key)) throw new CliError("standard input must contain one API key", EXIT_CODES.usage);
      const flags = cmd.optsWithGlobals<GlobalOpts>();
      const settings = resolveSettings({ url: flags.url, globalAuth: true });
      if (!settings.url) throw new CliError("supply --url or set TEMUJIRA_URL", EXIT_CODES.auth);
      // Verify before replacing any stored credentials. Keep no revocation id for an imported key.
      const { user } = await new TemujiraClient({ baseUrl: settings.url, token: key }).me();
      if (user.exclusive_identity) throw new CliError("this identity is exclusive; use a shared identity for saved credentials", EXIT_CODES.auth);
      const cfg = { url: settings.url, api_key: key };
      if (opts.directory) writeDirectoryConfig(opts.directory, cfg); else writeConfig(cfg);
      emit(resolveMode(flags), { json: { user, scope: opts.directory ? "directory" : "shared" }, human: () => `Saved ${opts.directory ? "directory" : "shared"} credentials for ${userLine(user)}`, quiet: () => user.id });
    });

  auth.command("status").description("Show the active identity, server, and credential source without the key")
    .action(async (_opts, cmd: Command) => {
      const ctx = getCtx(cmd);
      const { user } = await ctx.client.me();
      const flags = cmd.optsWithGlobals<GlobalOpts>();
      const source = flags.apiKey ? "flag" : ctx.settings.directory ? "directory" : process.env.TEMUJIRA_API_KEY ? "environment" : "shared config";
      const result = { user, url: ctx.url, source, ...(ctx.settings.directory ? { directory: ctx.settings.directory } : {}) };
      emit(ctx.mode, { json: result, human: () => `${userLine(user)}\nServer: ${ctx.url}\nCredentials: ${source}${ctx.settings.directory ? ` (${ctx.settings.directory})` : ""}`, quiet: () => user.id });
    });

  auth.command("forget").description("Remove a saved credential without revoking the shared API key")
    .option("--directory <path>", "remove only this exact directory binding")
    .action(async (opts: { directory?: string }, cmd: Command) => {
      if (opts.directory) clearDirectoryConfig(opts.directory); else clearConfig();
      emit(resolveMode(cmd.optsWithGlobals<GlobalOpts>()), { json: { ok: true, revoked: false }, human: () => "Removed saved credentials. The API key is still active.", quiet: () => undefined });
    });

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
