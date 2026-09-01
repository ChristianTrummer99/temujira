import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTestApp } from "./helpers";

let t: Awaited<ReturnType<typeof makeTestApp>>;
let webDist: string;

beforeAll(async () => {
  // A fake Expo export: index.html + an asset.
  webDist = mkdtempSync(join(tmpdir(), "tmj-web-"));
  mkdirSync(join(webDist, "assets"), { recursive: true });
  writeFileSync(join(webDist, "index.html"), "<!doctype html><title>Temujira</title><div id=root></div>");
  writeFileSync(join(webDist, "assets", "logo.png"), "PNGDATA");
  t = await makeTestApp({ webDist });
});

afterAll(() => {
  t.cleanup();
  rmSync(webDist, { recursive: true, force: true });
});

describe("static web serving + SPA fallback", () => {
  it("serves index.html at /", async () => {
    const res = await t.app.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Temujira");
  });

  it("serves real asset files with their content type", async () => {
    const res = await t.app.request("/assets/logo.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/png");
    expect(await res.text()).toBe("PNGDATA");
  });

  it("falls back to index.html for client-side routes (deep-link / refresh)", async () => {
    const res = await t.app.request("/w/TEM/t/42");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Temujira");
  });

  it("blocks path traversal", async () => {
    const res = await t.app.request("/..%2f..%2fetc%2fpasswd");
    expect(res.status).toBe(403);
  });

  it("still 404s unknown API routes", async () => {
    const res = await t.app.request("/api/v1/does-not-exist");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("not_found");
  });
});
