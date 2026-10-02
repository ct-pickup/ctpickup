import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeResultsDb } from "./fakeResultsDb";

const h = vi.hoisted(() => ({
  db: null as unknown as import("./fakeResultsDb").FakeResultsDb,
}));

vi.mock("@/lib/server/runtimeClients", () => ({ getSupabaseAdmin: () => h.db }));
vi.mock("@/lib/supabase/service", () => ({ supabaseService: () => h.db }));
vi.mock("@/lib/push/sendExpoPush", () => ({ sendPushToUsers: async () => ({ tokens: 0, batches: [] }) }));

import type { SupabaseClient } from "@supabase/supabase-js";
import { POST as sessionResultPOST } from "@/app/api/sessions/result/route";
import { autoSettleTierSession } from "@/lib/pickup/autoSettleSession";

const RUN = "11111111-1111-4111-8111-111111111111";
const TS = "22222222-2222-4222-8222-222222222222";
const HOST = "host-1";
const RATED = "aaaaaaaa-0000-4000-8000-000000000001";
const NEWBIE = "aaaaaaaa-0000-4000-8000-000000000002";
const B1 = "bbbbbbbb-0000-4000-8000-000000000001";
const B2 = "bbbbbbbb-0000-4000-8000-000000000002";
const PLAYERS = [RATED, NEWBIE, B1, B2];

const rating = (id: string) => h.db.rows("player_ratings").find((r) => r.user_id === id);
const attended = (id: string) => h.db.rows("profiles").find((r) => r.id === id)!.attended_count;

function post(body: Record<string, unknown>) {
  return sessionResultPOST(
    new Request("http://test.local/api/sessions/result", {
      method: "POST",
      headers: { authorization: `Bearer ${HOST}`, "content-type": "application/json" },
      body: JSON.stringify({ run_id: RUN, ...body }),
    }),
  );
}

/** Mirrors settle_session's write: +1 sessions per rated attendee with a player_ratings row, once. */
function installSettle() {
  h.db.rpcHandler = (name, args) => {
    if (name !== "settle_session") return { data: null, error: null };
    const s = h.db.rows("tier_sessions").find((r) => r.id === args.p_session_id)!;
    if (s.state === "settled") return { data: 0, error: null };
    let n = 0;
    for (const a of h.db.rows("session_attendance").filter((r) => r.session_id === s.id && r.status === "attended")) {
      const pr = rating(a.user_id as string);
      if (!pr) continue;
      h.db.rows("rating_events").push({ session_id: s.id, user_id: a.user_id });
      pr.sessions = Number(pr.sessions ?? 0) + 1;
      n += 1;
    }
    s.state = "settled";
    return { data: n, error: null };
  };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  h.db = new FakeResultsDb();
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-key";
  h.db.rows("pickup_runs").push({ id: RUN, created_by: HOST, title: "Run", status: "in_progress" });
  h.db.rows("profiles").push({ id: HOST, is_admin: false });
  for (const id of PLAYERS) {
    h.db.rows("profiles").push({ id, is_admin: false, pickup_wins_count: 0, pickup_losses_count: 0, attended_count: 2 });
    h.db.rows("pickup_run_rsvps").push({ run_id: RUN, user_id: id, status: "confirmed" });
    h.db.rows("pickup_run_team_assignments").push({ run_id: RUN, user_id: id, team: id.startsWith("a") ? "A" : "B" });
  }
  for (const id of [RATED, B1, B2]) {
    h.db.rows("player_ratings").push({ user_id: id, sessions: 3, score: 60, star_provisional: true });
  }
});

describe("player_ratings.sessions is counted once per game", () => {
  it("posting a result no longer touches sessions; it still bumps attended_count and creates a missing ratings row", async () => {
    expect((await post({ score_a: 4, score_b: 2 })).status).toBe(200);
    expect(rating(RATED)!.sessions).toBe(3);
    expect(rating(B1)!.sessions).toBe(3);
    expect(rating(NEWBIE)).toBeDefined();
    expect(rating(NEWBIE)!.sessions ?? 0).toBe(0);
    for (const id of PLAYERS) expect(attended(id)).toBe(3);
    expect(rating(RATED)!.star_provisional).toBe(true);
    expect(h.db.queries.some((q) => q.table === "rating_events")).toBe(false);
    expect(h.db.queries.some((q) => q.table === "player_ratings" && q.op === "update")).toBe(false);
  });

  it("editing the result never bumps anything", async () => {
    await post({ score_a: 4, score_b: 2 });
    expect((await post({ score_a: 3, score_b: 3, score_only: true })).status).toBe(200);
    expect(rating(RATED)!.sessions).toBe(3);
    expect(attended(RATED)).toBe(3);
  });

  it("result + settle adds exactly one session per rated player (was two)", async () => {
    installSettle();
    h.db.rows("tier_sessions").push({ id: TS, state: "open" });
    for (const id of PLAYERS) h.db.rows("session_attendance").push({ session_id: TS, user_id: id, status: "attended", organizer_score: 7 });

    await post({ score_a: 4, score_b: 2 });
    await autoSettleTierSession(h.db as unknown as SupabaseClient, TS);
    await autoSettleTierSession(h.db as unknown as SupabaseClient, TS);

    expect(rating(RATED)!.sessions).toBe(4);
    expect(rating(B1)!.sessions).toBe(4);
    expect(rating(NEWBIE)!.sessions).toBe(1);
    for (const id of PLAYERS) {
      const events = h.db.rows("rating_events").filter((e) => e.user_id === id).length;
      expect(Number(rating(id)!.sessions) - (id === NEWBIE ? 0 : 3)).toBe(events);
    }
  });
});
