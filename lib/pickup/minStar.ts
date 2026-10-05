import { internalStar } from "@/lib/match/compatibility";

/**
 * A game's minimum skill level as a half star, 0.5 to 5.0 (`pickup_runs.min_star`,
 * 20261011000000_pickup_runs_min_star.sql). Null means "All levels" (or a game made before this existed, which
 * keeps using its tier band, `open_tier_rank`).
 */

export const MIN_STAR_STEPS: readonly number[] = Array.from({ length: 10 }, (_, i) => (i + 1) / 2);

/** The five tier bands the older app and the tier gate understand, with the stars each one covers. */
export const TIER_BANDS = [
  { key: "bronze", level: "casual", open_tier_rank: 1, low: 0.5, high: 1.0 },
  { key: "silver", level: "casual", open_tier_rank: 2, low: 1.5, high: 2.0 },
  { key: "gold", level: "competitive", open_tier_rank: 3, low: 2.5, high: 3.0 },
  { key: "platinum", level: "competitive", open_tier_rank: 4, low: 3.5, high: 4.0 },
  { key: "diamond", level: "elite", open_tier_rank: 5, low: 4.5, high: 5.0 },
] as const;

/** The band containing a star, so old-app code (min_tier / open_tier_rank) keeps working. */
export function tierBandForStar(star: number) {
  return TIER_BANDS.find((b) => star >= b.low && star <= b.high) ?? null;
}

export type MinStarParse = { ok: true; value: number | null } | { ok: false; error: string };

/** Absent (undefined, null or empty) is fine and means no min_star. Anything present must be a half star from 0.5 to 5.0. */
export function parseMinStar(raw: unknown): MinStarParse {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: null };
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (!Number.isFinite(n) || !MIN_STAR_STEPS.includes(n)) {
    return { ok: false, error: "min_star must be a half star from 0.5 to 5.0 (0.5, 1.0, 1.5 ... 5.0)." };
  }
  return { ok: true, value: n };
}

type DbError = { code?: string; message?: string } | null | undefined;

export function isMissingMinStarColumn(err: DbError): boolean {
  if (!err) return false;
  const msg = err.message ?? "";
  return (err.code === "42703" || err.code === "PGRST204" || /could not find|does not exist|schema cache/i.test(msg)) && /min_star/i.test(msg);
}

/**
 * Runs an insert that sets `min_star`, retrying without it when the column is missing, so code can deploy before
 * the migration runs. `write(true)` includes `min_star`; `write(false)` is the same write without it.
 */
export async function writeWithOptionalMinStar<R extends { error: DbError }>(write: (withMinStar: boolean) => PromiseLike<R>): Promise<R> {
  const first = await write(true);
  if (!isMissingMinStarColumn(first.error)) return first;
  console.warn("[minStar] pickup_runs.min_star missing; saved with the tier band only. Run 20261011000000_pickup_runs_min_star.sql.");
  return write(false);
}

export type EligibilityResult = { ok: true } | { ok: false; error: string };

const TIER_RANK: Record<string, number> = { bronze: 1, silver: 2, gold: 3, platinum: 4, diamond: 5 };

/**
 * Whether a player may join a game by skill level.
 *  - Game has min_star: the player's star (their rating, or the tier stand-in) must be at least that.
 *  - Otherwise the existing tier gate, unchanged: the player's tier rank must reach the game's open_tier_rank.
 */
export function checkSkillEligibility(
  run: { open_tier_rank?: unknown; min_star?: unknown },
  player: { tier?: string | null; star_rating?: number | string | null } | null,
): EligibilityResult {
  const minStar = run.min_star == null ? NaN : Number(run.min_star);
  if (Number.isFinite(minStar) && minStar > 0) {
    const star = internalStar(player);
    if (star == null || star < minStar) {
      return { ok: false, error: `This session is for players rated ${minStar.toFixed(1)}★ and up.` };
    }
    return { ok: true };
  }

  const minTierRank = typeof run.open_tier_rank === "number" ? run.open_tier_rank : 0;
  if (minTierRank > 0) {
    const playerTierRank = player?.tier ? (TIER_RANK[player.tier] ?? 0) : 0;
    if (playerTierRank < minTierRank) {
      const band = TIER_BANDS.find((b) => b.open_tier_rank === minTierRank);
      return {
        ok: false,
        error: band ? `This session is for players rated ${band.low.toFixed(1)}★ and up.` : "This session is for higher-rated players.",
      };
    }
  }
  return { ok: true };
}
