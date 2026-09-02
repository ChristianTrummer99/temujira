import { describe, expect, it } from "vitest";
import { configFromEnv } from "../src/config";

describe("server environment configuration", () => {
  it("uses safe defaults when optional values are absent or blank", () => {
    const config = configFromEnv({
      NODE_ENV: "production",
      MAX_UPLOAD_MB: "",
      TEMUJIRA_ADMIN_EMAIL: "",
      TEMUJIRA_ADMIN_PASSWORD: "",
      TEMUJIRA_ADMIN_NAME: "Admin",
    });

    expect(config.maxUploadMb).toBe(50);
    expect(config.adminEmail).toBeUndefined();
    expect(config.adminPassword).toBeUndefined();
  });

  it("validates and normalizes headless admin provisioning", () => {
    const config = configFromEnv({
      TEMUJIRA_ADMIN_EMAIL: "Admin@Example.COM",
      TEMUJIRA_ADMIN_PASSWORD: "a-long-password",
      TEMUJIRA_ADMIN_NAME: "  Administrator  ",
    });

    expect(config.adminEmail).toBe("admin@example.com");
    expect(config.adminPassword).toBe("a-long-password");
    expect(config.adminName).toBe("Administrator");
  });

  it("rejects partial headless admin provisioning", () => {
    expect(() =>
      configFromEnv({ TEMUJIRA_ADMIN_EMAIL: "admin@example.com" }),
    ).toThrow(
      "TEMUJIRA_ADMIN_EMAIL and TEMUJIRA_ADMIN_PASSWORD must be set together",
    );
  });

  it.each([
    {
      TEMUJIRA_ADMIN_EMAIL: "not-an-email",
      TEMUJIRA_ADMIN_PASSWORD: "a-long-password",
    },
    {
      TEMUJIRA_ADMIN_EMAIL: "admin@example.com",
      TEMUJIRA_ADMIN_PASSWORD: "short",
    },
    {
      TEMUJIRA_ADMIN_EMAIL: "admin@example.com",
      TEMUJIRA_ADMIN_PASSWORD: "a-long-password",
      TEMUJIRA_ADMIN_NAME: "   ",
    },
  ])("rejects invalid headless admin values: %o", (env) => {
    expect(() => configFromEnv(env)).toThrow(
      "invalid TEMUJIRA_ADMIN_* configuration",
    );
  });

  it.each(["0", "-1", "not-a-number", "Infinity"])(
    "rejects invalid MAX_UPLOAD_MB=%s",
    (value) => {
      expect(() => configFromEnv({ MAX_UPLOAD_MB: value })).toThrow(
        "MAX_UPLOAD_MB must be a positive number",
      );
    },
  );

  it("accepts a positive MAX_UPLOAD_MB", () => {
    expect(configFromEnv({ MAX_UPLOAD_MB: "12.5" }).maxUploadMb).toBe(12.5);
  });

  it.each([
    [undefined, undefined],
    ["", undefined],
    ["auto", undefined],
    ["yes", true],
    ["0", false],
  ] as const)("parses COOKIE_SECURE=%s", (value, expected) => {
    expect(configFromEnv({ COOKIE_SECURE: value }).cookieSecure).toBe(expected);
  });

  it("rejects an invalid COOKIE_SECURE value", () => {
    expect(() => configFromEnv({ COOKIE_SECURE: "sometimes" })).toThrow(
      "COOKIE_SECURE must be",
    );
  });
});
