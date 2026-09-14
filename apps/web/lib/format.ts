/** Small display helpers shared by the list/detail/inbox/activity screens. */

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/** "just now" / "5m ago" / "3h ago" / "2d ago" / a locale date. */
export function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ms).toLocaleDateString();
}

export function formatAbsolute(ms: number): string {
  return new Date(ms).toLocaleString();
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** "TEM-42" -> { key: "TEM", number: "42" }; null when it isn't a task key. */
export function splitTaskKey(taskKey: string): { workspaceKey: string; number: string } | null {
  const m = /^([A-Z][A-Z0-9]{1,5})-([0-9]+)$/.exec(taskKey);
  if (!m) return null;
  return { workspaceKey: m[1], number: m[2] };
}

/**
 * Alternation body for matching task keys whose workspace prefix is one of the given
 * workspace keys, e.g. `(?:HUM|KEY)-[0-9]+`. Only known keys are matched so a random
 * `MX-100` is never linkified. Longest key first so e.g. `HUM` wins over `HU`. Returns
 * `''` when no keys are known — callers should fall back to a never-matching pattern.
 */
export function taskKeyBody(workspaceKeys: string[]): string {
  const keys = Array.from(
    new Set(workspaceKeys.filter((k) => /^[A-Z][A-Z0-9]{1,5}$/.test(k)))
  ).sort((a, b) => b.length - a.length);
  if (keys.length === 0) return '';
  return `(?:${keys.join('|')})-[0-9]+`;
}
