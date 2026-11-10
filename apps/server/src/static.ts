import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { extname, isAbsolute, join, normalize, resolve } from "node:path";
import { Readable } from "node:stream";
import type { Context } from "hono";
import { DEFAULT_INSTANCE_NAME, ROUTES, type InstanceSettings } from "@temujira/shared";

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

function brandedHtml(html: string, settings: InstanceSettings): string {
  const name = escapeHtml(settings.display_name);
  const head = [`<meta name="application-name" content="${name}" />`];
  if (settings.logo_id) {
    // The app reads the logo id before its first render; the uploaded logo is also the tab icon.
    const id = escapeHtml(settings.logo_id);
    head.push(`<meta name="app-logo-id" content="${id}" />`,
      `<link rel="icon" href="/api/v1${ROUTES["instance.getLogo"].path}?v=${id}" />`);
    html = html.replace(/<link\b[^>]*\brel=["']?(?:shortcut\s+)?icon\b[^>]*>/gi, "");
  }
  // Use replacement functions: names can contain the special replacement sequence $&.
  return html.replace(/<title>[^]*?<\/title>/i, () => `<title>${name}</title>`)
    .replace(/<\/head>/i, () => `${head.join("")}</head>`);
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * Serve the statically-exported Expo web app with an SPA fallback.
 *
 * - Serves real files from `dist` under `/` (assets, css, js, index.html).
 * - For any non-file path, returns `index.html` so expo-router client routing works
 *   on refresh/deep-link.
 * - `/api/*` paths are left for the API router; this middleware 404s them so the API's
 *   own notFound semantics are preserved.
 * - If `webDist` is unset (pure API dev), returns a friendly 404 for non-API routes.
 */
export function staticMiddleware(webDist: string | undefined, settings: () => InstanceSettings = () => ({ display_name: DEFAULT_INSTANCE_NAME, logo_id: null })) {
  if (!webDist) {
    return function staticDisabled(c: Context) {
      if (c.req.path.startsWith("/api/")) return c.json({ error: { code: "not_found", message: "no API route" } }, 404);
      return c.text(`${settings().display_name} API is running. Set WEB_DIST to serve the web app.`, 404);
    };
  }

  const root = isAbsolute(webDist) ? resolve(webDist) : join(process.cwd(), webDist);
  const indexFile = join(root, "index.html");
  return function serveStatic(c: Context) {
    const pathname = c.req.path;
    if (pathname.startsWith("/api/")) {
      return c.json({ error: { code: "not_found", message: "no API route" } }, 404);
    }

    const decoded = decodeURIComponent(pathname.split("?")[0]);
    const file = normalize(join(root, decoded));

    // Path traversal guard: must stay inside the static root.
    if (file !== root && !file.startsWith(root + "/")) {
      return c.text("Forbidden", 403);
    }

    let target = file;
    try {
      if (file === root || !existsSync(target) || statSync(target).isDirectory()) {
        target = indexFile;
      }
      const stat = statSync(target);
      const mime = MIME[extname(target)] ?? "application/octet-stream";
      const headers = new Headers();
      headers.set("Content-Type", mime);
      if (target === indexFile) {
        headers.set("Cache-Control", "no-store");
        return new Response(brandedHtml(readFileSync(target, "utf8"), settings()), { status: 200, headers });
      }
      headers.set("Content-Length", String(stat.size));
      headers.set(
        "Cache-Control",
        mime.startsWith("text/") || mime.includes("javascript") || mime.includes("json")
          ? "no-cache"
          : "public, max-age=31536000, immutable",
      );
      const stream = Readable.toWeb(createReadStream(target)) as unknown as ReadableStream;
      return new Response(stream, { status: 200, headers });
    } catch {
      return c.text("Not found", 404);
    }
  };
}
