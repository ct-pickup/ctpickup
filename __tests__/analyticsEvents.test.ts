import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import { CLIENT_EVENT_NAMES, EVENT_NAMES, PROPERTY_KEYS, postgameVoteEvent, recordEvents, resetAnalyticsBackoff, sanitizeProperties, toRow } from "@/lib/analytics/events";
import { MAX_BATCH, parseClientBatch, withRegions } from "@/lib/analytics/ingest";
import { fakeClient, makeDb } from "./helpers/fakeSupabase";

const sqlText = readFileSync("supabase/migrations/20261026000000_analytics_events.sql", "utf8");
const quoted = (block: string) => [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

describe("allowlists match the database", () => {
  it("event names", () => {
    const block = sqlText.slice(sqlText.indexOf("check (name in ("), sqlText.indexOf("constraint analytics_events_props_ok"));
    expect(quoted(block).sort()).toEqual([...EVENT_NAMES].sort());
  });
  it("property keys", () => {
    const block = sqlText.slice(sqlText.indexOf("e.key <> all (array["), sqlText.indexOf("or not ("));
    expect(quoted(block).sort()).toEqual([...PROPERTY_KEYS].sort());
  });
  it("the app may send only a subset, and never the events the server writes", () => {
    for (const n of CLIENT_EVENT_NAMES) expect(EVENT_NAMES).toContain(n);
    for (const n of ["rsvp_completed", "attended", "no_show", "push_sent", "waitlisted", "account_approved"]) expect(CLIENT_EVENT_NAMES).not.toContain(n);
  });
});

describe("sanitizeProperties", () => {
  it("keeps scalars and tokens, drops everything else", () => {
    expect(
      sanitizeProperties({ run_id: "abc-123", rank: 2, enabled: true, kind: "has space", reason: "a@b.co", email: "x", count: Infinity, status: { a: 1 }, reasons: "near_you,level" }),
    ).toEqual({ run_id: "abc-123", rank: 2, enabled: true, reasons: "near_you,level" });
  });
  it("is empty for junk input", () => {
    for (const v of [null, undefined, "x", 3, [1, 2]]) expect(sanitizeProperties(v)).toEqual({});
  });
  it("caps the number of keys", () => {
    const many = Object.fromEntries(PROPERTY_KEYS.slice(0, 20).map((k) => [k, 1]));
    expect(Object.keys(sanitizeProperties(many)).length).toBe(12);
  });
});

describe("toRow", () => {
  it("rejects unknown names and short keys", () => {
    expect(toRow({ key: "abcdefgh", name: "nope" as never, source: "server" })).toBeNull();
    expect(toRow({ key: "short", name: "run_viewed", source: "server" })).toBeNull();
  });
  it("cleans region, platform and session", () => {
    const r = toRow({ key: "abcdefgh", name: "run_viewed", source: "client", region: "CT", platform: "ios", sessionId: "bad id", appVersion: "1.2.3" })!;
    expect(r).toMatchObject({ region: "CT", platform: "ios", session_id: null, app_version: "1.2.3" });
    expect(toRow({ key: "abcdefgh", name: "run_viewed", source: "client", region: "41.2,-73.1 at home", platform: "toaster" })).toMatchObject({ region: null, platform: null });
  });
});

describe("recordEvents", () => {
  beforeEach(() => resetAnalyticsBackoff());
  it("stores once per key", async () => {
    const db = makeDb({ analytics_events: [] });
    const admin = fakeClient(db) as never;
    const ev = { key: "same-key-1", name: "run_viewed" as const, source: "server" as const };
    await recordEvents(admin, [ev]);
    await recordEvents(admin, [ev]);
    expect(db.tables.analytics_events).toHaveLength(1);
  });
  it("never throws and backs off when the table is missing", async () => {
    const db = makeDb({});
    db.failTables.analytics_events = 'relation "analytics_events" does not exist';
    const admin = fakeClient(db) as never;
    await expect(recordEvents(admin, [{ key: "missing-1", name: "run_viewed", source: "server" }])).resolves.toBe(0);
    db.failTables = {};
    db.tables.analytics_events = [];
    await expect(recordEvents(admin, [{ key: "missing-2", name: "run_viewed", source: "server" }])).resolves.toBe(0); // still backing off
    resetAnalyticsBackoff();
    await expect(recordEvents(admin, [{ key: "missing-3", name: "run_viewed", source: "server" }])).resolves.toBe(1);
  });
  it("postgame vote events repeat their key on a retry", () => {
    expect(postgameVoteEvent("r", "u", "potd").key).toBe(postgameVoteEvent("r", "u", "potd").key);
    expect(postgameVoteEvent("r", "u", "potd").key).not.toBe(postgameVoteEvent("r", "u", "peer_vote").key);
  });
});

describe("parseClientBatch", () => {
  const now = 1_800_000_000_000;
  const ok = (over: Record<string, unknown> = {}) => ({ id: "evt-00000001", name: "run_viewed", at: now - 1000, properties: { run_id: "x1" }, ...over });
  it("keeps client events and scopes the key to the user", () => {
    const r = parseClientBatch({ session_id: "sess-0001", platform: "ios", app_version: "1.0.0", events: [ok()] }, "user-1", now);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ key: "c:user-1:evt-00000001", source: "client", userId: "user-1", occurredAt: now - 1000 });
  });
  it("drops server-only names, bad ids and junk, and counts them", () => {
    const r = parseClientBatch({ events: [ok({ name: "rsvp_completed" }), ok({ id: "x" }), "junk", ok({ name: "nope" }), ok({ id: "evt-00000002" })] }, "u", now);
    expect(r.events).toHaveLength(1);
    expect(r.dropped).toBe(4);
  });
  it("uses the server clock for times in the future or older than a week", () => {
    const r = parseClientBatch({ events: [ok({ at: now + 3_600_000 }), ok({ id: "evt-00000003", at: now - 8 * 86_400_000 })] }, "u", now);
    expect(r.events.map((e) => e.occurredAt)).toEqual([now, now]);
  });
  it("caps a batch", () => {
    const events = Array.from({ length: MAX_BATCH + 10 }, (_, i) => ok({ id: `evt-${String(i).padStart(8, "0")}` }));
    const r = parseClientBatch({ events }, "u", now);
    expect(r.events).toHaveLength(MAX_BATCH);
    expect(r.dropped).toBe(10);
  });
  it("returns nothing for a bad body", () => {
    for (const b of [null, "x", {}, { events: "no" }]) expect(parseClientBatch(b, "u", now).events).toEqual([]);
  });
  it("fills the region from the game, never from the phone", async () => {
    const run = "11111111-1111-4111-8111-111111111111";
    const db = makeDb({ pickup_runs: [{ id: run, service_region: "CT" }] });
    const r = parseClientBatch({ events: [ok({ properties: { run_id: run } }), ok({ id: "evt-00000004", properties: { kind: "x" } })] }, "u", now);
    const withR = await withRegions(fakeClient(db) as never, r.events);
    expect(withR.map((e) => e.region ?? null)).toEqual(["CT", null]);
  });
});
