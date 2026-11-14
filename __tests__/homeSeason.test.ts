import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { homeSeasonModel, upcomingSuggestions } from "../mobile/lib/homeSeasonCore";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const now = Date.parse("2026-11-13T12:00:00-05:00");
const run = (id: string, offsetMin: number, status: string | null = "planning") => ({ id, start_at: new Date(now + offsetMin * 60_000).toISOString(), status });

describe("Home: upcoming games under Today", () => {
  it("shows at most three future games, soonest first, one per run", () => {
    const out = upcomingSuggestions([run("c", 300), run("a", 60), run("b", 120), run("a", 60), run("d", 400)], now);
    expect(out.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
  it("drops past, cancelled and finished runs", () => {
    const out = upcomingSuggestions([run("past", -30), run("x", 30, "cancelled"), run("y", 40, "canceled"), run("z", 50, "completed"), run("ok", 90)], now);
    expect(out.map((r) => r.id)).toEqual(["ok"]);
  });
  it("is empty with nothing to suggest, and never throws on a bad date", () => {
    expect(upcomingSuggestions([], now)).toEqual([]);
    expect(upcomingSuggestions([{ id: "bad", start_at: "nope", status: null }], now)).toEqual([]);
  });
  it("uses the runs Home already loads and renders under Today only when nothing is booked", () => {
    const home = src("mobile/app/(tabs)/index.tsx");
    expect(home).toMatch(/upcomingSuggestions\(\[\.\.\.nearRuns, \.\.\.regionRuns\]/);
    const cal = src("mobile/components/home/HomeCalendar.tsx");
    expect(cal).toMatch(/dayGames\.length === 0 && isToday && suggestions\.length > 0/);
    expect(cal).toMatch(/suggestions\.slice\(0, 3\)/);
  });
});

describe("Home season card", () => {
  const standing = { star: 3.5, exact: 3.58, provisional: true, rank: 22, total: 270 };
  it("shows rating, rank and prize games when all are loaded", () => {
    const m = homeSeasonModel(standing, 4, true)!;
    expect(m.starsText).toBe("3.58");
    expect(m.rankText).toBe("#22 of 270");
    expect(m.games).toBe(4);
    expect(m.provisional).toBe(true);
  });
  it("hides each piece with no data, and the whole card with nothing", () => {
    expect(homeSeasonModel(null, null, true)).toBeNull();
    expect(homeSeasonModel(null, 2, true)).toMatchObject({ starsText: null, rankText: null, games: 2 });
    expect(homeSeasonModel({ ...standing, rank: null }, 2, true)!.rankText).toBeNull();
    expect(homeSeasonModel(standing, null, true)!.games).toBeNull();
    // prize off: games are never shown; the card still shows the rating
    expect(homeSeasonModel(standing, 7, false)!.games).toBeNull();
    expect(homeSeasonModel(null, 7, false)).toBeNull();
  });
  it("the card opens the profile, sits under the calendar, and uses the existing calls only", () => {
    const home = src("mobile/app/(tabs)/index.tsx");
    expect(home.indexOf("<HomeCalendar")).toBeLessThan(home.indexOf("<HomeSeasonCard"));
    expect(home).toMatch(/<HomeSeasonCard onPress=\{\(\) => push\("\/\(tabs\)\/account"\)\} \/>/);
    const card = src("mobile/components/home/HomeSeasonCard.tsx");
    expect(card).toMatch(/fetchSeasonStanding\(token, userId\)/);
    expect(card).toMatch(/fetchMyRecord\(token\)/);
    expect(card).not.toMatch(/fetch\(`|\/api\//);
    expect(card).toMatch(/seasonCountdownText\(seasonTimeLeft\(now\)\)/);
  });
});
