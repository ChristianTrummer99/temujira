import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { clearConfig, configPath, readConfig, resolveSettings, writeConfig } from "../src/config";

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
});
