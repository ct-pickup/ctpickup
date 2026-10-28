import { beforeEach, describe, expect, it, vi } from "vitest";

import { claimPushSlotsTwin, fakeClient, makeDb, type FakeDb } from "./helpers/fakeSupabase";

const sent = vi.hoisted(() => [] as { ids: string[]; payload: { title: string; body: string; data?: Record<string, unknown> } }[]);
vi.mock("@/lib/push/sendExpoPush", () => ({
  sendPushToUsers: async (_a: unknown, ids: string[], payload: { title: string; body: string; data?: Record<string, unknown> }) => {
    sent.push({ ids, payload });
    return { tokens: ids.length, batches: [] };
  },
}));

import { freedWindows, gameMovedCopy, newGameCopy, slotDedupeKey, slotOpenCopy, venueChangeCopy, wantedBy, withinRadius, zipPoint } from "@/lib/alerts/alertRules";
import { claimAlertSlots, notifyGameMoved, notifyNewGame, notifySlotOpened, notifyVenueChange } from "@/lib/alerts/fieldAlerts";

const WESTPORT = "06880";
const DARIEN = "06820"; // about 9 miles from Westport
const NYC = "10001"; // about 45 miles

describe("alert rules", () => {
  it("a player with no row gets the default; an explicit off wins; the radius defaults to 10", () => {
    const rows = [{ user_id: "b", alert_type: "new_games", enabled: false, radius_miles: null }, { user_id: "c", alert_type: "new_games", enabled: true, radius_miles: 25 }];
    const w = wantedBy(["a", "b", "c"], rows, "new_games");
    expect([...w.entries()]).toEqual([["a", 10], ["c", 25]]);
    expect(wantedBy(["a"], [], "weekly_roundup").size).toBe(0); // off by default
    expect(wantedBy(["a"], [{ user_id: "a", alert_type: "new_games", enabled: false, radius_miles: null }], "slot_opens").has("a")).toBe(true); // another type's row does not matter
  });
  it("matches by the player's own radius and ignores unreadable ZIPs", () => {
    const point = zipPoint(WESTPORT)!;
    const profiles = [{ id: "near", zip_code: DARIEN }, { id: "far", zip_code: NYC }, { id: "bad", zip_code: "xx" }, { id: "none", zip_code: null }];
    const radius = new Map([["near", 10], ["far", 10], ["bad", 10], ["none", 10]]);
    expect(withinRadius(profiles, point, radius)).toEqual(["near"]);
    expect(withinRadius(profiles, point, new Map([["far", 60]]))).toEqual(["far"]);
  });
  it("finds booked windows that came free and are still in the future", () => {
    const now = new Date("2026-10-20T12:00:00Z");
    const w = (s: string, e: string) => ({ starts_at: s, ends_at: e });
    const before = [w("2026-10-21T22:00:00Z", "2026-10-21T23:00:00Z"), w("2026-10-22T22:00:00Z", "2026-10-22T23:00:00Z"), w("2026-10-19T22:00:00Z", "2026-10-19T23:00:00Z")];
    const after = [w("2026-10-22T22:00:00.000Z", "2026-10-22T23:00:00.000Z")];
    expect(freedWindows(before, after, now)).toEqual([before[0]]); // the past one and the one still booked are not freed
    expect(freedWindows(before, before, now)).toEqual([]);
    expect(slotDedupeKey("v1", [before[0]!])).toBe(slotDedupeKey("v1", [before[0]!]));
  });
  it("copy is short, plain, and has no em dash or tier or wave wording", () => {
    const texts = [
      slotOpenCopy("Hillcrest", [{ starts_at: "2026-10-22T22:00:00Z", ends_at: "2026-10-22T23:00:00Z" }]),
      venueChangeCopy("Hillcrest", "closed", "2026-11-02"),
      venueChangeCopy("Hillcrest", "removed"),
      newGameCopy("2026-10-22T22:00:00Z", false, "Hillcrest"),
      gameMovedCopy("Thursday 7v7", "2026-10-22T22:00:00Z", { time: true, place: true }),
    ].flatMap((c) => [c.title, c.body]);
    for (const t of texts) {
      expect(t).not.toMatch(/—|–/);
      expect(t).not.toMatch(/tier|wave/i);
      expect(t.length).toBeLessThan(90);
    }
    expect(venueChangeCopy("Hillcrest", "closed", "2026-11-02").body).toBe("Hillcrest is closed until Nov 2.");
  });
});

describe("alert senders", () => {
  let db: FakeDb;
  let now = Date.parse("2026-10-20T12:00:00Z");
  const admin = () => fakeClient(db) as never;

  beforeEach(() => {
    sent.length = 0;
    now = Date.parse("2026-10-20T12:00:00Z");
    db = makeDb({
      app_flags: [{ key: "fields", enabled: false, allowlist: ["u1", "u2", "u3", "u4"] }],
      profiles: [
        { id: "host", approved: true, zip_code: WESTPORT, is_admin: false },
        { id: "u1", approved: true, zip_code: DARIEN, is_admin: false },
        { id: "u2", approved: true, zip_code: DARIEN, is_admin: false },
        { id: "u3", approved: true, zip_code: NYC, is_admin: false },
        { id: "u4", approved: true, zip_code: DARIEN, is_admin: false },
        { id: "u5", approved: true, zip_code: DARIEN, is_admin: false }, // not on the fields flag
      ],
      alert_subscriptions: [{ user_id: "u2", alert_type: "new_games", enabled: false, radius_miles: null }],
      saved_venues: [{ user_id: "u1", venue_key: "v1" }, { user_id: "u2", venue_key: "v1" }, { user_id: "u5", venue_key: "v1" }],
      pickup_run_rsvps: [{ run_id: "r1", user_id: "u1", status: "confirmed" }, { run_id: "r1", user_id: "u2", status: "confirmed" }, { run_id: "r1", user_id: "u4", status: "waitlist" }],
      push_ledger: [],
    });
    db.rpcs.claim_push_slots = claimPushSlotsTwin(db, () => now);
  });

  const game = { id: "g1", hostId: "host", startAt: "2026-10-22T22:00:00Z", timeTbd: false, place: "Hillcrest", lat: 41.1415, lng: -73.3579 };

  it("new game: only players on the flag, with the alert on, inside their radius, never the host", async () => {
    const n = await notifyNewGame(admin(), game);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.ids.sort()).toEqual(["u1", "u4"]); // u2 turned it off, u3 is 45 miles away, u5 has no flag, host is skipped
    expect(n).toBe(2);
    expect(sent[0]!.payload.data).toMatchObject({ kind: "fields_new_game", run_id: "g1", screen: "session/g1" });
  });
  it("new game: skips players the region push already reached, and does nothing without a location", async () => {
    await notifyNewGame(admin(), game, ["u1"]);
    expect(sent[0]!.ids).toEqual(["u4"]);
    sent.length = 0;
    expect(await notifyNewGame(admin(), { ...game, lat: null, lng: null })).toBe(0);
    expect(sent).toHaveLength(0);
  });
  it("new game: the same game never pushes twice and a second game inside 6 hours is held back", async () => {
    await notifyNewGame(admin(), game);
    sent.length = 0;
    await notifyNewGame(admin(), game);
    expect(sent).toHaveLength(0); // same event
    await notifyNewGame(admin(), { ...game, id: "g2" });
    expect(sent).toHaveLength(0); // inside the 6 hour window
    now += 6 * 3_600_000 + 1000;
    await notifyNewGame(admin(), { ...game, id: "g3" });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.ids.sort()).toEqual(["u1", "u4"]);
  });
  it("the rate limit is per type: a new-game push does not block a slot alert", async () => {
    await notifyNewGame(admin(), game);
    sent.length = 0;
    const before = [{ starts_at: "2026-10-22T22:00:00Z", ends_at: "2026-10-22T23:00:00Z" }];
    await notifySlotOpened(admin(), "v1", "Hillcrest", before, [], new Date(now));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.ids).toEqual(["u1", "u2"]); // saved it, flag on; u5 saved it but has no flag
    expect(sent[0]!.payload.data).toMatchObject({ kind: "fields_slot_open", venue_key: "v1", screen: "field" });
  });
  it("slot opens: nothing when nothing was freed, and a repeat sync of the same change does not push again", async () => {
    const same = [{ starts_at: "2026-10-22T22:00:00Z", ends_at: "2026-10-22T23:00:00Z" }];
    expect(await notifySlotOpened(admin(), "v1", "Hillcrest", same, same, new Date(now))).toBe(0);
    expect(await notifySlotOpened(admin(), "v1", "Hillcrest", same, [], new Date(now))).toBe(2);
    now += 7 * 3_600_000;
    expect(await notifySlotOpened(admin(), "v1", "Hillcrest", same, [], new Date(now))).toBe(0);
  });
  it("respects a switched-off alert", async () => {
    db.tables.alert_subscriptions!.push({ user_id: "u1", alert_type: "slot_opens", enabled: false, radius_miles: null });
    const before = [{ starts_at: "2026-10-22T22:00:00Z", ends_at: "2026-10-22T23:00:00Z" }];
    await notifySlotOpened(admin(), "v1", "Hillcrest", before, [], new Date(now));
    expect(sent[0]!.ids).toEqual(["u2"]);
  });
  it("venue closed or removed goes to players who saved it; a game that moved goes to players who joined it", async () => {
    expect(await notifyVenueChange(admin(), "v1", "Hillcrest", "closed", "2026-11-02")).toBe(2);
    expect(sent[0]!.payload.body).toBe("Hillcrest is closed until Nov 2.");
    sent.length = 0;
    expect(await notifyGameMoved(admin(), { id: "r1", title: "Thursday 7v7", startAt: "2026-10-23T22:00:00Z" }, { time: true, place: false })).toBe(0); // same type, inside 6 hours
    now += 7 * 3_600_000;
    expect(await notifyGameMoved(admin(), { id: "r1", title: "Thursday 7v7", startAt: "2026-10-23T22:00:00Z" }, { time: true, place: false })).toBe(2);
    expect(sent[0]!.ids.sort()).toEqual(["u1", "u2"]); // u4 is on the waitlist, not joined
    expect(sent[0]!.payload.data).toMatchObject({ kind: "fields_change", run_id: "r1", screen: "session/r1" });
    expect(await notifyGameMoved(admin(), { id: "r1", title: null, startAt: null }, { time: false, place: false })).toBe(0);
  });
  it("fails closed: when the flag table or the ledger cannot be read nobody is pushed", async () => {
    db.failTables.app_flags = "boom";
    expect(await notifyVenueChange(admin(), "v1", "Hillcrest", "removed")).toBe(0);
    db.failTables = {};
    delete db.rpcs.claim_push_slots;
    expect(await claimAlertSlots(admin(), ["u1"], "x", "y")).toEqual([]);
    expect(await notifyVenueChange(admin(), "v1", "Hillcrest", "removed")).toBe(0);
    expect(sent).toHaveLength(0);
  });
  it("everyone gets it once the flag is on for everyone", async () => {
    db.tables.app_flags![0]!.enabled = true;
    await notifyNewGame(admin(), game);
    expect(sent[0]!.ids.sort()).toEqual(["u1", "u4", "u5"]);
  });
});
