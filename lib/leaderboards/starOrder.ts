/**
 * Order of the Stars leaderboard. Pure, so the rule is tested without a database.
 *
 *   1. players with at least one rated game above players with none (0 games sinks, whatever star it was seeded with);
 *      unknown games (migration not applied) are not demoted
 *   2. exact rating (player_cards.rating_exact) descending; the stored half star stands in when a player has no exact rating
 *   3. the stored half star descending (only matters between a real exact rating and a stand-in)
 *   4. rated games descending
 *   5. user id ascending, so equal players always come out in the same order
 *
 * Ranks are assigned AFTER this sort (lib/leaderboards/cap.ts uses the index). The raw score is never read here.
 */
export type StarOrderRow = {
  user_id: string;
  star?: number | null;
  rating_exact?: number | null;
  rated_games?: number | null;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function compareStarRows(a: StarOrderRow, b: StarOrderRow): number {
  const noGames = (r: StarOrderRow) => (num(r.rated_games) === 0 ? 1 : 0);
  const value = (r: StarOrderRow) => num(r.rating_exact) ?? num(r.star) ?? -1;
  return (
    noGames(a) - noGames(b) ||
    value(b) - value(a) ||
    (num(b.star) ?? -1) - (num(a.star) ?? -1) ||
    (num(b.rated_games) ?? -1) - (num(a.rated_games) ?? -1) ||
    (a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0)
  );
}

export function sortStarRows<T extends StarOrderRow>(rows: readonly T[]): T[] {
  return [...rows].sort(compareStarRows);
}
