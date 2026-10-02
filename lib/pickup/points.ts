/**
 * Points and seasons, the single config. Pure: no Supabase, no React.
 * Keep mobile/lib/pickup/points.ts identical (scripts/sync-mobile-lib-pickup.mjs).
 *
 * Mirrored in SQL by public.points_season_label() (supabase/migrations/20261003000000_points_events.sql)
 * and by supabase/queries/points_events_backfill.sql. Change all three together.
 */

/** Points per ledger reason. No tier or star multiplier. */
export const POINTS = {
  /** Each game with a posted result where the player was on a team (the record's games count). */
  played: 10,
  win: 5,
  draw: 2,
  /** Player of the Day for that game. */
  potd: 10,
} as const;

export type PointsReason = keyof typeof POINTS;
export const POINTS_REASONS: PointsReason[] = ["played", "win", "draw", "potd"];

export type GameOutcome = "W" | "D" | "L";

/** Reasons a player earns for one game: `outcome` null means no team (not a game played). */
export function pointsReasonsForGame(outcome: GameOutcome | null, potd: boolean): PointsReason[] {
  const out: PointsReason[] = [];
  if (outcome != null) out.push("played");
  if (outcome === "W") out.push("win");
  if (outcome === "D") out.push("draw");
  if (potd) out.push("potd");
  return out;
}

export function pointsForGame(outcome: GameOutcome | null, potd: boolean): number {
  return pointsReasonsForGame(outcome, potd).reduce((sum, r) => sum + POINTS[r], 0);
}

export const SEASON_TIME_ZONE = "America/New_York";
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Quarterly seasons from the calendar month: Fall Sep–Nov, Winter Dec–Feb, Spring Mar–May, Summer Jun–Aug.
 * Winter spans two years and is named for both: Dec 2026–Feb 2027 is "Winter 2026–27" (en dash, two-digit end year).
 */
export function seasonLabelFor(year: number, month: number): string {
  if (month >= 9 && month <= 11) return `Fall ${year}`;
  if (month >= 3 && month <= 5) return `Spring ${year}`;
  if (month >= 6 && month <= 8) return `Summer ${year}`;
  const start = month === 12 ? year : year - 1;
  return `Winter ${start}\u2013${String((start + 1) % 100).padStart(2, "0")}`;
}

function easternYearMonth(ms: number): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: SEASON_TIME_ZONE, year: "numeric", month: "numeric" }).formatToParts(
    new Date(ms),
  );
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get("year"), month: get("month") };
}

/**
 * The season of a game from its kickoff (`start_at`), in Eastern time.
 * A start_at of exactly midnight UTC is a date-only anchor (the Eastern calendar day stored as UTC midnight,
 * see lib/datetime/easternWallTime.ts), so its UTC date is used. Null for a missing or invalid time.
 */
export function seasonForStartAt(startAt: string | number | Date | null | undefined): string | null {
  if (startAt == null || startAt === "") return null;
  const ms = startAt instanceof Date ? startAt.getTime() : typeof startAt === "number" ? startAt : Date.parse(startAt);
  if (!Number.isFinite(ms)) return null;
  if (ms % DAY_MS === 0) {
    const d = new Date(ms);
    return seasonLabelFor(d.getUTCFullYear(), d.getUTCMonth() + 1);
  }
  const { year, month } = easternYearMonth(ms);
  return seasonLabelFor(year, month);
}

/** The season running now, in Eastern time. */
export function currentSeason(now: number = Date.now()): string {
  const { year, month } = easternYearMonth(now);
  return seasonLabelFor(year, month);
}
