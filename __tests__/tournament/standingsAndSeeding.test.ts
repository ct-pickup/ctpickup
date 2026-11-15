import { describe, expect, it } from "vitest";
import { compareStandings, computeGroupStandings, type StandingsMatch } from "../../lib/tournament/standingsMath";
import { fieldAverage, ratedValue, seedTeams } from "../../lib/tournament/seeding";

const members = ["T1", "T2", "T3"].map((t, i) => ({ id: `m${i}`, team_id: t, group_id: "G" }));
const g = (a: string, b: string, sa: number | null, sb: number | null, done = true): StandingsMatch => ({
  stage: "group",
  team_a_id: a,
  team_b_id: b,
  score_a: sa,
  score_b: sb,
  completed_at: done ? "2026-11-14T12:00:00Z" : null,
});
const byTeam = (rows: ReturnType<typeof computeGroupStandings>) => Object.fromEntries(rows.map((r) => [r.team_id, r]));

describe("group standings", () => {
  it("win 3, draw 1, loss 0, with goals for, against and difference", () => {
    const rows = byTeam(computeGroupStandings(members, [g("T1", "T2", 2, 1), g("T2", "T3", 0, 0), g("T1", "T3", 1, 3)]));
    expect(rows.T1).toMatchObject({ wins: 1, losses: 1, draws: 0, goals_for: 3, goals_against: 4, goal_difference: -1, points: 3 });
    expect(rows.T2).toMatchObject({ wins: 0, losses: 1, draws: 1, goals_for: 1, goals_against: 2, goal_difference: -1, points: 1 });
    expect(rows.T3).toMatchObject({ wins: 1, losses: 0, draws: 1, goals_for: 3, goals_against: 1, goal_difference: 2, points: 4 });
  });

  it("editing a score recomputes from scratch, so a win turned into a draw does not double count", () => {
    const before = byTeam(computeGroupStandings(members, [g("T1", "T2", 2, 1)]));
    expect(before.T1).toMatchObject({ wins: 1, draws: 0, points: 3 });
    expect(before.T2).toMatchObject({ losses: 1, points: 0 });

    const edited = byTeam(computeGroupStandings(members, [g("T1", "T2", 1, 1)]));
    expect(edited.T1).toMatchObject({ wins: 0, draws: 1, losses: 0, goals_for: 1, goals_against: 1, points: 1 });
    expect(edited.T2).toMatchObject({ wins: 0, draws: 1, losses: 0, points: 1 });

    const flipped = byTeam(computeGroupStandings(members, [g("T1", "T2", 0, 4)]));
    expect(flipped.T1).toMatchObject({ losses: 1, points: 0, goal_difference: -4 });
    expect(flipped.T2).toMatchObject({ wins: 1, points: 3, goal_difference: 4 });
  });

  it("ignores matches that are not finished, not group matches, or missing a team or a score", () => {
    const rows = computeGroupStandings(members, [
      g("T1", "T2", 2, 1, false),
      { ...g("T1", "T2", 2, 1), stage: "sf" },
      { ...g("T1", "T2", 2, 1), team_b_id: null },
      g("T1", "T2", null, 1),
    ]);
    expect(rows.every((r) => r.points === 0 && r.goals_for === 0)).toBe(true);
  });

  it("orders by points, then goal difference, then goals for", () => {
    const rows = computeGroupStandings(members, [g("T1", "T2", 3, 0), g("T2", "T3", 1, 0), g("T1", "T3", 0, 2)]);
    // All three finish on 3 points. Goal difference: T1 +1, T3 +1, T2 -2. Goals for breaks the tie: T1 scored 3, T3 scored 2.
    expect([...rows].sort(compareStandings).map((r) => r.team_id)).toEqual(["T1", "T3", "T2"]);
  });
});

describe("seeding from exact ratings", () => {
  const ratings = new Map([
    ["u1", { exact: 4.0, ratedGames: 12 }],
    ["u2", { exact: 3.0, ratedGames: 8 }],
    ["u3", { exact: 2.0, ratedGames: 6 }],
    // u4 has no card at all. u5 has a card but no rated game yet, so its number is a placeholder.
    ["u5", { exact: 2.5, ratedGames: 0 }],
  ]);

  it("unrated players count as the field average", () => {
    const teams = [
      { id: "A", team_name: "Alphas", user_ids: ["u1", "u2"] },
      { id: "B", team_name: "Bravos", user_ids: ["u3", "u4"] },
    ];
    // Field average of the rated players: (4 + 3 + 2) / 3 = 3. Team B is (2 + 3) / 2.
    expect(fieldAverage(teams, ratings)).toBeCloseTo(3, 10);
    expect(seedTeams(teams, ratings)).toEqual([
      { id: "A", seed: 1, team_avg: 3.5 },
      { id: "B", seed: 2, team_avg: 2.5 },
    ]);
  });

  it("a card with no rated games is treated as unrated, not as its placeholder number", () => {
    expect(ratedValue({ exact: 2.5, ratedGames: 0 })).toBeNull();
    expect(ratedValue({ exact: 2.5, ratedGames: null })).toBe(2.5);
    const teams = [
      { id: "A", team_name: "Alphas", user_ids: ["u1", "u5"] },
      { id: "B", team_name: "Bravos", user_ids: ["u3"] },
    ];
    // Field average = (4 + 2) / 2 = 3, so u5 counts as 3 and team A is (4 + 3) / 2.
    expect(seedTeams(teams, ratings).find((t) => t.id === "A")?.team_avg).toBe(3.5);
  });

  it("when nobody is rated there are no seeds and no averages", () => {
    const teams = [
      { id: "A", team_name: "Alphas", user_ids: ["u4"] },
      { id: "B", team_name: "Bravos", user_ids: ["u5"] },
    ];
    expect(seedTeams(teams, ratings)).toEqual([
      { id: "A", seed: null, team_avg: null },
      { id: "B", seed: null, team_avg: null },
    ]);
  });

  it("a team with no known players is left unseeded and does not shift the others", () => {
    const teams = [
      { id: "A", team_name: "Alphas", user_ids: ["u1"] },
      { id: "E", team_name: "Empty", user_ids: [] },
      { id: "B", team_name: "Bravos", user_ids: ["u3"] },
    ];
    const seeded = Object.fromEntries(seedTeams(teams, ratings).map((t) => [t.id, t]));
    expect(seeded.A).toMatchObject({ seed: 1, team_avg: 4 });
    expect(seeded.B).toMatchObject({ seed: 2, team_avg: 2 });
    expect(seeded.E).toEqual({ id: "E", seed: null, team_avg: null });
  });

  it("equal averages are ordered by team name so the seeds are stable", () => {
    const teams = [
      { id: "Z", team_name: "Zebras", user_ids: ["u2"] },
      { id: "A", team_name: "Aces", user_ids: ["u2"] },
    ];
    expect(seedTeams(teams, ratings).map((t) => [t.id, t.seed])).toEqual([
      ["Z", 2],
      ["A", 1],
    ]);
  });
});
