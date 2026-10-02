import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeResultsDb } from "./fakeResultsDb";

const h = vi.hoisted(() => ({
  db: null as unknown as import("./fakeResultsDb").FakeResultsDb,
}));

vi.mock("@/lib/server/runtimeClients", () => ({ getSupabaseAdmin: () => h.db }));
vi.mock("@/lib/supabase/service", () => ({ supabaseService: () => h.db }));
vi.mock("@/lib/push/sendExpoPush", () => ({ sendPushToUsers: async () => ({ tokens: 0, batches: [] }) }));
vi.mock("@sentry/nextjs", () => ({ captureException: () => {} }));

import type { SupabaseClient } from "@supabase/supabase-js";
import { GET as leaderboardsGET } from "@/app/api/leaderboards/route";
import { GET as recordGET } from "@/app/api/player/record/route";
import { POST as sessionResultPOST } from "@/app/api/sessions/result/route";
import {
  buildPlayerRecord,
  buildRecordSummaries,
  loadPlayerRecord,
  loadRecordSummaries,
  summarizeLog,
  type PlayerRecord,
  type RecordResult,
} from "@/lib/records/playerRecord";

const HOUR = 60 * 60 * 1000;
const ME = "aaaaaaaa-0000-4000-8000-000000000001";
const MATE = "aaaaaaaa-0000-4000-8000-000000000002";
const RIVAL = "bbbbbbbb-0000-4000-8000-000000000001";
const HIDDEN = "cccccccc-0000-4000-8000-000000000001";
const HOST = "host-1";
const IOS_UA = "CT%20Pickup/41 CFNetwork/1568.100.1 Darwin/24.0.0";
const NEW_APP = { "user-agent": IOS_UA, "x-app-version": "1.4.0" };
const LEGACY = { "user-agent": IOS_UA };

const admin = () => h.db as unknown as SupabaseClient;
const runId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** One game: ME and MATE on A, RIVAL on B. `result` undefined = no result posted. */
function game(n: number, result?: Omit<RecordResult, "run_id">) {
  const id = runId(n);
  h.db.rows("pickup_runs").push({
    id,
    created_by: HOST,
    title: `Run ${n}`,
    location_text: "Field",
    status: result ? "completed" : "in_progress",
    start_at: new Date(Date.UTC(2026, 8, 1) + n * 24 * HOUR).toISOString(),
  });
  for (const [user_id, team] of [
    [ME, "A"],
    [MATE, "A"],
    [RIVAL, "B"],
  ] as const) {
    h.db.rows("pickup_run_team_assignments").push({ run_id: id, user_id, team });
    h.db.rows("pickup_run_rsvps").push({ run_id: id, user_id, status: "confirmed" });
  }
  if (result) h.db.rows("pickup_run_results").push({ run_id: id, total_teams: 2, created_at: new Date().toISOString(), ...result });
}

function profile(id: string, overrides: Record<string, unknown> = {}) {
  h.db.rows("profiles").push({
    id,
    first_name: "Pat",
    last_name: id.slice(0, 4),
    username: id,
    approved: true,
    is_admin: false,
    nearest_venue: null,
    pickup_wins_count: 0,
    pickup_losses_count: 0,
    attended_count: 0,
    ...overrides,
  });
}

function expectHeaderMatchesLog(record: PlayerRecord) {
  const decided = record.log.filter((g) => g.outcome != null);
  expect(record.games).toBe(decided.length);
  expect(record.wins).toBe(decided.filter((g) => g.outcome === "W").length);
  expect(record.draws).toBe(decided.filter((g) => g.outcome === "D").length);
  expect(record.losses).toBe(decided.filter((g) => g.outcome === "L").length);
  expect(record.games).toBe(record.wins + record.draws + record.losses);
  expect(record.win_pct).toBe(record.games ? record.wins / record.games : null);
  expect(record.potd_count).toBe(record.log.filter((g) => g.potd).length);
}

function get(url: string, viewer: string, headers: Record<string, string> = {}) {
  return recordGET(new Request(`http://test.local${url}`, { headers: { authorization: `Bearer ${viewer}`, ...headers } }));
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.db = new FakeResultsDb();
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-key";
  profile(HOST);
  profile(ME);
  profile(MATE);
  profile(RIVAL);
  profile(HIDDEN, { approved: false });
});

describe("record helper", () => {
  it("header equals the match log: wins, draws, no-score games and POTD", async () => {
    game(1, { winning_team: "A", score_a: 5, score_b: 3, player_of_day: ME });
    game(2, { winning_team: null, score_a: 2, score_b: 2 });
    game(3, { winning_team: "B", score_a: null, score_b: null });
    game(4, { winning_team: null, score_a: null, score_b: null });
    game(5);

    const record = await loadPlayerRecord(admin(), ME);
    expectHeaderMatchesLog(record);
    expect(record).toMatchObject({ games: 4, wins: 1, draws: 2, losses: 1, win_pct: 0.25, potd_count: 1 });
    expect(record.log.map((g) => [g.outcome, g.score])).toEqual([
      [null, null],
      ["D", null],
      ["L", null],
      ["D", "2–2"],
      ["W", "5–3"],
    ]);
    expect(record.form).toEqual(["W", "D", "L", "D"]);

    const rival = await loadPlayerRecord(admin(), RIVAL);
    expectHeaderMatchesLog(rival);
    expect(rival).toMatchObject({ games: 4, wins: 1, draws: 2, losses: 1 });
    expect(rival.log.find((g) => g.run_id === runId(1))?.score).toBe("3–5");
  });

  it("ignores the stored counters", async () => {
    h.db.rows("profiles").find((p) => p.id === ME)!.pickup_wins_count = 99;
    h.db.rows("player_ratings").push({ user_id: ME, sessions: 50 });
    game(1, { winning_team: "B", score_a: 0, score_b: 1 });
    const record = await loadPlayerRecord(admin(), ME);
    expect(record).toMatchObject({ games: 1, wins: 0, losses: 1 });
    expect(h.db.queries.some((q) => q.table === "player_ratings")).toBe(false);
  });

  it("follows edited results: header recomputed from the edited log", async () => {
    game(1);
    h.db.rows("pickup_runs")[0].status = "in_progress";
    const post = (body: Record<string, unknown>) =>
      sessionResultPOST(
        new Request("http://test.local/api/sessions/result", {
          method: "POST",
          headers: { authorization: `Bearer ${HOST}`, "content-type": "application/json" },
          body: JSON.stringify({ run_id: runId(1), ...body }),
        }),
      );

    expect((await post({ score_a: 5, score_b: 3 })).status).toBe(200);
    let record = await loadPlayerRecord(admin(), ME);
    expect(record).toMatchObject({ games: 1, wins: 1, draws: 0 });
    expectHeaderMatchesLog(record);

    expect((await post({ score_a: 2, score_b: 2, score_only: true })).status).toBe(200);
    record = await loadPlayerRecord(admin(), ME);
    expect(record).toMatchObject({ games: 1, wins: 0, draws: 1, losses: 0, win_pct: 0 });
    expect(record.log[0].score).toBe("2–2");
    expectHeaderMatchesLog(record);

    expect((await post({ score_a: 1, score_b: 4, score_only: true })).status).toBe(200);
    record = await loadPlayerRecord(admin(), ME);
    expect(record).toMatchObject({ games: 1, wins: 0, draws: 0, losses: 1 });
    expectHeaderMatchesLog(record);
    expect(h.db.rows("pickup_run_result_edits")).toHaveLength(2);
  });

  it("bulk summaries match the single-player record", async () => {
    game(1, { winning_team: "A", score_a: 3, score_b: 1 });
    game(2, { winning_team: null, score_a: 1, score_b: 1, player_of_day: RIVAL });
    game(3, { winning_team: null });
    game(4);
    const all = await loadRecordSummaries(admin());
    const some = await loadRecordSummaries(admin(), [ME, RIVAL, HIDDEN]);
    for (const uid of [ME, MATE, RIVAL]) {
      const { form: _f, log: _l, ...summary } = await loadPlayerRecord(admin(), uid);
      expect(all.get(uid)).toEqual(summary);
    }
    expect(some.get(ME)).toEqual(all.get(ME));
    expect(some.get(RIVAL)).toEqual(all.get(RIVAL));
    expect(some.get(HIDDEN)).toMatchObject({ games: 0 });
  });

  it("falls back without score columns before the migration", async () => {
    h.db.missingColumns.pickup_run_results = ["score_a", "score_b"];
    game(1, { winning_team: "A" });
    game(2, { winning_team: null });
    const record = await loadPlayerRecord(admin(), ME);
    expect(record).toMatchObject({ games: 2, wins: 1, draws: 1 });
    expect(record.log.every((g) => g.score == null)).toBe(true);
  });

  it("pure builders agree", () => {
    const results: RecordResult[] = [
      { run_id: "r1", winning_team: "A", score_a: 2, score_b: 0 },
      { run_id: "r2", winning_team: null },
    ];
    const assignments = [
      { run_id: "r1", user_id: "u", team: "B" },
      { run_id: "r2", user_id: "u", team: "B" },
      { run_id: "r3", user_id: "u", team: "B" },
    ];
    const one = buildPlayerRecord("u", {
      teams: new Map(assignments.map((a) => [a.run_id, a.team])),
      results: new Map(results.map((r) => [r.run_id, r])),
      runs: new Map(),
      confirmedRunIds: [],
    });
    expect(summarizeLog(one.log)).toEqual(buildRecordSummaries(assignments, results).get("u"));
    expect(buildRecordSummaries(assignments, results).get("u")).toMatchObject({ games: 2, losses: 1, draws: 1 });
  });
});

describe("/api/player/record", () => {
  beforeEach(() => {
    game(1, { winning_team: "A", score_a: 5, score_b: 3 });
    game(2, { winning_team: null, score_a: 1, score_b: 1 });
  });

  it("gives the caller the full record", async () => {
    const res = await get("/api/player/record", ME);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.record).toMatchObject({ games: 2, wins: 1, draws: 1, losses: 0, form: ["W", "D"] });
    expect(body.record.log).toHaveLength(2);
  });

  it("gives other players a summary only, never the log", async () => {
    const body = await (await get(`/api/player/record?userId=${RIVAL}`, ME)).json();
    expect(body.summary).toEqual({ games: 2, wins: 0, draws: 1, losses: 1, win_pct: 0, potd_count: 0 });
    expect(body).not.toHaveProperty("record");
    const text = JSON.stringify(body);
    for (const banned of ["score\"", "tier", "reliability", "log"]) expect(text).not.toContain(banned);
  });

  it("hides unapproved players and blocks unapproved viewers", async () => {
    expect((await get(`/api/player/record?userId=${HIDDEN}`, ME)).status).toBe(404);
    expect((await get(`/api/player/record?userId=${ME}`, HIDDEN)).status).toBe(403);
    const many = await (await get(`/api/player/record?userIds=${ME},${RIVAL},${HIDDEN}`, MATE)).json();
    expect(Object.keys(many.summaries).sort()).toEqual([ME, RIVAL].sort());
    expect((await get("/api/player/record?userIds=not-a-uuid", ME)).status).toBe(400);
    expect((await recordGET(new Request("http://test.local/api/player/record"))).status).toBe(401);
  });
});

describe("leaderboards use the record helper only for the new app", () => {
  beforeEach(() => {
    for (let n = 1; n <= 10; n += 1) game(n, n <= 6 ? { winning_team: "A", score_a: 2, score_b: 1 } : { winning_team: null, score_a: 0, score_b: 0 });
    h.db.rows("profiles").find((p) => p.id === ME)!.pickup_wins_count = 40;
    h.db.rows("profiles").find((p) => p.id === ME)!.pickup_losses_count = 10;
    h.db.rows("player_ratings").push({ user_id: ME, tier: "gold", score: 70, sessions: 30, reliability: 90, verification: "document" });
  });

  it("new app: wins, win rate and games come from posted results (draws are games)", async () => {
    const body = await (await leaderboardsGET(new Request("http://test.local/api/leaderboards", { headers: NEW_APP }))).json();
    expect(body.wins.find((r: { id: string }) => r.id === ME)).toMatchObject({ value: 6, games_played: 10 });
    expect(body.win_rate.find((r: { id: string }) => r.id === ME)).toMatchObject({ value: 60, win_rate: 0.6, games_played: 10 });
    expect(body.sessions.find((r: { id: string }) => r.id === ME)).toMatchObject({ value: 10 });
    expect(body.tiers.find((r: { user_id: string }) => r.user_id === ME)).toMatchObject({ games: 10, sessions: 30 });
  });

  it("v1.3.5 keeps the stored counters and gets no games field", async () => {
    const body = await (await leaderboardsGET(new Request("http://test.local/api/leaderboards", { headers: LEGACY }))).json();
    expect(body.wins.find((r: { id: string }) => r.id === ME)).toMatchObject({ value: 40 });
    for (const row of body.tiers) expect(row).not.toHaveProperty("games");
  });
});
