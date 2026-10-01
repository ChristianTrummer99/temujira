import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { eq, isNull } from "drizzle-orm";
import { attachments } from "./db/schema";
import type { AppContext } from "./routes/types";
import type { AttachmentRow } from "./serialize";

/** Literal terms (ANDed prefix matches) and quoted phrases; no user-supplied FTS operators. */
export function searchExpression(query: string): string | null {
  const parts = [...query.matchAll(/"([^"]+)"|(\S+)/gu)].slice(0, 32);
  const terms = parts.flatMap((part) => {
    const words = (part[1] ?? part[2] ?? "").match(/[\p{L}\p{N}_]+/gu);
    if (!words?.length) return [];
    const phrase = `"${words.join(" ")}"`;
    return [part[1] ? phrase : `${phrase}*`];
  });
  return terms.length ? terms.join(" AND ") : null;
}

export const SEARCH_TEXT_LIMIT = 1024 * 1024;
const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".mdx", ".log", ".json", ".jsonc", ".csv", ".tsv",
  ".yaml", ".yml", ".toml", ".ini", ".xml", ".html", ".htm", ".svg", ".sql",
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".py", ".go", ".rs", ".rb",
  ".c", ".h", ".cpp", ".hpp", ".cs", ".java", ".kt", ".swift", ".php", ".sh",
  ".bash", ".zsh", ".css", ".scss", ".less", ".diff", ".patch", ".gcode", ".nc",
]);

/** Bounded UTF-8 extraction. Binary formats stay searchable by filename, never decoded as prose. */
function attachmentText(ctx: AppContext, row: AttachmentRow): string {
  if (row.size > SEARCH_TEXT_LIMIT) return "";
  const mime = row.mimeType.split(";")[0]!.toLowerCase();
  if (!mime.startsWith("text/") && !TEXT_EXTENSIONS.has(extname(row.filename).toLowerCase()) &&
      !/^application\/(json|xml|yaml|javascript)(\b|\+)/.test(mime)) return "";
  const bytes = readFileSync(ctx.storage.path(row.id));
  if (bytes.length > SEARCH_TEXT_LIMIT || bytes.includes(0)) return "";
  let text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (/html|svg|xml/.test(mime) || /\.(html?|svg|xml)$/i.test(row.filename)) {
    text = text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ").replace(/<[^>]*>/g, " ");
  }
  return text;
}

/** Called after upload finalization and once for pre-existing, not-yet-indexed attachments. */
export function indexAttachmentText(ctx: AppContext, row: AttachmentRow): void {
  let text = "";
  try { text = attachmentText(ctx, row); } catch { /* Missing/invalid bytes still have a filename index. */ }
  ctx.db.update(attachments).set({ searchText: text }).where(eq(attachments.id, row.id)).run();
}

export function backfillAttachmentSearch(ctx: AppContext): void {
  for (const row of ctx.db.select().from(attachments).where(isNull(attachments.searchText)).all()) {
    indexAttachmentText(ctx, row);
  }
}
