import type { Command } from "commander";
import { TemujiraClient } from "@temujira/client";
import { resolveSettings, type Settings } from "./config";
import { CliError, EXIT_CODES } from "./exit";
import { resolveMode, type OutputMode } from "./output";

export interface GlobalOpts {
  url?: string;
  apiKey?: string;
  json?: boolean;
  quiet?: boolean;
}

export interface Ctx {
  client: TemujiraClient;
  mode: OutputMode;
  url: string;
  settings: Settings;
}

/**
 * Build the per-invocation context from global flags + env + config file.
 * Missing URL or (when required) missing API key is an auth/config error, exit 3.
 */
export function getCtx(cmd: Command, opts: { requireAuth?: boolean } = {}): Ctx {
  const g = cmd.optsWithGlobals<GlobalOpts>();
  const settings = resolveSettings({ url: g.url, apiKey: g.apiKey });
  const mode = resolveMode(g);
  if (!settings.url) {
    throw new CliError(
      "no server URL configured — pass --url, set TEMUJIRA_URL, or run `tmj setup` / `tmj auth login`",
      EXIT_CODES.auth,
    );
  }
  if ((opts.requireAuth ?? true) && !settings.apiKey) {
    throw new CliError(
      "not authenticated — pass --api-key, set TEMUJIRA_API_KEY, or run `tmj auth login`",
      EXIT_CODES.auth,
    );
  }
  return {
    client: new TemujiraClient({ baseUrl: settings.url, token: settings.apiKey }),
    mode,
    url: settings.url,
    settings,
  };
}
