import { describe, expect, it } from "vitest";

import { averageStars, gamesInRecord, parseCardStats, performance, recordLabel } from "../mobile/lib/playerStatsCore";

const row = { wins: "3", draws: 1, losses: 2, partner_stars: "3.5", opponent_stars: 3, partner_games: 6, opponent_games: 6, perf_games: 6, perf_vs_expected: "1.4", min_games: 3 };

describe("profile game stats", () => {
  it("reads a view row, coercing numbers that arrive as text", () => {
    expect(parseCardStats(row)).toEqual({ wins: 3, draws: 1, losses: 2, partnerStars: 3.5, opponentStars: 3, partnerGames: 6, opponentGames: 6, perfGames: 6, perfVsExpected: 1.4, minGames: 3 });
  });
  it("is null for junk and tolerates missing optional columns", () => {
    for (const bad of [null, undefined, "x", 3, {}, { wins: 1 }]) expect(parseCardStats(bad)).toBeNull();
    expect(parseCardStats({ wins: 0, draws: 0, losses: 1 })).toMatchObject({ partnerStars: null, perfVsExpected: null, minGames: 3, perfGames: 0 });
  });
  it("record is wins, draws, losses", () => {
    expect(recordLabel({ wins: 3, draws: 1, losses: 2 })).toBe("3-1-2");
    expect(gamesInRecord({ wins: 3, draws: 1, losses: 2 })).toBe(6);
  });
  it("an average needs enough games behind it", () => {
    expect(averageStars(3.5, 3, 3)).toBe(3.5);
    expect(averageStars(3.5, 2, 3)).toBeNull();
    expect(averageStars(null, 9, 3)).toBeNull();
  });
  it("performance is above, below or about as expected, and says so without a number when there is too little", () => {
    expect(performance({ perfGames: 6, perfVsExpected: 1.4, minGames: 3 })).toEqual({ label: "Above expected", detail: "+1.4 wins over 6 confirmed games", tone: "above" });
    expect(performance({ perfGames: 6, perfVsExpected: -0.9, minGames: 3 })).toMatchObject({ label: "Below expected", detail: "-0.9 wins over 6 confirmed games", tone: "below" });
    expect(performance({ perfGames: 6, perfVsExpected: 0.2, minGames: 3 })).toMatchObject({ label: "About as expected", tone: "even" });
    expect(performance({ perfGames: 2, perfVsExpected: 1.4, minGames: 3 })).toEqual({ label: "Not enough confirmed games yet", detail: null, tone: "none" });
    expect(performance({ perfGames: 0, perfVsExpected: null, minGames: 3 }).tone).toBe("none");
  });
  it("copy has no em dash", () => {
    for (const p of [performance({ perfGames: 6, perfVsExpected: 1.4, minGames: 3 }), performance({ perfGames: 0, perfVsExpected: null, minGames: 3 })]) expect(`${p.label} ${p.detail ?? ""}`).not.toMatch(/—|–/);
  });
});
