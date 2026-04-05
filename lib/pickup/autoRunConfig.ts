/** All timing windows relative to anchor start (earliest slot or run.start_at). */

export const MS_PER_HOUR = 60 * 60 * 1000;

/** Admin launch allowed only if anchor start is at least this far in the future. */
export const MIN_LEAD_BEFORE_LAUNCH_MS = 36 * MS_PER_HOUR;

/** Fire “24h before start” checkpoint when now >= start - this offset. */
export const CHECKPOINT_24H_BEFORE_MS = 24 * MS_PER_HOUR;
export const CHECKPOINT_12H_BEFORE_MS = 12 * MS_PER_HOUR;
export const CHECKPOINT_6H_BEFORE_MS = 6 * MS_PER_HOUR;
export const CHECKPOINT_1H_BEFORE_MS = 1 * MS_PER_HOUR;

/** If distinct users with availability “available” is below this, expand tier window at 24h / 12h. */
export const EXPAND_WAVE_MIN_COMMITTED = 8;

/**
 * Tier-1 (1A+1B) players on the same slot required to mark likely_on at 6h checkpoint
 * (matches player commit path heuristic).
 */
export const LIKELY_ON_TIER1_PER_SLOT = 5;

/** Minimum distinct “available” commitments on the chosen slot to auto-finalize at 1h checkpoint. */
export function finalizeMinCommitted(capacity: number | null | undefined): number {
  const c = Number(capacity || 18);
  return Math.max(8, Math.min(c, Math.ceil(c * 0.55)));
}
