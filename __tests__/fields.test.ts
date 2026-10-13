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
import { clampPlayers, weekendDays } from "../mobile/lib/fields/requestOptions";
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
  it("lists the next weekend days after today", () => {
    const days = weekendDays(new Date(2026, 9, 13), 4); // Tue Oct 13 2026
    expect(days.map((d) => d.iso)).toEqual(["2026-10-17", "2026-10-18", "2026-10-24", "2026-10-25"]);
    expect(days[0]!.long).toBe("Sat, Oct 17");
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
