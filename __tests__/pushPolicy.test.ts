import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeClient, makeDb, type FakeDb } from "./helpers/fakeSupabase";
import { DEFAULT_PUSH_PREFS, decidePush, inQuietHours, isCancellationToday, isUrgentWaitlistOffer, minutesInZone, prefsFromRow, pushCategoryFor } from "@/lib/push/pushPolicy";
import { sendMarketingPushToAll, sendMarketingPushToUsers, sendPushToAll, sendPushToUsers } from "@/lib/push/sendExpoPush";
import { parsePushSettingsUpdate, readPushSettings, savePushSettings } from "@/lib/push/pushSettings";

const q = (start: number, end: number, tz: string | null = "America/New_York", enabled = true) => ({ enabled, start, end, tz });
const at = (iso: string) => new Date(iso);

describe("push categories", () => {
  it.each([
    [{ kind: "pickup_invite" }, "games"], [{ kind: "session_new" }, "games"], [{ kind: "player_followed_joined" }, "games"], [{ kind: "host_new_run" }, "games"],
    [{ kind: "pickup_waitlist_offer" }, "reminders"], [{ kind: "pickup_waitlist_expiring" }, "reminders"], [{ kind: "session_rate_reminder" }, "reminders"],
    [{ kind: "pickup_result" }, "results"], [{ kind: "pickup_award_goalie" }, "results"], [{ kind: "session_voting_open" }, "results"],
    [{ kind: "chat_message" }, "chat"], [{ kind: "announcement" }, "chat"],
    [{ kind: "fields_new_game" }, "fields"], [{ kind: "fields_slot_open" }, "fields"], [{ screen: "field-requests" }, "fields"],
    [{ screen: "admin/field-requests" }, "other"], [{ kind: "tier_suggestions_ready" }, "other"], [{ kind: "photo_removed" }, "other"], [null, "other"], [{}, "other"],
  ] as const)("%j -> %s", (data, want) => {
    expect(pushCategoryFor(data)).toBe(want);
  });
});

describe("quiet hours", () => {
  it("handles a window that crosses midnight, in the player's own zone", () => {
    const n = q(22 * 60, 7 * 60);
    expect(inQuietHours(at("2026-10-21T02:30:00Z"), n)).toBe(true); // 10:30 PM ET
    expect(inQuietHours(at("2026-10-21T10:59:00Z"), n)).toBe(true); // 6:59 AM ET
    expect(inQuietHours(at("2026-10-21T11:00:00Z"), n)).toBe(false); // 7:00 AM ET, end is exclusive
    expect(inQuietHours(at("2026-10-21T17:00:00Z"), n)).toBe(false); // 1 PM ET
    expect(inQuietHours(at("2026-10-21T02:00:00Z"), q(22 * 60, 7 * 60, "America/Los_Angeles"))).toBe(false); // 7 PM in LA
    expect(inQuietHours(at("2026-10-21T06:30:00Z"), q(22 * 60, 7 * 60, "America/Los_Angeles"))).toBe(true); // 11:30 PM PDT
  });
  it("a window inside one day, a disabled window and start equal to end", () => {
    expect(inQuietHours(at("2026-10-21T17:00:00Z"), q(12 * 60, 14 * 60))).toBe(true); // 1 PM ET
    expect(inQuietHours(at("2026-10-21T20:00:00Z"), q(12 * 60, 14 * 60))).toBe(false); // 4 PM ET
    expect(inQuietHours(at("2026-10-21T17:00:00Z"), q(12 * 60, 14 * 60, "America/New_York", false))).toBe(false);
    expect(inQuietHours(at("2026-10-21T17:00:00Z"), q(600, 600))).toBe(false);
  });
  it("a missing or unknown zone means US Eastern", () => {
    expect(minutesInZone(at("2026-10-21T17:00:00Z"), null)).toBe(13 * 60);
    expect(minutesInZone(at("2026-10-21T17:00:00Z"), "Not/AZone")).toBe(13 * 60);
  });
  it("follows daylight saving: the same clock time in winter is an hour later in UTC", () => {
    expect(minutesInZone(at("2026-12-21T17:00:00Z"), "America/New_York")).toBe(12 * 60);
  });
});

describe("the decision", () => {
  const prefs = (over: Partial<typeof DEFAULT_PUSH_PREFS.categories> = {}, quiet = q(22 * 60, 7 * 60)) => ({ ...DEFAULT_PUSH_PREFS, marketing: true, categories: { ...DEFAULT_PUSH_PREFS.categories, ...over }, quiet });
  const night = at("2026-10-21T03:00:00Z"); // 11 PM ET
  const day = at("2026-10-21T17:00:00Z");
  it("sends by default, and a switched-off category is never sent, urgent or not", () => {
    expect(decidePush(prefs(), "games", false, day)).toEqual({ send: true });
    expect(decidePush(prefs({ games: false }), "games", false, day)).toEqual({ send: false, reason: "category_off" });
    expect(decidePush(prefs({ reminders: false }), "reminders", true, night)).toEqual({ send: false, reason: "category_off" });
    expect(decidePush({ ...prefs(), marketing: false }, "marketing", false, day)).toEqual({ send: false, reason: "category_off" });
  });
  it("quiet hours stop a normal push; an urgent one gets through; other categories are unaffected by an off switch", () => {
    expect(decidePush(prefs(), "games", false, night)).toEqual({ send: false, reason: "quiet_hours" });
    expect(decidePush(prefs(), "reminders", true, night)).toEqual({ send: true });
    expect(decidePush(prefs({ chat: false }), "games", false, day)).toEqual({ send: true });
    expect(decidePush(prefs(), "other", false, night)).toEqual({ send: false, reason: "quiet_hours" });
    expect(decidePush(prefs(), "other", false, day)).toEqual({ send: true });
  });
  it("marketing is opt-in when nothing is stored", () => {
    expect(prefsFromRow(undefined).marketing).toBe(false);
    expect(prefsFromRow({ id: "a" }).marketing).toBe(false);
    expect(prefsFromRow({ id: "a", marketing_push_enabled: true }).marketing).toBe(true);
    expect(prefsFromRow({ id: "a" }).categories.games).toBe(true);
  });
});

describe("urgent items", () => {
  const now = at("2026-10-21T19:00:00Z");
  it("a waitlist spot is urgent from 2 hours before kickoff until an hour after it starts", () => {
    expect(isUrgentWaitlistOffer("2026-10-21T20:30:00Z", now)).toBe(true);
    expect(isUrgentWaitlistOffer("2026-10-21T21:00:00Z", now)).toBe(true); // exactly 2 hours
    expect(isUrgentWaitlistOffer("2026-10-21T21:00:01Z", now)).toBe(false);
    expect(isUrgentWaitlistOffer("2026-10-21T18:30:00Z", now)).toBe(true); // started 30 minutes ago
    expect(isUrgentWaitlistOffer("2026-10-21T17:00:00Z", now)).toBe(false);
    expect(isUrgentWaitlistOffer(null, now)).toBe(false);
    expect(isUrgentWaitlistOffer("nonsense", now)).toBe(false);
  });
  it("a cancellation is urgent for a game on today's date in US Eastern", () => {
    expect(isCancellationToday("2026-10-21T23:30:00Z", now)).toBe(true); // 7:30 PM ET today
    expect(isCancellationToday("2026-10-22T02:00:00Z", at("2026-10-21T19:00:00Z"))).toBe(true); // 10 PM ET today
    expect(isCancellationToday("2026-10-22T05:00:00Z", at("2026-10-21T19:00:00Z"))).toBe(false); // 1 AM ET tomorrow
    expect(isCancellationToday("2026-10-24T20:00:00Z", now)).toBe(false);
    expect(isCancellationToday(null, now)).toBe(false);
  });
});

describe("enforced on every send path", () => {
  let db: FakeDb;
  const calls = vi.hoisted(() => [] as string[][]);
  const realFetch = globalThis.fetch;
  const admin = () => fakeClient(db) as never;
  const NIGHT = Date.parse("2026-10-21T03:00:00Z"); // 11 PM ET
  const DAY = Date.parse("2026-10-21T17:00:00Z");

  beforeEach(() => {
    calls.length = 0;
    globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
      const msgs = JSON.parse(init?.body ?? "[]") as { to: string }[];
      calls.push(msgs.map((m) => m.to));
      return { ok: true, status: 200, json: async () => ({ data: msgs.map(() => ({ status: "ok" })) }) } as Response;
    }) as typeof fetch;
    db = makeDb({
      profiles: [
        { id: "plain", push_cat_games: true, push_cat_reminders: true, push_cat_results: true, push_cat_chat: true, push_cat_fields: true, marketing_push_enabled: true, quiet_hours_enabled: false },
        { id: "gamesOff", push_cat_games: false, push_cat_reminders: true, push_cat_results: true, push_cat_chat: true, push_cat_fields: true, marketing_push_enabled: true, quiet_hours_enabled: false },
        { id: "quiet", push_cat_games: true, push_cat_reminders: true, push_cat_results: true, push_cat_chat: true, push_cat_fields: true, marketing_push_enabled: true, quiet_hours_enabled: true, quiet_hours_start: 1320, quiet_hours_end: 420, quiet_hours_tz: "America/New_York" },
        { id: "noMarketing", push_cat_games: true, push_cat_reminders: true, push_cat_results: true, push_cat_chat: true, push_cat_fields: true, marketing_push_enabled: false, quiet_hours_enabled: false },
      ],
      user_push_devices: ["plain", "gamesOff", "quiet", "noMarketing"].map((u) => ({ user_id: u, expo_push_token: `ExponentPushToken[${u}]`, push_notifications_enabled: true, marketing_push_enabled: u !== "noMarketing", installation_context: "standalone" })),
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(DAY);
  });
  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = realFetch;
  });

  const all = ["plain", "gamesOff", "quiet", "noMarketing"];
  const sentTo = () => calls.flat().map((t) => t.replace(/^ExponentPushToken\[|\]$/g, "")).sort();

  it("sendPushToUsers skips a switched-off category and, at night, players in quiet hours", async () => {
    const r = await sendPushToUsers(admin(), all, { title: "t", body: "b", data: { kind: "pickup_new_run" } });
    expect(sentTo()).toEqual(["noMarketing", "plain", "quiet"]); // gamesOff left out
    expect(r.suppressed).toBe(1);
    calls.length = 0;
    vi.setSystemTime(NIGHT);
    const n = await sendPushToUsers(admin(), all, { title: "t", body: "b", data: { kind: "pickup_new_run" } });
    expect(sentTo()).toEqual(["noMarketing", "plain"]);
    expect(n.suppressed).toBe(2);
  });
  it("an urgent push gets through quiet hours but not through a switched-off category", async () => {
    vi.setSystemTime(NIGHT);
    await sendPushToUsers(admin(), all, { title: "t", body: "b", data: { kind: "pickup_canceled" } }, { urgent: true });
    expect(sentTo()).toEqual(["noMarketing", "plain", "quiet"]); // gamesOff still left out
  });
  it("another category is unaffected by a games switch", async () => {
    await sendPushToUsers(admin(), all, { title: "t", body: "b", data: { kind: "chat_message" } });
    expect(sentTo()).toEqual(all.slice().sort());
  });
  it("sendPushToAll and the marketing paths enforce it too", async () => {
    await sendPushToAll(admin(), { title: "t", body: "b", data: { kind: "pickup_new_run" } });
    expect(sentTo()).toEqual(["noMarketing", "plain", "quiet"]);
    calls.length = 0;
    await sendMarketingPushToUsers(admin(), all, { title: "t", body: "b" });
    expect(sentTo()).toEqual(["gamesOff", "plain", "quiet"]); // noMarketing never opted in
    calls.length = 0;
    vi.setSystemTime(NIGHT);
    await sendMarketingPushToAll(admin(), { title: "t", body: "b" });
    expect(sentTo()).toEqual(["gamesOff", "plain"]); // quiet hours apply to marketing
  });
  it("a settings lookup that fails sends anyway (the columns may not exist yet)", async () => {
    db.failTables.profiles = "boom";
    await sendPushToUsers(admin(), all, { title: "t", body: "b", data: { kind: "pickup_new_run" } });
    expect(sentTo()).toEqual(all.slice().sort());
  });
});

describe("saving settings", () => {
  it("accepts good updates and rejects anything unknown or out of range", () => {
    expect(parsePushSettingsUpdate({ categories: { games: false } })).toEqual({ ok: true, update: { categories: { games: false } } });
    expect(parsePushSettingsUpdate({ quiet: { enabled: true, start: 1320, end: 420, timezone: "America/Chicago" } }).ok).toBe(true);
    for (const bad of [null, [], {}, { categories: { loud: true } }, { categories: { games: "yes" } }, { quiet: { start: 1440 } }, { quiet: { start: 1.5 } }, { quiet: { timezone: "Mars/Base" } }, { quiet: { enabled: 1 } }, { extra: 1 }, { quiet: { color: "red" } }]) {
      expect(parsePushSettingsUpdate(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });
  it("writes the columns and syncs marketing to the player's devices", async () => {
    const db = makeDb({ profiles: [{ id: "u1" }], user_push_devices: [{ user_id: "u1", marketing_push_enabled: false }] });
    expect(await savePushSettings(fakeClient(db) as never, "u1", { categories: { games: false, marketing: true }, quiet: { enabled: true, start: 60, end: 120, timezone: "America/Denver" } })).toEqual({ ok: true });
    expect(db.tables.profiles![0]).toMatchObject({ push_cat_games: false, marketing_push_enabled: true, quiet_hours_enabled: true, quiet_hours_start: 60, quiet_hours_end: 120, quiet_hours_tz: "America/Denver" });
    expect(db.tables.user_push_devices![0]!.marketing_push_enabled).toBe(true);
    expect((await readPushSettings(fakeClient(db) as never, "u1")).quiet).toEqual({ enabled: true, start: 60, end: 120, timezone: "America/Denver" });
    expect(await savePushSettings(fakeClient(db) as never, "nobody", { categories: { chat: false } })).toMatchObject({ ok: false });
  });
});
