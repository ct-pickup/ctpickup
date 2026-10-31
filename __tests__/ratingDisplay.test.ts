import { describe, expect, it } from "vitest";

import { gamesSoFar, RATING_NOTE_OTHER, RATING_NOTE_OWN, ratingDisplay, ratingNote, ratingNumber, reliabilityPercent, starsText } from "../mobile/lib/ratingDisplayCore";
import { fetchPlayerCard, fetchPlayerCards } from "../mobile/lib/starRatings";

describe("ratingNumber", () => {
  it("shows the exact rating with two decimals when it matches the star", () => {
    expect(ratingNumber(3.5, 3.62)).toBe("3.62");
    expect(ratingNumber(3.5, 3.5)).toBe("3.50");
    expect(ratingNumber(5, 4.76)).toBe("4.76");
    expect(ratingNumber(0.5, 0.5)).toBe("0.50");
  });
  it("falls back to the one decimal star when the exact rating is missing or disagrees with the star", () => {
    expect(ratingNumber(3.5, null)).toBe("3.5");
    expect(ratingNumber(3.5, undefined)).toBe("3.5");
    expect(ratingNumber(3.5, NaN)).toBe("3.5");
    expect(ratingNumber(3.5, 4.1)).toBe("3.5"); // a stale or wrong decimal never contradicts the stars
    expect(ratingNumber(2, 5.4)).toBe("2.0");
  });
});

describe("starsText", () => {
  it("reads naturally", () => {
    expect(starsText(3.5)).toBe("3.5 stars");
    expect(starsText(4)).toBe("4.0 stars");
    expect(starsText(1)).toBe("1 star");
    expect(starsText(0.5)).toBe("0.5 stars");
  });
});

describe("reliabilityPercent", () => {
  it("is games over games-to-settle, capped at 100", () => {
    expect(reliabilityPercent(0, 5)).toBe(0);
    expect(reliabilityPercent(1, 5)).toBe(20);
    expect(reliabilityPercent(3, 5)).toBe(60);
    expect(reliabilityPercent(4, 5)).toBe(80);
    expect(reliabilityPercent(5, 5)).toBe(100);
    expect(reliabilityPercent(12, 5)).toBe(100);
    expect(reliabilityPercent(1, 3)).toBe(33);
  });
  it("is null when the games are not known", () => {
    expect(reliabilityPercent(null, 5)).toBeNull();
    expect(reliabilityPercent(2, null)).toBeNull();
    expect(reliabilityPercent(undefined, undefined)).toBeNull();
    expect(reliabilityPercent(2, 0)).toBeNull();
    expect(reliabilityPercent(-1, 5)).toBeNull();
  });
  it("reaches 100 exactly when the provisional rule (5 rated games) stops applying", () => {
    for (let n = 0; n <= 8; n++) expect(reliabilityPercent(n, 5) === 100).toBe(n >= 5);
  });
});

describe("ratingDisplay", () => {
  const base = { star: 3.5, exact: 3.62, ratedGames: 3, settledGames: 5, provisional: true };
  it("builds the provisional block", () => {
    expect(ratingDisplay(base)).toEqual({ number: "3.62", starsText: "3.5 stars", reliability: 60, settled: false, progress: 0.6, gamesLabel: "3 games so far" });
  });
  it("builds the settled block", () => {
    const d = ratingDisplay({ ...base, ratedGames: 9, provisional: false });
    expect(d.reliability).toBe(100);
    expect(d.settled).toBe(true);
    expect(d.progress).toBe(1);
    expect(d.gamesLabel).toBe("9 games so far");
  });
  it("zero games: ring at 0 and no plural slip", () => {
    const d = ratingDisplay({ ...base, ratedGames: 0 });
    expect(d.reliability).toBe(0);
    expect(d.gamesLabel).toBe("0 games so far");
    expect(gamesSoFar(1)).toBe("1 game so far");
  });
  it("without the migration the ring and bar are hidden and the number is the old one decimal star", () => {
    const d = ratingDisplay({ star: 3.5, exact: null, ratedGames: null, settledGames: null, provisional: true });
    expect(d).toMatchObject({ number: "3.5", reliability: null, progress: null, gamesLabel: null });
  });
});

describe("copy", () => {
  it("has the note for own and other profiles, with no em dash and no tier or wave words", () => {
    expect(ratingNote(true)).toBe("Stars round to the nearest half star. The decimal is your exact rating.");
    expect(ratingNote(false)).toBe(RATING_NOTE_OTHER);
    for (const t of [RATING_NOTE_OWN, RATING_NOTE_OTHER, starsText(3.5), gamesSoFar(3)]) {
      expect(t).not.toMatch(/—|–|\btier\b|\bwave\b|bronze|silver|gold|platinum|diamond/i);
    }
  });
});

/** A minimal stand in for the Supabase client: records the selected columns and can fail the extended select. */
function client(rows: unknown[], failExtended: boolean) {
  const selects: string[] = [];
  const supabase = {
    from: () => ({
      select: (cols: string) => {
        selects.push(cols);
        const bad = failExtended && cols.includes("rating_exact");
        return { in: async () => (bad ? { data: null, error: { message: "column player_cards.rating_exact does not exist" } } : { data: rows, error: null }) };
      },
    }),
  };
  return { supabase: supabase as never, selects };
}
const row = { user_id: "u1", star_rating: 3.5, star_provisional: true, percentile: 40 };

describe("fetchPlayerCard", () => {
  it("reads the exact rating and games when the migration is applied", async () => {
    const { supabase, selects } = client([{ ...row, rating_exact: "3.62", rated_games: 3, settled_games: 5 }], false);
    const c = await fetchPlayerCard(supabase, "u1");
    expect(selects).toHaveLength(1);
    expect(c).toMatchObject({ star: 3.5, exact: 3.62, ratedGames: 3, settledGames: 5 });
  });
  it("falls back to the star columns when the migration is not applied yet", async () => {
    const { supabase, selects } = client([row], true);
    const c = await fetchPlayerCard(supabase, "u1");
    expect(selects).toHaveLength(2);
    expect(selects[1]).toBe("user_id,star_rating,star_provisional,percentile");
    expect(c).toMatchObject({ star: 3.5, provisional: true, exact: null, ratedGames: null, settledGames: null });
  });
  it("lists (leaderboards, game lists) never ask for the exact columns", async () => {
    const { supabase, selects } = client([row], false);
    const m = await fetchPlayerCards(supabase, ["u1"]);
    expect(selects).toEqual(["user_id,star_rating,star_provisional,percentile"]);
    expect(m.get("u1")?.exact).toBeNull();
  });
  it("returns nothing for a player with no rating row", async () => {
    const { supabase } = client([], false);
    expect(await fetchPlayerCard(supabase, "u1")).toBeNull();
  });
});
