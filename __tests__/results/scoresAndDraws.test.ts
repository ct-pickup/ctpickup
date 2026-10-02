import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeResultsDb } from "./fakeResultsDb";

const h = vi.hoisted(() => ({
  db: null as unknown as import("./fakeResultsDb").FakeResultsDb,
  pushes: [] as { userIds: string[]; title: string; body: string }[],
}));

vi.mock("@/lib/server/runtimeClients", () => ({ getSupabaseAdmin: () => h.db }));
vi.mock("@/lib/supabase/service", () => ({ supabaseService: () => h.db }));
vi.mock("@/lib/push/sendExpoPush", () => ({
  sendPushToUsers: async (_admin: unknown, userIds: string[], msg: { title: string; body: string }) => {
    h.pushes.push({ userIds, title: msg.title, body: msg.body });
    return { tokens: 1, batches: [] };
  },
}));

import { POST as adminResultPOST } from "@/app/api/admin/pickup/result/route";
import { POST as sessionResultPOST } from "@/app/api/sessions/result/route";
import { autoSettleTierSession } from "@/lib/pickup/autoSettleSession";
import {
  canEditResult,
  outcomeForTeam,
  parseResultSubmission,
  resultSummary,
  scoreLineForTeam,
} from "@/lib/pickup/resultOutcome";
import { resultFormBody, resultFormFromStored } from "../../mobile/lib/resultForm";
import { outcomeFor, recordCaption, recordLine } from "../../mobile/lib/season";

const HOUR = 60 * 60 * 1000;
const RUN = "11111111-1111-4111-8111-111111111111";
const HOST = "host-1";
const ADMIN = "admin-1";
const A1 = "aaaaaaaa-0000-4000-8000-000000000001";
const A2 = "aaaaaaaa-0000-4000-8000-000000000002";
const B1 = "bbbbbbbb-0000-4000-8000-000000000001";
const B2 = "bbbbbbbb-0000-4000-8000-000000000002";
const PLAYERS = [A1, A2, B1, B2];

function seed() {
  h.db.rows("pickup_runs").push({ id: RUN, created_by: HOST, title: "Tuesday run", status: "in_progress" });
  h.db.rows("profiles").push({ id: HOST, is_admin: false }, { id: ADMIN, is_admin: true });
  for (const id of PLAYERS) {
    h.db.rows("profiles").push({ id, is_admin: false, pickup_wins_count: 0, pickup_losses_count: 0, attended_count: 0 });
    h.db.rows("pickup_run_rsvps").push({ run_id: RUN, user_id: id, status: "confirmed" });
    h.db.rows("pickup_run_team_assignments").push({ run_id: RUN, user_id: id, team: id.startsWith("a") ? "A" : "B" });
  }
}

function post(userId: string, body: Record<string, unknown>) {
  return sessionResultPOST(
    new Request("http://test.local/api/sessions/result", {
      method: "POST",
      headers: { authorization: `Bearer ${userId}`, "content-type": "application/json" },
      body: JSON.stringify({ run_id: RUN, ...body }),
    }),
  );
}

function adminPost(body: Record<string, unknown>) {
  return adminResultPOST(
    new Request("http://test.local/api/admin/pickup/result", {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN}`, "content-type": "application/json" },
      body: JSON.stringify({
        run_id: RUN,
        total_teams: 2,
        team_assignments: PLAYERS.map((user_id) => ({ user_id, team: user_id.startsWith("a") ? "A" : "B" })),
        ...body,
      }),
    }),
  );
}

const result = () => h.db.rows("pickup_run_results").find((r) => r.run_id === RUN) ?? null;
const edits = () => h.db.rows("pickup_run_result_edits");
const counters = (id: string) => {
  const p = h.db.rows("profiles").find((r) => r.id === id)!;
  return [p.pickup_wins_count, p.pickup_losses_count];
};
const ageResult = (ms: number) => {
  result()!.created_at = new Date(Date.now() - ms).toISOString();
};

beforeEach(() => {
  h.db = new FakeResultsDb();
  h.pushes = [];
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-key";
  seed();
});

describe("result rules", () => {
  it("derives a win from the score", () => {
    expect(parseResultSubmission({ score_a: 5, score_b: 3 }, 2)).toEqual({ ok: true, winning_team: "A", score_a: 5, score_b: 3 });
    expect(parseResultSubmission({ score_a: "1", score_b: "4" }, 2)).toMatchObject({ ok: true, winning_team: "B" });
  });

  it("derives a draw from equal scores", () => {
    expect(parseResultSubmission({ score_a: 2, score_b: 2 }, 2)).toEqual({ ok: true, winning_team: null, score_a: 2, score_b: 2 });
  });

  it("takes a winner or a draw when the score was not tracked", () => {
    expect(parseResultSubmission({ winning_team: "B" }, 2)).toEqual({ ok: true, winning_team: "B", score_a: null, score_b: null });
    expect(parseResultSubmission({ outcome: "draw" }, 2)).toEqual({ ok: true, winning_team: null, score_a: null, score_b: null });
    expect(parseResultSubmission({ winning_team: "draw" }, 2)).toMatchObject({ ok: true, winning_team: null });
  });

  it("rejects bad scores and contradictions", () => {
    expect(parseResultSubmission({ score_a: 31, score_b: 0 }, 2).ok).toBe(false);
    expect(parseResultSubmission({ score_a: -1, score_b: 0 }, 2).ok).toBe(false);
    expect(parseResultSubmission({ score_a: 2.5, score_b: 0 }, 2).ok).toBe(false);
    expect(parseResultSubmission({ score_a: 3 }, 2).ok).toBe(false);
    expect(parseResultSubmission({ score_a: 3, score_b: 1, winning_team: "B" }, 2).ok).toBe(false);
    expect(parseResultSubmission({ score_a: 3, score_b: 1, outcome: "draw" }, 2).ok).toBe(false);
    expect(parseResultSubmission({ score_a: 3, score_b: 1 }, 3).ok).toBe(false);
    expect(parseResultSubmission({ outcome: "draw" }, 3).ok).toBe(false);
    expect(parseResultSubmission({ winning_team: "C" }, 2).ok).toBe(false);
    expect(parseResultSubmission({}, 2).ok).toBe(false);
  });

  it("reads outcomes and score lines from the player's side", () => {
    const r = { winning_team: "A", score_a: 5, score_b: 3 };
    expect([outcomeForTeam("A", r), scoreLineForTeam("A", r)]).toEqual(["W", "5\u20133"]);
    expect([outcomeForTeam("B", r), scoreLineForTeam("B", r)]).toEqual(["L", "3\u20135"]);
    expect(outcomeForTeam("A", { winning_team: null })).toBe("D");
    expect(outcomeForTeam("A", { winning_team: null, score_a: 1, score_b: 1 })).toBe("D");
    expect(outcomeForTeam(null, r)).toBeNull();
    expect(resultSummary(r)).toBe("Team A won 5\u20133.");
    expect(resultSummary({ winning_team: null })).toBe("It ended in a draw.");
  });

  it("lets the host edit for 24 hours and admins anytime", () => {
    const now = Date.now();
    const at = (ms: number) => new Date(now - ms).toISOString();
    expect(canEditResult({ isAdmin: false, isHost: true, postedAt: at(23 * HOUR), now }).ok).toBe(true);
    expect(canEditResult({ isAdmin: false, isHost: true, postedAt: at(25 * HOUR), now }).ok).toBe(false);
    expect(canEditResult({ isAdmin: true, isHost: false, postedAt: at(400 * HOUR), now })).toEqual({ ok: true, role: "admin" });
    expect(canEditResult({ isAdmin: false, isHost: false, postedAt: at(HOUR), now }).ok).toBe(false);
  });

  it("builds the mobile form body without a separate winner when scored", () => {
    expect(resultFormBody({ tracked: true, scoreA: "5", scoreB: "3", pick: "B" }, true)).toEqual({
      ok: true,
      body: { score_a: 5, score_b: 3 },
    });
    expect(resultFormBody({ tracked: false, scoreA: "", scoreB: "", pick: "draw" }, true)).toEqual({
      ok: true,
      body: { outcome: "draw" },
    });
    expect(resultFormBody({ tracked: true, scoreA: "40", scoreB: "1", pick: null }, true).ok).toBe(false);
    expect(resultFormFromStored({ winning_team: null })).toMatchObject({ tracked: false, pick: "draw" });
  });

  it("formats the season record as W–D–L only with draws", () => {
    expect(recordLine(2, 1, 1)).toBe("2\u20131\u20131");
    expect(recordLine(3, 1, 2)).toBe("3\u20132\u20131");
    expect(recordLine(2, 1)).toBe("2\u20131");
    expect(recordCaption(1)).toBe("Wins \u00b7 Draws \u00b7 Losses");
    expect(recordCaption(0)).toBe("Wins \u00b7 Losses");
    expect(outcomeFor("A", { winning_team: null })).toBe("D");
  });
});

describe("POST /api/sessions/result", () => {
  it("records a score win and derives the winner", async () => {
    const res = await post(HOST, { score_a: 5, score_b: 3 });
    expect(res.status).toBe(200);
    expect(result()).toMatchObject({ winning_team: "A", score_a: 5, score_b: 3 });
    expect(counters(A1)).toEqual([1, 0]);
    expect(counters(B1)).toEqual([0, 1]);
    expect(h.pushes.find((p) => p.title === "Session results are in!")?.body).toContain("Team A won 5\u20133.");
  });

  it("records a score draw as neither a win nor a loss", async () => {
    expect((await post(HOST, { score_a: 2, score_b: 2 })).status).toBe(200);
    expect(result()).toMatchObject({ winning_team: null, score_a: 2, score_b: 2 });
    for (const id of PLAYERS) expect(counters(id)).toEqual([0, 0]);
  });

  it("records a winner without a score", async () => {
    expect((await post(HOST, { winning_team: "B" })).status).toBe(200);
    expect(result()).toMatchObject({ winning_team: "B", score_a: null, score_b: null });
    expect(counters(B2)).toEqual([1, 0]);
  });

  it("records a draw without a score", async () => {
    expect((await post(HOST, { outcome: "draw" })).status).toBe(200);
    expect(result()).toMatchObject({ winning_team: null, score_a: null, score_b: null });
    for (const id of PLAYERS) expect(counters(id)).toEqual([0, 0]);
  });

  it("rejects out-of-range scores", async () => {
    const res = await post(HOST, { score_a: 31, score_b: 2 });
    expect(res.status).toBe(400);
    expect(result()).toBeNull();
  });

  it("lets the host edit within 24 hours, moving counters and logging the edit", async () => {
    await post(HOST, { score_a: 5, score_b: 3 });
    ageResult(23 * HOUR);
    const res = await post(HOST, { score_a: 3, score_b: 3, score_only: true });
    expect(res.status).toBe(200);
    expect(result()).toMatchObject({ winning_team: null, score_a: 3, score_b: 3 });
    expect(counters(A1)).toEqual([0, 0]);
    expect(counters(B1)).toEqual([0, 0]);
    expect(edits()).toHaveLength(1);
    expect(edits()[0]).toMatchObject({
      run_id: RUN,
      edited_by: HOST,
      editor_role: "host",
      old_values: { winning_team: "A", score_a: 5, score_b: 3 },
      new_values: { winning_team: null, score_a: 3, score_b: 3 },
    });
    expect(h.pushes.filter((p) => p.title === "Session results are in!")).toHaveLength(1);
  });

  it("rejects a host edit after 24 hours and leaves the result alone", async () => {
    await post(HOST, { score_a: 5, score_b: 3 });
    ageResult(25 * HOUR);
    const res = await post(HOST, { score_a: 0, score_b: 4, score_only: true });
    expect(res.status).toBe(403);
    expect(result()).toMatchObject({ winning_team: "A", score_a: 5 });
    expect(edits()).toHaveLength(0);
  });

  it("lets an admin edit after 24 hours", async () => {
    await post(HOST, { score_a: 5, score_b: 3 });
    ageResult(30 * 24 * HOUR);
    expect((await post(ADMIN, { score_a: 0, score_b: 4, score_only: true })).status).toBe(200);
    expect(result()).toMatchObject({ winning_team: "B", score_a: 0, score_b: 4 });
    expect(edits()[0]).toMatchObject({ editor_role: "admin", edited_by: ADMIN });
    expect(counters(B1)).toEqual([1, 0]);
    expect(counters(A1)).toEqual([0, 1]);
  });

  it("never settles ratings when posting or editing a result", async () => {
    await post(HOST, { score_a: 5, score_b: 3 });
    await post(HOST, { outcome: "draw", score_only: true });
    expect(h.db.rpcCalls.filter((c) => c.name !== "points_replace_run")).toEqual([]);
  });

  it("rejects scores and draws gracefully before the migration runs", async () => {
    h.db.missingColumns.pickup_run_results = ["score_a", "score_b"];
    h.db.notNull.pickup_run_results = ["winning_team"];
    const scored = await post(HOST, { score_a: 5, score_b: 3 });
    expect(scored.status).toBe(409);
    expect(await scored.json()).toMatchObject({ code: "scores_unavailable" });
    const drawn = await post(HOST, { outcome: "draw" });
    expect(drawn.status).toBe(409);
    expect(await drawn.json()).toMatchObject({ code: "draws_unavailable" });
    expect(result()).toBeNull();
    expect((await post(HOST, { winning_team: "A" })).status).toBe(200);
    expect(result()).toMatchObject({ winning_team: "A" });
  });

  it("still saves an edit when the edit log table is missing", async () => {
    h.db.missingTables.add("pickup_run_result_edits");
    await post(HOST, { winning_team: "A" });
    expect((await post(HOST, { winning_team: "B", score_only: true })).status).toBe(200);
    expect(result()).toMatchObject({ winning_team: "B" });
  });
});

describe("POST /api/admin/pickup/result", () => {
  it("records a score and logs admin edits anytime", async () => {
    expect((await adminPost({ score_a: 4, score_b: 1 })).status).toBe(200);
    expect(result()).toMatchObject({ winning_team: "A", score_a: 4, score_b: 1 });
    ageResult(90 * 24 * HOUR);
    expect((await adminPost({ outcome: "draw" })).status).toBe(200);
    expect(result()).toMatchObject({ winning_team: null, score_a: null, score_b: null });
    expect(edits()).toHaveLength(1);
    expect(edits()[0]).toMatchObject({ editor_role: "admin", old_values: { winning_team: "A", score_a: 4 } });
    for (const id of PLAYERS) expect(counters(id)).toEqual([0, 0]);
  });
});

describe("settle_session with a draw", () => {
  it("settles the tier session without reading the result", async () => {
    const TS = "22222222-2222-4222-8222-222222222222";
    h.db.rows("tier_sessions").push({ id: TS, state: "open" });
    for (const id of PLAYERS) h.db.rows("session_attendance").push({ session_id: TS, user_id: id, status: "attended", organizer_score: null });
    h.db.rows("pickup_run_results").push({ run_id: RUN, winning_team: null, score_a: 2, score_b: 2 });
    h.db.rpcHandler = (name) => (name === "settle_session" ? { data: 4, error: null } : { data: null, error: null });

    const out = await autoSettleTierSession(h.db as never, TS);

    expect(out).toEqual({ settled: true, rows: 4 });
    expect(h.db.rpcCalls).toEqual([{ name: "settle_session", args: { p_session_id: TS } }]);
    expect(h.db.queries.some((q) => q.table === "pickup_run_results")).toBe(false);
    expect(h.db.rows("session_attendance").every((a) => a.organizer_score === 5)).toBe(true);
  });
});
