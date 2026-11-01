import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { attendanceRing, gamesSoFar, ratingDisplay, ratingNumber, reliabilityPercent, starsText } from "../mobile/lib/ratingDisplayCore";
import { STAR_LEVELS_SUBTITLE } from "../shared/starLevels";
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

describe("attendanceRing", () => {
  it("hides the ring with 0 rated games, even though everyone starts at 92", () => {
    expect(attendanceRing(92, 0)).toBeNull();
  });
  it("shows it from the first rated game", () => {
    expect(attendanceRing(92, 1)).toBe(92);
    expect(attendanceRing(92.4, 3)).toBe(92);
    expect(attendanceRing(85, 12)).toBe(85);
  });
  it("is hidden when the column or the games are unknown (migration not applied)", () => {
    expect(attendanceRing(null, 4)).toBeNull();
    expect(attendanceRing(undefined, 4)).toBeNull();
    expect(attendanceRing(92, null)).toBeNull();
    expect(attendanceRing(92, undefined)).toBeNull();
    expect(attendanceRing(NaN, 4)).toBeNull();
  });
  it("keeps the value inside 0 to 100", () => {
    expect(attendanceRing(0, 2)).toBe(0);
    expect(attendanceRing(120, 2)).toBe(100);
    expect(attendanceRing(-5, 2)).toBe(0);
  });
});

describe("ratingDisplay", () => {
  const base = { star: 3.5, exact: 3.62, ratedGames: 3, settledGames: 5, attendanceReliability: 92, provisional: true };
  it("builds the provisional block: ring is attendance, bar is rating confidence with no percent", () => {
    expect(ratingDisplay(base)).toEqual({ number: "3.62", starsText: "3.5 stars", reliability: 92, settled: false, progress: 0.6, gamesLabel: "3 games so far" });
  });
  it("builds the settled block", () => {
    const d = ratingDisplay({ ...base, ratedGames: 9, provisional: false, attendanceReliability: 100 });
    expect(d.reliability).toBe(100);
    expect(d.settled).toBe(true);
    expect(d.progress).toBe(1);
    expect(d.gamesLabel).toBe("9 games so far");
  });
  it("0 games: the ring is hidden but the bar and the games line stay", () => {
    const d = ratingDisplay({ ...base, ratedGames: 0 });
    expect(d.reliability).toBeNull();
    expect(d.progress).toBe(0);
    expect(d.gamesLabel).toBe("0 games so far");
    expect(gamesSoFar(1)).toBe("1 game so far");
  });
  it("1 game: the ring shows", () => {
    expect(ratingDisplay({ ...base, ratedGames: 1 }).reliability).toBe(92);
  });
  it("attendance column missing: ring hidden, everything else works", () => {
    const d = ratingDisplay({ ...base, attendanceReliability: null });
    expect(d).toMatchObject({ number: "3.62", reliability: null, progress: 0.6, gamesLabel: "3 games so far" });
  });
  it("without the earlier migration too: old one decimal star, no ring, no bar", () => {
    const d = ratingDisplay({ star: 3.5, exact: null, ratedGames: null, settledGames: null, attendanceReliability: null, provisional: true });
    expect(d).toMatchObject({ number: "3.5", reliability: null, progress: null, gamesLabel: null });
  });
});

describe("copy", () => {
  it("has no em dash and no tier or wave words", () => {
    for (const t of [starsText(3.5), gamesSoFar(3), STAR_LEVELS_SUBTITLE]) {
      expect(t).not.toMatch(/—|–|\btier\b|\bwave\b|bronze|silver|gold|platinum|diamond/i);
    }
  });
  it("labels the ring Reliability and shows no percent on the bar", () => {
    const ring = readFileSync(new URL("../mobile/components/profile/RatingReliability.tsx", import.meta.url), "utf8");
    expect(ring).toMatch(/Reliability\s*\n\s*<\/Text>/);
    expect(ring).not.toMatch(/Reliable\b(?!ity)/);
    expect(ring).toMatch(/accessibilityLabel=\{`Reliability \$\{clamped\} percent`\}/);
    // The bar component has no percent: its only text is Provisional, Settled and the games line.
    const bar = ring.slice(ring.indexOf("export function SettleProgress"), ring.indexOf("function make_styles"));
    const withoutFillWidth = bar.split("\n").filter((l) => !l.includes("width:")).join("\n");
    expect(withoutFillWidth).not.toMatch(/%/);
    expect(withoutFillWidth).not.toMatch(/percent/i);
  });
  it("no longer carries the rounding note", () => {
    expect(STAR_LEVELS_SUBTITLE).not.toMatch(/round to the nearest/i);
  });
});

/** A minimal stand in for the Supabase client: records the selected columns and fails any select that names a missing column. */
function client(rows: unknown[], missing: string[]) {
  const selects: string[] = [];
  const supabase = {
    from: () => ({
      select: (cols: string) => {
        selects.push(cols);
        const bad = missing.find((m) => cols.includes(m));
        return { in: async () => (bad ? { data: null, error: { message: `column player_cards.${bad} does not exist` } } : { data: rows, error: null }) };
      },
    }),
  };
  return { supabase: supabase as never, selects };
}
const row = { user_id: "u1", star_rating: 3.5, star_provisional: true, percentile: 40 };
const BASE = "user_id,star_rating,star_provisional,percentile";
const EXACT = `${BASE},rating_exact,rated_games,settled_games`;

describe("fetchPlayerCard", () => {
  it("reads the exact rating, games and attendance reliability when both migrations are applied", async () => {
    const { supabase, selects } = client([{ ...row, rating_exact: "3.62", rated_games: 3, settled_games: 5, attendance_reliability: 92 }], []);
    const c = await fetchPlayerCard(supabase, "u1");
    expect(selects).toEqual([`${EXACT},attendance_reliability`]);
    expect(c).toMatchObject({ star: 3.5, exact: 3.62, ratedGames: 3, settledGames: 5, attendanceReliability: 92 });
  });
  it("attendance column missing: keeps the exact rating and games, and the ring has no value", async () => {
    const { supabase, selects } = client([{ ...row, rating_exact: "3.62", rated_games: 3, settled_games: 5 }], ["attendance_reliability"]);
    const c = await fetchPlayerCard(supabase, "u1");
    expect(selects).toEqual([`${EXACT},attendance_reliability`, EXACT]);
    expect(c).toMatchObject({ exact: 3.62, ratedGames: 3, attendanceReliability: null });
  });
  it("neither migration applied: falls back to the star columns alone", async () => {
    const { supabase, selects } = client([row], ["rating_exact", "attendance_reliability"]);
    const c = await fetchPlayerCard(supabase, "u1");
    expect(selects).toEqual([`${EXACT},attendance_reliability`, EXACT, BASE]);
    expect(c).toMatchObject({ star: 3.5, provisional: true, exact: null, ratedGames: null, settledGames: null, attendanceReliability: null });
  });
  it("never reads the legacy reliability column", async () => {
    const { supabase, selects } = client([row], []);
    await fetchPlayerCard(supabase, "u1");
    for (const sel of selects) expect(sel.split(",")).not.toContain("reliability");
  });
  it("lists (leaderboards, game lists) never ask for the exact or attendance columns", async () => {
    const { supabase, selects } = client([row], []);
    const m = await fetchPlayerCards(supabase, ["u1"]);
    expect(selects).toEqual([BASE]);
    expect(m.get("u1")?.exact).toBeNull();
  });
  it("returns nothing for a player with no rating row", async () => {
    const { supabase } = client([], []);
    expect(await fetchPlayerCard(supabase, "u1")).toBeNull();
  });
});
