/**
 * Only explicit `public` (case/whitespace-insensitive) is treated as a public pickup run.
 * Everything else uses select-style behavior (tier invites, gates, etc.).
 */
export function isPublicPickupRunType(runType: unknown): boolean {
  if (runType == null) return false;
  return String(runType).trim().toLowerCase() === "public";
}
