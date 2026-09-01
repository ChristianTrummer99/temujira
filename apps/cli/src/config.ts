import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Shape of ~/.config/temujira/config.json. */
export interface CliConfig {
  url?: string;
  api_key?: string;
  /** Server-side id of api_key, so `tmj auth logout` can revoke it. */
  api_key_id?: string;
}

export type Env = Record<string, string | undefined>;

/** Config file path: $XDG_CONFIG_HOME/temujira/config.json, else ~/.config/temujira/config.json. */
export function configPath(env: Env = process.env): string {
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg && xdg.trim() !== "" ? xdg : path.join(env.HOME ?? os.homedir(), ".config");
  return path.join(base, "temujira", "config.json");
}

/** Read the config file; a missing or corrupt file yields {}. */
export function readConfig(env: Env = process.env): CliConfig {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(env), "utf8")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as CliConfig;
    }
  } catch {
    // missing or invalid file
  }
  return {};
}

/** Write the config file (dir 0700, file 0600). Returns the file path. */
export function writeConfig(cfg: CliConfig, env: Env = process.env): string {
  const file = configPath(env);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600); // writeFileSync mode only applies on creation
  return file;
}

/** Delete the config file if it exists. */
export function clearConfig(env: Env = process.env): void {
  try {
    fs.unlinkSync(configPath(env));
  } catch {
    // already gone
  }
}

export interface Settings {
  url?: string;
  apiKey?: string;
  /** Only set when the api key came from the config file. */
  apiKeyId?: string;
}

/** Resolution precedence: flags > env (TEMUJIRA_URL / TEMUJIRA_API_KEY) > config file. */
export function resolveSettings(
  flags: { url?: string; apiKey?: string } = {},
  env: Env = process.env,
): Settings {
  const cfg = readConfig(env);
  const url = flags.url ?? env.TEMUJIRA_URL ?? cfg.url;
  const apiKey = flags.apiKey ?? env.TEMUJIRA_API_KEY ?? cfg.api_key;
  const keyFromFile = flags.apiKey === undefined && env.TEMUJIRA_API_KEY === undefined;
  return {
    url: url || undefined,
    apiKey: apiKey || undefined,
    apiKeyId: keyFromFile ? cfg.api_key_id : undefined,
  };
}
