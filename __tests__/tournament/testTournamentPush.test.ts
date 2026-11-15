import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeDb, type FakeDb } from "../helpers/fakeSupabase";

const h = vi.hoisted(() => ({ db: null as unknown, expo: [] as unknown[][], from: [] as string[] }));

vi.mock("@sentry/nextjs", () => ({ captureException: () => undefined }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/admin/sync/enqueueRevalidate", () => ({ enqueueRevalidateAndRun: async () => undefined }));
vi.mock("@/lib/admin/surfaceHealth", () => ({ recordTournamentActivationChange: async () => undefined }));
vi.mock("@/lib/admin/requireAdmin", () => ({ requireAdminBearer: async () => ({ ok: true, userId: "admin1" }) }));
vi.mock("@/lib/tournament/tournamentDriveProximity", () => ({ approvedUserIdsWithinTournamentDrive: async () => ["p1", "p2"] }));
vi.mock("@/lib/tournament/refundPaidCaptainsOnTournamentCancel", () => ({ refundPaidCaptainsOnTournamentCancel: async () => ({ ok: true }) }));
vi.mock("@/lib/push/approvedUserIds", () => ({ fetchApprovedUserIds: async () => ({ ids: ["p1", "p2"] }) }));
vi.mock("@/lib/admin/publishLayer", () => ({ isPublishLayerAvailable: async () => false }));
vi.mock("@/lib/admin/publish/executePublication", () => ({ executePublication: async () => ({}) }));
vi.mock("@/lib/pickup/autoRunCheckpoints", () => ({ processAutoPickupRun: async () => ({}) }));
vi.mock("@/lib/pickup/hubPromote", () => ({ promotePickupRunToHub: async () => ({}) }));
vi.mock("@/lib/waiver/checkWaiverAccepted", () => ({ userHasAcceptedCurrentWaiver: async () => true }));
vi.mock("@/lib/server/runtimeClients", async () => {
  const { fakeClient } = await import("../helpers/fakeSupabase");
  const admin = () => {
    const c = fakeClient(h.db as never);
    return {
      ...c,
      from: (t: string) => {
        h.from.push(t);
        return c.from(t);
      },
      auth: { getUser: async () => ({ data: { user: { id: "admin1" } }, error: null }) },
    };
  };
  return {
    getSupabaseAdmin: admin,
    getSupabaseAnon: () => ({ auth: { getUser: async () => ({ data: { user: { id: "claimant" } }, error: null }) } }),
  };
});

import { POST as operatorPost } from "../../app/api/admin/operator/route";
import { POST as bracketPost } from "../../app/api/admin/tournaments/bracket/route";
import { POST as tournamentsPost } from "../../app/api/admin/tournaments/route";
import { GET as remindersGet } from "../../app/api/cron/tournament-reminders/route";
import { POST as claimPost } from "../../app/api/tournament/captain/submit-claim/route";
import { sendMarketingPushToUsers, sendPushToAll, sendPushToUsers } from "../../lib/push/sendExpoPush";
import { isTestTournamentSlug, pushIsForTestTournament } from "../../lib/tournament/testTournament";

const TEST_SLUG = "test-bracket-demo";
const REAL_SLUG = "spring-classic";
const TID = "T1";

/** Every tournament push kind in the app. A new one must be added here, and the scan at the bottom enforces it. */
const TOURNAMENT_PUSH_KINDS = [
  "tournament_live",
  "tournament_canceled",
  "tournament_bracket_generated",
  "tournament_mvp_vote",
  "tournament_starts_soon",
  "tournament_captain_claim_admin",
  "tournament_roster_invite",
  "tournament_roster_response",
  "tournament_join_request",
  "tournament_join_decision",
  "tournament_captain_payment_confirmed",
];

const token = (id: string) => `ExponentPushToken[dev-${id}]`;
const devices = (ids: string[]) =>
  ids.map((id) => ({ user_id: id, expo_push_token: token(id), push_notifications_enabled: true, installation_context: "standalone" }));
const sentCount = () => h.expo.reduce((n, batch) => n + batch.length, 0);
const post = (url: string, body: unknown, auth = "Bearer admin") =>
  new Request(`https://site.test${url}`, { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  h.expo = [];
  h.from = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      const messages = JSON.parse(init.body) as unknown[];
      h.expo.push(messages);
      return new Response(JSON.stringify({ data: messages.map(() => ({ status: "ok" })) }), { status: 200 });
    }),
  );
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function adminDb(slug: string, extra: Record<string, unknown[]> = {}): FakeDb {
  return makeDb({
    profiles: [{ id: "admin1", is_admin: true, approved: true }, { id: "claimant", is_admin: false, approved: true }],
    tournaments: [{ id: TID, slug, title: "T", is_active: true, canceled_at: null, service_region: null, venue: "V", min_roster_players: 1, max_teams: 12, start_at: "2099-01-01T00:00:00Z" }],
    user_push_devices: devices(["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8", "p1", "p2", "admin1"]),
    ...extra,
  });
}

function eightTeams() {
  return Array.from({ length: 8 }, (_, i) => ({ id: `c${i + 1}`, tournament_id: TID, status: "confirmed", team_name: `Team ${i + 1}`, captain_name: "x", user_id: `u${i + 1}` }));
}

describe("which slugs count as a test tournament", () => {
  it("only a slug that starts with test-", () => {
    expect(isTestTournamentSlug("test-bracket-demo")).toBe(true);
    expect(isTestTournamentSlug("TEST-Bracket")).toBe(true);
    expect(isTestTournamentSlug("  test-x ")).toBe(true);
    for (const no of ["spring-classic", "testing-x", "my-test-1", "test", "test_x", "", null, undefined, 7]) expect(isTestTournamentSlug(no)).toBe(false);
  });
});

describe("the push sender holds back every tournament push kind for a test tournament", () => {
  it.each(TOURNAMENT_PUSH_KINDS)("%s: nothing is sent, and no player or device is even looked up", async (kind) => {
    h.db = adminDb(TEST_SLUG);
    const admin = (await import("../../lib/server/runtimeClients")).getSupabaseAdmin() as unknown as SupabaseClient;
    const res = await sendPushToUsers(admin, ["u1", "u2"], { title: "t", body: "b", data: { kind, tournament_id: TID } });
    expect(res).toEqual({ tokens: 0, batches: [], skipped: "test_tournament" });
    expect(sentCount()).toBe(0);
    expect(h.from).toEqual(["tournaments"]);
  });

  it.each(TOURNAMENT_PUSH_KINDS)("%s: the same push for a real tournament still goes out", async (kind) => {
    h.db = adminDb(REAL_SLUG);
    const admin = (await import("../../lib/server/runtimeClients")).getSupabaseAdmin() as unknown as SupabaseClient;
    const res = await sendPushToUsers(admin, ["u1", "u2"], { title: "t", body: "b", data: { kind, tournament_id: TID } });
    expect(res.skipped).toBeUndefined();
    expect(res.tokens).toBe(2);
    expect(sentCount()).toBe(2);
  });

  it("the broadcast and marketing senders hold it back too", async () => {
    h.db = adminDb(TEST_SLUG);
    const admin = (await import("../../lib/server/runtimeClients")).getSupabaseAdmin() as unknown as SupabaseClient;
    const payload = { title: "t", body: "b", data: { kind: "tournament_live", tournament_id: TID } };
    expect(await sendPushToAll(admin, payload)).toMatchObject({ skipped: "test_tournament" });
    expect(await sendMarketingPushToUsers(admin, ["u1"], payload)).toMatchObject({ skipped: "test_tournament" });
    expect(sentCount()).toBe(0);
  });

  it("a push that names no tournament, or an unknown one, is not held back", async () => {
    h.db = adminDb(TEST_SLUG);
    const admin = (await import("../../lib/server/runtimeClients")).getSupabaseAdmin() as unknown as SupabaseClient;
    await sendPushToUsers(admin, ["u1"], { title: "t", body: "b", data: { kind: "pickup_invite" } });
    await sendPushToUsers(admin, ["u2"], { title: "t", body: "b", data: { kind: "tournament_live", tournament_id: "no-such-tournament" } });
    expect(sentCount()).toBe(2);
  });

  it("if the check itself fails, the push still goes out", async () => {
    const db = adminDb(TEST_SLUG);
    db.failTables.tournaments = "connection reset";
    h.db = db;
    const admin = (await import("../../lib/server/runtimeClients")).getSupabaseAdmin() as unknown as SupabaseClient;
    expect(await pushIsForTestTournament(admin, { tournament_id: TID })).toBe(false);
    await sendPushToUsers(admin, ["u1"], { title: "t", body: "b", data: { kind: "tournament_live", tournament_id: TID } });
    expect(sentCount()).toBe(1);
  });
});

describe("every tournament push route sends nothing for a test tournament, and still sends for a real one", () => {
  async function bothWays(run: (slug: string) => Promise<Response>) {
    const test = await run(TEST_SLUG);
    expect(test.status, "test tournament").toBeLessThan(300);
    expect(sentCount(), "pushes for the test tournament").toBe(0);
    h.expo = [];
    const real = await run(REAL_SLUG);
    expect(real.status, "real tournament").toBeLessThan(300);
    expect(sentCount(), "pushes for the real tournament").toBeGreaterThan(0);
  }

  it("Bracket is live (Generate Groups)", async () => {
    await bothWays(async (slug) => {
      h.db = adminDb(slug, { tournament_captains: eightTeams(), tournament_roster: [] });
      return bracketPost(post("/api/admin/tournaments/bracket", { action: "generate", tournament_id: TID }));
    });
  });

  it("Vote for Match MVP (saving a score)", async () => {
    await bothWays(async (slug) => {
      h.db = adminDb(slug, {
        tournament_captains: eightTeams(),
        tournament_roster: [],
        tournament_matches: [{ id: "m1", tournament_id: TID, stage: "group", group_name: "A", match_number: 1, team_a_id: "c1", team_b_id: "c2", score_a: null, score_b: null, winner_id: null, is_bye: false, started_at: null, completed_at: null }],
      });
      return bracketPost(post("/api/admin/tournaments/bracket", { action: "log_score", tournament_id: TID, match_id: "m1", score_a: 2, score_b: 1 }));
    });
  });

  it("Tournament is live (Make live in the admin Tournaments list)", async () => {
    await bothWays(async (slug) => {
      h.db = adminDb(slug, { tournament_captains: [] });
      return tournamentsPost(post("/api/admin/tournaments", { action: "set_hub", tournament_id: TID }));
    });
  });

  it("Tournament is live (the operator route, which tells every approved player)", async () => {
    await bothWays(async (slug) => {
      h.db = adminDb(slug);
      return operatorPost(post("/api/admin/operator", { action: "set_hub_tournament", tournament_id: TID }));
    });
  });

  it("Tournament canceled", async () => {
    await bothWays(async (slug) => {
      h.db = adminDb(slug, { tournament_captains: eightTeams() });
      return tournamentsPost(post("/api/admin/tournaments", { action: "cancel_tournament", tournament_id: TID }));
    });
  });

  it("Tournament starts soon (the hourly reminder)", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    await bothWays(async (slug) => {
      const db = adminDb(slug, { tournament_captains: eightTeams(), tournament_roster: [] });
      db.tables.tournaments![0]!.start_at = new Date(Date.now() + 24 * 3_600_000).toISOString();
      db.tables.tournaments![0]!.start_reminder_sent_at = null;
      h.db = db;
      return remindersGet(new Request("https://site.test/api/cron/tournament-reminders", { headers: { authorization: "Bearer s3cret" } }));
    });
  });

  it("Captain claim submitted (the push to admins)", async () => {
    await bothWays(async (slug) => {
      h.db = adminDb(slug, { tournament_captains: [], tournament_roster_prelim: [] });
      return claimPost(
        post("/api/tournament/captain/submit-claim", { captainName: "Sam Test", captainInstagram: "sam_test", teamName: "Team Z", expectedPlayers: 5, prelimRoster: [] }, "Bearer player"),
      );
    });
  });
});

describe("no tournament push can slip past the guard", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (p.endsWith(".ts")) out.push(p);
    }
    return out;
  }
  const root = new URL("../../", import.meta.url).pathname;
  const files = [...walk(join(root, "app")), ...walk(join(root, "lib"))].filter((f) => !f.endsWith("lib/push/pushPolicy.ts") && !f.endsWith("lib/push/usePush.ts"));

  it("every kind: \"tournament_...\" a server file sends is in the list this test covers", () => {
    const found = new Set<string>();
    for (const f of files) {
      const s = readFileSync(f, "utf8");
      if (!/sendPushToUsers|sendMarketingPushToUsers|sendPushToAll/.test(s)) continue;
      for (const m of s.matchAll(/kind:\s*"(tournament_[a-z_]+)"/g)) found.add(m[1]!);
    }
    expect([...found].sort()).toEqual([...TOURNAMENT_PUSH_KINDS].sort());
  });

  it("every one of those pushes names its tournament, which is what the guard keys on", () => {
    const problems: string[] = [];
    for (const f of files) {
      const s = readFileSync(f, "utf8");
      for (const m of s.matchAll(/kind:\s*"(tournament_[a-z_]+)"/g)) {
        const near = s.slice(m.index!, m.index! + 400);
        // The data object holding the kind must carry tournament_id before it closes.
        const dataEnd = near.search(/\n\s*\},?\s*\n\s*\}\)|\}\s*,?\s*\}\)/);
        const window = dataEnd > 0 ? near.slice(0, dataEnd) : near;
        if (!/tournament_id/.test(window) && !/tournament_id/.test(s.slice(Math.max(0, m.index! - 120), m.index!))) problems.push(`${f.replace(root, "")}: ${m[1]}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("nothing outside the sender talks to Expo directly", () => {
    const direct = files.filter((f) => /exp\.host\/--\/api\/v2\/push/.test(readFileSync(f, "utf8")));
    expect(direct.map((f) => f.replace(root, ""))).toEqual(["lib/push/sendExpoPush.ts"]);
  });
});
