/** Rows per leaderboard category returned to a client, before the requester's own and played-with rows. */
export const LEADERBOARD_TOP_N = 10;

/**
 * Caps one ranked category. `full` is the whole category in rank order (best first); rank is the 1-based position in it.
 * Returns the top `topN` rows, then, in rank order, the requester's own row and the rows of players the requester has
 * played with that fall below the top. Nobody else is included. `total` is the size of the full category.
 */
export function capRanked<T>(
  full: readonly T[],
  idOf: (row: T) => string,
  viewerId: string | null,
  playedWith: ReadonlySet<string>,
  topN: number = LEADERBOARD_TOP_N,
): { rows: Array<T & { rank: number }>; total: number } {
  const rows: Array<T & { rank: number }> = [];
  full.forEach((row, i) => {
    const id = idOf(row);
    const keep = i < topN || (viewerId != null && id === viewerId) || playedWith.has(id);
    if (keep) rows.push({ ...row, rank: i + 1 });
  });
  return { rows, total: full.length };
}
