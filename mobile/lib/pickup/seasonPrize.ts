/**
 * Season prize: the season window, the prize amount and the flag. Pure: no Supabase, no React.
 * Keep mobile/lib/pickup/seasonPrize.ts identical (scripts/sync-mobile-lib-pickup.mjs).
 *
 * Seasons are the points seasons from lib/pickup/points.ts, in America/New_York: Spring Mar-May, Summer Jun-Aug,
 * Fall Sep-Nov, Winter Dec-Feb. These are three-month seasons, not calendar quarters (Jan-Mar, Apr-Jun, ...), so the
 * prize season is always the season the points leaderboard is showing. The key numbers the quarter in which the
 * season STARTS: Spring Q1, Summer Q2, Fall Q3, Winter Q4, with the year the season starts in
 * (Winter Dec 2026 to Feb 2027 is "2026-Q4").
 */

export const SEASON_PRIZE_USD = 150;

/** Version of the official rules the entry pledge was accepted under. Bump when the rules change. */
export const SEASON_PRIZE_RULES_VERSION = "draft-1";

/** Games needed in the season to be prize-eligible (stated in the rules page; not enforced here). */
export const SEASON_PRIZE_MIN_GAMES = 10;

const TIME_ZONE = "America/New_York";

export type SeasonWindow = {
  /** "2026-Q3". */
  key: string;
  /** "Fall 2026" (same label as the points leaderboard). */
  label: string;
  /** First and last day of the season, as YYYY-MM-DD in Eastern time. */
  startDate: string;
  endDate: string;
  /** "Sep 1" and "Nov 30, 2026". */
  startText: string;
  endText: string;
};

function easternYearMonth(ms: number): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, year: "numeric", month: "numeric" }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get("year"), month: get("month") };
}

function labelFor(startYear: number, startMonth: number): string {
  if (startMonth === 3) return `Spring ${startYear}`;
  if (startMonth === 6) return `Summer ${startYear}`;
  if (startMonth === 9) return `Fall ${startYear}`;
  return `Winter ${startYear}–${String((startYear + 1) % 100).padStart(2, "0")}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function textFor(y: number, m: number, d: number, withYear: boolean): string {
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : null),
  });
}

/** The season running at `now` (Eastern time), with its first and last day. */
export function seasonWindowFor(now: number = Date.now()): SeasonWindow {
  const { year, month } = easternYearMonth(now);
  const startMonth = month >= 3 && month <= 5 ? 3 : month >= 6 && month <= 8 ? 6 : month >= 9 && month <= 11 ? 9 : 12;
  const startYear = month <= 2 ? year - 1 : year;

  const endMonthRaw = startMonth + 2;
  const endYear = endMonthRaw > 12 ? startYear + 1 : startYear;
  const endMonth = endMonthRaw > 12 ? endMonthRaw - 12 : endMonthRaw;
  const endDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();

  const quarter = startMonth / 3;
  return {
    key: `${startYear}-Q${quarter}`,
    label: labelFor(startYear, startMonth),
    startDate: `${startYear}-${pad(startMonth)}-01`,
    endDate: `${endYear}-${pad(endMonth)}-${pad(endDay)}`,
    startText: textFor(startYear, startMonth, 1, false),
    endText: textFor(endYear, endMonth, endDay, true),
  };
}

/** Server flag (SEASON_PRIZE_ENABLED=true). The routes and the rules page answer 404 while it is off. */
export function isSeasonPrizeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.SEASON_PRIZE_ENABLED ?? "").trim().toLowerCase() === "true";
}
