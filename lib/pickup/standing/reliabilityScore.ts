export type PickupReliabilityBucket = "building" | "good" | "watch" | "needs_review";

export type PickupReliabilityInput = {
  /** Total number of committed pickups (tracked pickups). */
  confirmed: number;
  /** Count of attended pickups (subset of confirmed). */
  attended: number;
  /** Count of late cancellations (each tied to a committed pickup). */
  lateCancels: number;
  /** Count of no-shows (each tied to a committed pickup). */
  noShows: number;
};

export type PickupReliabilityResult = {
  /** Tracked pickups used in the score (after clamping/sanity checks). */
  trackedPickups: number;
  /** Weighted reliability percentage (0–100). Null when fewer than 3 tracked pickups. */
  scorePct: number | null;
  /** Bucket used for admin views and future rules. */
  bucket: PickupReliabilityBucket;
};

/**
 * Computes a weighted pickup reliability score.
 *
 * Rules (user-provided):
 * - Tracked pickup = any real committed pickup.
 * - Start scoring only after 3 tracked pickups.
 * - Per tracked pickup:
 *   - attended / showed up  → 1.0 point
 *   - late cancel           → 0.5 points
 *   - no-show               → 0.0 points
 * - Score = (points earned / tracked pickups) × 100
 * - Buckets:
 *   - ≥ 85% → "good"
 *   - 70–84% → "watch"
 *   - < 70% → "needs_review"
 *   - < 3 tracked pickups → "building"
 */
export function computePickupReliability(input: PickupReliabilityInput): PickupReliabilityResult {
  const confirmed = Math.max(0, Math.floor(input.confirmed || 0));
  const attended = Math.max(0, Math.floor(input.attended || 0));
  const lateCancels = Math.max(0, Math.floor(input.lateCancels || 0));
  const noShows = Math.max(0, Math.floor(input.noShows || 0));

  if (confirmed === 0) {
    return { trackedPickups: 0, scorePct: null, bucket: "building" };
  }

  // Sanity clamp so that attended + lateCancels + noShows never exceeds confirmed.
  const rawExtras = lateCancels + noShows;
  const maxExtras = Math.max(0, confirmed - attended);
  const extras = Math.min(rawExtras, maxExtras);

  // Prefer preserving the ratio between late cancels and no-shows when clamping.
  let adjLateCancels = 0;
  let adjNoShows = 0;
  if (rawExtras > 0 && extras > 0) {
    const ratioLate = lateCancels / rawExtras;
    adjLateCancels = Math.round(extras * ratioLate);
    adjNoShows = extras - adjLateCancels;
  }

  const trackedPickups = confirmed;

  if (trackedPickups < 3) {
    return { trackedPickups, scorePct: null, bucket: "building" };
  }

  const points = attended * 1.0 + adjLateCancels * 0.5;
  const rawScore = (points / trackedPickups) * 100;
  const scorePct = Math.max(0, Math.min(100, Math.round(rawScore * 100) / 100));

  let bucket: PickupReliabilityBucket;
  if (scorePct >= 85) bucket = "good";
  else if (scorePct >= 70) bucket = "watch";
  else bucket = "needs_review";

  return { trackedPickups, scorePct, bucket };
}

