import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  avgText,
  hasLiveMatch,
  knockoutRounds,
  parseBracketPayload,
  penaltyText,
  scheduledText,
  scoreText,
  seedAndAvgText,
  seedText,
  SEED_HELP,
  winnerSide,
  type BracketMatch,
  type BracketTeam,
} from "../../mobile/lib/tournamentBracketCore";

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

const team = (id: string, o: Partial<BracketTeam> = {}): BracketTeam => ({ id, team_name: id, seed: null, team_avg: null, roster: [], ...o });
const teams = Object.fromEntries([team("A", { team_name: "Alphas", seed: 1, team_avg: 3.5 }), team("B", { team_name: "Bravos", seed: 2, team_avg: 2.5 })].map((t) => [t.id, t]));

const match = (o: Partial<BracketMatch> & { id: string }): BracketMatch => ({
  stage: "sf",
  group_name: null,
  match_number: 1000,
  team_a_id: "A",
  team_b_id: "B",
  score_a: null,
  score_b: null,
  winner_id: null,
  is_bye: false,
  scheduled_at: null,
  started_at: null,
  completed_at: null,
  status: "scheduled",
  won_on_penalties: false,
  ...o,
});

describe("parsing the player bracket payload", () => {
  const payload = {
    teams: [{ id: "A", team_name: "Alphas", seed: 1, team_avg: 3.5, roster: ["Sam R.", "", 7, "Lee K."] }],
    matches: [
      { id: "m1", stage: "sf", match_number: 1000, team_a_id: "A", team_b_id: "B", score_a: 1, score_b: 1, winner_id: "B", completed_at: "t", started_at: "t" },
    ],
    standings: [{ id: "s1", team_id: "A", group_id: "g", wins: "2", points: 6 }],
    upcoming: [{ id: "slot:final:0", stage: "final", slot: 0, team_a_id: "B", team_b_id: null, label_a: null, label_b: "Winner of Semi-final 2", is_bye: false }],
    top_scorers: [{ scorer_name: "Sam R.", goals: 3, rank: 1 }],
  };

  it("reads teams, seeds, matches, standings, placeholders and scorers", () => {
    const p = parseBracketPayload(payload)!;
    expect(p.teams[0]).toEqual({ id: "A", team_name: "Alphas", seed: 1, team_avg: 3.5, roster: ["Sam R.", "Lee K."] });
    expect(p.standings[0]).toMatchObject({ wins: 2, points: 6, losses: 0 });
    expect(p.upcoming[0]).toMatchObject({ stage: "final", team_a_id: "B", label_b: "Winner of Semi-final 2" });
    expect(p.top_scorers).toEqual([{ scorer_name: "Sam R.", goals: 3, rank: 1 }]);
  });

  it("fills in status and penalties for a server that did not send them", () => {
    const m = parseBracketPayload(payload)!.matches[0]!;
    expect(m).toMatchObject({ status: "final", won_on_penalties: true });
  });

  it("returns only the allow-listed fields, whatever else arrives", () => {
    const p = parseBracketPayload({
      ...payload,
      teams: [{ id: "A", team_name: "Alphas", captain_instagram: "x", captain_name: "y", ip: "1.2.3.4" }],
      matches: [{ id: "m1", stage: "group", payment_status: "paid", flagged_reason: "z" }],
    })!;
    const text = JSON.stringify(p);
    for (const k of ["captain_instagram", "captain_name", "ip", "payment_status", "flagged_reason"]) expect(text).not.toContain(k);
  });

  it("rejects a payload that is not a bracket", () => {
    expect(parseBracketPayload(null)).toBeNull();
    expect(parseBracketPayload({ teams: [] })).toBeNull();
    expect(parseBracketPayload({ teams: [], matches: [], standings: [] })).toMatchObject({ upcoming: [], top_scorers: [] });
  });
});

describe("what a match card says", () => {
  it("seed and team average sit side by side", () => {
    expect(seedText(teams.A)).toBe("Seed 1");
    expect(avgText(teams.A)).toBe("avg 3.50");
    expect(seedAndAvgText(teams.A)).toBe("Seed 1 · avg 3.50");
    expect(seedAndAvgText(team("Z"))).toBeNull();
    expect(seedAndAvgText(team("Y", { seed: 3 }))).toBe("Seed 3");
  });

  it("explains how seeds are worked out in plain words", () => {
    expect(SEED_HELP).toMatch(/average rating/);
    expect(SEED_HELP).toMatch(/no rating yet counts as the field average/);
  });

  it("score reads vs until there is one, then the score, BYE for a bye", () => {
    expect(scoreText(match({ id: "x" }))).toBe("vs");
    expect(scoreText(match({ id: "x", score_a: 2, score_b: 1 }))).toBe("2 - 1");
    expect(scoreText(match({ id: "x", is_bye: true, team_b_id: null }))).toBe("BYE");
  });

  it("highlights the stored winner once the match is final, and nobody before", () => {
    expect(winnerSide(match({ id: "x", status: "final", winner_id: "B" }))).toBe("b");
    expect(winnerSide(match({ id: "x", status: "final", winner_id: "A" }))).toBe("a");
    expect(winnerSide(match({ id: "x", status: "in_progress", winner_id: "A" }))).toBeNull();
    expect(winnerSide(match({ id: "x", status: "final", winner_id: null, stage: "group" }))).toBeNull();
  });

  it("says who won on penalties", () => {
    const m = match({ id: "x", status: "final", score_a: 2, score_b: 2, winner_id: "B", won_on_penalties: true });
    expect(penaltyText(m, teams)).toBe("Bravos won on penalties");
    expect(penaltyText(match({ id: "y", status: "final", score_a: 2, score_b: 1, winner_id: "A" }), teams)).toBeNull();
  });

  it("knows when a match is being played", () => {
    expect(hasLiveMatch([{ status: "final" }, { status: "in_progress" }])).toBe(true);
    expect(hasLiveMatch([{ status: "scheduled" }])).toBe(false);
  });

  it("formats a scheduled kickoff in Eastern time, or says nothing", () => {
    expect(scheduledText("2026-11-14T19:30:00Z")).toBe("Sat 2:30 PM ET");
    expect(scheduledText(null)).toBeNull();
    expect(scheduledText("not a date")).toBeNull();
  });
});

describe("the knockout rounds with the next round filling in", () => {
  it("lists real matches and the placeholders for later rounds in order", () => {
    const rounds = knockoutRounds(
      [match({ id: "sf1", match_number: 1000 }), match({ id: "sf2", match_number: 1001, team_a_id: "C", team_b_id: "D" })],
      [{ id: "slot:final:0", stage: "final", slot: 0, team_a_id: null, team_b_id: null, label_a: "Winner of Semi-final 1", label_b: "Winner of Semi-final 2", is_bye: false }],
    );
    expect(rounds.map((r) => [r.title, r.items.map((i) => i.kind)])).toEqual([
      ["Semi-finals", ["match", "match"]],
      ["Final", ["slot"]],
    ]);
  });

  it("when the final exists it replaces its placeholder", () => {
    const rounds = knockoutRounds([match({ id: "sf1" }), match({ id: "f", stage: "final", match_number: 3000 })], []);
    expect(rounds.map((r) => r.stage)).toEqual(["sf", "final"]);
    expect(rounds[1]!.items).toHaveLength(1);
  });

  it("no knockout rows and no placeholders means no knockout section", () => {
    expect(knockoutRounds([match({ id: "g", stage: "group" })], [])).toEqual([]);
  });
});

describe("the live bracket screen", () => {
  const screen = src("mobile/app/tournament-bracket-view.tsx");

  it("refreshes every 10 seconds, only while the screen is focused and the app is in the foreground", () => {
    expect(screen).toMatch(/const POLL_MS = 10_000/);
    expect(screen).toMatch(/setInterval\(\(\) => void load\(\), POLL_MS\)/);
    expect(screen).toMatch(/useFocusEffect/);
    expect(screen).toMatch(/AppState\.addEventListener\("change"/);
    expect(screen).toMatch(/const active = focused && appActive/);
    expect(screen).toMatch(/if \(!active \|\| !token \|\| !tournamentId\) return;/);
    // The interval and the realtime channel are both torn down when the screen stops being active.
    expect(screen).toMatch(/clearInterval\(timer\)/);
    expect(screen).toMatch(/removeChannel\(channel\)/);
  });

  it("keeps the realtime subscription the screen already had, now tied to focus", () => {
    expect(screen).toMatch(/table: "tournament_matches"/);
    expect(screen).toMatch(/table: "tournament_group_members"/);
    expect(screen).toMatch(/table: "tournament_match_goals"/);
  });

  it("has a Live indicator and pull to refresh", () => {
    expect(screen).toMatch(/<LiveTag pulsing=\{anyLive\} \/>/);
    const tag = src("mobile/components/tournament/LiveTag.tsx");
    expect(tag).toMatch(/<Text style=\{styles\.text\}>Live<\/Text>/);
    expect(screen).toMatch(/<RefreshControl/);
  });

  it("uses the shared motion config, the selection pill and Reduce Motion", () => {
    expect(screen).toMatch(/from "@\/lib\/motion"/);
    expect(screen).toMatch(/MOTION\.duration\./);
    expect(screen).not.toMatch(/duration: \d{3,}/);
    expect(screen).toMatch(/useSelectionPill<TabId>\(tab\)/);
    expect(screen).toMatch(/<SelectionPill/);
    expect(screen).toMatch(/useReduceMotion/);
    expect(src("mobile/components/tournament/LiveTag.tsx")).toMatch(/pulsing && !reduceMotion/);
  });

  it("never reads a contact or private field", () => {
    for (const f of ["mobile/app/tournament-bracket-view.tsx", "mobile/lib/tournamentBracketCore.ts"]) {
      expect(src(f), f).not.toMatch(/captain_instagram|captain_name|user_agent|flagged_reason|stripe|payment_status|\.email\b/);
    }
  });

  it("new copy has no em dash and no tier or wave wording", () => {
    for (const f of ["mobile/app/tournament-bracket-view.tsx", "mobile/lib/tournamentBracketCore.ts", "lib/tournament/bracketLogic.ts", "lib/tournament/logScore.ts", "lib/tournament/publicBracket.ts"]) {
      expect(src(f), f).not.toMatch(/—/);
      expect(src(f), f).not.toMatch(/\btier\b|\bwave\b/i);
    }
  });
});

describe("the admin screen", () => {
  const admin = src("mobile/app/(tabs)/admin/tournament-bracket.tsx");
  it("asks for the penalty winner on a level knockout score and sends it as winner_id", () => {
    expect(admin).toMatch(/needsPenaltyWinner/);
    expect(admin).toMatch(/Pick the team that won on penalties/);
    expect(admin).toMatch(/winner_id: penaltyWinner/);
  });
  it("asks before clearing later matches, then resends with the confirmation", () => {
    expect(admin).toMatch(/detail\?\.code === "confirm_reset"/);
    expect(admin).toMatch(/confirmReset/);
  });
  it("shows won on penalties and can start a match", () => {
    expect(admin).toMatch(/won on penalties/);
    expect(admin).toMatch(/postBracket\("start_match"/);
  });
});
