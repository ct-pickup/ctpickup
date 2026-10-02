import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeMatchDb } from "./fakeDb";

const h = vi.hoisted(() => ({
  db: null as unknown as import("./fakeDb").FakeMatchDb,
  pushes: [] as { userIds: string[]; title: string }[],
}));

vi.mock("@/lib/server/runtimeClients", () => ({
  getSupabaseAdmin: () => h.db,
}));
vi.mock("@/lib/push/sendExpoPush", () => ({
  sendPushToUsers: async (_admin: unknown, userIds: string[], msg: { title: string }) => {
    h.pushes.push({ userIds, title: msg.title });
    return { tokens: 1, batches: [] };
  },
}));

import { GET as bestGamesGET } from "@/app/api/match/best-games/route";
import { GET as fillGET } from "@/app/api/match/fill-candidates/route";
import { POST as invitePOST } from "@/app/api/match/invite/route";
import { GET as playedWithGET } from "@/app/api/match/played-with/route";
import { createInviteToken } from "@/lib/match/inviteToken";

process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-key";

const HOUR = 60 * 60 * 1000;
const HOST = "host-1";
const RUN = "run-1";
const HARTFORD = { latitude: 41.7637, longitude: -72.6851 };

const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

function get(path: string, userId: string | null) {
  return new Request(`http://test.local${path}`, {
    headers: userId ? { authorization: `Bearer ${userId}` } : {},
  });
}

function post(userId: string | null, body: Record<string, unknown>) {
  return new Request("http://test.local/api/match/invite", {
    method: "POST",
    headers: { ...(userId ? { authorization: `Bearer ${userId}` } : {}), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const fill = (userId: string | null, runId = RUN) => fillGET(get(`/api/match/fill-candidates?run_id=${runId}`, userId));

function seedProfile(id: string, overrides: Record<string, unknown> = {}) {
  h.db.rows("profiles").push({
    id,
    first_name: id.charAt(0).toUpperCase() + id.slice(1),
    last_name: "Lastname",
    avatar_url: null,
    zip_code: "06106",
    max_drive_minutes: 50,
    approved: true,
    playing_position: "Defender",
    primary_position: "CB",
    secondary_positions: [],
    allow_host_invites: true,
    is_admin: false,
    phone: "+18605550100",
    email: `${id}@example.com`,
    tier_rank: 3,
    ...overrides,
  });
}

function seedRating(userId: string, tier: string, star: number | null = null) {
  h.db.rows("player_ratings").push({ user_id: userId, tier, star_rating: star, score: 72, reliability: 90 });
}

function seedRsvp(runId: string, userId: string, status: string) {
  h.db.rows("pickup_run_rsvps").push({ run_id: runId, user_id: userId, status });
}

function seedRun(overrides: Record<string, unknown> = {}) {
  h.db.rows("pickup_runs").push({
    id: RUN,
    title: "Tuesday 7v7",
    start_at: iso(48 * HOUR),
    status: "planning",
    run_type: "public",
    capacity: 14,
    spots_taken: 1,
    fee_cents: 800,
    format: "7v7",
    location_text: "Colt Park, Hartford",
    created_by: HOST,
    location_private: null,
    venue_zip_code: null,
    service_region: "CT",
    tier_session_id: null,
    min_star: null,
    ...HARTFORD,
    ...overrides,
  });
}

beforeEach(() => {
  h.db = new FakeMatchDb();
  h.pushes = [];
  seedProfile(HOST);
  seedRating(HOST, "gold");
  h.db.rows("pickup_runs").push({ id: "old-run", created_by: HOST, status: "completed", start_at: iso(-30 * 24 * HOUR) });
  seedRun();
  seedProfile("goer");
  seedRating("goer", "gold");
  seedRsvp(RUN, "goer", "confirmed");
  for (const id of ["alex", "blair", "casey"]) {
    seedProfile(id);
    seedRating(id, "gold");
  }
});

const ALLOWED_CANDIDATE_KEYS = ["first_name", "invite_token", "invited", "last_initial", "position", "stars", "town"].sort();

describe("auth", () => {
  it("rejects unauthenticated requests on every route", async () => {
    expect((await fill(null)).status).toBe(401);
    expect((await bestGamesGET(get("/api/match/best-games", null))).status).toBe(401);
    expect((await playedWithGET(get(`/api/match/played-with?run_ids=${RUN}`, null))).status).toBe(401);
    expect((await invitePOST(post(null, { run_id: RUN, invite_token: "x" }))).status).toBe(401);
  });
});

describe("fill-candidates access", () => {
  it("rejects a non-host for someone else's run without player data", async () => {
    seedProfile("intruder");
    h.db.rows("pickup_runs").push({ id: "own-old", created_by: "intruder", status: "completed", start_at: iso(-HOUR * 100) });
    const res = await fill("intruder");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.candidates).toBeUndefined();
  });

  it("rejects a canceled run", async () => {
    h.db.rows("pickup_runs").find((r) => r.id === RUN)!.status = "canceled";
    const res = await fill(HOST);
    expect(res.status).toBe(409);
    expect((await res.json()).candidates).toBeUndefined();
  });

  it("rejects the cancelled spelling and completed runs too", async () => {
    const run = h.db.rows("pickup_runs").find((r) => r.id === RUN)!;
    run.status = "cancelled";
    expect((await fill(HOST)).status).toBe(409);
    run.status = "completed";
    expect((await fill(HOST)).status).toBe(409);
  });

  it("rejects a run in the past", async () => {
    h.db.rows("pickup_runs").find((r) => r.id === RUN)!.start_at = iso(-HOUR);
    expect((await fill(HOST)).status).toBe(409);
  });

  it("rejects a full run", async () => {
    const run = h.db.rows("pickup_runs").find((r) => r.id === RUN)!;
    run.capacity = 2;
    run.spots_taken = 0;
    seedRsvp(RUN, "alex", "pending_payment");
    const res = await fill(HOST);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("This game is full.");
  });

  it("rejects a new host with no completed hosted game", async () => {
    h.db.tables.pickup_runs = h.db.rows("pickup_runs").filter((r) => r.id !== "old-run");
    const res = await fill(HOST);
    expect(res.status).toBe(403);
    expect((await res.json()).candidates).toBeUndefined();
  });

  it("lets an admin through without hosting history", async () => {
    seedProfile("staff", { is_admin: true, zip_code: null });
    const res = await fill("staff");
    expect(res.status).toBe(200);
  });
});

describe("fill-candidates rate limit", () => {
  it("rejects the 31st request in an hour", async () => {
    for (let i = 0; i < 30; i++) expect((await fill(HOST)).status).toBe(200);
    const res = await fill(HOST);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("1200");
  });

  it("fails closed when the rate limit store is unavailable", async () => {
    h.db.rpcFails = true;
    const res = await fill(HOST);
    expect(res.status).toBe(503);
    expect((await res.json()).candidates).toBeUndefined();
  });
});

describe("fill-candidates results", () => {
  it("returns only allowed fields and no ids, contact details, ZIP or score", async () => {
    const res = await fill(HOST);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.candidates.length).toBe(3);
    for (const c of body.candidates) expect(Object.keys(c).sort()).toEqual(ALLOWED_CANDIDATE_KEYS);
    const text = JSON.stringify(body);
    for (const forbidden of ["alex", "blair", "casey", "06106", "+1860", "example.com", "score", "reliability", "latitude", "zip"]) {
      expect(text).not.toContain(forbidden);
    }
    expect(body.candidates[0]).toMatchObject({ last_initial: "L", position: "CB", town: "Hartford", stars: null, invited: false });
  });

  it("never exceeds 10 players", async () => {
    for (let i = 0; i < 15; i++) {
      seedProfile(`extra${i}`);
      seedRating(`extra${i}`, "gold");
    }
    const body = await (await fill(HOST)).json();
    expect(body.candidates.length).toBe(10);
  });

  it("excludes the host, attendees, decliners and players who turned invites off", async () => {
    seedRsvp(RUN, "alex", "declined");
    seedRsvp(RUN, "blair", "waitlist");
    h.db.rows("profiles").find((p) => p.id === "casey")!.allow_host_invites = false;
    seedProfile("dana");
    seedRating("dana", "gold");
    seedRsvp(RUN, "dana", "canceled");
    const body = await (await fill(HOST)).json();
    expect(body.candidates.map((c: { first_name: string }) => c.first_name)).toEqual(["Dana"]);
  });

  it("treats a missing allow_host_invites column as on", async () => {
    h.db.missingColumns.profiles = ["allow_host_invites"];
    h.db.rows("profiles").find((p) => p.id === "casey")!.allow_host_invites = false;
    const body = await (await fill(HOST)).json();
    expect(body.candidates.length).toBe(3);
  });

  it("filters below the level floor using tier when star_rating is missing", async () => {
    h.db.missingColumns.player_ratings = ["star_rating"];
    h.db.rows("player_ratings").find((r) => r.user_id === "alex")!.tier = "bronze";
    const body = await (await fill(HOST)).json();
    expect(body.candidates.length).toBe(2);
    expect(body.candidates.every((c: { stars: number | null }) => c.stars === null)).toBe(true);
  });

  it("uses min_star as the floor and shows real stars when present", async () => {
    h.db.rows("pickup_runs").find((r) => r.id === RUN)!.min_star = 3.5;
    h.db.rows("player_ratings").find((r) => r.user_id === "alex")!.star_rating = 4;
    const body = await (await fill(HOST)).json();
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0]).toMatchObject({ first_name: "Alex", stars: 4 });
  });

  it("excludes players beyond their own max drive", async () => {
    h.db.rows("profiles").find((p) => p.id === "alex")!.zip_code = "06830";
    h.db.rows("profiles").find((p) => p.id === "alex")!.max_drive_minutes = 30;
    const body = await (await fill(HOST)).json();
    expect(body.candidates.map((c: { first_name: string }) => c.first_name).sort()).toEqual(["Blair", "Casey"]);
  });
});

describe("invite", () => {
  const token = (userId: string, runId = RUN) => createInviteToken(runId, userId);

  it("sends the run invite push, records it and is idempotent", async () => {
    const first = await invitePOST(post(HOST, { run_id: RUN, invite_token: token("alex") }));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ok: true, already_invited: false, invites_sent: 1, invite_limit: 20 });
    expect(h.pushes).toEqual([{ userIds: ["alex"], title: expect.any(String) }]);
    expect(h.db.rows("pickup_run_invites")).toHaveLength(1);
    expect(h.db.rows("pickup_run_host_invites")).toMatchObject([{ run_id: RUN, invitee_id: "alex", inviter_id: HOST }]);

    const again = await invitePOST(post(HOST, { run_id: RUN, invite_token: token("alex") }));
    expect(await again.json()).toMatchObject({ ok: true, already_invited: true });
    expect(h.pushes).toHaveLength(1);
  });

  it("shows invited state in the candidate list", async () => {
    await invitePOST(post(HOST, { run_id: RUN, invite_token: token("alex") }));
    const body = await (await fill(HOST)).json();
    expect(body.invites_sent).toBe(1);
    expect(body.candidates.filter((c: { invited: boolean }) => c.invited)).toHaveLength(1);
  });

  it("caps invites at 20 per game across inviters", async () => {
    for (let i = 0; i < 20; i++) h.db.rows("pickup_run_host_invites").push({ run_id: RUN, invitee_id: `p${i}`, inviter_id: "staff" });
    const res = await invitePOST(post(HOST, { run_id: RUN, invite_token: token("alex") }));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ limit_reached: true });
    expect(h.pushes).toHaveLength(0);
  });

  it("rejects players who declined, are already in, or turned invites off", async () => {
    seedRsvp(RUN, "alex", "declined");
    seedRsvp(RUN, "blair", "confirmed");
    h.db.rows("profiles").find((p) => p.id === "casey")!.allow_host_invites = false;
    for (const id of ["alex", "blair", "casey"]) {
      expect((await invitePOST(post(HOST, { run_id: RUN, invite_token: token(id) }))).status).toBe(409);
    }
    expect(h.pushes).toHaveLength(0);
  });

  it("rejects a token issued for another run and non-hosts", async () => {
    expect((await invitePOST(post(HOST, { run_id: RUN, invite_token: token("alex", "other-run") }))).status).toBe(400);
    expect((await invitePOST(post(HOST, { run_id: RUN, invite_token: "garbage" }))).status).toBe(400);
    expect((await invitePOST(post("blair", { run_id: RUN, invite_token: token("alex") }))).status).toBe(403);
  });

  it("applies the same run-state checks", async () => {
    h.db.rows("pickup_runs").find((r) => r.id === RUN)!.status = "canceled";
    expect((await invitePOST(post(HOST, { run_id: RUN, invite_token: token("alex") }))).status).toBe(409);
  });

  it("returns 503 before the host invites table exists", async () => {
    h.db.missingTables.add("pickup_run_host_invites");
    const res = await invitePOST(post(HOST, { run_id: RUN, invite_token: token("alex") }));
    expect(res.status).toBe(503);
    expect(h.pushes).toHaveLength(0);
    const list = await (await fill(HOST)).json();
    expect(list.invites_available).toBe(false);
  });
});

describe("best-games and played-with", () => {
  function seedHistory() {
    h.db.rows("pickup_runs").push({ id: "past", tier_session_id: "ts-1", status: "completed", start_at: iso(-7 * 24 * HOUR) });
    for (const id of ["alex", "goer"]) h.db.rows("session_attendance").push({ session_id: "ts-1", user_id: id, status: "attended" });
  }

  it("returns cards with reasons and no score or player ids", async () => {
    seedHistory();
    const res = await bestGamesGET(get("/api/match/best-games", "alex"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.games).toHaveLength(1);
    const g = body.games[0];
    expect(g.id).toBe(RUN);
    expect(g.reasons.length).toBeGreaterThan(0);
    expect(g.reasons.length).toBeLessThanOrEqual(2);
    expect(g.played_with).toEqual({ count: 1, people: [{ first_name: "Goer", avatar_url: null }] });
    const text = JSON.stringify(body);
    for (const forbidden of ["score", "goer\"", "host-1", "06106", "created_by", "min_star", "location_private"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("skips games the player joined or declined, full games and their own games", async () => {
    seedRsvp(RUN, "alex", "declined");
    expect((await (await bestGamesGET(get("/api/match/best-games", "alex"))).json()).games).toHaveLength(0);
    expect((await (await bestGamesGET(get("/api/match/best-games", HOST))).json()).games).toHaveLength(0);
    h.db.rows("pickup_runs").find((r) => r.id === RUN)!.spots_taken = 14;
    expect((await (await bestGamesGET(get("/api/match/best-games", "blair"))).json()).games).toHaveLength(0);
  });

  it("summarizes played-with players going per run", async () => {
    seedHistory();
    const res = await playedWithGET(get(`/api/match/played-with?run_ids=${RUN},nope`, "alex"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ runs: { [RUN]: { count: 1, people: [{ first_name: "Goer", avatar_url: null }] } } });
    const none = await playedWithGET(get(`/api/match/played-with?run_ids=${RUN}`, "blair"));
    expect(await none.json()).toEqual({ runs: {} });
  });
});
