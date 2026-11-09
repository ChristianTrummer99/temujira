import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, jsonReq, makeTestApp, setupAdmin } from "./helpers";

let t: Awaited<ReturnType<typeof makeTestApp>>;
let webDist: string;

beforeAll(async () => {
  // A fake Expo export: index.html + an asset.
  webDist = mkdtempSync(join(tmpdir(), "tmj-web-"));
  mkdirSync(join(webDist, "assets"), { recursive: true });
  writeFileSync(join(webDist, "index.html"), "<!doctype html><html><head><title>Temujira</title></head><body><div id=root></div></body></html>");
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

  it("sends the saved name on first load and deep links, with HTML safely escaped", async () => {
    const admin = await setupAdmin(t.app);
    const name = `R&D \"$&\" </title><script>x</script>`;
    const response = await t.app.request("/api/v1/instance", jsonReq("PATCH", { display_name: name }, bearer(admin.token)));
    expect(response.status).toBe(200);
    for (const path of ["/", "/index.html", "/login", "/settings/branding", "/w/START/t/1"]) {
      const res = await t.app.request(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const html = await res.text();
      const escaped = "R&amp;D &quot;$&amp;&quot; &lt;/title&gt;&lt;script&gt;x&lt;/script&gt;";
      expect(html).toContain(`<title>${escaped}</title>`);
      expect(html).toContain(`<meta name="application-name" content="${escaped}" />`);
      expect(html).not.toContain("<script>x</script>");
      expect(html).not.toContain("Temujira");
    }
  });
});
