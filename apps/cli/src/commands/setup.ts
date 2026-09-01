import os from "node:os";
import type { Command } from "commander";
import type { RouteId } from "@temujira/shared";
import { writeConfig } from "../config";
import { getCtx } from "../context";
import { CliError, EXIT_CODES } from "../exit";
import { emit, userLine } from "../output";

export const COMMAND_ROUTES = {
  setup: ["setup.status", "setup.run", "apiKeys.create", "auth.logout"],
} as const satisfies Record<string, readonly RouteId[]>;

export function registerSetup(program: Command): void {
  program
    .command("setup")
    .description("First-run setup: create the first admin, mint a CLI API key, save config")
    .requiredOption("--email <email>", "admin email address")
    .requiredOption("--password <password>", "admin password (min 8 characters)")
    .option("--name <name>", "admin display name", "Admin")
    .action(async (opts: { email: string; password: string; name: string }, cmd: Command) => {
      const ctx = getCtx(cmd, { requireAuth: false });
      const { needsSetup } = await ctx.client.setupStatus();
      if (!needsSetup) {
        throw new CliError("setup already completed — use `tmj auth login`", EXIT_CODES.invalid);
      }
      const { user, token: sessionToken } = await ctx.client.runSetup({
        email: opts.email,
        name: opts.name,
        password: opts.password,
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
          [
            `setup complete on ${ctx.url}`,
            `signed in as ${userLine(user)}`,
            `API key "${keyName}" saved to ${file}`,
          ].join("\n"),
        quiet: () => user.id,
      });
    });
}
