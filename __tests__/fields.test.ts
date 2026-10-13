import { describe, expect, it } from "vitest";
import {
  filterFields,
  permitChip,
  permitConfirmation,
  pinLabel,
  priceConfirmation,
  priceLabel,
  requestEstimate,
  slotStatus,
} from "../mobile/lib/fields/presentation";
import { clampPlayers, defaultDay, requestDays } from "../mobile/lib/fields/requestOptions";
import { SAMPLE_FIELDS } from "../mobile/lib/fields/sampleData";
import { NO_FIELD_FILTERS } from "../mobile/lib/fields/types";

const [riverside, hillcrest, lakeview, oakHill] = SAMPLE_FIELDS.map((f) => f.venue);

describe("slotStatus", () => {
  it("is never open without a connected calendar", () => {
    expect(slotStatus({ calendarConnected: false, booked: false, yourRequest: false })).toBe("unknown");
  });
  it("always shows a booking we hold a row for, connected or not", () => {
    expect(slotStatus({ calendarConnected: false, booked: true, yourRequest: false })).toBe("booked");
    expect(slotStatus({ calendarConnected: false, booked: false, pending: true, yourRequest: false })).toBe("pending");
  });
  it("is open or booked only when the calendar is connected", () => {
    expect(slotStatus({ calendarConnected: true, booked: false, yourRequest: false })).toBe("open");
    expect(slotStatus({ calendarConnected: true, booked: true, yourRequest: false })).toBe("booked");
  });
  it("shows the player's own request as pending", () => {
    expect(slotStatus({ calendarConnected: false, booked: false, yourRequest: true })).toBe("pending");
  });
});

describe("confirmation badges", () => {
  it("never calls an assumed permit verified, even on a verified row", () => {
    expect(permitConfirmation({ verified: true, permit_basis: "assumed: public school policy" })).toBe("confirming");
  });
  it("verifies a permit on a verified row with a real basis, or a manual basis", () => {
    expect(permitConfirmation({ verified: true, permit_basis: "tag: access=yes" })).toBe("verified");
    expect(permitConfirmation({ verified: false, permit_basis: "manual" })).toBe("verified");
    expect(permitConfirmation({ verified: false, permit_basis: "tag: access=yes" })).toBe("confirming");
    expect(permitConfirmation({ verified: false, permit_basis: null })).toBe("confirming");
  });
  it("verifies a price on a verified row or a manual price", () => {
    expect(priceConfirmation({ verified: false, price_source: "manual" })).toBe("verified");
    expect(priceConfirmation({ verified: true, price_source: "osm" })).toBe("verified");
    expect(priceConfirmation({ verified: false, price_source: "osm" })).toBe("confirming");
  });
  it("matches the design example: Hillcrest price verified, permit still being confirmed", () => {
    expect(priceConfirmation(hillcrest!)).toBe("verified");
    expect(permitConfirmation(hillcrest!)).toBe("confirming");
  });
});

describe("price and permit labels", () => {
  it("formats prices and never invents one", () => {
    expect(priceLabel(riverside!)).toBe("Free");
    expect(priceLabel(hillcrest!)).toBe("$120/hr");
    expect(priceLabel(oakHill!)).toBe("Price unknown");
    expect(pinLabel(oakHill!)).toBe("$?");
    expect(priceLabel({ price_status: "paid", price_min: 60, price_max: 90, price_unit: "hour", price_text: null })).toBe("$60–90/hr");
  });
  it("shows permit chips", () => {
    expect(permitChip(riverside!)?.label).toBe("No permit");
    expect(permitChip(hillcrest!)?.label).toBe("Permit needed");
    expect(permitChip(lakeview!)?.label).toBe("Membership");
    expect(permitChip(oakHill!)).toBeNull();
  });
});

describe("filterFields", () => {
  it("applies chips and search", () => {
    expect(filterFields(SAMPLE_FIELDS, { ...NO_FIELD_FILTERS, free: true }).map((f) => f.venue.name)).toEqual(["Riverside Park Field"]);
    expect(filterFields(SAMPLE_FIELDS, { ...NO_FIELD_FILTERS, turf: true, lights: true })).toHaveLength(2);
    expect(filterFields(SAMPLE_FIELDS, { ...NO_FIELD_FILTERS, noPermit: true })).toHaveLength(1);
    expect(filterFields(SAMPLE_FIELDS, { ...NO_FIELD_FILTERS, query: "westport" })).toHaveLength(1);
  });
});

describe("request helpers", () => {
  it("estimates hours times the hourly price", () => {
    expect(requestEstimate(hillcrest!, 2)).toEqual({ label: "$240", cents: 24000 });
    expect(requestEstimate(riverside!, 2).label).toBe("Free");
    expect(requestEstimate(oakHill!, 2).cents).toBeNull();
  });
  it("lists every day from tomorrow through 30 days out, weekdays included", () => {
    const days = requestDays(new Date("2026-10-13T16:00:00Z")); // Tue Oct 13 2026, midday Eastern
    expect(days).toHaveLength(30);
    expect(days[0]).toMatchObject({ iso: "2026-10-14", weekday: "Wed", dayNum: 14, weekend: false });
    expect(days[29]!.iso).toBe("2026-11-12");
    expect(days.filter((d) => !d.weekend).length).toBeGreaterThan(15);
    expect(days.find((d) => d.iso === "2026-11-01")).toMatchObject({ month: "Nov", dayNum: 1 });
    expect(days[3]!.long).toBe("Sat, Oct 17");
  });
  it("starts on the first weekend day in range", () => {
    expect(defaultDay(requestDays(new Date("2026-10-13T16:00:00Z")))).toBe("2026-10-17");
  });
  it("uses the Eastern date for today late in the evening", () => {
    // 01:00Z on Oct 14 is 9 PM Oct 13 in Eastern: tomorrow is still Oct 14
    expect(requestDays(new Date("2026-10-14T01:00:00Z"))[0]!.iso).toBe("2026-10-14");
  });
  it("clamps players", () => {
    expect(clampPlayers(0)).toBe(2);
    expect(clampPlayers(99)).toBe(30);
  });
});

import { adminNewRequestPush, draftEmail, draftMailto, formatRequestWhen, isAdminSettableStatus, playerStatusPush } from "../shared/fields/requestEmail";

describe("request email and pushes", () => {
  it("formats the requested time", () => {
    expect(formatRequestWhen("2026-10-17", "11:00:00", 2)).toBe("Sat, Oct 17, 11 AM–1 PM");
    expect(formatRequestWhen("2026-10-18", "18:00", 2)).toBe("Sun, Oct 18, 6 PM–8 PM");
    expect(formatRequestWhen("2026-10-17", "09:00", 1.5)).toBe("Sat, Oct 17, 9 AM–10:30 AM");
  });
  it("drafts an email with no player details", () => {
    const d = draftEmail({ venueName: "Hillcrest High School Turf", venueKind: "school", date: "2026-10-17", start: "11:00", hours: 2, players: 14 });
    expect(d.subject).toContain("Hillcrest High School Turf");
    expect(d.body).toContain("about 14 players");
    expect(d.body).toContain("facility-use process");
  });
  it("builds a mailto that works with no address on file", () => {
    const d = { subject: "A b", body: "Hi\nthere" };
    expect(draftMailto(null, d)).toBe("mailto:?subject=A%20b&body=Hi%0Athere");
    expect(draftMailto("a@b.org", d).startsWith("mailto:a%40b.org?")).toBe(true);
  });
  it("only lets admins set the three working statuses", () => {
    expect(isAdminSettableStatus("approved")).toBe(true);
    expect(isAdminSettableStatus("new")).toBe(false);
    expect(isAdminSettableStatus("cancelled")).toBe(false);
  });
  it("writes player and admin push text", () => {
    expect(playerStatusPush("approved", "Hillcrest", "Sat, Oct 17, 11 AM–1 PM")?.title).toBe("Field approved");
    expect(playerStatusPush("new", "Hillcrest", "x")).toBeNull();
    expect(adminNewRequestPush("Sam", "Hillcrest", "Sat", 14).body).toBe("Sam · Hillcrest · Sat · 14 players");
  });
});

import { routeForPushData } from "../mobile/lib/pushRouting";
import { statusLabel, trackerSteps } from "../mobile/lib/fields/requestTracker";

const RID = "123e4567-e89b-12d3-a456-426614174000";

describe("push tap routing", () => {
  it("sends a player to their request", () => {
    expect(routeForPushData({ screen: "field-requests", request_id: RID }, { isAdmin: false })).toBe(`/field-requests?request=${RID}`);
    expect(routeForPushData({ screen: "field-requests" }, { isAdmin: false })).toBe("/field-requests");
  });
  it("sends an admin to the queue, and nobody else", () => {
    expect(routeForPushData({ screen: "admin/field-requests", request_id: RID }, { isAdmin: true })).toBe("/admin/field-requests");
    expect(routeForPushData({ screen: "admin/field-requests" }, { isAdmin: false })).toBeNull();
  });
  it("ignores other pushes and bad ids", () => {
    expect(routeForPushData({ screen: "admin/verification" }, { isAdmin: true })).toBeNull();
    expect(routeForPushData(null, { isAdmin: true })).toBeNull();
    expect(routeForPushData({ screen: "field-requests", request_id: "../../x" }, { isAdmin: false })).toBe("/field-requests");
  });
});

describe("request tracker", () => {
  it("moves through the four steps", () => {
    expect(trackerSteps("new").map((s) => s.state)).toEqual(["done", "todo", "todo", "todo"]);
    expect(trackerSteps("waiting_on_school").map((s) => s.state)).toEqual(["done", "done", "todo", "todo"]);
    expect(trackerSteps("approved").map((s) => s.state)).toEqual(["done", "done", "done", "done"]);
  });
  it("ends a declined request at the venue and never confirms it", () => {
    const steps = trackerSteps("declined");
    expect(steps.at(-1)?.state).toBe("declined");
    expect(steps.some((s) => s.title === "You're confirmed")).toBe(false);
  });
  it("labels statuses", () => {
    expect(statusLabel("waiting_on_school")).toBe("Waiting on the venue");
  });
});

import { buildDay, hourLabel, scheduleDays } from "../mobile/lib/fields/schedule";
import { eventDateBlock, eventJoinedLabel, eventPriceLabel, eventSourceLabel, eventTimeLabel, filterEvents, type EventRow } from "../mobile/lib/fields/events";

describe("schedule day", () => {
  // Oct 17 2026 is EDT (UTC-4). 10:00-12:00 local = 14:00-16:00Z.
  const slots = [
    { starts_at: "2026-10-17T14:00:00Z", ends_at: "2026-10-17T15:00:00Z", status: "booked" as const, title: "Youth league" },
    { starts_at: "2026-10-17T18:00:00Z", ends_at: "2026-10-17T20:00:00Z", status: "booked" as const, title: "Varsity practice" },
  ];
  const own = [{ requested_date: "2026-10-17", start_time: "11:00:00", duration_hours: 2 }];
  it("never shows Open when the calendar is not connected", () => {
    const rows = buildDay({ date: "2026-10-17", slots, ownRequests: own, calendarConnected: false });
    expect(rows.some((r) => r.status === "open")).toBe(false);
    expect(rows.find((r) => r.hour === 8)?.status).toBe("unknown");
    expect(rows.find((r) => r.hour === 10)).toMatchObject({ status: "booked", title: "Youth league" });
    expect(rows.find((r) => r.hour === 11)).toMatchObject({ status: "pending", title: "Your pickup game" });
    expect(rows.find((r) => r.hour === 12)?.status).toBe("pending");
    expect(rows.find((r) => r.hour === 14)).toMatchObject({ status: "booked", title: "Varsity practice" });
    expect(rows.find((r) => r.hour === 16)?.status).toBe("unknown");
  });
  it("shows free hours as Open only when connected", () => {
    const rows = buildDay({ date: "2026-10-17", slots, ownRequests: [], calendarConnected: true });
    expect(rows.find((r) => r.hour === 8)?.status).toBe("open");
    expect(rows.find((r) => r.hour === 10)?.status).toBe("booked");
  });
  it("lists seven days from today and labels hours", () => {
    const days = scheduleDays(new Date("2026-10-13T16:00:00Z"));
    expect(days).toHaveLength(7);
    expect(days[0]).toMatchObject({ iso: "2026-10-13", weekday: "Tue", dayNum: 13 });
    expect(days[6]!.iso).toBe("2026-10-19");
    expect(hourLabel(12)).toBe("12 PM");
    expect(hourLabel(8)).toBe("8 AM");
  });
});

describe("events", () => {
  const base: EventRow = {
    id: "1", title: "Saturday pickup 7v7", event_type: "pickup", starts_at: "2026-10-17T15:00:00Z", capacity: 14, joined_count: 8,
    price_cents: 1000, price_unit: "player", source: "manual", source_note: null, venue_key: "k", venues: { name: "Hillcrest" },
  };
  it("formats date, time, price and joined", () => {
    expect(eventDateBlock(base.starts_at)).toEqual({ weekday: "SAT", day: 17 });
    expect(eventTimeLabel(base.starts_at)).toBe("11 AM");
    expect(eventPriceLabel(base)).toBe("$10 each");
    expect(eventPriceLabel({ price_cents: 8000, price_unit: "team" })).toBe("$80 per team");
    expect(eventPriceLabel({ price_cents: 0, price_unit: null })).toBe("Free");
    expect(eventPriceLabel({ price_cents: null, price_unit: null })).toBeNull();
    expect(eventJoinedLabel(base)).toBe("8 of 14 joined");
    expect(eventJoinedLabel({ ...base, event_type: "tournament", capacity: 8, joined_count: 3 })).toBe("3 of 8 teams");
    expect(eventJoinedLabel({ ...base, capacity: null })).toBeNull();
  });
  it("labels imports and filters", () => {
    expect(eventSourceLabel({ source: "imported", source_note: null })).toBe("Imported from town calendar");
    expect(eventSourceLabel(base)).toBeNull();
    expect(filterEvents([base, { ...base, id: "2", event_type: "league" }], "league")).toHaveLength(1);
    expect(filterEvents([base], "all")).toHaveLength(1);
  });
});

import { guessProvider, normalizeCalendarUrl, parseIcs } from "../shared/fields/ics";

describe("ics reader", () => {
  const wrap = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}END:VCALENDAR\r\n`;
  it("reads UTC, zoned and all-day events", () => {
    const r = parseIcs(
      wrap(
        "BEGIN:VEVENT\r\nUID:a\r\nSUMMARY:Youth league\r\nDTSTART:20261017T140000Z\r\nDTEND:20261017T150000Z\r\nEND:VEVENT\r\n" +
          "BEGIN:VEVENT\r\nUID:b\r\nSUMMARY:Varsity\\, practice\r\nDTSTART;TZID=America/New_York:20261017T140000\r\nDURATION:PT2H\r\nEND:VEVENT\r\n" +
          "BEGIN:VEVENT\r\nUID:c\r\nDTSTART;VALUE=DATE:20261018\r\nEND:VEVENT\r\n",
      ),
    );
    expect(r.events).toHaveLength(3);
    expect(r.events[0]!.start.toISOString()).toBe("2026-10-17T14:00:00.000Z");
    expect(r.events[1]!.start.toISOString()).toBe("2026-10-17T18:00:00.000Z"); // 2 PM EDT
    expect(r.events[1]!.end.toISOString()).toBe("2026-10-17T20:00:00.000Z");
    expect(r.events[1]!.summary).toBe("Varsity, practice");
    expect(r.events[2]!.end.getTime() - r.events[2]!.start.getTime()).toBe(86400000);
  });
  it("flags recurring events instead of guessing, and skips cancelled ones", () => {
    const r = parseIcs(
      wrap(
        "BEGIN:VEVENT\r\nDTSTART:20261017T140000Z\r\nDTEND:20261017T150000Z\r\nRRULE:FREQ=WEEKLY\r\nEND:VEVENT\r\n" +
          "BEGIN:VEVENT\r\nDTSTART:20261018T140000Z\r\nDTEND:20261018T150000Z\r\nSTATUS:CANCELLED\r\nEND:VEVENT\r\n",
      ),
    );
    expect(r.recurring).toBe(1);
    expect(r.events).toHaveLength(0);
    expect(r.skipped).toBe(1);
  });
  it("accepts only https calendar links", () => {
    expect(normalizeCalendarUrl("webcal://x.org/a.ics")).toBe("https://x.org/a.ics");
    expect(normalizeCalendarUrl("http://x.org/a.ics")).toBeNull();
    expect(normalizeCalendarUrl("nonsense")).toBeNull();
    expect(guessProvider("https://calendar.google.com/calendar/ical/x/basic.ics")).toBe("google");
    expect(guessProvider("https://town.org/feed.ics")).toBe("ical");
  });
});

import { alertEnabled } from "../mobile/lib/fields/alerts";

describe("alert defaults", () => {
  it("uses the default when there is no row, and the row when there is", () => {
    expect(alertEnabled([], "request_updates")).toBe(true);
    expect(alertEnabled([], "weekly_roundup")).toBe(false);
    expect(alertEnabled([{ alert_type: "request_updates", enabled: false }], "request_updates")).toBe(false);
    expect(alertEnabled([{ alert_type: "weekly_roundup", enabled: true }], "weekly_roundup")).toBe(true);
  });
});

import { calendarCounts, calendarState } from "../mobile/lib/fields/calendars";

describe("venue calendars", () => {
  const now = Date.parse("2026-10-13T12:00:00Z");
  it("treats only a fresh live sync as live", () => {
    expect(calendarState({ sync_status: "live", last_synced_at: "2026-10-13T11:00:00Z" }, now)).toBe("live");
    expect(calendarState({ sync_status: "live", last_synced_at: "2026-10-11T11:00:00Z" }, now)).toBe("stale");
    expect(calendarState({ sync_status: "live", last_synced_at: null }, now)).toBe("stale");
    expect(calendarState({ sync_status: "failed", last_synced_at: "2026-10-13T11:00:00Z" }, now)).toBe("failed");
    expect(calendarState({ sync_status: "not_connected", last_synced_at: null }, now)).toBe("not_connected");
  });
  it("counts live, needs attention and unknown", () => {
    const rows = [
      { sync_status: "live" as const, last_synced_at: "2026-10-13T11:00:00Z" },
      { sync_status: "failed" as const, last_synced_at: null },
      { sync_status: "not_connected" as const, last_synced_at: null },
    ];
    expect(calendarCounts(rows, 600, now)).toEqual({ live: 1, needsAttention: 1, unknown: 599 });
  });
});

import { kindLabel, pinsInRegion, sortListings, toListing } from "../mobile/lib/fields/listings";

describe("real venue listings", () => {
  const mk = (key: string, name: string, lat: number | null, lon: number | null, priority: number | null, venue_type: string | null = "park") => ({
    ...SAMPLE_FIELDS[0]!.venue,
    venue_key: key,
    name,
    lat,
    lon,
    priority,
    venue_type: venue_type as never,
  });
  it("labels venue types", () => {
    expect(kindLabel({ venue_type: "school_public" })).toBe("Public school");
    expect(kindLabel({ venue_type: null })).toBe("Field");
  });
  it("adds distance only when the user's position is known", () => {
    const v = mk("a", "A", 41.2, -73.2, 1);
    expect(toListing(v).distance_mi).toBeNull();
    expect(toListing(v, { user: { lat: 41.2, lon: -73.2 } }).distance_mi).toBeCloseTo(0, 5);
    expect(toListing(v).calendar_connected).toBe(false);
    expect(toListing(v, { connected: true }).calendar_connected).toBe(true);
  });
  it("sorts nearest first, then priority, then name", () => {
    const near = toListing(mk("n", "Near", 41.2, -73.2, 1), { user: { lat: 41.2, lon: -73.2 } });
    const far = toListing(mk("f", "Far", 42.0, -72.0, 9), { user: { lat: 41.2, lon: -73.2 } });
    expect(sortListings([far, near]).map((l) => l.venue.venue_key)).toEqual(["n", "f"]);
    const a = toListing(mk("a", "Alpha", null, null, 1));
    const b = toListing(mk("b", "Beta", null, null, 3));
    const c = toListing(mk("c", "Charlie", null, null, 3));
    expect(sortListings([a, c, b]).map((l) => l.venue.venue_key)).toEqual(["b", "c", "a"]);
  });
  it("keeps only pins in view and caps them", () => {
    const list = Array.from({ length: 100 }, (_, i) => toListing(mk(`k${i}`, `V${i}`, 41.0 + i * 0.001, -73.0, 1)));
    const outside = toListing(mk("out", "Out", 45, -70, 1));
    const view = { latitude: 41.05, longitude: -73.0, latitudeDelta: 0.2, longitudeDelta: 0.2 };
    const pins = pinsInRegion([...list, outside], view, 60);
    expect(pins).toHaveLength(60);
    expect(pins.some((p) => p.venue.venue_key === "out")).toBe(false);
    expect(pinsInRegion([outside], view, 60)).toHaveLength(0);
    expect(pinsInRegion([toListing(mk("nl", "NoLoc", null, null, 1))], view, 60)).toHaveLength(0);
  });
});

import { clusterListings, clusterSize, fitRegion, initialRegion, MIN_CLUSTER_DELTA, regionForCluster } from "../mobile/lib/fields/clusters";

describe("map clustering", () => {
  const size = { width: 350, height: 240 };
  const venue = (key: string, lat: number | null, lon: number | null) => toListing({ ...SAMPLE_FIELDS[0]!.venue, venue_key: key, name: key, lat, lon });
  // ~0.2 degrees across 350 px => 0.001 degree is ~1.75 px, so a tight pack of 10 sits inside one 56 px circle.
  const wide = { latitude: 41.2, longitude: -73.2, latitudeDelta: 0.2, longitudeDelta: 0.3 };

  it("merges venues that would overlap into one numbered cluster", () => {
    const pack = Array.from({ length: 10 }, (_, i) => venue(`p${i}`, 41.2 + i * 0.0003, -73.2 + i * 0.0003));
    const lone = venue("lone", 41.28, -73.05);
    const items = clusterListings([...pack, lone], wide, size);
    const clusters = items.filter((i) => i.kind === "cluster");
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.kind === "cluster" && clusters[0]!.count).toBe(10);
    expect(items.filter((i) => i.kind === "pin").map((i) => i.key)).toEqual(["lone"]);
  });
  it("shows individual pins when they do not overlap", () => {
    const a = venue("a", 41.1, -73.3);
    const b = venue("b", 41.3, -73.1);
    expect(clusterListings([a, b], wide, size).every((i) => i.kind === "pin")).toBe(true);
  });
  it("splits a cluster as the map zooms in", () => {
    const list = [venue("a", 41.2, -73.2), venue("b", 41.2, -73.1985), venue("c", 41.2, -73.197)];
    expect(clusterListings(list, wide, size)).toHaveLength(1);
    const zoomed = { ...wide, latitudeDelta: 0.005, longitudeDelta: 0.007 };
    // At the closest zoom nothing is merged, even venues on the same spot.
    expect(clusterListings(list, { ...zoomed, latitudeDelta: MIN_CLUSTER_DELTA, longitudeDelta: 0.008 }, size).every((i) => i.kind === "pin")).toBe(true);
    const mid = { latitude: 41.2, longitude: -73.1985, latitudeDelta: 0.007, longitudeDelta: 0.0045 };
    expect(clusterListings(list, mid, size).length).toBeGreaterThan(1);
  });
  it("drops venues outside the view and without coordinates, and keeps the cap", () => {
    const many = Array.from({ length: 200 }, (_, i) => venue(`m${i}`, 41.1 + (i % 20) * 0.01, -73.3 + Math.floor(i / 20) * 0.02));
    const items = clusterListings([...many, venue("far", 45, -70), venue("noloc", null, null)], { latitude: 41.2, longitude: -73.2, latitudeDelta: 0.4, longitudeDelta: 0.5 }, { width: 3000, height: 2000 }, { cap: 60 });
    expect(items.length).toBeLessThanOrEqual(60);
    expect(items.some((i) => i.key === "far" || i.key === "noloc")).toBe(false);
  });
  it("opens near the user, or around the best venue's nearest neighbors without a position", () => {
    const list = Array.from({ length: 40 }, (_, i) => venue(`v${i}`, 41.0 + i * 0.02, -73.5 + i * 0.01));
    const user = initialRegion(list, { lat: 41.15, lon: -73.25 });
    expect(user).toMatchObject({ latitude: 41.15, longitude: -73.25 });
    expect(user!.latitudeDelta).toBeLessThan(0.2);
    const none = initialRegion(list, null)!;
    // 15 nearest of a 40-venue line spans 14 steps of 0.02 degrees, well under the whole 0.78 span
    expect(none.latitudeDelta).toBeLessThan(0.5);
    expect(none.latitudeDelta).toBeGreaterThan(0.2);
    expect(initialRegion([], null)).toBeNull();
    expect(fitRegion([])).toBeNull();
  });
  it("zooms a tapped cluster in at least 3x and sizes bubbles by count", () => {
    const members = [venue("a", 41.2, -73.2), venue("b", 41.21, -73.21)];
    const r = regionForCluster(members, wide);
    expect(r.latitudeDelta).toBeLessThanOrEqual(wide.latitudeDelta / 3 + 1e-9);
    expect(r.latitudeDelta).toBeGreaterThan(0);
    const same = regionForCluster([venue("x", 41.2, -73.2), venue("y", 41.2, -73.2)], wide);
    expect(same.latitudeDelta).toBeLessThan(MIN_CLUSTER_DELTA + 1e-9);
    expect(clusterSize(2)).toBeLessThan(clusterSize(50));
    expect(clusterSize(5000)).toBe(56);
  });
});

import { addDaysIso, DURATIONS, durationLabel, etToday, isDateInWindow, isValidDuration, isValidStartTime, START_TIMES, timeLabel12 } from "../shared/fields/requestRules";
import { windowStatus } from "../mobile/lib/fields/schedule";

describe("request rules", () => {
  it("offers every 30 minutes from 7 AM to 9 PM", () => {
    expect(START_TIMES).toHaveLength(29);
    expect(START_TIMES[0]).toBe("07:00");
    expect(START_TIMES[1]).toBe("07:30");
    expect(START_TIMES.at(-1)).toBe("21:00");
    expect(START_TIMES).not.toContain("21:30");
    expect(START_TIMES).not.toContain("06:30");
  });
  it("validates start times and lengths", () => {
    expect(isValidStartTime("07:30")).toBe(true);
    expect(isValidStartTime("13:00:00")).toBe(true);
    expect(isValidStartTime("21:00")).toBe(true);
    expect(isValidStartTime("06:30")).toBe(false);
    expect(isValidStartTime("21:30")).toBe(false);
    expect(isValidStartTime("11:15")).toBe(false);
    expect(isValidStartTime(null)).toBe(false);
    expect([...DURATIONS]).toEqual([1, 1.5, 2]);
    expect(isValidDuration(1.5)).toBe(true);
    expect(isValidDuration(3)).toBe(false);
    expect(isValidDuration("2")).toBe(false);
  });
  it("accepts dates from tomorrow to 30 days out only", () => {
    const today = "2026-10-13";
    expect(isDateInWindow("2026-10-13", today)).toBe(false);
    expect(isDateInWindow("2026-10-14", today)).toBe(true);
    expect(isDateInWindow("2026-11-12", today)).toBe(true);
    expect(isDateInWindow("2026-11-13", today)).toBe(false);
    expect(isDateInWindow("nope", today)).toBe(false);
    expect(addDaysIso("2026-10-31", 1)).toBe("2026-11-01");
    expect(etToday(new Date("2026-10-14T01:00:00Z"))).toBe("2026-10-13");
  });
  it("labels times and lengths", () => {
    expect(timeLabel12("07:00")).toBe("7:00 AM");
    expect(timeLabel12("12:30")).toBe("12:30 PM");
    expect(timeLabel12("21:00")).toBe("9:00 PM");
    expect(durationLabel(1)).toBe("1 hour");
    expect(durationLabel(1.5)).toBe("1.5 hours");
  });
  it("drafts the email and times correctly for a half-hour weekday request", () => {
    expect(formatRequestWhen("2026-10-14", "07:30", 1.5)).toBe("Wed, Oct 14, 7:30 AM–9 AM");
    expect(formatRequestWhen("2026-10-15", "20:30", 2)).toBe("Thu, Oct 15, 8:30 PM–10:30 PM");
  });
});

describe("requested window status", () => {
  // Oct 17 2026 is EDT (UTC-4): a booking 10:00-11:00 local is 14:00-15:00Z.
  const slots = [{ starts_at: "2026-10-17T14:00:00Z", ends_at: "2026-10-17T15:00:00Z", status: "booked" as const, title: "Youth league" }];
  it("never says Open without a connected calendar", () => {
    expect(windowStatus({ date: "2026-10-17", start: "08:00", hours: 1, slots, calendarConnected: false })).toBe("unknown");
    expect(windowStatus({ date: "2026-10-17", start: "12:00", hours: 2, slots: [], calendarConnected: false })).toBe("unknown");
  });
  it("always flags a known booking, connected or not, including partial overlap", () => {
    expect(windowStatus({ date: "2026-10-17", start: "10:30", hours: 1, slots, calendarConnected: false })).toBe("booked");
    expect(windowStatus({ date: "2026-10-17", start: "09:30", hours: 1, slots, calendarConnected: true })).toBe("booked");
    expect(windowStatus({ date: "2026-10-17", start: "09:00", hours: 1, slots, calendarConnected: true })).toBe("open");
    expect(windowStatus({ date: "2026-10-17", start: "11:00", hours: 1, slots, calendarConnected: true })).toBe("open");
  });
  it("uses the chosen length when checking for overlap", () => {
    expect(windowStatus({ date: "2026-10-17", start: "09:00", hours: 1.5, slots, calendarConnected: true })).toBe("booked");
    expect(windowStatus({ date: "2026-10-17", start: "09:00", hours: 1, slots, calendarConnected: true })).toBe("open");
  });
});
