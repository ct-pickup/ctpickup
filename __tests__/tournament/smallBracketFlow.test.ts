import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeDb, type FakeDb } from "../helpers/fakeSupabase";

const h = vi.hoisted(() => ({ db: null as unknown, expo: [] as unknown[][] }));

vi.mock("@sentry/nextjs", () => ({ captureException: () => undefined }));
vi.mock("@/lib/server/runtimeClients", async () => {
  const { fakeClient } = await import("../helpers/fakeSupabase");
  return {
    getSupabaseAdmin: () => ({ ...fakeClient(h.db as never), auth: { getUser: async () => ({ data: { user: { id: "admin1" } }, error: null }) } }),
  };
});

import { POST } from "../../app/api/admin/tournaments/bracket/route";

/**
 * The smallest test tournament the app supports, as scripts/test-tournament/seed.sql builds it: 4 teams, 2 groups of 2, the captain
 * is the whole team (no roster rows), 2 group matches. The app is driven through its real admin route, the way the phone does it:
 * group scores, Generate Knockout, a semi-final that ends level, the final.
 */
const T = "tour-1";
const TEAMS = ["c1", "c2", "c3", "c4"];

function seeded(): FakeDb {
  return makeDb({
    profiles: [{ id: "admin1", is_admin: true }],
    tournaments: [{ id: T, slug: "test-bracket-demo", title: "TEST Bracket Demo (delete me)", is_active: false, min_roster_players: 1, max_teams: 4 }],
    tournament_captains: TEAMS.map((id, i) => ({ id, tournament_id: T, status: "confirmed", team_name: `Test Team ${i + 1}`, captain_name: `Test Captain ${i + 1}`, user_id: `u${i + 1}`, expected_players: 1 })),
    tournament_roster: [],
    tournament_groups: [
      { id: "gA", tournament_id: T, group_name: "A" },
      { id: "gB", tournament_id: T, group_name: "B" },
    ],
    tournament_group_members: [
      { id: "mem1", group_id: "gA", tournament_id: T, team_id: "c1", wins: 0, draws: 0, losses: 0, goals_for: 0, goals_against: 0, goal_difference: 0, points: 0 },
      { id: "mem2", group_id: "gA", tournament_id: T, team_id: "c2", wins: 0, draws: 0, losses: 0, goals_for: 0, goals_against: 0, goal_difference: 0, points: 0 },
      { id: "mem3", group_id: "gB", tournament_id: T, team_id: "c3", wins: 0, draws: 0, losses: 0, goals_for: 0, goals_against: 0, goal_difference: 0, points: 0 },
      { id: "mem4", group_id: "gB", tournament_id: T, team_id: "c4", wins: 0, draws: 0, losses: 0, goals_for: 0, goals_against: 0, goal_difference: 0, points: 0 },
    ],
    tournament_matches: [
      { id: "g1", tournament_id: T, stage: "group", group_name: "A", match_number: 1, team_a_id: "c1", team_b_id: "c2", score_a: null, score_b: null, winner_id: null, is_bye: false, started_at: null, completed_at: null },
      { id: "g2", tournament_id: T, stage: "group", group_name: "B", match_number: 2, team_a_id: "c3", team_b_id: "c4", score_a: null, score_b: null, winner_id: null, is_bye: false, started_at: null, completed_at: null },
    ],
    tournament_match_goals: [],
    user_push_devices: TEAMS.map((_, i) => ({ user_id: `u${i + 1}`, expo_push_token: `ExponentPushToken[dev-u${i + 1}]`, push_notifications_enabled: true, installation_context: "standalone" })),
  });
}

const call = async (body: Record<string, unknown>) => {
  const res = await POST(new Request("https://site.test/api/admin/tournaments/bracket", { method: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify({ tournament_id: T, ...body }) }));
  // The fake database does not mint ids on insert; give new matches the id the server would.
  for (const r of (h.db as FakeDb).tables.tournament_matches ?? []) if (!r.id) r.id = `${r.stage}-${r.match_number}`;
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};
const matches = () => (h.db as FakeDb).tables.tournament_matches!;
const byStage = (s: string) => matches().filter((m) => m.stage === s).sort((a, b) => Number(a.match_number) - Number(b.match_number));

beforeEach(() => {
  h.db = seeded();
  h.expo = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_u: string, init: { body: string }) => {
      h.expo.push(JSON.parse(init.body));
      return new Response("{}", { status: 200 });
    }),
  );
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("4 teams in 2 groups of 2, captain only", () => {
  it("Generate Groups refuses a 4 team tournament and changes nothing, so tapping it by mistake is harmless", async () => {
    const before = JSON.stringify([matches(), (h.db as FakeDb).tables.tournament_groups, (h.db as FakeDb).tables.tournament_group_members]);
    const r = await call({ action: "generate" });
    expect(r.status).toBe(400);
    expect(String(r.json.error)).toMatch(/Need 8-12 paid teams, got 4/);
    expect(JSON.stringify([matches(), (h.db as FakeDb).tables.tournament_groups, (h.db as FakeDb).tables.tournament_group_members])).toBe(before);
    expect(h.expo).toEqual([]);
  });

  it("plays the whole thing: group stage, Generate Knockout, a semi-final level on penalties, the final", async () => {
    // Group stage. A group match may end level.
    expect((await call({ action: "log_score", match_id: "g1", score_a: 2, score_b: 0 })).status).toBe(200);
    expect((await call({ action: "log_score", match_id: "g2", score_a: 1, score_b: 1 })).status).toBe(200);
    const mem = (team: string) => (h.db as FakeDb).tables.tournament_group_members!.find((r) => r.team_id === team)!;
    expect(mem("c1")).toMatchObject({ wins: 1, points: 3, goal_difference: 2 });
    expect(mem("c2")).toMatchObject({ losses: 1, points: 0 });
    expect(mem("c3")).toMatchObject({ draws: 1, points: 1 });
    expect(mem("c4")).toMatchObject({ draws: 1, points: 1 });

    // Generate Knockout works with 2 groups of 2: both teams of each group go through, as 2 semi-finals.
    const ko = await call({ action: "generate_knockout" });
    expect(ko.status).toBe(200);
    const semis = byStage("sf");
    expect(semis).toHaveLength(2);
    expect(semis.map((m) => [m.team_a_id, m.team_b_id])).toEqual([
      ["c1", "c4"],
      ["c3", "c2"],
    ]);
    expect(byStage("final")).toHaveLength(0);

    // A knockout match cannot end level without a penalty winner.
    const level = await call({ action: "log_score", match_id: semis[0]!.id, score_a: 1, score_b: 1 });
    expect(level.status).toBe(400);
    expect(level.json.code).toBe("penalty_winner_required");

    // With one, the winner goes through and the match reads "won on penalties".
    const pens = await call({ action: "log_score", match_id: semis[0]!.id, score_a: 1, score_b: 1, winner_id: "c4" });
    expect(pens.status).toBe(200);
    expect(pens.json).toMatchObject({ winner_id: "c4", won_on_penalties: true });
    expect(byStage("final")).toHaveLength(0);

    // The second semi-final fills the final.
    expect((await call({ action: "log_score", match_id: semis[1]!.id, score_a: 3, score_b: 1 })).status).toBe(200);
    const final = byStage("final");
    expect(final).toHaveLength(1);
    expect([final[0]!.team_a_id, final[0]!.team_b_id]).toEqual(["c4", "c3"]);

    // The final.
    const done = await call({ action: "log_score", match_id: final[0]!.id, score_a: 0, score_b: 2 });
    expect(done.status).toBe(200);
    expect(done.json.winner_id).toBe("c3");
    expect(matches().filter((m) => m.completed_at)).toHaveLength(5);
  });

  it("the test tournament sends no push for any of it", async () => {
    await call({ action: "log_score", match_id: "g1", score_a: 2, score_b: 0 });
    await call({ action: "log_score", match_id: "g2", score_a: 0, score_b: 1 });
    await call({ action: "generate_knockout" });
    expect(h.expo).toEqual([]);
  });
});
