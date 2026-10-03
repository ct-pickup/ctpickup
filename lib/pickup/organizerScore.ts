const TIER_TO_SCORE: Record<string, number> = {
  bronze: 2,
  silver: 4,
  gold: 6,
  platinum: 8,
  diamond: 10,
};

/**
 * organizer_score (1-10) for one host rating. Accepts the legacy tier names
 * (unchanged: bronze..diamond = 2..10) or stars in half steps (0.5-5.0), which
 * map to stars * 2. Whole stars 1-5 give 2, 4, 6, 8, 10, the same as the tiers.
 * Returns null for anything else.
 */
export function organizerScoreFor(input: unknown): number | null {
  if (typeof input === "number") {
    return Number.isFinite(input) && input >= 0.5 && input <= 5 && input * 2 === Math.floor(input * 2)
      ? input * 2
      : null;
  }
  const tier = String(input ?? "").trim().toLowerCase();
  return TIER_TO_SCORE[tier] ?? null;
}
