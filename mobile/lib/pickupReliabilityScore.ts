/** Mirrors `lib/pickup/standing/reliabilityScore.ts` for offline/API-less score display. */

export type PickupReliabilityBucket = "building" | "good" | "watch" | "needs_review";

export type PickupReliabilityInput = {
  confirmed: number;
  attended: number;
  lateCancels: number;
  noShows: number;
};

export type PickupReliabilityResult = {
  trackedPickups: number;
  scorePct: number | null;
  bucket: PickupReliabilityBucket;
};

export function computePickupReliability(input: PickupReliabilityInput): PickupReliabilityResult {
  const confirmed = Math.max(0, Math.floor(input.confirmed || 0));
  const attended = Math.max(0, Math.floor(input.attended || 0));
  const lateCancels = Math.max(0, Math.floor(input.lateCancels || 0));
  const noShows = Math.max(0, Math.floor(input.noShows || 0));

  if (confirmed === 0) {
    return { trackedPickups: 0, scorePct: null, bucket: "building" };
  }

  const rawExtras = lateCancels + noShows;
  const maxExtras = Math.max(0, confirmed - attended);
  const extras = Math.min(rawExtras, maxExtras);

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
