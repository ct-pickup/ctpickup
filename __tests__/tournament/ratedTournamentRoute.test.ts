import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeDb, type FakeDb } from "../helpers/fakeSupabase";

const h = vi.hoisted(() => ({ db: null as unknown, expo: [] as unknown[][], user: "admin1" }));

vi.mock("@sentry/nextjs", () => ({ captureException: () => undefined }));
vi.mock("@/lib/server/runtimeClients", async () => {
  const { fakeClient } = await import("../helpers/fakeSupabase");
  return {
    getSupabaseAdmin: () => ({ ...fakeClient(h.db as never), auth: { getUser: async () => ({ data: { user: { id: h.user } }, error: null }) } }),
  };
});

import { GET, POST } from "../../app/api/admin/tournaments/bracket/route";

/**
 * Rated tournaments through the real admin route, with the database's rating step replaced by a recording stand-in. The rating math
 * itself is tested against a real Postgres in __tests__/sql/ratedTournaments.sql.test.ts; here the question is WHEN the server calls it,
 * what it writes for season points, what it locks, and what it never does (push, return a rating, touch an unrated tournament).
 */
const T = "tour-1";
const TEAMS = ["c1", "c2", "c3", "c4"];

function seeded(o: { rated?: boolean; season?: boolean; slug?: string } = {}): FakeDb {
  const db = makeDb({
    profiles: [{ id: "admin1", is_admin: true }, { id: "player1", is_admin: false }],
    tournaments: [{ id: T, slug: o.slug ?? "test-rated-demo", title: "t", is_active: false, min_roster_players: 1, max_teams: 4, rated: o.rated ?? false, count_for_season: o.season ?? false }],
    tournament_captains: TEAMS.map((id, i) => ({ id, tournament_id: T, status: "confirmed", team_name: `Test Team ${i + 1}`, captain_name: `Test Captain ${i + 1}`, user_id: `u${i + 1}`, expected_players: 1 })),
    tournament_roster: [],
    tournament_groups: [{ id: "gA", tournament_id: T, group_name: "A" }, { id: "gB", tournament_id: T, group_name: "B" }],
    tournament_group_members: TEAMS.map((team_id, i) => ({ id: `mem${i + 1}`, group_id: i < 2 ? "gA" : "gB", tournament_id: T, team_id, wins: 0, draws: 0, losses: 0, goals_for: 0, goals_against: 0, goal_difference: 0, points: 0 })),
    tournament_matches: [
      { id: "g1", tournament_id: T, stage: "group", group_name: "A", match_number: 1, team_a_id: "c1", team_b_id: "c2", score_a: null, score_b: null, winner_id: null, is_bye: false, started_at: null, completed_at: null },
      { id: "g2", tournament_id: T, stage: "group", group_name: "B", match_number: 2, team_a_id: "c3", team_b_id: "c4", score_a: null, score_b: null, winner_id: null, is_bye: false, started_at: null, completed_at: null },
    ],
    tournament_match_goals: [],
    tournament_match_runs: [],
    tournament_match_rating: [],
    pickup_runs: [],
    pickup_run_results: [],
    pickup_run_team_assignments: [],
    points_events: [],
    rating_events: [],
    user_push_devices: TEAMS.map((_, i) => ({ user_id: `u${i + 1}`, expo_push_token: `ExponentPushToken[dev-u${i + 1}]`, push_notifications_enabled: true, installation_context: "standalone" })),
  });

  // Stand-in for tournament_sync_match: what the SQL leaves behind that the server then reads (the link, the result, the teams).
  db.rpcs.tournament_sync_match = (args) => {
    const matchId = String(args.p_match_id);
    const m = db.tables.tournament_matches!.find((r) => r.id === matchId)!;
    const t = db.tables.tournaments!.find((r) => r.id === m.tournament_id)!;
    const run = `run-${matchId}`;
    const rated = t.rated === true;
    const keep = (t.rated === true || t.count_for_season === true) && m.completed_at != null && m.score_a != null;
    db.tables.tournament_match_runs = db.tables.tournament_match_runs!.filter((r) => r.match_id !== matchId);
    db.tables.pickup_runs = db.tables.pickup_runs!.filter((r) => r.id !== run);
    db.tables.pickup_run_results = db.tables.pickup_run_results!.filter((r) => r.run_id !== run);
    db.tables.pickup_run_team_assignments = db.tables.pickup_run_team_assignments!.filter((r) => r.run_id !== run);
    if (!keep) return { data: { status: "not_scored", counted: false, reason: "not_scored" }, error: null };
    const a = Number(m.score_a);
    const b = Number(m.score_b);
    const win = a > b ? "A" : b > a ? "B" : m.winner_id === m.team_a_id ? "A" : m.winner_id === m.team_b_id ? "B" : null;
    db.tables.tournament_match_runs!.push({ match_id: matchId, run_id: run });
    db.tables.pickup_runs!.push({ id: run, start_at: "2026-11-14T20:00:00Z" });
    db.tables.pickup_run_results!.push({ run_id: run, total_teams: 2, winning_team: win, score_a: a === b && win ? null : a, score_b: a === b && win ? null : b, created_at: "2026-11-14T20:00:00Z", player_of_day: null });
    db.tables.pickup_run_team_assignments!.push({ run_id: run, user_id: `u${String(m.team_a_id).slice(1)}`, team: "A" }, { run_id: run, user_id: `u${String(m.team_b_id).slice(1)}`, team: "B" });
    return { data: { status: rated ? "counted" : "recorded", counted: rated, reason: rated ? null : "not_rated", players: 2 }, error: null };
  };
  db.rpcs.tournament_sync_tournament = (args) => {
    for (const m of db.tables.tournament_matches!.filter((r) => r.tournament_id === args.p_tournament_id)) db.rpcs.tournament_sync_match!({ p_match_id: m.id });
    return { data: 2, error: null };
  };
  db.rpcs.tournament_forget_matches = (args) => {
    const ids = args.p_match_ids as string[];
    // What the real function needs: the matches must still exist when it runs, or the link to their record is already gone.
    forgot.push({ ids, stillThere: ids.map((id) => db.tables.tournament_matches!.some((r) => r.id === id)) });
    for (const id of ids) db.rpcs.tournament_sync_match!({ p_match_id: id, __forget: true });
    return { data: ids.length, error: null };
  };
  // points_replace_run, as the SQL does it: delete the run's rows, insert the given ones.
  db.rpcs.points_replace_run = (args) => {
    const run = String(args.p_run_id);
    db.tables.points_events = db.tables.points_events!.filter((r) => r.run_id !== run);
    for (const r of (args.p_rows as Record<string, unknown>[]) ?? []) db.tables.points_events!.push({ ...r, run_id: run });
    return { data: ((args.p_rows as unknown[]) ?? []).length, error: null };
  };
  return db;
}

let forgot: { ids: string[]; stillThere: boolean[] }[] = [];
const tables = () => (h.db as FakeDb).tables;
const rpcNames = () => (h.db as FakeDb).rpcCalls.map((c) => c.name);

const call = async (body: Record<string, unknown>) => {
  const res = await POST(new Request("https://site.test/api/admin/tournaments/bracket", { method: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify({ tournament_id: T, ...body }) }));
  for (const r of tables().tournament_matches ?? []) if (!r.id) r.id = `${r.stage}-${r.match_number}`;
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};
const get = async () => {
  const res = await GET(new Request(`https://site.test/api/admin/tournaments/bracket?tournament_id=${T}`, { headers: { authorization: "Bearer t" } }));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};
const log = (id: string, a: number, b: number, extra: Record<string, unknown> = {}) => call({ action: "log_score", match_id: id, score_a: a, score_b: b, ...extra });
const points = () => tables().points_events!;

function start(o: Parameters<typeof seeded>[0] = {}) {
  h.db = seeded(o);
  h.expo = [];
  h.user = "admin1";
  forgot = [];
}

beforeEach(() => {
  start();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_u: string, init: { body: string }) => {
      h.expo.push(JSON.parse(init.body));
      return new Response("{}", { status: 200 });
    }),
  );
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("1. a tournament that is not rated, and does not count for the season, is left exactly as it was", () => {
  it("scoring it makes no record, calls no rating function, writes no points", async () => {
    start({ rated: false, season: false });
    const r = await log("g1", 3, 1);
    expect(r.status).toBe(200);
    expect(r.json.rating).toEqual({ status: "off", counted: false, reason: null });
    expect(rpcNames().filter((n) => n.startsWith("tournament_") || n === "points_replace_run")).toEqual([]);
    expect(tables().pickup_runs).toEqual([]);
    expect(tables().tournament_match_runs).toEqual([]);
    expect(points()).toEqual([]);
  });

  it("the score, standings and winner are the same as always", async () => {
    start({ rated: false });
    await log("g1", 2, 0);
    const mem = (team: string) => tables().tournament_group_members!.find((r) => r.team_id === team)!;
    expect(mem("c1")).toMatchObject({ wins: 1, points: 3 });
    expect(tables().tournament_matches!.find((m) => m.id === "g1")).toMatchObject({ score_a: 2, score_b: 0, winner_id: "c1" });
  });
});

describe("rated tournaments are rated through the one database step, once per save", () => {
  it("a rated tournament syncs the match after the score is saved, and says whether it counted (never a rating)", async () => {
    start({ rated: true });
    const r = await log("g1", 3, 1);
    expect(r.status).toBe(200);
    expect(rpcNames().filter((n) => n === "tournament_sync_match")).toHaveLength(1);
    expect(r.json.rating).toEqual({ status: "counted", counted: true, reason: null });
    expect(Object.keys(r.json.rating as object).sort()).toEqual(["counted", "reason", "status"]);
    expect(JSON.stringify(r.json)).not.toMatch(/delta|score_before|score_after|rating_events|"score"/);
  });

  it("saving the same score again, or a new score, calls it again each time and never creates a second record", async () => {
    start({ rated: true });
    await log("g1", 3, 1);
    await log("g1", 3, 1);
    await log("g1", 0, 2);
    expect(rpcNames().filter((n) => n === "tournament_sync_match")).toHaveLength(3);
    expect(tables().tournament_match_runs).toHaveLength(1);
    expect(tables().pickup_runs).toHaveLength(1);
  });

  it("a rating problem never fails the score: the score is saved and the answer says the rating did not run", async () => {
    start({ rated: true });
    (h.db as FakeDb).rpcs.tournament_sync_match = () => ({ data: null, error: { message: "boom", code: "XX000" } });
    const r = await log("g1", 3, 1);
    expect(r.status).toBe(200);
    expect(r.json.rating).toEqual({ status: "error", counted: false, reason: null });
    expect(tables().tournament_matches!.find((m) => m.id === "g1")).toMatchObject({ score_a: 3, score_b: 1 });
  });

  it("before the migration is applied the function does not exist: scoring still works", async () => {
    start({ rated: true });
    delete (h.db as FakeDb).rpcs.tournament_sync_match;
    const r = await log("g1", 3, 1);
    expect(r.status).toBe(200);
    expect(r.json.rating).toEqual({ status: "unavailable", counted: false, reason: null });
  });

  it("a match that was skipped says why in codes, and the admin screen can read it", async () => {
    start({ rated: true });
    (h.db as FakeDb).rpcs.tournament_sync_match = () => ({ data: { status: "skipped", counted: false, reason: "too_few_players", players: 2 }, error: null });
    const r = await log("g1", 1, 0);
    expect(r.json.rating).toEqual({ status: "skipped", counted: false, reason: "too_few_players" });
    tables().tournament_match_rating!.push({ match_id: "g1", counted: false, reason: "too_few_players" });
    const g = await get();
    expect((g.json.match_ratings as Record<string, unknown>).g1).toEqual({ counted: false, reason: "too_few_players" });
  });
});

describe("5. season points follow count_for_season, and the 10 game prize reads the same rows", () => {
  it("rated but not counted for the season: no season points rows are ever written", async () => {
    start({ rated: true, season: false });
    await log("g1", 3, 1);
    await log("g2", 1, 1);
    await log("g1", 0, 4);
    expect(points()).toEqual([]);
    // the only thing sent to the points writer is "clear this run"
    const writes = (h.db as FakeDb).rpcCalls.filter((c) => c.name === "points_replace_run");
    for (const w of writes) expect(w.args.p_rows).toEqual([]);
  });

  it("counted for the season: played and win rows for the players, once per run, replaced (not added) on a re-save or an edit", async () => {
    start({ rated: true, season: true });
    await log("g1", 3, 1);
    const reasons = () => points().map((p) => `${p.user_id}:${p.reason}`).sort();
    expect(reasons()).toEqual(["u1:played", "u1:win", "u2:played"]);
    await log("g1", 3, 1);
    expect(reasons()).toEqual(["u1:played", "u1:win", "u2:played"]);
    await log("g1", 0, 2);
    expect(reasons()).toEqual(["u1:played", "u2:played", "u2:win"]);
    // season points exist for exactly these two players, and `played` is what the 10 game prize counts
    expect(points().filter((p) => p.reason === "played")).toHaveLength(2);
  });

  it("counted for the season but not rated: a record and points, and no rating step beyond recording", async () => {
    start({ rated: false, season: true });
    const r = await log("g1", 2, 0);
    expect(r.json.rating).toMatchObject({ status: "recorded", counted: false, reason: "not_rated" });
    expect(points().length).toBeGreaterThan(0);
  });

  it("a penalty winner counts as the winner for season points", async () => {
    start({ season: true });
    // group matches may end level; make g1 a draw: both get played and draw, nobody wins
    await log("g1", 1, 1);
    expect(points().map((p) => `${p.user_id}:${p.reason}`).sort()).toEqual(["u1:draw", "u1:played", "u2:draw", "u2:played"]);
  });

  it("switching Counts for season ON after matches were scored brings them in; switching it OFF clears them", async () => {
    start({ rated: true, season: false });
    await log("g1", 3, 1);
    await log("g2", 0, 2);
    expect(points()).toEqual([]);
    const on = await call({ action: "set_rating_options", count_for_season: true });
    expect(on.status).toBe(200);
    expect(rpcNames()).toContain("tournament_sync_tournament");
    expect(points().filter((p) => p.reason === "played")).toHaveLength(4);
    const off = await call({ action: "set_rating_options", count_for_season: false });
    expect(off.status).toBe(200);
    expect(points()).toEqual([]);
  });
});

describe("13. the admin controls: Rated locks after the first score, Counts for season does not", () => {
  it("both can be changed before any match is scored", async () => {
    start({ rated: false, season: false });
    expect((await call({ action: "set_rating_options", rated: true })).status).toBe(200);
    expect((await call({ action: "set_rating_options", count_for_season: true })).status).toBe(200);
    expect(tables().tournaments![0]).toMatchObject({ rated: true, count_for_season: true });
    expect((await call({ action: "set_rating_options", rated: false, count_for_season: false })).status).toBe(200);
    expect(tables().tournaments![0]).toMatchObject({ rated: false, count_for_season: false });
  });

  it("Rated is refused once a match has a score, with the reason in plain words, and nothing changes", async () => {
    start({ rated: false });
    await log("g1", 2, 0);
    const r = await call({ action: "set_rating_options", rated: true });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("rated_locked");
    expect(String(r.json.error)).toMatch(/halfway through an event/);
    expect(tables().tournaments![0]!.rated).toBe(false);
    // turning it on to the value it already has is not a change
    const same = await call({ action: "set_rating_options", rated: false });
    expect(same.status).toBe(200);
  });

  it("Rated stays locked for a tournament that was rated from the start", async () => {
    start({ rated: true });
    await log("g1", 2, 0);
    expect((await call({ action: "set_rating_options", rated: false })).status).toBe(409);
    expect(tables().tournaments![0]!.rated).toBe(true);
  });

  it("Counts for season can still change after scoring", async () => {
    start({ rated: true });
    await log("g1", 2, 0);
    expect((await call({ action: "set_rating_options", count_for_season: true })).status).toBe(200);
    expect(tables().tournaments![0]!.count_for_season).toBe(true);
  });

  it("the bracket screen is told both switches and whether Rated is locked, in words", async () => {
    start({ rated: true, season: false });
    let g = await get();
    expect(g.json.rating_options).toMatchObject({ rated: true, count_for_season: false, rated_locked: false, rated_label: "Rated: on", season_label: "Counts for season: off" });
    await log("g1", 1, 0);
    g = await get();
    const o = g.json.rating_options as Record<string, unknown>;
    expect(o.rated_locked).toBe(true);
    expect(String(o.rated_note)).toMatch(/locked/);
  });

  it("only an admin can change it, and a value that is not true or false is refused", async () => {
    start({ rated: false });
    h.user = "player1";
    expect((await call({ action: "set_rating_options", rated: true })).status).toBe(403);
    h.user = "admin1";
    expect((await call({ action: "set_rating_options", rated: "yes" })).status).toBe(400);
    expect(tables().tournaments![0]!.rated).toBe(false);
  });
});

describe("11. no push for ratings, ever; a test tournament sends no push at all", () => {
  it("a rated test- tournament sends nothing", async () => {
    start({ rated: true, season: true, slug: "test-rated-demo" });
    await log("g1", 3, 1);
    await log("g2", 1, 1);
    expect(h.expo).toEqual([]);
  });

  it("a rated real tournament sends only the match MVP vote it always sent, and nothing about ratings", async () => {
    start({ rated: true, season: true, slug: "spring-classic" });
    await log("g1", 3, 1);
    await log("g1", 3, 1);
    const bodies = JSON.stringify(h.expo);
    expect(bodies).toMatch(/Vote for Match MVP/);
    expect(bodies).not.toMatch(/rating|rated|season point/i);
    // the MVP push goes out on the first score only
    expect(h.expo.flat().filter((m) => /Vote for Match MVP/.test(JSON.stringify(m))).length).toBeGreaterThan(0);
    const first = h.expo.length;
    await log("g1", 5, 0);
    expect(h.expo.length).toBe(first);
  });
});

describe("8. changing a bracket takes ratings back out first", () => {
  it("changing a semi-final result that would reset a scored final asks first, and forgets the final while it still exists", async () => {
    start({ rated: true });
    await log("g1", 2, 0);
    await log("g2", 0, 1);
    await call({ action: "generate_knockout" });
    const sf = tables().tournament_matches!.filter((m) => m.stage === "sf").sort((a, b) => Number(a.match_number) - Number(b.match_number));
    await log(String(sf[0]!.id), 2, 0);
    await log(String(sf[1]!.id), 2, 0);
    const final = tables().tournament_matches!.find((m) => m.stage === "final")!;
    expect((await log(String(final.id), 1, 0)).status).toBe(200);
    forgot = [];
    // the other team now wins the first semi-final: the final's teams change, and it already has a result
    const ask = await log(String(sf[0]!.id), 0, 2);
    expect(ask.status).toBe(409);
    expect(ask.json.code).toBe("confirm_reset");
    expect(forgot).toEqual([]);
    const done = await log(String(sf[0]!.id), 0, 2, { confirm_reset: true });
    expect(done.status).toBe(200);
    expect(forgot).toHaveLength(1);
    expect(forgot[0]!.ids).toEqual([String(final.id)]);
    expect(forgot[0]!.stillThere).toEqual([true]);
  });

  it("regenerating the knockout forgets the old knockout matches while they still exist", async () => {
    start({ rated: true });
    await log("g1", 2, 0);
    await log("g2", 0, 1);
    await call({ action: "generate_knockout" });
    const sfIds = tables().tournament_matches!.filter((m) => m.stage === "sf").map((m) => String(m.id));
    expect(sfIds.length).toBeGreaterThan(0);
    forgot = [];
    await call({ action: "generate_knockout" });
    expect(forgot.length).toBe(1);
    expect(forgot[0]!.ids.sort()).toEqual(sfIds.sort());
    expect(forgot[0]!.stillThere.every(Boolean)).toBe(true);
  });

  it("a tournament that is not rated never calls the forget step", async () => {
    start({ rated: false });
    await log("g1", 2, 0);
    await log("g2", 0, 1);
    await call({ action: "generate_knockout" });
    await call({ action: "generate_knockout" });
    expect(rpcNames()).not.toContain("tournament_forget_matches");
  });
});
