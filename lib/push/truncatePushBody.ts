/** Expo notification body copy — keep short for lock screens. */
export function truncatePushBody(s: string, max = 100): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
