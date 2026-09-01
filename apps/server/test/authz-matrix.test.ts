import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROUTES, ROUTE_IDS, type RouteId } from "@temujira/shared";
import { bearer, jsonReq, makeMember, makeTestApp, setupAdmin } from "./helpers";

let t: Awaited<ReturnType<typeof makeTestApp>>;
let memberToken = "";
let revokedKeyToken = "";

const DUMMY_ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const pathFor = (id: RouteId): string => "/api/v1" + ROUTES[id].path.replace(/:[A-Za-z]+/g, DUMMY_ULID);

const protectedIds = ROUTE_IDS.filter((id) => ROUTES[id].auth !== "public");
const adminIds = ROUTE_IDS.filter((id) => ROUTES[id].auth === "admin");

beforeAll(async () => {
  t = await makeTestApp();
  const admin = await setupAdmin(t.app);
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
  it("has protected and admin routes to iterate", () => {
    expect(protectedIds.length).toBeGreaterThan(20);
    expect(adminIds.length).toBeGreaterThan(0);
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

describe("member credentials on admin routes are rejected with 403", () => {
  for (const id of adminIds) {
    it(`${id} (${ROUTES[id].method} ${ROUTES[id].path})`, async () => {
      const res = await t.app.request(pathFor(id), { method: ROUTES[id].method, headers: bearer(memberToken) });
      expect(res.status).toBe(403);
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
