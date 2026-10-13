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
    expect(slotStatus({ calendarConnected: false, booked: true, yourRequest: false })).toBe("unknown");
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
