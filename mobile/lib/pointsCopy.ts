/** Copy for points and games on the Leaderboard rows and the Profile season card. Pure, so tests can pin the exact wording. */

/** "6 games played". Games are all-time; points beside it are this season only. */
export function gamesPlayedText(n: number): string {
  return `${n} ${n === 1 ? "game" : "games"} played`;
}

/** Small line under the points number on Leaderboard rows: the season name ("Fall 2026"), or "this season" if it is not known. */
export function seasonPointsCaption(season: string | null | undefined): string {
  const s = typeof season === "string" ? season.trim() : "";
  return s || "this season";
}

export const POINTS_LABEL = "PTS";
export const POINTS_LOAD_FAILED_TEXT = "Can’t load points, tap to retry";

export type StandingState = "loading" | "ok" | "failed";
