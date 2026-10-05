import { describe, expect, it } from "vitest";

import { lastGames, seasonTotals, trendShape, type StatsGame } from "../mobile/lib/seasonStats";

const g = (id: string, start: string | null, outcome: StatsGame["outcome"], potd = false): StatsGame => ({
  run_id: id, start_at: start, title: null, location_text: null, team: "A", outcome, score: null, potd,
});

describe("seasonTotals", () => {
  const log = [
    g("a", "2026-10-02T23:00:00Z", "W", true),
    g("b", "2026-09-20T23:00:00Z", "L"),
    g("c", "2026-09-05T23:00:00Z", "D"),
    g("old", "2026-07-01T23:00:00Z", "W"), // Summer: not this season
    g("pending", "2026-10-05T23:00:00Z", null), // no result
    g("nodate", null, "W"),
  ];
  it("counts only this season's games with a result", () => {
    expect(seasonTotals(log, "Fall 2026")).toEqual({ games: 3, wins: 1, draws: 1, losses: 1, potd: 1 });
  });
  it("copes with an empty or missing log", () => {
    expect(seasonTotals(undefined, "Fall 2026").games).toBe(0);
    expect(seasonTotals([], "Fall 2026").potd).toBe(0);
  });
});

describe("lastGames", () => {
  it("newest first, results only, limited", () => {
    const log = [g("old", "2026-09-01T00:00:00Z", "L"), g("new", "2026-10-01T00:00:00Z", "W"), g("none", "2026-10-09T00:00:00Z", null)];
    expect(lastGames(log, 5).map((x) => x.run_id)).toEqual(["new", "old"]);
    expect(lastGames(log, 1).map((x) => x.run_id)).toEqual(["new"]);
  });
});

describe("trendShape", () => {
  it("scales to 0..1 so no scores leak", () => {
    expect(trendShape([40, 50, 60])).toEqual([0, 0.5, 1]);
  });
  it("needs two points and tolerates a flat line", () => {
    expect(trendShape([50])).toBeNull();
    expect(trendShape([])).toBeNull();
    expect(trendShape([50, 50])).toEqual([0.5, 0.5]);
  });
});
