/**
 * Pure helpers for the profile rating block: the exact two decimal number, the show-up ring and the settle progress.
 * No network, no theme. Stars always come from the stored half star; the decimal is only a more exact view of the same rating.
 */
export type RatingInput = {
  star: number;
  /** player_cards.rating_exact (two decimals). Null before the migration is applied. */
  exact: number | null;
  /** player_cards.rated_games and settled_games. Null before the migration is applied. */
  ratedGames: number | null;
  settledGames: number | null;
  /** player_cards.attendance_reliability (0 to 100). Null before its migration is applied. */
  attendanceReliability?: number | null;
  provisional: boolean;
};

export type RatingDisplay = {
  /** "3.62", or "3.5" (one decimal) when the exact rating is not available. */
  number: string;
  /** Show-up reliability for the ring, 0 to 100. Null (ring hidden) with 0 rated games or when the column is missing. */
  reliability: number | null;
  settled: boolean;
  /** 0 to 1 for the progress bar, or null when hidden. */
  progress: number | null;
  /** "3 of 5 rated games". Null when hidden. */
  gamesLabel: string | null;
  /** "2 more games to lock your rating", "1 more game to lock your rating", or "Rating locked in". Null when the counts are unknown. */
  lockLabel: string | null;
};

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The number a half star player sees. Falls back to one decimal of the star so the old display survives a missing migration. */
export function ratingNumber(star: number, exact: number | null | undefined): string {
  return finite(exact) && exact >= 0.5 && exact <= 5 && Math.round(exact * 2) / 2 === star ? exact.toFixed(2) : star.toFixed(1);
}

/** Share of the games needed to settle that the player has, 0 to 100. 100 exactly when the provisional rule stops applying. */
export function reliabilityPercent(ratedGames: number | null | undefined, settledGames: number | null | undefined): number | null {
  if (!finite(ratedGames) || !finite(settledGames) || settledGames <= 0 || ratedGames < 0) return null;
  return Math.min(100, Math.round((100 * ratedGames) / settledGames));
}

/**
 * The ring value: attendance reliability, shown from the first rated game. Everyone starts at 92, which would look odd with no
 * games, so 0 rated games (or unknown games, or a missing column) hides it.
 */
export function attendanceRing(reliability: number | null | undefined, ratedGames: number | null | undefined): number | null {
  if (!finite(reliability) || !finite(ratedGames) || ratedGames < 1) return null;
  return Math.min(100, Math.max(0, Math.round(reliability)));
}

/** How far from a settled rating, in plain words. */
export function lockLabel(ratedGames: number | null | undefined, settledGames: number | null | undefined, settled: boolean): string | null {
  if (!finite(ratedGames) || !finite(settledGames) || settledGames <= 0) return null;
  const left = Math.max(0, settledGames - ratedGames);
  if (settled || left === 0) return "Rating locked in";
  return `${left} more ${left === 1 ? "game" : "games"} to lock your rating`;
}

/** "0 of 5 rated games": counts rated games only, so it never reads against the games played count above it. */
export function ratedGamesLabel(rated: number, settled: number): string {
  return `${rated} of ${settled} rated games`;
}

/**
 * What makes a game count as rated, in plain words. From the code: a rating session settles when the host submits player ratings
 * (session screen, "Submit & settle ratings") or automatically two hours after kickoff (check-voting); each settled game the player
 * attended adds one rated game.
 */
export const RATED_GAMES_HELP = "A game counts as rated once its ratings settle: when the host submits player ratings, or two hours after kickoff.";

export function ratingDisplay(r: RatingInput): RatingDisplay {
  const confidence = reliabilityPercent(r.ratedGames, r.settledGames);
  const known = confidence != null && finite(r.ratedGames);
  return {
    number: ratingNumber(r.star, r.exact),
    reliability: attendanceRing(r.attendanceReliability, r.ratedGames),
    // Settled follows the stored flag; if the counts disagree with it, the flag wins for the label.
    settled: !r.provisional,
    // The bar is the rating-confidence signal (rated games toward settled). It never shows a percent.
    progress: known ? confidence / 100 : null,
    gamesLabel: known ? ratedGamesLabel(r.ratedGames as number, r.settledGames as number) : null,
    lockLabel: known ? lockLabel(r.ratedGames, r.settledGames, !r.provisional) : null,
  };
}
