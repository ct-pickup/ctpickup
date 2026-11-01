/**
 * Order of the Stars leaderboard. Pure, so the rule is tested without a database.
 *
 *   1. players with at least one game played above players with none (0 games played sinks, whatever star it was seeded with).
 *      "Games played" is the count each row shows as "N games played": games with a posted result where the player was on a team
 *      (lib/records/playerRecord.ts). It is NOT player_ratings.sessions. A row whose games played is unknown is not demoted
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
  /** Games played (posted results with the player on a team); the number shown as "N games played". */
  games?: number | null;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function compareStarRows(a: StarOrderRow, b: StarOrderRow): number {
  const noGames = (r: StarOrderRow) => (num(r.games) === 0 ? 1 : 0);
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
