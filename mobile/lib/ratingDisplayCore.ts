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
  /** "3 games so far", "1 game so far". Null when hidden. */
  gamesLabel: string | null;
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

export function gamesSoFar(n: number): string {
  return `${n} ${n === 1 ? "game" : "games"} so far`;
}

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
    gamesLabel: known ? gamesSoFar(r.ratedGames as number) : null,
  };
}
