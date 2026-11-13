/**
 * Pure math behind the profile and leaderboard polish (count-up, medals, rank changes, badge unlocks, the season countdown).
 * No React, no theme, so every rule here is unit tested. Components only animate what these functions decide.
 */
import { seasonWindowFor } from "./pickup/seasonPrize";

/** 0..1 -> 0..1, fast start and a soft landing. */
export function easeOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - x, 3);
}

/** The value a count-up shows at progress `t` (0..1) on its way from 0 to `target`. */
export function countUpValue(t: number, target: number): number {
  return easeOutCubic(t) * target;
}

/** Count-up length: short for small numbers, never more than 1.1 s. */
export function countUpDurationMs(target: number): number {
  return Math.round(Math.min(1100, 500 + Math.abs(target) * 120));
}

export type Medal = "gold" | "silver" | "bronze";

/** Top three only. */
export function medalFor(rank: number | null | undefined): Medal | null {
  return rank === 1 ? "gold" : rank === 2 ? "silver" : rank === 3 ? "bronze" : null;
}

/**
 * Rank change since the last time this viewer saw the list, by player. Positive means moved up (a lower rank number).
 * A player not in the previous snapshot has no arrow. Zero is "no change".
 */
export function rankDeltas(previous: Readonly<Record<string, number>>, current: ReadonlyArray<{ user_id: string; rank: number }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of current) {
    const was = previous[r.user_id];
    if (typeof was === "number" && Number.isFinite(was)) out[r.user_id] = was - r.rank;
  }
  return out;
}

/** The snapshot to remember for next time. */
export function rankSnapshot(current: ReadonlyArray<{ user_id: string; rank: number }>): Record<string, number> {
  return Object.fromEntries(current.map((r) => [r.user_id, r.rank]));
}

/** The badges that get the unlock animation. */
export const CELEBRATED_BADGES = ["first_game", "games_10", "win_streak_3", "potd"] as const;
export type CelebratedBadge = (typeof CELEBRATED_BADGES)[number];

/**
 * Badges that were not earned the last time this device saw the shelf and are earned now. `seenEarned` null means this device has no
 * memory yet (first open): nothing is celebrated then, so an old badge never fires confetti on a new phone.
 */
export function newlyEarnedBadges(
  seenEarned: ReadonlySet<string> | null,
  badges: ReadonlyArray<{ id: string; earned: boolean }>,
): CelebratedBadge[] {
  if (!seenEarned) return [];
  return badges
    .filter((b) => b.earned && !seenEarned.has(b.id) && (CELEBRATED_BADGES as readonly string[]).includes(b.id))
    .map((b) => b.id as CelebratedBadge);
}

export type TimeLeft = { days: number; hours: number; minutes: number; totalMs: number };

/** Time left until the season's last day ends (midnight Eastern after its endDate). Never negative. */
export function seasonTimeLeft(now: number = Date.now()): TimeLeft {
  const season = seasonWindowFor(now);
  // The season ends at the start of the day AFTER endDate, Eastern. Find that instant by probing the offset at the end date.
  const endDayUtc = Date.parse(`${season.endDate}T00:00:00Z`) + 86_400_000;
  const offsetMin = easternOffsetMinutes(endDayUtc);
  const endMs = endDayUtc + offsetMin * 60_000;
  const totalMs = Math.max(0, endMs - now);
  const minutesAll = Math.floor(totalMs / 60_000);
  return { days: Math.floor(minutesAll / 1440), hours: Math.floor((minutesAll % 1440) / 60), minutes: minutesAll % 60, totalMs };
}

/** "12d 4h 15m left", "4h 15m left", "15m left", or "Season over". */
export function seasonCountdownText(t: TimeLeft): string {
  if (t.totalMs <= 0) return "Season over";
  if (t.days > 0) return `${t.days}d ${t.hours}h ${t.minutes}m left`;
  if (t.hours > 0) return `${t.hours}h ${t.minutes}m left`;
  return `${t.minutes}m left`;
}

/** Minutes that America/New_York is behind UTC at `ms` (240 in summer, 300 in winter). */
function easternOffsetMinutes(ms: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const local = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
  return Math.round((ms - local) / 60_000);
}

/** 0..1 toward the prize threshold. */
export function prizeProgress(games: number | null | undefined, minGames: number): number {
  if (!Number.isFinite(games as number) || minGames <= 0) return 0;
  return Math.min(1, Math.max(0, (games as number) / minGames));
}
