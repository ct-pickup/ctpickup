import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ratingWorld, NOW, HOUR, iso } from "../helpers/ratingWorld";
import type { FakeDb } from "../helpers/fakeSupabase";

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@sentry/nextjs", () => ({ captureException: () => undefined }));
vi.mock("@/lib/waiver/checkWaiverAccepted", () => ({ userHasAcceptedCurrentWaiver: async () => true }));
vi.mock("@/lib/push/sendExpoPush", () => ({ sendPushToUsers: async () => ({ tokens: 0, batches: [] }) }));
vi.mock("@/lib/profilePhoto/requirement", () => ({ profilePhotoGate: async () => null }));
vi.mock("@/lib/pickup/sessionLifecycle", () => ({
  promotePlanningRunsPastStart: async () => undefined,
  scheduleSessionRateRemindersForRun: async () => undefined,
}));
vi.mock("@/lib/pickup/pickupPushNotifications", () => ({
  approvedUserIdsInRunServiceRegion: async () => [],
  sendPickupRsvpConfirmedPush: async () => undefined,
  pickupFinalizeSlotPushRecipientIds: async () => [],
}));
vi.mock("@/lib/server/runtimeClients", async () => {
  const { fakeClient } = await import("../helpers/fakeSupabase");
  const admin = () => ({
    ...fakeClient(h.db as never),
    // The bearer token is the player's id, which keeps the tests readable.
    auth: { getUser: async (token: string) => ({ data: { user: { id: token } }, error: null }) },
  });
  return { getSupabaseAdmin: admin, getStripePickup: () => ({}) };
});
vi.mock("@/lib/ratings/ratingReminders", () => ({}));

import { POST as commitPost } from "../../app/api/pickup/commit/route";
import { POST as payPost } from "../../app/api/pickup/pay/route";
import { POST as rsvpPost } from "../../app/api/pickup/rsvp/route";
import { GET as pendingGet } from "../../app/api/sessions/pending-rating/route";
import { POST as createPost } from "../../app/api/sessions/create/route";

const req = (url: string, token: string, body?: unknown, method = "POST") =>
  new Request(`https://site.test${url}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

type Call = (token: string) => Promise<Response>;
const ROUTES: Record<string, { call: Call; ungated?: Call }> = {
  "RSVP join": {
    call: (t) => rsvpPost(req("/api/pickup/rsvp", t, { action: "join", run_id: "r2" })),
    ungated: (t) => rsvpPost(req("/api/pickup/rsvp", t, { action: "decline", run_id: "r2" })),
  },
  "commit (I'm available)": {
    call: (t) => commitPost(req("/api/pickup/commit", t, { run_id: "r2", state: "available", slot_label: "7 PM" })),
    ungated: (t) => commitPost(req("/api/pickup/commit", t, { run_id: "r2", state: "declined" })),
  },
  "create a game": {
    call: (t) => createPost(req("/api/sessions/create", t, { location_text: "Field 9", start_date: "2099-01-01", start_time: "19:00", capacity: 10 })),
  },
};

const setFlag = (db: FakeDb, v: { enabled?: boolean; allowlist?: string[] }) => {
  db.tables.app_flags = [{ key: "require_ratings", enabled: v.enabled ?? false, allowlist: v.allowlist ?? [] }];
};
const isRatingRequired = async (res: Response) => res.status === 409 && ((await res.clone().json().catch(() => ({}))) as { code?: string }).code === "rating_required";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  h.db = ratingWorld({ flag: { enabled: false, allowlist: ["p1"] } });
});

describe.each(Object.entries(ROUTES))("%s", (_name, route) => {
  it("answers 409 'Rate your last game first' with the pending game's id when a rating is pending", async () => {
    const res = await route.call("p1");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "Rate your last game first",
      code: "rating_required",
      detail: "Submit your rating for that game, then you can join or book another one. It only takes a few seconds.",
      pending_run_id: "r1",
      expires_at: iso(NOW - 2 * HOUR + 72 * HOUR),
    });
  });

  it("flag off for them: nothing changes (no 409)", async () => {
    expect(await isRatingRequired(await route.call("p2"))).toBe(false); // p2 owes a rating too, but is not listed
    setFlag(h.db as FakeDb, { enabled: false, allowlist: [] });
    expect(await isRatingRequired(await route.call("p1"))).toBe(false);
  });

  it("no flag row at all: nothing changes", async () => {
    (h.db as FakeDb).tables.app_flags = [];
    expect(await isRatingRequired(await route.call("p1"))).toBe(false);
  });

  it("flag on for everyone: every player who owes a rating is stopped", async () => {
    setFlag(h.db as FakeDb, { enabled: true });
    expect(await isRatingRequired(await route.call("p3"))).toBe(true);
  });

  it("admins are exempt even when the flag is on for everyone and they owe a rating", async () => {
    setFlag(h.db as FakeDb, { enabled: true, allowlist: ["adm"] });
    (h.db as FakeDb).tables.pickup_run_rsvps!.push({ run_id: "r1", user_id: "adm", status: "confirmed" });
    expect(await isRatingRequired(await route.call("adm"))).toBe(false);
  });

  it("not once the ballot is in", async () => {
    (h.db as FakeDb).tables.peer_votes!.push({ session_id: "ts1", voter_id: "p1", votee_id: "p2", rank: 1 });
    expect(await isRatingRequired(await route.call("p1"))).toBe(false);
  });

  it("not for a player who did not join that game, or who hosted it", async () => {
    setFlag(h.db as FakeDb, { enabled: true });
    expect(await isRatingRequired(await route.call("p9"))).toBe(false);
    expect(await isRatingRequired(await route.call("host1"))).toBe(false);
  });

  it("not after the requirement expires 72 hours after kickoff", async () => {
    (h.db as FakeDb).tables.pickup_runs![0]!.start_at = iso(NOW - 72 * HOUR);
    expect(await isRatingRequired(await route.call("p1"))).toBe(false);
  });

  if (route.ungated) {
    const ungated = route.ungated;
    it("declining or leaving is never blocked", async () => {
      setFlag(h.db as FakeDb, { enabled: true });
      expect(await isRatingRequired(await ungated("p1"))).toBe(false);
    });
  }
});

describe("paying is never stopped by a pending rating", () => {
  it("a player who owes a rating can still pay for a spot they already hold, flag on for everyone", async () => {
    setFlag(h.db as FakeDb, { enabled: true });
    expect(await isRatingRequired(await payPost(req("/api/pickup/pay", "p1", { run_id: "r2" })))).toBe(false);
    expect(await isRatingRequired(await payPost(req("/api/pickup/pay", "p3", { run_id: "r2" })))).toBe(false);
  });

  it("the pay route has no rating gate in it at all", () => {
    const route = readFileSync(new URL("../../app/api/pickup/pay/route.ts", import.meta.url), "utf8");
    expect(route).not.toMatch(/ratingGate|pendingRating|rating_required/);
  });
});

describe("the cards read the same answer", () => {
  const get = (t: string) => pendingGet(req("/api/sessions/pending-rating", t, undefined, "GET"));

  it("the pending game for a listed player, with the time it runs out and no score", async () => {
    const res = await get("p1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      pending: { run_id: "r1", title: "Sunday Pickup", kickoff_at: iso(NOW - 2 * HOUR), expires_at: iso(NOW - 2 * HOUR + 72 * HOUR) },
    });
    expect(JSON.stringify(body)).not.toMatch(/score|rating_exact|star/i);
  });

  it("nothing while the flag is off for them, for admins, and once the ballot is in", async () => {
    expect(await (await get("p2")).json()).toEqual({ pending: null });
    setFlag(h.db as FakeDb, { enabled: true, allowlist: [] });
    (h.db as FakeDb).tables.pickup_run_rsvps!.push({ run_id: "r1", user_id: "adm", status: "confirmed" });
    expect(await (await get("adm")).json()).toEqual({ pending: null });
    (h.db as FakeDb).tables.peer_votes!.push({ session_id: "ts1", voter_id: "p3", votee_id: "p1", rank: 1 });
    expect(await (await get("p3")).json()).toEqual({ pending: null });
  });

  it("needs a signed in player", async () => {
    expect((await pendingGet(new Request("https://site.test/api/sessions/pending-rating"))).status).toBe(401);
  });

  it("any failure reads as nothing pending: the gate never locks anyone out", async () => {
    (h.db as FakeDb).failTables.pickup_runs = "connection reset";
    expect(await (await get("p1")).json()).toEqual({ pending: null });
    expect(await isRatingRequired(await ROUTES["RSVP join"]!.call("p1"))).toBe(false);
  });
});

describe("what the loader counts", () => {
  const get = async (t = "p1") => (await (await pendingGet(req("/api/sessions/pending-rating", t, undefined, "GET"))).json()) as { pending: { run_id: string } | null };

  it("3 players joined: no rating is asked; 4: it is", async () => {
    h.db = ratingWorld({ players: 3, flag: { enabled: true } });
    expect((await get()).pending).toBeNull();
    h.db = ratingWorld({ players: 4, flag: { enabled: true } });
    expect((await get()).pending?.run_id).toBe("r1");
  });

  it("a payment pending player counts as joined, and the waitlist does not count as a player", async () => {
    h.db = ratingWorld({ players: 3, flag: { enabled: true } });
    (h.db as FakeDb).tables.pickup_run_rsvps!.push({ run_id: "r1", user_id: "p8", status: "waitlist" });
    expect((await get()).pending).toBeNull();
    (h.db as FakeDb).tables.pickup_run_rsvps!.push({ run_id: "r1", user_id: "p7", status: "pending_payment" });
    expect((await get()).pending?.run_id).toBe("r1");
  });

  it("exactly 1 hour after kickoff is pending, a minute less is not (and completed is, any time after kickoff)", async () => {
    h.db = ratingWorld({ kickoffAgo: HOUR, flag: { enabled: true } });
    expect((await get()).pending?.run_id).toBe("r1");
    h.db = ratingWorld({ kickoffAgo: HOUR - 60_000, flag: { enabled: true } });
    expect((await get()).pending).toBeNull();
    h.db = ratingWorld({ kickoffAgo: HOUR - 60_000, status: "completed", flag: { enabled: true } });
    expect((await get()).pending?.run_id).toBe("r1");
  });

  it("exactly 72 hours after kickoff it has expired; a minute earlier it has not", async () => {
    h.db = ratingWorld({ kickoffAgo: 72 * HOUR - 60_000, flag: { enabled: true } });
    expect((await get()).pending?.run_id).toBe("r1");
    h.db = ratingWorld({ kickoffAgo: 72 * HOUR, flag: { enabled: true } });
    expect((await get()).pending).toBeNull();
  });

  it("a tournament match is excluded, and a missing tournament table changes nothing", async () => {
    h.db = ratingWorld({ flag: { enabled: true }, extra: { tournament_match_runs: [{ match_id: "m1", run_id: "r1" }] } });
    expect((await get()).pending).toBeNull();
    h.db = ratingWorld({ flag: { enabled: true } });
    (h.db as FakeDb).failTables.tournament_match_runs = 'relation "tournament_match_runs" does not exist';
    expect((await get()).pending?.run_id).toBe("r1");
  });

  it("a player the admin marked as not attending is not asked", async () => {
    h.db = ratingWorld({ flag: { enabled: true }, extra: { pickup_run_attendance: [{ run_id: "r1", user_id: "p1", attended: false }] } });
    expect((await get()).pending).toBeNull();
    expect((await get("p2")).pending?.run_id).toBe("r1");
  });

  it("canceled games and games with the time still to be announced never ask", async () => {
    h.db = ratingWorld({ flag: { enabled: true }, status: "canceled" });
    expect((await get()).pending).toBeNull();
    h.db = ratingWorld({ flag: { enabled: true } });
    (h.db as FakeDb).tables.pickup_runs![0]!.time_tbd = true;
    expect((await get()).pending).toBeNull();
  });

  it("with two unrated games, the one that runs out first is the one named", async () => {
    h.db = ratingWorld({ flag: { enabled: true } });
    const db = h.db as FakeDb;
    db.tables.pickup_runs!.push({ id: "r0", title: "Older", location_text: "Field 1", status: "active", start_at: iso(NOW - 30 * HOUR), created_by: "host1", tier_session_id: "ts0", time_tbd: false });
    for (const id of ["p1", "p2", "p3", "p4"]) db.tables.pickup_run_rsvps!.push({ run_id: "r0", user_id: id, status: "confirmed" });
    expect((await get()).pending?.run_id).toBe("r0");
  });
});
