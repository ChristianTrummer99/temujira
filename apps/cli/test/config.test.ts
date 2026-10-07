import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { clearConfig, clearDirectoryConfig, configPath, directoryConfigPath, readConfig, resolveSettings, writeConfig, writeDirectoryConfig } from "../src/config";

function tempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tmj-test-"));
}

describe("config", () => {
  it("computes the path under HOME/.config by default", () => {
    expect(configPath({ HOME: "/home/x" })).toBe("/home/x/.config/temujira/config.json");
  });

  it("respects XDG_CONFIG_HOME", () => {
    expect(configPath({ HOME: "/home/x", XDG_CONFIG_HOME: "/xdg" })).toBe(
      "/xdg/temujira/config.json",
    );
  });

  it("writes mode 0600 and round-trips", () => {
    const env = { HOME: tempHome() };
    const file = writeConfig({ url: "http://h", api_key: "tmj_k", api_key_id: "id1" }, env);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(readConfig(env)).toEqual({ url: "http://h", api_key: "tmj_k", api_key_id: "id1" });
    clearConfig(env);
    expect(readConfig(env)).toEqual({});
  });

  it("returns {} for a missing or corrupt file", () => {
    const env = { HOME: tempHome() };
    expect(readConfig(env)).toEqual({});
    const file = configPath(env);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "not json");
    expect(readConfig(env)).toEqual({});
  });

  it("precedence: flags > env > config file", () => {
    const base = { HOME: tempHome() };
    writeConfig({ url: "http://file", api_key: "file-key", api_key_id: "file-id" }, base);

    // file only
    expect(resolveSettings({}, base)).toEqual({
      url: "http://file",
      apiKey: "file-key",
      apiKeyId: "file-id",
    });

    // env beats file (and the file's key id no longer applies)
    const env = { ...base, TEMUJIRA_URL: "http://env", TEMUJIRA_API_KEY: "env-key" };
    expect(resolveSettings({}, env)).toEqual({
      url: "http://env",
      apiKey: "env-key",
      apiKeyId: undefined,
    });

    // flags beat env
    expect(resolveSettings({ url: "http://flag", apiKey: "flag-key" }, env)).toEqual({
      url: "http://flag",
      apiKey: "flag-key",
      apiKeyId: undefined,
    });

    // mixed: flag url + file api key
    expect(resolveSettings({ url: "http://flag" }, base)).toEqual({
      url: "http://flag",
      apiKey: "file-key",
      apiKeyId: "file-id",
    });
  });

  it("resolves to empty settings when nothing is configured", () => {
    expect(resolveSettings({}, { HOME: tempHome() })).toEqual({
      url: undefined,
      apiKey: undefined,
      apiKeyId: undefined,
    });
  });

  it("uses the nearest explicit directory binding, outside the repo, with a global override", () => {
    const home = tempHome();
    try {
      const project = path.join(home, "project"), child = path.join(project, "child"), sibling = path.join(home, "project-other");
      fs.mkdirSync(child, { recursive: true }); fs.mkdirSync(sibling);
      const env = { HOME: home, TEMUJIRA_URL: "http://shared", TEMUJIRA_API_KEY: "shared-key" };
      const file = writeDirectoryConfig(project, { url: "http://scoped", api_key: "scoped-key" }, env);
      expect(file.startsWith(path.join(home, ".config"))).toBe(true);
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      expect(fs.readdirSync(project)).toEqual(["child"]);
      expect(resolveSettings({}, env, child)).toMatchObject({ url: "http://scoped", apiKey: "scoped-key", directory: fs.realpathSync(project) });
      expect(resolveSettings({}, env, sibling)).toMatchObject({ url: "http://shared", apiKey: "shared-key" });
      expect(resolveSettings({ globalAuth: true }, env, child)).toMatchObject({ url: "http://shared", apiKey: "shared-key" });
      expect(resolveSettings({ apiKey: "explicit", url: "http://explicit" }, env, child)).toMatchObject({ url: "http://explicit", apiKey: "explicit" });
      writeDirectoryConfig(child, { url: "http://child", api_key: "child-key" }, env);
      expect(resolveSettings({}, env, child).apiKey).toBe("child-key");
      clearDirectoryConfig(child, env);
      expect(resolveSettings({}, env, child).apiKey).toBe("scoped-key");
      clearDirectoryConfig(project, env);
      expect(resolveSettings({}, env, child).apiKey).toBe("shared-key");
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });

  it("does not fall back to the shared identity when a directory binding is corrupt", () => {
    const home = tempHome();
    try {
      const env = { HOME: home, TEMUJIRA_API_KEY: "shared" };
      writeDirectoryConfig(home, { url: "http://scoped", api_key: "scoped" }, env);
      fs.writeFileSync(directoryConfigPath(home, env), "invalid");
      expect(() => resolveSettings({}, env, home)).toThrow("invalid directory credentials");
      expect(resolveSettings({ globalAuth: true }, env, home).apiKey).toBe("shared");
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });

  it("an imported key has no revocation id and replaces a prior login key", () => {
    const env = { HOME: tempHome() };
    try {
      writeConfig({ url: "http://server", api_key: "old", api_key_id: "owned" }, env);
      writeConfig({ url: "http://server", api_key: "shared" }, env);
      expect(readConfig(env)).toEqual({ url: "http://server", api_key: "shared" });
      expect(fs.statSync(configPath(env)).mode & 0o777).toBe(0o600);
    } finally { fs.rmSync(env.HOME, { recursive: true, force: true }); }
  });
});
