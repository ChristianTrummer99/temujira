import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

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
  writePrivateJson(file, cfg);
  return file;
}

/** Atomic replacement: interrupted writes never leave half a credential/checkpoint file. */
export function writePrivateJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function canonicalDirectory(directory: string): string {
  const canonical = fs.realpathSync(directory);
  if (!fs.statSync(canonical).isDirectory()) throw new Error("credential scope must be a directory");
  return canonical;
}

/** The binding lives in the private user config, never inside the project. */
export function directoryConfigPath(directory: string, env: Env = process.env): string {
  const hash = createHash("sha256").update(canonicalDirectory(directory)).digest("hex");
  return path.join(path.dirname(configPath(env)), "directories", `${hash}.json`);
}

export function writeDirectoryConfig(directory: string, cfg: CliConfig, env: Env = process.env): string {
  const file = directoryConfigPath(directory, env);
  writePrivateJson(file, { directory: canonicalDirectory(directory), url: cfg.url, api_key: cfg.api_key });
  return file;
}

export function clearDirectoryConfig(directory: string, env: Env = process.env): void {
  fs.rmSync(directoryConfigPath(directory, env), { force: true });
}

export function readDirectoryConfig(cwd = process.cwd(), env: Env = process.env): (CliConfig & { directory: string }) | undefined {
  let directory = canonicalDirectory(cwd);
  while (true) {
    const file = directoryConfigPath(directory, env);
    if (fs.existsSync(file)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        if (parsed.directory !== directory || typeof parsed.url !== "string" || !parsed.url || typeof parsed.api_key !== "string" || !parsed.api_key) throw new Error();
        return { directory, url: parsed.url, api_key: parsed.api_key };
      } catch {
        // Do not fall back to a different identity when an explicit binding is damaged.
        throw new Error("invalid directory credentials; use `tmj auth use-key` or `tmj auth forget --directory`");
      }
    }
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
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
  directory?: string;
}

/** Flags > explicit nearest directory binding > environment > shared config. */
export function resolveSettings(
  flags: { url?: string; apiKey?: string; globalAuth?: boolean } = {},
  env: Env = process.env,
  cwd = process.cwd(),
): Settings {
  const cfg = readConfig(env);
  const scoped = flags.globalAuth ? undefined : readDirectoryConfig(cwd, env);
  if (scoped) return {
    url: flags.url ?? scoped.url,
    apiKey: flags.apiKey ?? scoped.api_key,
    directory: scoped.directory,
  };
  const url = flags.url ?? env.TEMUJIRA_URL ?? cfg.url;
  const apiKey = flags.apiKey ?? env.TEMUJIRA_API_KEY ?? cfg.api_key;
  const keyFromFile = flags.apiKey === undefined && env.TEMUJIRA_API_KEY === undefined;
  return {
    url: url || undefined,
    apiKey: apiKey || undefined,
    apiKeyId: keyFromFile ? cfg.api_key_id : undefined,
  };
}
