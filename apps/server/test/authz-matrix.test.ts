import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROUTES, ROUTE_IDS, SCOPE_IDS, type RouteId, type ScopeId } from "@temujira/shared";
import { bearer, jsonReq, makeMember, makeTestApp, setupAdmin } from "./helpers";

let t: Awaited<ReturnType<typeof makeTestApp>>;
let adminToken = "";
let memberToken = "";
let revokedKeyToken = "";

const DUMMY_ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const pathFor = (id: RouteId): string => "/api/v1" + ROUTES[id].path.replace(/:[A-Za-z]+/g, DUMMY_ULID);
// ROUTES is `as const`, so `scope` only exists on entries that declare it.
const scopeOf = (id: RouteId): ScopeId | undefined => (ROUTES[id] as { scope?: ScopeId }).scope;

const protectedIds = ROUTE_IDS.filter((id) => ROUTES[id].auth !== "public");
// Routes whose scope the default member does NOT hold (new members default to tasks:write).
const DEFAULT_MEMBER_SCOPES = new Set(["tasks:write"]);
const missingScopeIds = ROUTE_IDS.filter((id) => {
  const scope = scopeOf(id);
  return scope !== undefined && !DEFAULT_MEMBER_SCOPES.has(scope);
});

beforeAll(async () => {
  t = await makeTestApp();
  const admin = await setupAdmin(t.app);
  adminToken = admin.token;
  const member = await makeMember(t.app, admin.token);
  memberToken = member.token;

  // Mint an API key, then revoke it.
  const keyRes = await t.app.request("/api/v1/api-keys", jsonReq("POST", { name: "doomed" }, bearer(admin.token)));
  const { apiKey, token } = (await keyRes.json()) as { apiKey: { id: string }; token: string };
  revokedKeyToken = token;
  const revoke = await t.app.request(`/api/v1/api-keys/${apiKey.id}`, {
    method: "DELETE",
    headers: bearer(admin.token),
  });
  if (revoke.status !== 200) throw new Error("failed to revoke API key for the matrix");
});
afterAll(() => t.cleanup());

describe("registry sanity", () => {
  it("has protected routes and scope-gated routes to iterate", () => {
    expect(protectedIds.length).toBeGreaterThan(20);
    expect(missingScopeIds.length).toBeGreaterThan(0);
  });

  it("every route scope is a known scope id", () => {
    const known = new Set<string>(SCOPE_IDS);
    for (const id of ROUTE_IDS) {
      const scope = scopeOf(id);
      if (scope !== undefined) expect(known.has(scope), `${id} -> ${scope}`).toBe(true);
    }
  });
});

// Auth middleware runs before validation, so bare requests (no body) are enough:
// only the status code matters here.
describe("anonymous requests are rejected with 401", () => {
  for (const id of protectedIds) {
    it(`${id} (${ROUTES[id].method} ${ROUTES[id].path})`, async () => {
      const res = await t.app.request(pathFor(id), { method: ROUTES[id].method });
      expect(res.status).toBe(401);
    });
  }
});

describe("a member lacking a route's scope is rejected with 403", () => {
  for (const id of missingScopeIds) {
    it(`${id} (${ROUTES[id].method} ${ROUTES[id].path}) requires ${scopeOf(id)}`, async () => {
      const res = await t.app.request(pathFor(id), { method: ROUTES[id].method, headers: bearer(memberToken) });
      expect(res.status).toBe(403);
    });
  }
});

describe("an admin passes scope checks (fails later on validation, never 401/403)", () => {
  for (const id of missingScopeIds) {
    it(`${id} (${ROUTES[id].method} ${ROUTES[id].path})`, async () => {
      const res = await t.app.request(pathFor(id), { method: ROUTES[id].method, headers: bearer(adminToken) });
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });
  }
});

describe("a revoked API key is rejected with 401 everywhere", () => {
  for (const id of protectedIds) {
    it(`${id} (${ROUTES[id].method} ${ROUTES[id].path})`, async () => {
      const res = await t.app.request(pathFor(id), { method: ROUTES[id].method, headers: bearer(revokedKeyToken) });
      expect(res.status).toBe(401);
    });
  }
});
