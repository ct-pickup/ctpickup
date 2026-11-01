import { describe, expect, it, vi } from "vitest";

import { starFills, starNumberText, usableExact } from "../mobile/lib/starFillCore";
import { loadExactRatings } from "../lib/ratings/exactRatings";
import { fakeClient, makeDb } from "./helpers/fakeSupabase";

describe("starFills", () => {
  it("3.35 is three full stars, a third of the fourth, and an empty fifth", () => {
    expect(starFills(3.5, 3.35)).toEqual([1, 1, 1, 0.35, 0]);
  });
  it("3.0 is exactly three full stars", () => {
    expect(starFills(3, 3.0)).toEqual([1, 1, 1, 0, 0]);
  });
  it("4.96 nearly fills the fifth star", () => {
    expect(starFills(5, 4.96)).toEqual([1, 1, 1, 1, 0.96]);
  });
  it("0.5 is half of the first star", () => {
    expect(starFills(0.5, 0.5)).toEqual([0.5, 0, 0, 0, 0]);
  });
  it("5.00 fills all five", () => {
    expect(starFills(5, 5)).toEqual([1, 1, 1, 1, 1]);
  });
  it("falls back to the stored half stars when the exact rating is missing", () => {
    expect(starFills(3.5, null)).toEqual([1, 1, 1, 0.5, 0]);
    expect(starFills(3.5, undefined)).toEqual([1, 1, 1, 0.5, 0]);
    expect(starFills(4, null)).toEqual([1, 1, 1, 1, 0]);
    expect(starFills(0.5)).toEqual([0.5, 0, 0, 0, 0]);
  });
  it("ignores an exact rating that disagrees with the stored star, so the stars never contradict the half star", () => {
    expect(starFills(3.5, 4.4)).toEqual([1, 1, 1, 0.5, 0]);
    expect(starFills(2, 5)).toEqual([1, 1, 0, 0, 0]);
    expect(starFills(3.5, NaN)).toEqual([1, 1, 1, 0.5, 0]);
  });
  it("is empty with no rating at all, and clamps wild values", () => {
    expect(starFills(null, null)).toEqual([0, 0, 0, 0, 0]);
    expect(starFills(undefined, 3.4)).toEqual([0, 0, 0, 0, 0]);
    expect(starFills(9, null)).toEqual([1, 1, 1, 1, 1]);
    expect(starFills(-1, null)).toEqual([0, 0, 0, 0, 0]);
  });
  it("the fills add up to the exact rating", () => {
    for (const [star, exact] of [[3.5, 3.62], [1, 0.9], [4.5, 4.4], [2.5, 2.74]] as const) {
      expect(starFills(star, exact).reduce((a, b) => a + b, 0)).toBeCloseTo(exact, 2);
    }
  });
});

describe("starNumberText and usableExact", () => {
  it("shows two decimals from the exact rating and one decimal from the stored star", () => {
    expect(starNumberText(3.5, 3.62)).toBe("3.62");
    expect(starNumberText(3.5, 3.5)).toBe("3.50");
    expect(starNumberText(3.5, null)).toBe("3.5");
    expect(starNumberText(3.5, 4.4)).toBe("3.5");
    expect(starNumberText(5, 4.96)).toBe("4.96");
  });
  it("accepts an exact rating only inside half a half star of the stored one", () => {
    expect(usableExact(3.5, 3.26)).toBe(3.26);
    expect(usableExact(3.5, 3.74)).toBe(3.74);
    expect(usableExact(3.5, 3.76)).toBeNull();
    expect(usableExact(3.5, null)).toBeNull();
    expect(usableExact(null, 3.5)).toBeNull();
  });
});

describe("loadExactRatings (server)", () => {
  it("returns exact rating and games per player from player_cards", async () => {
    const db = makeDb({
      player_cards: [
        { user_id: "a", rating_exact: "3.62", rated_games: 6 },
        { user_id: "b", rating_exact: null, rated_games: 0 },
      ],
    });
    const m = await loadExactRatings(fakeClient(db) as never, ["a", "b", "c", "a"]);
    expect(m.get("a")).toEqual({ exact: 3.62, ratedGames: 6 });
    expect(m.has("b")).toBe(false);
    expect(m.has("c")).toBe(false);
  });
  it("returns nothing, without throwing, when the view lacks the columns (migration not applied)", async () => {
    const db = makeDb({});
    db.failTables.player_cards = "column player_cards.rating_exact does not exist";
    expect((await loadExactRatings(fakeClient(db) as never, ["a"])).size).toBe(0);
    vi.restoreAllMocks();
  });
});
