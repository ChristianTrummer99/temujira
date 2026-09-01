import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROUTES, ROUTE_IDS } from "@temujira/shared";
import { makeTestApp } from "./helpers";

let t: Awaited<ReturnType<typeof makeTestApp>>;

beforeAll(async () => {
  t = await makeTestApp();
});
afterAll(() => t.cleanup());

describe("route registry ⇔ mounted Hono routes (two-way diff)", () => {
  it("mounts exactly the registry's method+path set under /api/v1 — nothing missing, nothing extra", () => {
    // app.routes lists middleware entries too (same method+path, different handler),
    // so dedupe on (method, path); ignore ALL-method middleware like CORS.
    const mounted = new Set<string>();
    for (const r of t.app.routes) {
      if (!r.path.startsWith("/api/v1")) continue;
      if (r.method === "ALL") continue;
      mounted.add(`${r.method} ${r.path}`);
    }
    const expected = new Set(ROUTE_IDS.map((id) => `${ROUTES[id].method} /api/v1${ROUTES[id].path}`));

    const missing = [...expected].filter((r) => !mounted.has(r));
    const extra = [...mounted].filter((r) => !expected.has(r));
    expect(missing, `registry routes not mounted: ${missing.join(", ")}`).toEqual([]);
    expect(extra, `mounted routes not in the registry: ${extra.join(", ")}`).toEqual([]);
    expect(mounted.size).toBe(expected.size);
    expect(expected.size).toBe(ROUTE_IDS.length); // no two registry ids share method+path
  });
});
