/** Persisted `pickup_runs.run_type` values used by APIs and the admin UI. */
export type PickupRunTypeStored = "select" | "public";

/** Normalize any client input to a stored run_type (defaults to invite-gated `select`). */
export function normalizePickupRunTypeForDb(raw: unknown): PickupRunTypeStored {
  const t = String(raw ?? "select").trim().toLowerCase();
  return t === "public" ? "public" : "select";
}

/**
 * Only explicit `public` (case/whitespace-insensitive) is a public pickup run — first come first served for approved
 * players in the hub region. Everything else is treated as Select (invite-only via `pickup_run_invites`).
 */
export function isPublicPickupRunType(runType: unknown): boolean {
  if (runType == null) return false;
  return String(runType).trim().toLowerCase() === "public";
}

/** Select / invite-gated runs: any run type that is not explicitly `public`. */
export function isSelectPickupRunType(runType: unknown): boolean {
  return !isPublicPickupRunType(runType);
}

/**
 * Legacy constants still referenced by automated checkpoints and older invite helpers.
 * Player-facing access no longer uses tier waves; `tier_rank` remains for stats and leaderboards only.
 */
export const SELECT_PICKUP_MAX_INVITE_TIER_RANK = 4;

/** Legacy: window before kickoff where automated flows may expand invite tiers. */
export const SELECT_PICKUP_EMERGENCY_LAST_CALL_MS = 2 * 60 * 60 * 1000;

export function isSelectPickupEmergencyLastCallWindow(kickoffMs: number, nowMs: number): boolean {
  const ms = kickoffMs - nowMs;
  return ms > 0 && ms <= SELECT_PICKUP_EMERGENCY_LAST_CALL_MS;
}
