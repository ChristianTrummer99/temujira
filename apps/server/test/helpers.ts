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

let emailCounter = 0;
/** Unique email per call so test files can create many users without collisions. */
export const uniqueEmail = (prefix = "user") => `${prefix}-${++emailCounter}@example.com`;

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

async function expectOk<T>(res: Response, what: string): Promise<T> {
  if (res.status !== 200) throw new Error(`${what} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** Admin-create a human user (member by default) and log them in. */
export async function makeMember(
  app: BuiltApp["app"],
  adminToken: string,
  opts: { email?: string; name?: string; password?: string; role?: "admin" | "member" } = {},
): Promise<{ userId: string; token: string; email: string; password: string }> {
  const email = opts.email ?? uniqueEmail("member");
  const password = opts.password ?? "member-pass-123";
  const created = await expectOk<{ user: { id: string } }>(
    await app.request(
      "/api/v1/users",
      jsonReq("POST", { email, name: opts.name ?? "Member", password, role: opts.role ?? "member" }, bearer(adminToken)),
    ),
    "makeMember create",
  );
  const login = await expectOk<{ token: string }>(
    await app.request("/api/v1/auth/login", jsonReq("POST", { email, password })),
    "makeMember login",
  );
  return { userId: created.user.id, token: login.token, email, password };
}

/** Admin-create an agent account and mint an API key for it. */
export async function makeAgentWithKey(
  app: BuiltApp["app"],
  adminToken: string,
  name = "Agent",
): Promise<{ userId: string; keyId: string; keyToken: string; email: string }> {
  const email = uniqueEmail("agent");
  const created = await expectOk<{ user: { id: string } }>(
    await app.request("/api/v1/users", jsonReq("POST", { email, name, is_agent: true }, bearer(adminToken))),
    "makeAgentWithKey create",
  );
  const key = await expectOk<{ apiKey: { id: string }; token: string }>(
    await app.request(
      "/api/v1/api-keys",
      jsonReq("POST", { name: `${name} key`, user_id: created.user.id }, bearer(adminToken)),
    ),
    "makeAgentWithKey key",
  );
  return { userId: created.user.id, keyId: key.apiKey.id, keyToken: key.token, email };
}

export interface WorkspaceJson {
  id: string;
  name: string;
  key: string;
  archived_at: number | null;
}

export async function makeWorkspace(
  app: BuiltApp["app"],
  token: string,
  key: string,
  name = `${key} workspace`,
): Promise<WorkspaceJson> {
  const data = await expectOk<{ workspace: WorkspaceJson }>(
    await app.request("/api/v1/workspaces", jsonReq("POST", { name, key }, bearer(token))),
    "makeWorkspace",
  );
  return data.workspace;
}

export interface TaskJson {
  id: string;
  workspace_id: string;
  number: number;
  key: string;
  title: string;
  description: string;
  status_id: string;
  status: { id: string; name: string; position: number };
  assignee_id: string | null;
  assignee: { id: string } | null;
  archived_at: number | null;
  created_at: number;
  updated_at: number;
  attachments?: Array<{ id: string }>;
  tags: Array<{ id: string; name: string; color: string; workspace_id: string }>;
}

export async function makeTask(
  app: BuiltApp["app"],
  token: string,
  wsIdOrKey: string,
  input: { title: string; description?: string; status_id?: string; assignee_id?: string | null; tag_ids?: string[] },
): Promise<TaskJson> {
  const data = await expectOk<{ task: TaskJson }>(
    await app.request(`/api/v1/workspaces/${wsIdOrKey}/tasks`, jsonReq("POST", input, bearer(token))),
    "makeTask",
  );
  return data.task;
}

/** RequestInit for a single-field multipart file upload. */
export function fileUpload(
  bytes: string | Uint8Array<ArrayBuffer>,
  filename: string,
  type: string,
  headers: Record<string, string> = {},
): RequestInit {
  const fd = new FormData();
  fd.append("file", new File([bytes], filename, { type }));
  return { method: "POST", body: fd, headers };
}
