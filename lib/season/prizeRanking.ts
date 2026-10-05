/**
 * Season prize ranking. Pure: no Supabase, no React.
 *
 * There is exactly ONE prize per season: first place, $150. No second or third place.
 *
 * Who is ranked: players who entered the season, have not been disqualified, are not staff or admin accounts
 * (profiles.is_admin; the official rules exclude employees and administrators), and have at least
 * SEASON_PRIZE_MIN_GAMES games with a posted result in the season.
 *
 * Tie-break order (exactly this order):
 *   1. most season points
 *   2. then most wins
 *   3. then most Player of the Day awards
 *   4. then earliest season entry time (accepted_at)
 * (If two entrants are still level after all four, user id breaks the tie so the order is stable.
 *  That cannot be reached in practice: entry time is recorded to the millisecond.)
 *
 * The first ranked entrant is the current winner. Disqualifying the winner moves the win to the next
 * eligible entrant in this same order.
 */

import { SEASON_PRIZE_MIN_GAMES } from "../pickup/seasonPrize";

export type SeasonEntrantStats = {
  user_id: string;
  /** Season points from the points ledger. */
  points: number;
  /** Games won (ledger "win" rows) in the season. */
  wins: number;
  /** Player of the Day awards (ledger "potd" rows) in the season. */
  potd: number;
  /** Games with a posted result (ledger "played" rows) in the season. */
  games: number;
  /** When the player entered the season (ISO). */
  accepted_at: string;
  /** Set when the player has been disqualified from this season's prize. */
  disqualified: boolean;
  /** False for banned players. */
  in_good_standing?: boolean;
  /** True for staff or admin accounts (profiles.is_admin). They never rank; the admin view lists them as excluded. */
  is_staff?: boolean;
};

export type RankedEntrant = SeasonEntrantStats & { rank: number; is_winner: boolean };

/** How many eligible entrants the admin view lists. */
export const ADMIN_PRIZE_LIST_SIZE = 10;

export function isPrizeEligible(e: SeasonEntrantStats, minGames: number = SEASON_PRIZE_MIN_GAMES): boolean {
  return !e.disqualified && !e.is_staff && e.in_good_standing !== false && e.games >= minGames;
}

/** Points, then wins, then Player of the Day awards, then earliest entry. Negative when `a` ranks ahead of `b`. */
export function compareEntrants(a: SeasonEntrantStats, b: SeasonEntrantStats): number {
  return (
    b.points - a.points ||
    b.wins - a.wins ||
    b.potd - a.potd ||
    Date.parse(a.accepted_at) - Date.parse(b.accepted_at) ||
    a.user_id.localeCompare(b.user_id)
  );
}

/** The eligible entrants in prize order, best first. Rank 1 is the current winner. */
export function rankEligibleEntrants(entrants: readonly SeasonEntrantStats[], minGames: number = SEASON_PRIZE_MIN_GAMES): RankedEntrant[] {
  return entrants
    .filter((e) => isPrizeEligible(e, minGames))
    .sort(compareEntrants)
    .map((e, i) => ({ ...e, rank: i + 1, is_winner: i === 0 }));
}

/** What the admin sees: the top ADMIN_PRIZE_LIST_SIZE eligible entrants, the first being the current winner. */
export function adminPrizeList(entrants: readonly SeasonEntrantStats[], minGames: number = SEASON_PRIZE_MIN_GAMES): RankedEntrant[] {
  return rankEligibleEntrants(entrants, minGames).slice(0, ADMIN_PRIZE_LIST_SIZE);
}

/** Entrants excluded because they are staff or admin accounts, most points first, so the admin view can show them. */
export function excludedStaffEntrants(entrants: readonly SeasonEntrantStats[]): SeasonEntrantStats[] {
  return entrants.filter((e) => e.is_staff).sort(compareEntrants);
}
