import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeResultsDb } from "../results/fakeResultsDb";

const h = vi.hoisted(() => ({
  db: null as unknown as import("../results/fakeResultsDb").FakeResultsDb,
}));

vi.mock("@/lib/server/runtimeClients", () => ({ getSupabaseAdmin: () => h.db }));
vi.mock("@/lib/supabase/service", () => ({ supabaseService: () => h.db }));
vi.mock("@/lib/push/sendExpoPush", () => ({ sendPushToUsers: async () => ({ tokens: 0, batches: [] }) }));
vi.mock("@sentry/nextjs", () => ({ captureException: () => {} }));

import type { SupabaseClient } from "@supabase/supabase-js";
import { GET as leaderboardsGET } from "@/app/api/leaderboards/route";
import { POST as sessionResultPOST } from "@/app/api/sessions/result/route";
import { POINTS, currentSeason, pointsForGame, pointsReasonsForGame, seasonForStartAt, seasonLabelFor } from "@/lib/pickup/points";
import { pointsEventsForRun, syncRunPoints, totalsFromEvents, type PointsEventRow } from "@/lib/points/ledger";
import { buildRecordSummaries, loadPlayerRecord, loadRecordSummaries, type RecordResult } from "@/lib/records/playerRecord";
import * as mobilePoints from "../../mobile/lib/pickup/points";

const HOST = "host-1";
const A1 = "aaaaaaaa-0000-4000-8000-000000000001";
const A2 = "aaaaaaaa-0000-4000-8000-000000000002";
const B1 = "bbbbbbbb-0000-4000-8000-000000000001";
const B2 = "bbbbbbbb-0000-4000-8000-000000000002";
const PLAYERS = [A1, A2, B1, B2];
const RUN1 = "11111111-1111-4111-8111-111111111111";
const RUN2 = "22222222-2222-4222-8222-222222222222";
const IOS_UA = "CT%20Pickup/41 CFNetwork/1568.100.1 Darwin/24.0.0";
const NEW_APP = { "user-agent": IOS_UA, "x-app-version": "1.4.0" };

const admin = () => h.db as unknown as SupabaseClient;
const ledger = () => h.db.rows("points_events") as unknown as PointsEventRow[];
const totalFor = (userId: string, runId?: string) =>
  ledger()
    .filter((r) => r.user_id === userId && (!runId || r.run_id === runId))
    .reduce((s, r) => s + r.points, 0);

/** points_replace_run as the migration defines it: delete the run's rows, insert the new set. */
function installLedgerRpc(db: FakeResultsDb) {
  db.rpcHandler = (name, args) => {
    if (name !== "points_replace_run") return { data: null, error: null };
    const runId = args.p_run_id as string;
    const rows = args.p_rows as Array<{ user_id: string; reason: string; points: number; season: string }>;
    db.tables.points_events = db.rows("points_events").filter((r) => r.run_id !== runId);
    for (const r of rows) db.rows("points_events").push({ run_id: runId, ...r });
    return { data: rows.length, error: null };
  };
}

function seedRun(runId: string, startAt: string) {
  h.db.rows("pickup_runs").push({ id: runId, created_by: HOST, title: "Run", status: "in_progress", start_at: startAt });
  for (const id of PLAYERS) {
    h.db.rows("pickup_run_rsvps").push({ run_id: runId, user_id: id, status: "confirmed" });
    h.db.rows("pickup_run_team_assignments").push({ run_id: runId, user_id: id, team: id.startsWith("a") ? "A" : "B" });
  }
}

function post(runId: string, body: Record<string, unknown>) {
  return sessionResultPOST(
    new Request("http://test.local/api/sessions/result", {
      method: "POST",
      headers: { authorization: `Bearer ${HOST}`, "content-type": "application/json" },
      body: JSON.stringify({ run_id: runId, ...body }),
    }),
  );
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.db = new FakeResultsDb();
  installLedgerRpc(h.db);
  h.db.rows("profiles").push({ id: HOST, is_admin: false, approved: true });
  for (const id of PLAYERS) {
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
    });
  }
});

describe("points config", () => {
  it("is played 10, win 5, draw 2, potd 10 with no multiplier", () => {
    expect(POINTS).toEqual({ played: 10, win: 5, draw: 2, potd: 10 });
  });

  it("scores a win, a draw, a loss and POTD", () => {
    expect(pointsForGame("W", false)).toBe(15);
    expect(pointsForGame("D", false)).toBe(12);
    expect(pointsForGame("L", false)).toBe(10);
    expect(pointsForGame("W", true)).toBe(25);
    expect(pointsForGame("L", true)).toBe(20);
    expect(pointsForGame(null, true)).toBe(10);
    expect(pointsForGame(null, false)).toBe(0);
    expect(pointsReasonsForGame("D", true)).toEqual(["played", "draw", "potd"]);
  });

  it("keeps the mobile copy identical", () => {
    const web = readFileSync(path.join(__dirname, "../../lib/pickup/points.ts"), "utf8");
    const mobile = readFileSync(path.join(__dirname, "../../mobile/lib/pickup/points.ts"), "utf8");
    expect(mobile).toBe(web);
    expect(mobilePoints.seasonForStartAt("2026-12-01T17:00:00Z")).toBe("Winter 2026\u201327");
  });
});

describe("pointsEventsForRun", () => {
  const assignments = [
    { user_id: A1, team: "A" },
    { user_id: A2, team: "A" },
    { user_id: B1, team: "B" },
  ];
  const run = (result: Parameters<typeof pointsEventsForRun>[0]["result"]) =>
    pointsEventsForRun({ runId: RUN1, startAt: "2026-10-06T23:00:00Z", result, assignments });

  it("gives winners played + win and losers played only", () => {
    const rows = run({ winning_team: "A", player_of_day: null });
    expect(rows.filter((r) => r.user_id === A1).map((r) => r.reason)).toEqual(["played", "win"]);
    expect(rows.filter((r) => r.user_id === B1).map((r) => r.reason)).toEqual(["played"]);
    expect(rows.every((r) => r.season === "Fall 2026" && r.run_id === RUN1)).toBe(true);
  });

  it("gives both teams a draw, and reads the score before winning_team", () => {
    expect(run({ winning_team: null }).filter((r) => r.reason === "draw")).toHaveLength(3);
    const scored = run({ winning_team: "A", score_a: 1, score_b: 3 });
    expect(scored.filter((r) => r.reason === "win").map((r) => r.user_id)).toEqual([B1]);
    expect(run({ winning_team: "A", score_a: 2, score_b: 2 }).filter((r) => r.reason === "draw")).toHaveLength(3);
  });

  it("gives POTD to the player of the day even without a team, and nothing without a result", () => {
    const rows = run({ winning_team: "B", player_of_day: B2 });
    expect(rows.filter((r) => r.user_id === B2)).toEqual([
      { user_id: B2, run_id: RUN1, reason: "potd", points: 10, season: "Fall 2026" },
    ]);
    expect(run(null)).toEqual([]);
  });

  it("uses the result's posted time when the run has no kickoff", () => {
    const rows = pointsEventsForRun({
      runId: RUN1,
      startAt: null,
      postedAt: "2027-03-02T15:00:00Z",
      result: { winning_team: "A" },
      assignments,
    });
    expect(rows[0].season).toBe("Spring 2027");
  });
});

describe("seasons (Eastern time)", () => {
  const et = (iso: string | null) => seasonForStartAt(iso);

  it("names Winter for both years with an en dash and the other seasons for one", () => {
    expect(seasonLabelFor(2026, 12)).toBe("Winter 2026\u201327");
    expect(seasonLabelFor(2027, 1)).toBe("Winter 2026\u201327");
    expect(seasonLabelFor(2099, 12)).toBe("Winter 2099\u201300");
    expect(seasonLabelFor(2026, 9)).toBe("Fall 2026");
    expect(seasonLabelFor(2027, 3)).toBe("Spring 2027");
    expect(seasonLabelFor(2027, 6)).toBe("Summer 2027");
  });

  it("Dec 1, 2026 is Winter 2026–27; Nov 30 is Fall 2026", () => {
    expect(et("2026-11-30T23:00:00Z")).toBe("Fall 2026"); // 6pm EST Nov 30
    expect(et("2026-12-01T17:00:00Z")).toBe("Winter 2026\u201327"); // noon EST Dec 1
    expect(et("2026-12-01T05:00:01Z")).toBe("Winter 2026\u201327"); // 00:00:01 EST Dec 1
  });

  it("Feb 28, 2027 is Winter 2026–27; Mar 1, 2027 is Spring 2027", () => {
    expect(et("2027-02-28T23:30:00Z")).toBe("Winter 2026\u201327");
    expect(et("2027-03-01T05:30:00Z")).toBe("Spring 2027"); // 00:30 EST Mar 1
  });

  it("Feb 29 in a leap year stays Winter", () => {
    expect(et("2028-02-29T23:00:00Z")).toBe("Winter 2027\u201328");
    expect(et("2028-03-01T17:00:00Z")).toBe("Spring 2028");
  });

  it("Aug 31 is Summer; Sep 1 is Fall", () => {
    expect(et("2026-08-31T22:00:00Z")).toBe("Summer 2026");
    expect(et("2026-09-01T16:00:00Z")).toBe("Fall 2026");
  });

  it("uses the Eastern date late at night, not the UTC date", () => {
    // 10:30pm EST Nov 30 is already Dec 1 in UTC.
    expect(et("2026-12-01T03:30:00Z")).toBe("Fall 2026");
    // 11pm EDT Aug 31 is Sep 1 in UTC.
    expect(et("2026-09-01T03:00:00Z")).toBe("Summer 2026");
    // 11:30pm EST Feb 28 is Mar 1 in UTC.
    expect(et("2027-03-01T04:30:00Z")).toBe("Winter 2026\u201327");
    expect(currentSeason(Date.parse("2026-12-01T03:30:00Z"))).toBe("Fall 2026");
    expect(currentSeason(Date.parse("2026-12-01T05:30:00Z"))).toBe("Winter 2026\u201327");
  });

  it("reads a date-only start_at (UTC midnight) as that calendar day", () => {
    expect(et("2026-12-01T00:00:00+00:00")).toBe("Winter 2026\u201327");
    expect(et("2026-09-01T00:00:00.000Z")).toBe("Fall 2026");
    expect(et(null)).toBeNull();
    expect(et("not a date")).toBeNull();
  });

  it("matches the SQL season function's naming", () => {
    const sql = readFileSync(path.join(__dirname, "../../supabase/migrations/20261003000000_points_events.sql"), "utf8");
    expect(sql).toContain("'Winter ' || y || '\u2013' || lpad(((y + 1) % 100)::text, 2, '0')");
    expect(sql).toContain("'Winter ' || (y - 1) || '\u2013' || lpad((y % 100)::text, 2, '0')");
    expect(sql).toContain("(p_start_at at time zone 'UTC')::time = time '00:00:00'");
    expect(sql).toContain("p_start_at at time zone 'America/New_York'");
  });
});

describe("backfill definitions match the record helper", () => {
  // The backfill SQL mirrors pointsEventsForRun: a played row per A/B/C team assignment on a run with a result,
  // win when team = winner (score first, else winning_team), draw when there is no winner, potd for player_of_day.
  const runs = [
    { id: "r1", result: { winning_team: "A", player_of_day: A1 } },
    { id: "r2", result: { winning_team: null, player_of_day: B2 } },
    { id: "r3", result: { winning_team: "A", score_a: 0, score_b: 4, player_of_day: null } },
    { id: "r4", result: { winning_team: "B", score_a: 3, score_b: 3, player_of_day: A2 } },
    { id: "r5", result: { winning_team: "C", player_of_day: B1 } },
    { id: "r6", result: null },
  ];
  const assignments = [
    ...["r1", "r2", "r3", "r4", "r6"].flatMap((run_id) => [
      { run_id, user_id: A1, team: "A" },
      { run_id, user_id: A2, team: "A" },
      { run_id, user_id: B1, team: "B" },
    ]),
    { run_id: "r2", user_id: B2, team: "B" },
    { run_id: "r5", user_id: A1, team: "A" },
    { run_id: "r5", user_id: B1, team: "C" },
  ];

  it("gives the same games, wins, draws, POTD and points per player", () => {
    const results: RecordResult[] = runs.filter((r) => r.result).map((r) => ({ run_id: r.id, ...r.result! }));
    const summaries = buildRecordSummaries(assignments, results);
    const events = runs.flatMap((r) =>
      pointsEventsForRun({
        runId: r.id,
        startAt: "2026-10-06T23:00:00Z",
        result: r.result,
        assignments: assignments.filter((a) => a.run_id === r.id),
      }),
    );
    const totals = totalsFromEvents(events, "Fall 2026");
    expect(summaries.size).toBe(4);
    for (const [uid, s] of summaries) {
      const mine = events.filter((e) => e.user_id === uid);
      expect(mine.filter((e) => e.reason === "played")).toHaveLength(s.games);
      expect(mine.filter((e) => e.reason === "win")).toHaveLength(s.wins);
      expect(mine.filter((e) => e.reason === "draw")).toHaveLength(s.draws);
      expect(mine.filter((e) => e.reason === "potd")).toHaveLength(s.potd_count);
      expect(totals.get(uid)!.all_time_points).toBe(s.all_time_points);
      expect(s.all_time_points).toBe(10 * s.games + 5 * s.wins + 2 * s.draws + 10 * s.potd_count);
    }
    expect(events.some((e) => e.run_id === "r6")).toBe(false);
  });

  it("documents the same rules in the backfill SQL", () => {
    const sql = readFileSync(path.join(__dirname, "../../supabase/queries/points_events_backfill.sql"), "utf8");
    expect(sql).toContain("a.team in ('A', 'B', 'C')");
    expect(sql).toContain("when res.score_a > res.score_b then 'A' when res.score_b > res.score_a then 'B'");
    expect(sql).toContain("when res.winning_team in ('A', 'B', 'C') then res.winning_team");
    expect(sql).toContain("'played'::text as reason, 10 as points");
    expect(sql).toContain("'win', 5, season from played where winner = team");
    expect(sql).toContain("'draw', 2, season from played where winner is null");
    expect(sql).toContain("'potd', 10, season from decided where player_of_day is not null");
    expect(sql).toMatch(/begin;[\s\S]*delete from public\.points_events;[\s\S]*commit;/);
    expect(sql).not.toMatch(/(from|join)\s+public\.(player_ratings|session_attendance)/i);
  });
});

describe("result posts and edits write the ledger", () => {
  beforeEach(() => {
    seedRun(RUN1, "2026-10-06T23:00:00Z");
    seedRun(RUN2, "2026-10-08T23:00:00Z");
  });

  it("writes rows on post and replaces only that run's rows on edit", async () => {
    expect((await post(RUN1, { winning_team: "A", player_of_day: A1 })).status).toBe(200);
    expect((await post(RUN2, { winning_team: "B" })).status).toBe(200);
    const run2Before = ledger()
      .filter((r) => r.run_id === RUN2)
      .map((r) => ({ ...r }));
    expect(totalFor(A1, RUN1)).toBe(25);
    expect(totalFor(B1, RUN1)).toBe(10);

    expect((await post(RUN1, { winning_team: "B", score_only: true })).status).toBe(200);
    expect(totalFor(A1, RUN1)).toBe(20); // played + POTD kept, win removed
    expect(totalFor(B1, RUN1)).toBe(15);
    expect(ledger().filter((r) => r.run_id === RUN2)).toEqual(run2Before);
    expect(h.db.rpcCalls.filter((c) => c.name === "points_replace_run").map((c) => (c.args as { p_run_id: string }).p_run_id)).toEqual([
      RUN1,
      RUN2,
      RUN1,
    ]);
  });

  it("is safe on retry: syncing twice leaves the same rows", async () => {
    await post(RUN1, { outcome: "draw" });
    const once = ledger().map((r) => ({ ...r }));
    await syncRunPoints(admin(), RUN1);
    await syncRunPoints(admin(), RUN1);
    expect(ledger()).toEqual(once);
    expect(once).toHaveLength(8);
    expect(totalFor(A1)).toBe(12);
  });

  it("feeds the record helper and the Points leaderboard", async () => {
    h.db.rows("pickup_runs").find((r) => r.id === RUN2)!.start_at = "2020-10-08T23:00:00Z";
    await post(RUN1, { winning_team: "A" });
    await post(RUN2, { winning_team: "A" });
    const rec = await loadPlayerRecord(admin(), A1, Date.parse("2026-10-10T12:00:00Z"));
    expect(rec.all_time_points).toBe(30);

    const res = await leaderboardsGET(new Request("http://test.local/api/leaderboards", { headers: NEW_APP }));
    const body = await res.json();
    expect(body.season).toBe(currentSeason());
    expect(body.points_all_time.find((r: { id: string }) => r.id === A1)).toMatchObject({ value: 30 });
    expect(body.points_all_time.find((r: { id: string }) => r.id === B1)).toMatchObject({ value: 20 });
  });
});

describe("before the ledger migration runs", () => {
  beforeEach(() => {
    h.db.missingTables.add("points_events");
    h.db.rpcHandler = (name) =>
      name === "points_replace_run"
        ? { data: null, error: { message: "Could not find the function public.points_replace_run", code: "PGRST202" } }
        : { data: null, error: null };
    seedRun(RUN1, "2026-10-06T23:00:00Z");
  });

  it("still posts results, and sync reports the missing ledger without throwing", async () => {
    expect((await post(RUN1, { winning_team: "A", player_of_day: B1 })).status).toBe(200);
    await expect(syncRunPoints(admin(), RUN1)).resolves.toEqual({ ok: false, rows: 0, missing: true });
  });

  it("computes points from results instead", async () => {
    await post(RUN1, { winning_team: "A", player_of_day: B1 });
    const summaries = await loadRecordSummaries(admin());
    expect(summaries.get(A1)).toMatchObject({ games: 1, wins: 1, all_time_points: 15 });
    expect(summaries.get(B1)).toMatchObject({ games: 1, losses: 1, potd_count: 1, all_time_points: 20 });
    const some = await loadRecordSummaries(admin(), [A2]);
    expect(some.get(A2)).toMatchObject({ all_time_points: 15 });
    const rec = await loadPlayerRecord(admin(), B1, Date.parse("2026-10-10T12:00:00Z"));
    expect(rec).toMatchObject({ season: "Fall 2026", season_points: 20, all_time_points: 20 });

    const res = await leaderboardsGET(new Request("http://test.local/api/leaderboards", { headers: NEW_APP }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.points_all_time.find((r: { id: string }) => r.id === B1)).toMatchObject({ value: 20 });
  });
});
