import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, jsonReq, makeMember, makeTestApp, setupAdmin, uniqueEmail } from "./helpers";

let t: Awaited<ReturnType<typeof makeTestApp>>;
let admin: { token: string; userId: string };

interface UserJson {
  id: string;
  email: string;
  name: string;
  role: string;
  is_agent: boolean;
  deactivated_at: number | null;
  created_at: number;
  updated_at: number;
}

beforeAll(async () => {
  t = await makeTestApp();
  admin = await setupAdmin(t.app);
});
afterAll(() => t.cleanup());

describe("users.create", () => {
  it("creates a human member (password required, role defaults to member)", async () => {
    const email = uniqueEmail("human");
    const res = await t.app.request(
      "/api/v1/users",
      jsonReq("POST", { email, name: "Human", password: "password-123" }, bearer(admin.token)),
    );
    expect(res.status).toBe(200);
    const { user } = (await res.json()) as { user: UserJson };
    expect(user.email).toBe(email);
    expect(user.role).toBe("member");
    expect(user.is_agent).toBe(false);
    expect(user.deactivated_at).toBeNull();

    const login = await t.app.request("/api/v1/auth/login", jsonReq("POST", { email, password: "password-123" }));
    expect(login.status).toBe(200);
  });

  it("lowercases the email and returns 409 on duplicates", async () => {
    const email = uniqueEmail("dup");
    const first = await t.app.request(
      "/api/v1/users",
      jsonReq("POST", { email, name: "A", password: "password-123" }, bearer(admin.token)),
    );
    expect(first.status).toBe(200);
    const second = await t.app.request(
      "/api/v1/users",
      jsonReq("POST", { email: email.toUpperCase(), name: "B", password: "password-123" }, bearer(admin.token)),
    );
    expect(second.status).toBe(409);
    expect(((await second.json()) as { error: { code: string } }).error.code).toBe("conflict");
  });

  it("creates an agent account (no password, cannot log in with one)", async () => {
    const email = uniqueEmail("agent");
    const res = await t.app.request(
      "/api/v1/users",
      jsonReq("POST", { email, name: "Bot", is_agent: true }, bearer(admin.token)),
    );
    expect(res.status).toBe(200);
    const { user } = (await res.json()) as { user: UserJson };
    expect(user.is_agent).toBe(true);

    const login = await t.app.request("/api/v1/auth/login", jsonReq("POST", { email, password: "whatever-123" }));
    expect(login.status).toBe(401);
  });

  it("rejects an agent with a password and a human without one (validation)", async () => {
    const withPw = await t.app.request(
      "/api/v1/users",
      jsonReq("POST", { email: uniqueEmail(), name: "X", is_agent: true, password: "password-123" }, bearer(admin.token)),
    );
    expect(withPw.status).toBe(400);
    const withoutPw = await t.app.request(
      "/api/v1/users",
      jsonReq("POST", { email: uniqueEmail(), name: "Y" }, bearer(admin.token)),
    );
    expect(withoutPw.status).toBe(400);
  });
});

describe("users.list + users.get", () => {
  it("lists users created_at ascending with the admin first", async () => {
    const res = await t.app.request("/api/v1/users", { headers: bearer(admin.token) });
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as { items: UserJson[] };
    expect(items.length).toBeGreaterThan(2);
    expect(items[0]!.id).toBe(admin.userId);
    for (let i = 1; i < items.length; i++) {
      expect(items[i]!.created_at).toBeGreaterThanOrEqual(items[i - 1]!.created_at);
    }
  });

  it("gets one user and 404s on a missing id", async () => {
    const ok = await t.app.request(`/api/v1/users/${admin.userId}`, { headers: bearer(admin.token) });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { user: UserJson }).user.id).toBe(admin.userId);

    const missing = await t.app.request("/api/v1/users/01ARZ3NDEKTSV4RRFFQ69G5FAV", { headers: bearer(admin.token) });
    expect(missing.status).toBe(404);
  });

  it("excludes deactivated users unless include_deactivated", async () => {
    const m = await makeMember(t.app, admin.token);
    const del = await t.app.request(`/api/v1/users/${m.userId}`, { method: "DELETE", headers: bearer(admin.token) });
    expect(del.status).toBe(200);

    const plain = await t.app.request("/api/v1/users", { headers: bearer(admin.token) });
    const plainItems = ((await plain.json()) as { items: UserJson[] }).items;
    expect(plainItems.some((u) => u.id === m.userId)).toBe(false);

    const all = await t.app.request("/api/v1/users?include_deactivated=1", { headers: bearer(admin.token) });
    const allItems = ((await all.json()) as { items: UserJson[] }).items;
    expect(allItems.some((u) => u.id === m.userId)).toBe(true);
  });
});

describe("users.search (mention autocomplete)", () => {
  let zeta: { userId: string; token: string; email: string };
  let alpha: { userId: string };
  let gone: { userId: string };

  const search = async (qs: string): Promise<UserJson[]> => {
    const res = await t.app.request(`/api/v1/users/search${qs}`, { headers: bearer(admin.token) });
    expect(res.status).toBe(200);
    return ((await res.json()) as { items: UserJson[] }).items;
  };

  beforeAll(async () => {
    zeta = await makeMember(t.app, admin.token, { name: "Zeta Searchable", email: "zeta-search@example.com" });
    alpha = await makeMember(t.app, admin.token, { name: "Alpha Searchable", email: "alpha-search@example.com" });
    gone = await makeMember(t.app, admin.token, { name: "Ghost Searchable", email: "ghost-search@example.com" });
    await t.app.request(`/api/v1/users/${gone.userId}`, { method: "DELETE", headers: bearer(admin.token) });
  });

  it("is reachable at /users/search — never captured by /users/:id", async () => {
    const res = await t.app.request("/api/v1/users/search?q=Searchable", { headers: bearer(admin.token) });
    expect(res.status).toBe(200); // a 404 here means /users/:id shadowed the literal route
    expect(((await res.json()) as { items: UserJson[] }).items.length).toBeGreaterThan(0);
  });

  it("matches name substrings case-insensitively, ordered by name", async () => {
    const items = await search("?q=searchABLE");
    // Deactivated users never appear.
    expect(items.map((u) => u.id)).toEqual([alpha.userId, zeta.userId]);
    expect(items.some((u) => u.id === gone.userId)).toBe(false);
  });

  it("matches email substrings too", async () => {
    const items = await search("?q=zeta-search@");
    expect(items.map((u) => u.id)).toEqual([zeta.userId]);
    expect(items[0]!.email).toBe(zeta.email);
  });

  it("honors limit and returns an empty list for no match", async () => {
    expect((await search("?q=Searchable&limit=1")).map((u) => u.id)).toEqual([alpha.userId]);
    expect(await search("?q=definitely-nobody")).toEqual([]);
  });

  it("treats LIKE wildcards literally and validates the query", async () => {
    expect(await search(`?q=${encodeURIComponent("%")}`)).toEqual([]);
    expect(await search(`?q=${encodeURIComponent("_")}`)).toEqual([]);

    const noQ = await t.app.request("/api/v1/users/search", { headers: bearer(admin.token) });
    expect(noQ.status).toBe(400);
    const badLimit = await t.app.request("/api/v1/users/search?q=a&limit=999", { headers: bearer(admin.token) });
    expect(badLimit.status).toBe(400);
  });

  it("is open to members, not just admins", async () => {
    const m = await makeMember(t.app, admin.token);
    const res = await t.app.request("/api/v1/users/search?q=Searchable", { headers: bearer(m.token) });
    expect(res.status).toBe(200);
  });
});

describe("users.update", () => {
  it("renames and promotes/demotes when another active admin exists", async () => {
    const m = await makeMember(t.app, admin.token);
    const rename = await t.app.request(
      `/api/v1/users/${m.userId}`,
      jsonReq("PATCH", { name: "New Name" }, bearer(admin.token)),
    );
    expect(rename.status).toBe(200);
    expect(((await rename.json()) as { user: UserJson }).user.name).toBe("New Name");

    const promote = await t.app.request(
      `/api/v1/users/${m.userId}`,
      jsonReq("PATCH", { role: "admin" }, bearer(admin.token)),
    );
    expect(((await promote.json()) as { user: UserJson }).user.role).toBe("admin");

    const demote = await t.app.request(
      `/api/v1/users/${m.userId}`,
      jsonReq("PATCH", { role: "member" }, bearer(admin.token)),
    );
    expect(((await demote.json()) as { user: UserJson }).user.role).toBe("member");
  });

  it("refuses to demote the last active admin (409)", async () => {
    // admin is the only active admin at this point.
    const res = await t.app.request(
      `/api/v1/users/${admin.userId}`,
      jsonReq("PATCH", { role: "member" }, bearer(admin.token)),
    );
    expect(res.status).toBe(409);
  });

  it("allows demoting a deactivated admin even when one active admin remains", async () => {
    const second = await makeMember(t.app, admin.token, { role: "admin" });
    const deact = await t.app.request(`/api/v1/users/${second.userId}`, {
      method: "DELETE",
      headers: bearer(admin.token),
    });
    expect(deact.status).toBe(200);
    const demote = await t.app.request(
      `/api/v1/users/${second.userId}`,
      jsonReq("PATCH", { role: "member" }, bearer(admin.token)),
    );
    expect(demote.status).toBe(200);
  });

  it("resets a human password (old sessions intact, new password works)", async () => {
    const m = await makeMember(t.app, admin.token);
    const res = await t.app.request(
      `/api/v1/users/${m.userId}`,
      jsonReq("PATCH", { password: "reset-pass-456" }, bearer(admin.token)),
    );
    expect(res.status).toBe(200);

    const oldLogin = await t.app.request(
      "/api/v1/auth/login",
      jsonReq("POST", { email: m.email, password: m.password }),
    );
    expect(oldLogin.status).toBe(401);
    const newLogin = await t.app.request(
      "/api/v1/auth/login",
      jsonReq("POST", { email: m.email, password: "reset-pass-456" }),
    );
    expect(newLogin.status).toBe(200);
  });

  it("refuses a password reset on an agent account (409)", async () => {
    const email = uniqueEmail("agent");
    const create = await t.app.request(
      "/api/v1/users",
      jsonReq("POST", { email, name: "Bot", is_agent: true }, bearer(admin.token)),
    );
    const { user } = (await create.json()) as { user: UserJson };
    const res = await t.app.request(
      `/api/v1/users/${user.id}`,
      jsonReq("PATCH", { password: "some-password-1" }, bearer(admin.token)),
    );
    expect(res.status).toBe(409);
  });

  it("reactivates a deactivated user", async () => {
    const m = await makeMember(t.app, admin.token);
    await t.app.request(`/api/v1/users/${m.userId}`, { method: "DELETE", headers: bearer(admin.token) });
    const res = await t.app.request(
      `/api/v1/users/${m.userId}`,
      jsonReq("PATCH", { reactivate: true }, bearer(admin.token)),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { user: UserJson }).user.deactivated_at).toBeNull();

    const login = await t.app.request("/api/v1/auth/login", jsonReq("POST", { email: m.email, password: m.password }));
    expect(login.status).toBe(200);
  });

  it("404s when updating a missing user", async () => {
    const res = await t.app.request(
      "/api/v1/users/01ARZ3NDEKTSV4RRFFQ69G5FAV",
      jsonReq("PATCH", { name: "Nobody" }, bearer(admin.token)),
    );
    expect(res.status).toBe(404);
  });
});

describe("users.deactivate", () => {
  it("deactivates a member, kills their sessions, and is idempotent", async () => {
    const m = await makeMember(t.app, admin.token);
    const before = await t.app.request("/api/v1/auth/me", { headers: bearer(m.token) });
    expect(before.status).toBe(200);

    const res = await t.app.request(`/api/v1/users/${m.userId}`, { method: "DELETE", headers: bearer(admin.token) });
    expect(res.status).toBe(200);
    const { user } = (await res.json()) as { user: UserJson };
    expect(user.deactivated_at).not.toBeNull();

    // Session token is dead (session row deleted) and login refused.
    const after = await t.app.request("/api/v1/auth/me", { headers: bearer(m.token) });
    expect(after.status).toBe(401);
    const login = await t.app.request("/api/v1/auth/login", jsonReq("POST", { email: m.email, password: m.password }));
    expect(login.status).toBe(401);

    // Deactivating again is a harmless no-op returning the same user.
    const again = await t.app.request(`/api/v1/users/${m.userId}`, { method: "DELETE", headers: bearer(admin.token) });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { user: UserJson }).user.deactivated_at).toBe(user.deactivated_at);
  });

  it("refuses to deactivate the last active admin (409)", async () => {
    const res = await t.app.request(`/api/v1/users/${admin.userId}`, {
      method: "DELETE",
      headers: bearer(admin.token),
    });
    expect(res.status).toBe(409);
  });

  it("allows deactivating an admin while another active admin remains", async () => {
    const second = await makeMember(t.app, admin.token, { role: "admin" });
    const res = await t.app.request(`/api/v1/users/${second.userId}`, {
      method: "DELETE",
      headers: bearer(admin.token),
    });
    expect(res.status).toBe(200);
  });

  it("404s on a missing user", async () => {
    const res = await t.app.request("/api/v1/users/01ARZ3NDEKTSV4RRFFQ69G5FAV", {
      method: "DELETE",
      headers: bearer(admin.token),
    });
    expect(res.status).toBe(404);
  });
});
