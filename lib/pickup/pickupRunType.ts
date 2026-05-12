/** Persisted `pickup_runs.run_type` values used by APIs and the admin UI. */
export type PickupRunTypeStored = "select" | "public";

/** Normalize any client input to a stored run_type (defaults to invite-gated `select`). */
export function normalizePickupRunTypeForDb(raw: unknown): PickupRunTypeStored {
  const t = String(raw ?? "select").trim().toLowerCase();
  return t === "public" ? "public" : "select";
}

/**
 * Only explicit `public` (case/whitespace-insensitive) is treated as a public pickup run.
 * Everything else uses select-style behavior (tier invites, gates, etc.).
 */
export function isPublicPickupRunType(runType: unknown): boolean {
  if (runType == null) return false;
  return String(runType).trim().toLowerCase() === "public";
}

/** Select-style / invite-gated runs: any run type that is not explicitly `public`. */
export function isSelectPickupRunType(runType: unknown): boolean {
  return !isPublicPickupRunType(runType);
}
