import { describe, expect, it } from "vitest";

import { capRanked } from "../lib/leaderboards/cap";
import { compareStarRows, sortStarRows, type StarOrderRow } from "../lib/leaderboards/starOrder";

const row = (user_id: string, star: number | null, rating_exact: number | null, rated_games: number | null): StarOrderRow => ({ user_id, star, rating_exact, rated_games });

describe("Stars leaderboard order", () => {
  it("puts Dylan 3.60 (5 games) above Malik 3.38 (2 games) inside the same 3.5 band", () => {
    const sorted = sortStarRows([row("malik", 3.5, 3.38, 2), row("dylan", 3.5, 3.6, 5)]);
    expect(sorted.map((r) => r.user_id)).toEqual(["dylan", "malik"]);
  });
  it("orders a whole band by exact rating, not by input order or points", () => {
    const rows = [row("c", 3.5, 3.31, 4), row("a", 3.5, 3.72, 9), row("d", 3.5, 3.38, 2), row("b", 3.5, 3.6, 5)];
    expect(sortStarRows(rows).map((r) => r.user_id)).toEqual(["a", "b", "d", "c"]);
  });
  it("a higher band still beats a lower one", () => {
    const sorted = sortStarRows([row("low", 3, 3.24, 8), row("high", 3.5, 3.26, 1)]);
    expect(sorted.map((r) => r.user_id)).toEqual(["high", "low"]);
  });
  it("players with 0 rated games go below every rated player, whatever their star", () => {
    const sorted = sortStarRows([row("zero4", 4.5, 4.6, 0), row("zero35", 3.5, 3.5, 0), row("rated1", 1, 0.9, 3), row("rated35", 3.5, 3.38, 2)]);
    expect(sorted.map((r) => r.user_id)).toEqual(["rated35", "rated1", "zero4", "zero35"]);
  });
  it("uses the half star when a player has no exact rating (migration not applied), and does not demote unknown games", () => {
    const sorted = sortStarRows([row("b", 3, null, null), row("a", 3.5, null, null), row("c", 3.5, null, null)]);
    expect(sorted.map((r) => r.user_id)).toEqual(["a", "c", "b"]);
  });
  it("ties on exact go to the star, then more rated games, then id", () => {
    const sorted = sortStarRows([row("z", 3.5, 3.5, 4), row("m", 3.5, 3.5, 6), row("a", 3.5, 3.5, 6)]);
    expect(sorted.map((r) => r.user_id)).toEqual(["a", "m", "z"]);
  });
  it("unrated players (no star at all) are last among players with games", () => {
    const sorted = sortStarRows([row("none", null, null, null), row("r", 0.5, 0.5, 1)]);
    expect(sorted.map((r) => r.user_id)).toEqual(["r", "none"]);
  });
  it("is deterministic: any input order gives the same output", () => {
    const rows = [row("e", 3.5, 3.5, 2), row("d", 3.5, 3.5, 2), row("c", 3, 3.1, 7), row("b", 4, 4.02, 1), row("a", 4, 4.02, 1), row("z", 3.5, 3.7, 0)];
    const want = sortStarRows(rows).map((r) => r.user_id);
    for (let i = 0; i < 20; i++) {
      const shuffled = [...rows].sort(() => Math.random() - 0.5);
      expect(sortStarRows(shuffled).map((r) => r.user_id)).toEqual(want);
    }
    expect(compareStarRows(rows[0]!, rows[0]!)).toBe(0);
  });
  it("ranks are assigned after the sort, so Dylan is ahead of Malik and zero-game players get the last ranks", () => {
    const sorted = sortStarRows([
      row("zero1", 3.5, 3.5, 0),
      row("malik", 3.5, 3.38, 2),
      row("zero2", 4, 4.0, 0),
      row("dylan", 3.5, 3.6, 5),
    ]);
    const { rows } = capRanked(sorted, (r) => r.user_id, null, new Set(), 10);
    const rankOf = (id: string) => rows.find((r) => r.user_id === id)!.rank;
    expect(rankOf("dylan")).toBe(1);
    expect(rankOf("malik")).toBe(2);
    expect(rankOf("zero2")).toBe(3);
    expect(rankOf("zero1")).toBe(4);
  });
});
