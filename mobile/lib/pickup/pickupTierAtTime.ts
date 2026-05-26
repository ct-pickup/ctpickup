/**
 * Maps `profiles.tier_rank` (1–6) to `pickup_run_rsvps.tier_at_time` (`pickup_tier` enum).
 * Profile tier strings like "1a" are not valid enum labels — use rank instead.
 */
export function pickupTierAtTimeFromRank(
  tierRank: number | null | undefined,
): string | null {
  if (tierRank == null || !Number.isFinite(Number(tierRank))) return null;
  const rank = Math.round(Number(tierRank));
  if (rank < 1 || rank > 6) return null;
  return String(rank);
}
