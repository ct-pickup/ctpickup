/**
 * Rated tournaments: the words and the two small rules the admin screen and the server share. Pure: no React Native, Next or Supabase.
 *
 * The rating itself is worked out in the database (supabase/migrations/20261106000000_rated_tournaments.sql); this file never holds,
 * returns or computes a rating. It only names the reasons a match did not count and says what an admin may change, and when.
 */

/**
 * The most one player's rating can move, up or down in total, across one tournament day. The database reads the same number from
 * rating_config 'tournament_daily_max_delta'; this copy is only for help text, and a test checks that the migration seeds this value.
 */
export const TOURNAMENT_DAILY_MAX_DELTA = 3;

/** Why a scored match of a rated tournament did not move ratings. A short code, written by the database. */
export type RatingReason = "not_rated" | "ratings_off" | "not_scored" | "too_few_players" | "teams_uneven" | "teams_incomplete" | "not_counted";

export type RatingStatus = "off" | "recorded" | "counted" | "skipped" | "not_scored" | "unavailable" | "error";

/** What the admin route says about one match. No ratings, ever. */
export type MatchRatingOutcome = { status: RatingStatus; counted: boolean; reason: RatingReason | null };

const REASON_TEXT: Record<RatingReason, string> = {
  not_rated: "This tournament isn’t rated.",
  ratings_off: "Ratings are switched off for the whole app right now, so this match didn’t count.",
  not_scored: "No score yet.",
  too_few_players: "Not counted: too few players took part in this match for the rating rule.",
  teams_uneven: "Not counted: the two teams differ in size by more than the rating rule allows.",
  teams_incomplete: "Not counted: a team has no players with an account.",
  not_counted: "Not counted.",
};

export function ratingReasonText(reason: string | null | undefined): string {
  if (!reason) return "Counted for ratings.";
  return REASON_TEXT[reason as RatingReason] ?? REASON_TEXT.not_counted;
}

export const RATED_LOCKED_TEXT =
  "Rated is locked because at least one match already has a score. Changing it halfway through an event would leave some matches counted and others not.";

export type RatingOptionsInput = { rated: boolean; count_for_season: boolean; scored_matches: number };

export type RatingOptionsView = {
  rated: boolean;
  count_for_season: boolean;
  /** Rated can no longer be changed: a match already has a score. */
  rated_locked: boolean;
  rated_label: string;
  season_label: string;
  /** Plain words under the Rated switch. */
  rated_note: string;
  /** Plain words under the Counts for season switch. */
  season_note: string;
};

/** A match counts as scored when it has a result and is not a bye. */
export function isScoredMatch(m: { completed_at?: string | null; is_bye?: boolean | null }): boolean {
  return !!m.completed_at && m.is_bye !== true;
}

export function ratedChangeAllowed(scoredMatches: number): boolean {
  return scoredMatches <= 0;
}

export function ratingOptionsView(i: RatingOptionsInput): RatingOptionsView {
  const locked = !ratedChangeAllowed(i.scored_matches);
  return {
    rated: i.rated,
    count_for_season: i.count_for_season,
    rated_locked: locked,
    rated_label: i.rated ? "Rated: on" : "Rated: off",
    season_label: i.count_for_season ? "Counts for season: on" : "Counts for season: off",
    rated_note: locked
      ? RATED_LOCKED_TEXT
      : i.rated
        ? `Each scored match can move player ratings a little (never more than ${TOURNAMENT_DAILY_MAX_DELTA} points in one day). Choose before the first match is scored.`
        : "Matches don’t change any rating. Choose before the first match is scored.",
    season_note: i.count_for_season
      ? "Played, win and draw points from these matches go on the season leaderboard and count toward the 10 game prize. You can change this at any time; earlier matches follow."
      : "These matches add no season points and don’t count toward the 10 game prize. You can change this at any time; earlier matches follow.",
  };
}
