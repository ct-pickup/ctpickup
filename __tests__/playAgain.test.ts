import { beforeEach, describe, expect, it, vi } from "vitest";

import { claimPushSlotsTwin, fakeClient, makeDb, type FakeDb } from "./helpers/fakeSupabase";

const invited = vi.hoisted(() => [] as string[]);
const sent = vi.hoisted(() => [] as { ids: string[]; payload: { title: string; body: string; data?: Record<string, unknown> } }[]);
vi.mock("@/lib/push/sendExpoPush", () => ({
  sendPushToUsers: async (_a: unknown, ids: string[], payload: { title: string; body: string; data?: Record<string, unknown> }) => {
    sent.push({ ids, payload });
    return { tokens: ids.length, batches: [] };
  },
}));
vi.mock("@/lib/pickup/deliverRunInvite", () => ({
  deliverRunInvite: async (_db: unknown, a: { inviteeId: string }) => {
    invited.push(a.inviteeId);
    return { ok: true, alreadyLinked: false };
  },
}));
import { askHostToRepeat, inviteFromPreviousGame, isRepeatable, playAgainInfo } from "@/lib/pickup/playAgain";
import { pushCategoryFor } from "@/lib/push/pushPolicy";
import { etSlot, nextWeekSlot, playAgainAskCopy, playAgainCopy, repeatPrefill } from "@/lib/pickup/repeatGame";

const HOST = "00000000-0000-4000-8000-0000000000a1";
const P1 = "00000000-0000-4000-8000-0000000000b1";
const P2 = "00000000-0000-4000-8000-0000000000b2";
const P3 = "00000000-0000-4000-8000-0000000000b3";
const OUT = "00000000-0000-4000-8000-0000000000c1";
const RUN = "00000000-0000-4000-8000-0000000000d1";
const NEW = "00000000-0000-4000-8000-0000000000d2";
const NOW = new Date("2026-10-28T15:00:00Z");

const sourceRun = {
  id: RUN, created_by: HOST, status: "completed", title: "Thursday 7v7", location_text: "Hillcrest Park, Westport", latitude: 41.1, longitude: -73.4,
  start_at: "2026-10-22T22:00:00Z", time_tbd: false, capacity: 14, fee_cents: 600, format: "7v7", run_type: "public", tiered_pricing: false, min_star: 3, open_tier_rank: 3, venue_key: "hillcrest",
};

function world(): FakeDb {
  const db = makeDb({
    pickup_runs: [{ ...sourceRun }],
    pickup_run_rsvps: [
      { run_id: RUN, user_id: HOST, status: "confirmed" },
      { run_id: RUN, user_id: P1, status: "confirmed" },
      { run_id: RUN, user_id: P2, status: "confirmed" },
      { run_id: RUN, user_id: P3, status: "cancelled" },
    ],
    profiles: [
      { id: HOST, is_admin: false, approved: true },
      { id: P1, is_admin: false, approved: true, tier_rank: 3 },
      { id: P2, is_admin: false, approved: false, tier_rank: 3 },
      { id: OUT, is_admin: false, approved: true },
    ],
    analytics_events: [],
  });
  db.rpcs.claim_push_slots = claimPushSlotsTwin(db);
  return db;
}

beforeEach(() => {
  sent.length = 0;
  invited.length = 0;
});

describe("nextWeekSlot", () => {
  it("is the same weekday and clock time one week later in Eastern time", () => {
    expect(nextWeekSlot("2026-10-22T22:00:00Z", false, NOW)).toEqual({ date: "2026-10-29", time: "18:00" });
  });
  it("keeps the wall clock across the November clock change", () => {
    // Sat Oct 31 6:00 PM EDT (22:00Z). A week later is Sat Nov 7 and clocks have gone back, so 6:00 PM is 23:00Z.
    expect(nextWeekSlot("2026-10-31T22:00:00Z", false, new Date("2026-10-30T12:00:00Z"))).toEqual({ date: "2026-11-07", time: "18:00" });
    expect(etSlot("2026-11-07T23:00:00Z", false)).toEqual({ date: "2026-11-07", time: "18:00" });
  });
  it("moves forward a week at a time when the game was long ago", () => {
    expect(nextWeekSlot("2026-09-03T22:00:00Z", false, NOW)).toEqual({ date: "2026-10-29", time: "18:00" });
  });
  it("keeps a game with no set time without a time", () => {
    expect(nextWeekSlot("2026-10-22T16:00:00Z", true, NOW)).toEqual({ date: "2026-10-29", time: null });
  });
  it("returns null for junk", () => {
    expect(nextWeekSlot("nope", false, NOW)).toBeNull();
  });
});

describe("repeatPrefill", () => {
  it("copies the field, size, format, price and level, and moves the day", () => {
    expect(repeatPrefill(sourceRun, NOW)).toEqual({
      location_text: "Hillcrest Park, Westport", latitude: 41.1, longitude: -73.4, venue_key: "hillcrest", capacity: 14, format: "7v7", fee_cents: 600,
      invite_only: false, tiered_pricing: false, min_star: 3, min_tier: "gold", date: "2026-10-29", time: "18:00", time_tbd: false,
    });
  });
  it("never carries a field request over, and defaults what is missing", () => {
    const p = repeatPrefill({ ...sourceRun, venue_request_id: "r1", capacity: 99, format: "weird", fee_cents: -5, open_tier_rank: null, min_star: null, run_type: "select" }, NOW)!;
    expect(p).not.toHaveProperty("venue_request_id");
    expect(p).toMatchObject({ capacity: 10, format: "Open", fee_cents: 0, min_tier: "all", min_star: null, invite_only: true });
  });
  it("is null without a place or a start", () => {
    expect(repeatPrefill({ ...sourceRun, location_text: "" }, NOW)).toBeNull();
    expect(repeatPrefill({ ...sourceRun, start_at: null }, NOW)).toBeNull();
  });
});

describe("who can repeat a game", () => {
  it("a game can be repeated once it has started or is done, never when cancelled", () => {
    expect(isRepeatable({ start_at: "2026-10-22T22:00:00Z", status: "active" }, NOW)).toBe(true);
    expect(isRepeatable({ start_at: "2026-11-22T22:00:00Z", status: "planning" }, NOW)).toBe(false);
    expect(isRepeatable({ start_at: "2026-11-22T22:00:00Z", status: "completed" }, NOW)).toBe(true);
    expect(isRepeatable({ start_at: "2026-10-22T22:00:00Z", status: "cancelled" }, NOW)).toBe(false);
  });
  it("the host gets the prefill and the count of players to invite first (not the host, not cancelled)", async () => {
    const info = await playAgainInfo(fakeClient(world()) as never, RUN, HOST, NOW);
    expect(info).toMatchObject({ eligible: true, role: "host", previous_players: 2 });
    expect(info?.prefill?.date).toBe("2026-10-29");
  });
  it("an admin can repeat any game; a player from the game can only ask; anyone else gets nothing", async () => {
    const db = world();
    (db.tables.profiles as Record<string, unknown>[]).push({ id: "admin-1", is_admin: true });
    expect((await playAgainInfo(fakeClient(db) as never, RUN, "admin-1", NOW))?.role).toBe("host");
    expect(await playAgainInfo(fakeClient(db) as never, RUN, P1, NOW)).toMatchObject({ eligible: true, role: "attendee", prefill: null });
    expect(await playAgainInfo(fakeClient(db) as never, RUN, OUT, NOW)).toMatchObject({ eligible: false, role: null });
    expect(await playAgainInfo(fakeClient(db) as never, RUN, P3, NOW)).toMatchObject({ eligible: false, role: null }); // cancelled their spot
  });
  it("is not offered before the game has happened", async () => {
    const db = world();
    (db.tables.pickup_runs as Record<string, unknown>[])[0] = { ...sourceRun, status: "planning", start_at: "2026-11-22T22:00:00Z" };
    expect(await playAgainInfo(fakeClient(db) as never, RUN, HOST, NOW)).toMatchObject({ eligible: false });
  });
  it("returns null for a game that does not exist", async () => {
    expect(await playAgainInfo(fakeClient(world()) as never, "missing", HOST, NOW)).toBeNull();
  });
});

describe("inviteFromPreviousGame", () => {
  const newRun = { id: NEW, start_at: "2026-10-30T22:00:00Z", time_tbd: false };
  it("pushes approved players from the last game once, and tells the caller who to skip", async () => {
    const db = world();
    const handled = await inviteFromPreviousGame(fakeClient(db) as never, { sourceRunId: RUN, hostId: HOST, hostName: "Sam", newRun, inviteOnly: false });
    expect(handled).toEqual([P1]); // P2 is not approved, the host is not a recipient
    expect(sent).toHaveLength(1);
    expect(sent[0]!.ids).toEqual([P1]);
    expect(sent[0]!.payload.data).toMatchObject({ kind: "play_again", run_id: NEW, screen: `session/${NEW}` });
    expect(sent[0]!.payload.body).toBe("Sam posted the same game for Fri 6:00 PM. You get first look.");
    const ev = db.tables.analytics_events as { name: string; properties: Record<string, unknown> }[];
    expect(ev.map((e) => e.name)).toEqual(["play_again_created"]);
    expect(ev[0]!.properties).toMatchObject({ run_id: RUN, new_run_id: NEW, role: "host", count: 1 });
  });
  it("invites instead of pushing for an invite-only game", async () => {
    const db = world();
    await inviteFromPreviousGame(fakeClient(db) as never, { sourceRunId: RUN, hostId: HOST, hostName: "Sam", newRun, inviteOnly: true });
    expect(invited).toEqual([P1]);
    expect(sent).toHaveLength(0);
  });
  it("sends at most one per player per day and still records the event when nobody is left to invite", async () => {
    const db = world();
    await inviteFromPreviousGame(fakeClient(db) as never, { sourceRunId: RUN, hostId: HOST, hostName: "Sam", newRun, inviteOnly: false });
    sent.length = 0;
    await inviteFromPreviousGame(fakeClient(db) as never, { sourceRunId: RUN, hostId: HOST, hostName: "Sam", newRun: { ...newRun, id: "other-run" }, inviteOnly: false });
    expect(sent).toHaveLength(0);
    (db.tables.pickup_run_rsvps as unknown[]).length = 0;
    await inviteFromPreviousGame(fakeClient(db) as never, { sourceRunId: RUN, hostId: HOST, hostName: "Sam", newRun: { ...newRun, id: "third-run" }, inviteOnly: false });
    expect((db.tables.analytics_events as unknown[]).length).toBe(3);
  });
  it("never throws", async () => {
    const db = world();
    db.failTables.pickup_run_rsvps = "boom";
    await expect(inviteFromPreviousGame(fakeClient(db) as never, { sourceRunId: RUN, hostId: HOST, hostName: "Sam", newRun, inviteOnly: false })).resolves.toEqual([]);
  });
});

describe("askHostToRepeat", () => {
  it("a player from the game asks; the host gets one push per game per day however many ask", async () => {
    const db = world();
    (db.tables.profiles as Record<string, unknown>[]).push({ id: P3, approved: true });
    (db.tables.pickup_run_rsvps as Record<string, unknown>[]).push({ run_id: RUN, user_id: OUT, status: "confirmed" });
    expect(await askHostToRepeat(fakeClient(db) as never, RUN, P1, NOW)).toEqual({ ok: true, notified: true });
    expect(await askHostToRepeat(fakeClient(db) as never, RUN, OUT, NOW)).toEqual({ ok: true, notified: false });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.ids).toEqual([HOST]);
    expect(sent[0]!.payload.data).toMatchObject({ kind: "play_again_ask", screen: `recap/${RUN}` });
  });
  it("refuses people who were not in the game, and the host", async () => {
    const db = world();
    expect(await askHostToRepeat(fakeClient(db) as never, RUN, P3, NOW)).toMatchObject({ ok: false, status: 403 });
    expect(await askHostToRepeat(fakeClient(db) as never, RUN, HOST, NOW)).toMatchObject({ ok: false, status: 403 });
  });
});

describe("push categories", () => {
  it("play again pushes are game notifications, so the games switch and quiet hours apply", () => {
    expect(pushCategoryFor({ kind: "play_again" })).toBe("games");
    expect(pushCategoryFor({ kind: "play_again_ask" })).toBe("games");
  });
});

describe("copy", () => {
  it("is short, plain and has no dash or tier wording", () => {
    for (const c of [playAgainCopy("Sam", "Fri 6:00 PM"), playAgainAskCopy()]) {
      for (const t of [c.title, c.body]) {
        expect(t).not.toMatch(/—|–|tier|wave/i);
        expect(t.length).toBeLessThan(90);
      }
    }
  });
});
