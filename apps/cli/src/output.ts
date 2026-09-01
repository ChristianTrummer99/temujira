import type { User } from "@temujira/client";

export type OutputMode = "human" | "json" | "quiet";

/**
 * --quiet wins over --json; --json wins over human; JSON is auto-enabled when
 * stdout is not a TTY.
 */
export function resolveMode(
  opts: { json?: boolean; quiet?: boolean },
  isTty: boolean = process.stdout.isTTY ?? false,
): OutputMode {
  if (opts.quiet) return "quiet";
  if (opts.json) return "json";
  return isTty ? "human" : "json";
}

export function print(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** All JSON output is the raw API response, pretty-printed with 2 spaces. */
export function printJson(data: unknown): void {
  print(JSON.stringify(data, null, 2));
}

/** Unix-ms timestamp → ISO 8601 string ("" for null/undefined). */
export function ts(ms: number | null | undefined): string {
  return ms == null ? "" : new Date(ms).toISOString();
}

/** "Name <email>" (empty string for null). */
export function userRef(u: { name: string; email: string } | null | undefined): string {
  return u ? `${u.name} <${u.email}>` : "";
}

/** "Name <email> (role[, agent])" — the whoami line. */
export function userLine(u: User): string {
  return `${userRef(u)} (${u.role}${u.is_agent ? ", agent" : ""})`;
}

/** First line of `text`, hard-capped at `max` chars with an ellipsis. */
export function truncate(text: string, max: number): string {
  const line = text.split("\n", 1)[0] ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Compact aligned columns; header + rows. */
export function table(header: string[], rows: string[][]): string {
  if (rows.length === 0) return "(no results)";
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) =>
    cells
      .map((c, i) => (c ?? "").padEnd(widths[i] ?? 0))
      .join("  ")
      .replace(/ +$/, "");
  return [line(header), ...rows.map(line)].join("\n");
}

/** `key:  value` lines with aligned values. */
export function kv(pairs: Array<[string, string]>): string {
  const width = Math.max(...pairs.map(([k]) => k.length));
  return pairs.map(([k, v]) => `${`${k}:`.padEnd(width + 1)}  ${v}`).join("\n");
}

/** Indent every line of `text`. */
export function indent(text: string, prefix = "  "): string {
  return text
    .split("\n")
    .map((l) => (l === "" ? l : prefix + l))
    .join("\n");
}

export interface Emission {
  /** Raw API response (or documented composition of the raw responses). */
  json: unknown;
  human: () => string | void;
  /** Ids only; return undefined to print nothing. */
  quiet?: () => string | void;
}

export function emit(mode: OutputMode, out: Emission): void {
  if (mode === "json") {
    printJson(out.json);
    return;
  }
  if (mode === "quiet") {
    const line = out.quiet?.();
    if (line !== undefined && line !== "") print(line);
    return;
  }
  const line = out.human();
  if (line !== undefined && line !== "") print(line);
}
