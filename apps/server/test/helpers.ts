import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp, type BuiltApp } from "../src/app";
import type { ServerConfig } from "../src/config";

export async function makeTestApp(overrides: Partial<ServerConfig> = {}): Promise<BuiltApp & { cleanup: () => void }> {
  const dataDir = mkdtempSync(join(tmpdir(), "tmj-test-"));
  const built = await buildApp({
    dataDir,
    maxUploadMb: 5,
    cookieSecure: false,
    devOrigins: [],
    version: "test",
    ...overrides,
  });
  return {
    ...built,
    cleanup: () => {
      built.ctx.sqlite.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export const jsonReq = (method: string, body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method,
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** Run first-time setup and return the admin's session token. */
export async function setupAdmin(
  app: BuiltApp["app"],
  email = "admin@example.com",
  password = "correct-horse-battery",
): Promise<{ token: string; userId: string }> {
  const res = await app.request("/api/v1/setup", jsonReq("POST", { email, name: "Admin", password }));
  if (res.status !== 200) throw new Error(`setup failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { user: { id: string }; token: string };
  return { token: data.token, userId: data.user.id };
}
