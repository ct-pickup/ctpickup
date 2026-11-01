import { ratingDisplay, type RatingDisplay } from "./ratingDisplayCore";

/** The slice of a player card the season screen needs. */
export type SeasonCardInput = {
  star: number;
  provisional: boolean;
  exact?: number | null;
  ratedGames?: number | null;
  settledGames?: number | null;
};

export type SeasonRatingCardModel = {
  star: number;
  exact: number | null;
  /** Reuses the profile block's display logic, so the number matches the profile exactly. */
  display: RatingDisplay;
  /** "Provisional" label: fewer rated games than it takes to settle (the same rule as the profile's star_provisional). */
  provisional: boolean;
};

/**
 * The small rating card at the top of "Your season". Null (card hidden) when the player has no rating yet: no player card, or a
 * star that is not a real rating. Everything else comes from ratingDisplayCore, the same logic as the profile rating block.
 */
export function seasonRatingCard(card: SeasonCardInput | null | undefined): SeasonRatingCardModel | null {
  if (!card || typeof card.star !== "number" || !Number.isFinite(card.star) || card.star <= 0) return null;
  const rated = card.ratedGames ?? null;
  const settled = card.settledGames ?? null;
  const display = ratingDisplay({ star: card.star, exact: card.exact ?? null, ratedGames: rated, settledGames: settled, provisional: card.provisional });
  const provisional = rated != null && settled != null ? rated < settled : card.provisional;
  return { star: card.star, exact: card.exact ?? null, display, provisional };
}
