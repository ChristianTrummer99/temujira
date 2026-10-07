/** Stable per-user color, independent of name, list order, and theme. */
export function avatarColor(userId: string): string {
  let hash = 2166136261;
  for (let i = 0; i < userId.length; i++) hash = Math.imul(hash ^ userId.charCodeAt(i), 16777619);
  const hue = ((hash >>> 0) / 0x100000000 * 360).toFixed(2);
  // Dark enough for white initials, including yellow/green hues.
  return `hsl(${hue}, 65%, 28%)`;
}
