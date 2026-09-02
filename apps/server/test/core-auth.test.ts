import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, jsonReq, makeTestApp, setupAdmin } from "./helpers";

let t: Awaited<ReturnType<typeof makeTestApp>>;

beforeAll(async () => {
  t = await makeTestApp();
});
afterAll(() => t.cleanup());

describe("setup + auth + api keys", () => {
  let sessionToken = "";
  let apiKeyToken = "";
  let apiKeyId = "";

  it("reports needsSetup=true on a fresh install", async () => {
    const res = await t.app.request("/api/v1/setup");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ needsSetup: true });
  });

  it("rejects oversized JSON without relying on Content-Length", async () => {
    const res = await t.app.request("/api/v1/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "admin@example.com",
        name: "x".repeat(2 * 1024 * 1024),
        password: "correct-horse-battery",
      }),
    });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "payload_too_large",
    );
  });

  it("creates the first admin and returns a usable session token", async () => {
    const { token } = await setupAdmin(t.app);
    sessionToken = token;
    expect(token.startsWith("tms_")).toBe(true);

    const me = await t.app.request("/api/v1/auth/me", {
      headers: bearer(token),
    });
    expect(me.status).toBe(200);
    const data = (await me.json()) as {
      user: { email: string; role: string; is_agent: boolean };
    };
    expect(data.user.email).toBe("admin@example.com");
    expect(data.user.role).toBe("admin");
    expect(data.user.is_agent).toBe(false);
  });

  it("reports needsSetup=false after setup", async () => {
    const res = await t.app.request("/api/v1/setup");
    expect(((await res.json()) as { needsSetup: boolean }).needsSetup).toBe(
      false,
    );
  });

  it("refuses setup once completed", async () => {
    const res = await t.app.request(
      "/api/v1/setup",
      jsonReq("POST", {
        email: "x@example.com",
        name: "X",
        password: "12345678",
      }),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("forbidden");
  });

  it("rejects bad credentials and accepts good ones (sets cookie)", async () => {
    const bad = await t.app.request(
      "/api/v1/auth/login",
      jsonReq("POST", {
        email: "admin@example.com",
        password: "wrong-password",
      }),
    );
    expect(bad.status).toBe(401);

    const good = await t.app.request(
      "/api/v1/auth/login",
      jsonReq("POST", {
        email: "admin@example.com",
        password: "correct-horse-battery",
      }),
    );
    expect(good.status).toBe(200);
    const setCookie = good.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("tmj_session=");
    expect(setCookie).toContain("HttpOnly");
  });

  it("rate-limits repeated login failures", async () => {
    for (let i = 0; i < 10; i++) {
      await t.app.request(
        "/api/v1/auth/login",
        jsonReq("POST", { email: "victim@example.com", password: "nope-nope" }),
      );
    }
    const blocked = await t.app.request(
      "/api/v1/auth/login",
      jsonReq("POST", { email: "victim@example.com", password: "nope-nope" }),
    );
    expect(blocked.status).toBe(429);
  });

  it("creates, uses, lists, and revokes an API key", async () => {
    const create = await t.app.request(
      "/api/v1/api-keys",
      jsonReq("POST", { name: "test key" }, bearer(sessionToken)),
    );
    expect(create.status).toBe(200);
    const created = (await create.json()) as {
      apiKey: { id: string; token_prefix: string };
      token: string;
    };
    apiKeyToken = created.token;
    apiKeyId = created.apiKey.id;
    expect(apiKeyToken.startsWith("tmj_")).toBe(true);
    expect(created.apiKey.token_prefix).toBe(apiKeyToken.slice(0, 12));

    const me = await t.app.request("/api/v1/auth/me", {
      headers: bearer(apiKeyToken),
    });
    expect(me.status).toBe(200);

    const list = await t.app.request("/api/v1/api-keys", {
      headers: bearer(sessionToken),
    });
    const listData = (await list.json()) as { items: Array<{ id: string }> };
    expect(listData.items.some((k) => k.id === apiKeyId)).toBe(true);

    const revoke = await t.app.request(`/api/v1/api-keys/${apiKeyId}`, {
      method: "DELETE",
      headers: bearer(sessionToken),
    });
    expect(revoke.status).toBe(200);

    const refused = await t.app.request("/api/v1/auth/me", {
      headers: bearer(apiKeyToken),
    });
    expect(refused.status).toBe(401);
  });

  it("requires auth and rejects garbage tokens", async () => {
    expect((await t.app.request("/api/v1/auth/me")).status).toBe(401);
    expect(
      (
        await t.app.request("/api/v1/auth/me", {
          headers: bearer("tmj_deadbeef"),
        })
      ).status,
    ).toBe(401);
    expect(
      (await t.app.request("/api/v1/auth/me", { headers: bearer("garbage") }))
        .status,
    ).toBe(401);
  });

  it("updates own name and password via auth.updateMe", async () => {
    const rename = await t.app.request(
      "/api/v1/auth/me",
      jsonReq("PATCH", { name: "Renamed Admin" }, bearer(sessionToken)),
    );
    expect(rename.status).toBe(200);
    expect(
      ((await rename.json()) as { user: { name: string } }).user.name,
    ).toBe("Renamed Admin");

    const badPw = await t.app.request(
      "/api/v1/auth/me",
      jsonReq(
        "PATCH",
        { current_password: "wrong", new_password: "new-password-123" },
        bearer(sessionToken),
      ),
    );
    expect(badPw.status).toBe(401);

    const goodPw = await t.app.request(
      "/api/v1/auth/me",
      jsonReq(
        "PATCH",
        {
          current_password: "correct-horse-battery",
          new_password: "new-password-123",
        },
        bearer(sessionToken),
      ),
    );
    expect(goodPw.status).toBe(200);

    const login = await t.app.request(
      "/api/v1/auth/login",
      jsonReq("POST", {
        email: "admin@example.com",
        password: "new-password-123",
      }),
    );
    expect(login.status).toBe(200);
  });

  it("logout destroys the session", async () => {
    const login = await t.app.request(
      "/api/v1/auth/login",
      jsonReq("POST", {
        email: "admin@example.com",
        password: "new-password-123",
      }),
    );
    const { token } = (await login.json()) as { token: string };
    const out = await t.app.request("/api/v1/auth/logout", {
      method: "POST",
      headers: bearer(token),
    });
    expect(out.status).toBe(200);
    const refused = await t.app.request("/api/v1/auth/me", {
      headers: bearer(token),
    });
    expect(refused.status).toBe(401);
  });

  it("serves health and openapi publicly", async () => {
    const health = await t.app.request("/api/v1/health");
    expect(health.status).toBe(200);
    expect(((await health.json()) as { ok: boolean }).ok).toBe(true);

    const oa = await t.app.request("/api/v1/openapi.json");
    expect(oa.status).toBe(200);
    const doc = (await oa.json()) as {
      openapi: string;
      paths: Record<string, unknown>;
    };
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths).length).toBeGreaterThan(20);
  });
});
