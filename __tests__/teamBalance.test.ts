import { describe, expect, it } from "vitest";

import { autoBalanceTeams, fieldAverage, positionBucket, teamBalanceLine, teamRatingSummary, type BalancePlayer, type PickupTeam } from "../mobile/lib/pickupTeamBalance";

const POS = ["Goalkeeper", "Defender", "Midfielder", "Attacker"] as const;
const p = (id: string, pos: string | null, rating: number | null): BalancePlayer => ({ id, playing_position: pos, rating });

/** 14 players: a few strong, many middling, some weak, in all position groups. */
const mixed = (): BalancePlayer[] => [
  p("p01", "Goalkeeper", 4.1), p("p02", "Goalkeeper", 2.2),
  p("p03", "Defender", 4.4), p("p04", "Defender", 3.8), p("p05", "Defender", 2.9), p("p06", "Defender", 1.8),
  p("p07", "Midfielder", 4.0), p("p08", "Midfielder", 3.3), p("p09", "Midfielder", 2.6), p("p10", "Midfielder", 1.6),
  p("p11", "Attacker", 4.7), p("p12", "Attacker", 3.4), p("p13", "Attacker", 2.4), p("p14", "Attacker", 1.9),
];

const avg = (players: BalancePlayer[], teams: Record<string, PickupTeam>, t: PickupTeam, fill = fieldAverage(players) ?? 0) => {
  const members = players.filter((x) => teams[x.id] === t);
  return members.reduce((s, x) => s + (typeof x.rating === "number" ? x.rating : fill), 0) / members.length;
};
const sizes = (players: BalancePlayer[], teams: Record<string, PickupTeam>) => {
  const n: Record<string, number> = {};
  for (const x of players) n[teams[x.id]] = (n[teams[x.id]] ?? 0) + 1;
  return n;
};

describe("rating-aware auto-balance", () => {
  it("two teams from a mixed pool end within 0.15 average rating", () => {
    const players = mixed();
    const teams = autoBalanceTeams(players, 2);
    expect(Math.abs(avg(players, teams, "A") - avg(players, teams, "B"))).toBeLessThanOrEqual(0.15);
    expect(sizes(players, teams)).toEqual({ A: 7, B: 7 });
  });
  it("three teams are within 0.25 and sizes stay even", () => {
    const players = [...mixed(), p("p15", "Defender", 3.1), p("p16", "Midfielder", 2.1)];
    const teams = autoBalanceTeams(players, 3);
    const a = (["A", "B", "C"] as const).map((t) => avg(players, teams, t));
    expect(Math.max(...a) - Math.min(...a)).toBeLessThanOrEqual(0.25);
    const n = Object.values(sizes(players, teams));
    expect(Math.max(...n) - Math.min(...n)).toBeLessThanOrEqual(1);
  });
  it("keeps the position spread: each position group is split evenly (within one) across the teams", () => {
    const players = mixed();
    const teams = autoBalanceTeams(players, 2);
    for (const pos of POS) {
      const group = players.filter((x) => x.playing_position === pos);
      const inA = group.filter((x) => teams[x.id] === "A").length;
      expect(Math.abs(inA - (group.length - inA)), pos).toBeLessThanOrEqual(1);
    }
  });
  it("unrated players do not skew it: they count as the field average and are spread across the teams", () => {
    const players = [...mixed().slice(0, 10), p("u1", "Defender", null), p("u2", "Midfielder", null), p("u3", "Attacker", null), p("u4", "Midfielder", null)];
    const teams = autoBalanceTeams(players, 2);
    expect(Math.abs(avg(players, teams, "A") - avg(players, teams, "B"))).toBeLessThanOrEqual(0.15);
    const unratedInA = players.filter((x) => x.rating == null && teams[x.id] === "A").length;
    expect(Math.abs(unratedInA - (4 - unratedInA))).toBeLessThanOrEqual(2);
  });
  it("an unrated player counts as the field average, not zero", () => {
    const players = [p("a", "Midfielder", 4), p("b", "Midfielder", 2), p("c", "Midfielder", null), p("d", "Midfielder", null)];
    expect(fieldAverage(players)).toBe(3);
    const teams: Record<string, PickupTeam> = { a: "A", c: "A", b: "B", d: "B" };
    const s = teamRatingSummary(players, teams, 2)!;
    expect(s.averages.A).toBe(3.5);
    expect(s.averages.B).toBe(2.5);
    expect(s.unratedCount).toBe(2);
  });
  it("an odd player count still works: everyone gets a team and sizes differ by at most one", () => {
    for (const drop of [0, 1, 4]) {
      const players = mixed().slice(0, 13 - drop).concat(drop === 4 ? [p("x", "Defender", 3)] : []);
      const teams = autoBalanceTeams(players, 2);
      expect(Object.keys(teams).sort()).toEqual(players.map((x) => x.id).sort());
      const n = Object.values(sizes(players, teams));
      expect(Math.max(...n) - Math.min(...n)).toBeLessThanOrEqual(1);
      const a = avg(players, teams, "A");
      const b = avg(players, teams, "B");
      expect(Math.abs(a - b)).toBeLessThanOrEqual(0.5);
    }
  });
  it("handles 1 player, 0 players and 2 players", () => {
    expect(autoBalanceTeams([], 2)).toEqual({});
    expect(autoBalanceTeams([p("a", "Defender", 3)], 2)).toEqual({ a: "A" });
    const two = autoBalanceTeams([p("a", "Defender", 4), p("b", "Defender", 2)], 2);
    expect(new Set(Object.values(two)).size).toBe(2);
  });
  it("with no ratings at all it behaves exactly as the position-only balance did", () => {
    const players = Array.from({ length: 9 }, (_, i) => p(`q${i}`, POS[i % 4], null));
    const withRatingField = autoBalanceTeams(players, 2);
    const plain = autoBalanceTeams(players.map(({ id, playing_position }) => ({ id, playing_position })), 2);
    expect(withRatingField).toEqual(plain);
    const n = Object.values(sizes(players, withRatingField));
    expect(Math.max(...n) - Math.min(...n)).toBeLessThanOrEqual(1);
  });
  it("is deterministic and never uses anything but id, position and rating", () => {
    const players = mixed();
    const first = autoBalanceTeams(players, 2);
    for (let i = 0; i < 10; i++) expect(autoBalanceTeams([...players].sort(() => Math.random() - 0.5), 2)).toEqual(first);
    const withExtras = players.map((x) => ({ ...x, gender: "female", sex: "female", score: 99 }) as BalancePlayer);
    expect(autoBalanceTeams(withExtras, 2)).toEqual(first);
  });
});

describe("admin balance line", () => {
  it("says how close the teams are, rounded up to 0.1", () => {
    const players = mixed();
    const teams = autoBalanceTeams(players, 2);
    expect(teamBalanceLine(players, teams, 2)).toMatch(/^Teams are within 0\.[1-2] rating$/);
  });
  it("updates after a manual change and notes unrated players", () => {
    const players = [p("a", "Defender", 4.5), p("b", "Defender", 4.4), p("c", "Defender", 1.0), p("d", "Defender", null)];
    const lopsided: Record<string, PickupTeam> = { a: "A", b: "A", c: "B", d: "B" };
    expect(teamBalanceLine(players, lopsided, 2)).toBe("Teams are within 2.3 rating (1 unrated counted as average)");
  });
  it("shows nothing when there is nothing to compare", () => {
    expect(teamBalanceLine([p("a", "Defender", null), p("b", "Defender", null)], { a: "A", b: "B" }, 2)).toBeNull();
    expect(teamBalanceLine([p("a", "Defender", 3)], { a: "A" }, 2)).toBeNull();
  });
  it("has no em dash, tier or wave words", () => {
    const players = mixed();
    const line = teamBalanceLine(players, autoBalanceTeams(players, 2), 2) ?? "";
    expect(line).not.toMatch(/—|\btier\b|\bwave\b|gender|male|female/i);
  });
  it("positionBucket is unchanged", () => {
    expect(positionBucket("Goalkeeper")).toBe("GK");
    expect(positionBucket("Forward")).toBe("A");
    expect(positionBucket(null)).toBe("OTHER");
  });
});
