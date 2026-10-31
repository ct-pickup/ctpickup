/**
 * Pure helpers for the profile rating block: the exact two decimal number, "X stars", reliability and the settle progress.
 * No network, no theme. Stars always come from the stored half star; the decimal is only a more exact view of the same rating.
 */
export type RatingInput = {
  star: number;
  /** player_cards.rating_exact (two decimals). Null before the migration is applied. */
  exact: number | null;
  /** player_cards.rated_games and settled_games. Null before the migration is applied. */
  ratedGames: number | null;
  settledGames: number | null;
  provisional: boolean;
};

export type RatingDisplay = {
  /** "3.62", or "3.5" (one decimal) when the exact rating is not available. */
  number: string;
  /** "3.5 stars", "1 star". */
  starsText: string;
  /** 0 to 100, or null when the games behind the rating are not known (ring and bar hidden). */
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

export function starsText(star: number): string {
  return star === 1 ? "1 star" : `${star.toFixed(1)} stars`;
}

/** Share of the games needed to settle that the player has, 0 to 100. 100 exactly when the provisional rule stops applying. */
export function reliabilityPercent(ratedGames: number | null | undefined, settledGames: number | null | undefined): number | null {
  if (!finite(ratedGames) || !finite(settledGames) || settledGames <= 0 || ratedGames < 0) return null;
  return Math.min(100, Math.round((100 * ratedGames) / settledGames));
}

export function gamesSoFar(n: number): string {
  return `${n} ${n === 1 ? "game" : "games"} so far`;
}

export function ratingDisplay(r: RatingInput): RatingDisplay {
  const reliability = reliabilityPercent(r.ratedGames, r.settledGames);
  const known = reliability != null && finite(r.ratedGames);
  return {
    number: ratingNumber(r.star, r.exact),
    starsText: starsText(r.star),
    reliability,
    // Settled follows the stored flag; if the counts disagree with it, the flag wins for the label but the percent stays true.
    settled: !r.provisional,
    progress: known ? reliability / 100 : null,
    gamesLabel: known ? gamesSoFar(r.ratedGames as number) : null,
  };
}

export const RATING_NOTE_OWN = "Stars round to the nearest half star. The decimal is your exact rating.";
export const RATING_NOTE_OTHER = "Stars round to the nearest half star. The decimal is their exact rating.";
export const ratingNote = (own: boolean): string => (own ? RATING_NOTE_OWN : RATING_NOTE_OTHER);
