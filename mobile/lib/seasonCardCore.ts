import { starNumberText } from "./starFillCore";

/**
 * The viewer's place on the Players > Stars leaderboard, from their own row in /api/leaderboards `tiers` (the server always includes
 * the signed-in player's row with its true rank). Same value and rounding as that list: `starNumberText(star, exact)`.
 */
export type SeasonStanding = {
  /** Stored half star, or null when the player has no rating yet (then rank is null too: "Unranked"). */
  star: number | null;
  /** Exact two decimal rating when the server sent it. */
  exact: number | null;
  /** Fewer rated games than it takes to settle: shown as the "New" chip. */
  provisional: boolean;
  /** True rank in the full Stars ranking, or null without a rating. */
  rank: number | null;
  /** Rated players on the Stars board. */
  total: number | null;
};

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The viewer's own row out of the Stars `tiers` rows (they already carry their true rank) plus the board total. */
export function standingFromTiers(tiers: readonly unknown[], userId: string | null | undefined, total: number | null | undefined): SeasonStanding {
  const mine = userId
    ? (tiers.find((r) => r != null && typeof r === "object" && (r as { user_id?: unknown }).user_id === userId) as
        | { star?: unknown; rating_exact?: unknown; provisional?: unknown; rank?: unknown }
        | undefined)
    : undefined;
  const star = finite(mine?.star) ? mine!.star : null;
  return {
    star,
    exact: star != null && finite(mine?.rating_exact) ? (mine!.rating_exact as number) : null,
    provisional: mine?.provisional === true,
    rank: star != null && finite(mine?.rank) ? (mine!.rank as number) : null,
    total: finite(total) ? total : null,
  };
}

/** "3.58", the same text the Stars leaderboard shows next to the stars. Null without a rating. */
export function standingStarsText(s: Pick<SeasonStanding, "star" | "exact"> | null | undefined): string | null {
  return s && s.star != null ? starNumberText(s.star, s.exact) : null;
}

/** "#12 of 58", "#12", or "Unranked" (only without a rating). */
export function standingRankText(s: Pick<SeasonStanding, "rank" | "total"> | null | undefined): string {
  if (!s || s.rank == null) return "Unranked";
  return `#${s.rank}${s.total != null ? ` of ${s.total}` : ""}`;
}
