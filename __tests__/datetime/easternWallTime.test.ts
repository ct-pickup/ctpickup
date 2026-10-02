import { describe, expect, it } from "vitest";
import {
  easternDatetimeLocalToIsoUtc,
  parsePickupAdminDatetimeToUtcIso,
  parsePickupStartInput,
  pickupStartFromHostBody,
  pickupTimeTbdStartAtFromDateString,
  pickupTimeTbdStartAtFromEtInstant,
} from "@/lib/datetime/easternWallTime";

describe("parsePickupAdminDatetimeToUtcIso", () => {
  it("converts Eastern wall-clock datetime-local to UTC (EDT)", () => {
    expect(parsePickupAdminDatetimeToUtcIso("2026-05-25T20:00")).toBe("2026-05-26T00:00:00.000Z");
  });

  it("does not treat Eastern wall clock as UTC when sent without offset", () => {
    const fromEt = parsePickupAdminDatetimeToUtcIso("2026-05-25T20:00");
    const asAbsoluteUtc = parsePickupAdminDatetimeToUtcIso("2026-05-25T20:00:00.000Z");
    expect(fromEt).toBe("2026-05-26T00:00:00.000Z");
    expect(asAbsoluteUtc).toBe("2026-05-25T20:00:00.000Z");
    expect(fromEt).not.toBe(asAbsoluteUtc);
  });

  it("maps a bare date to noon Eastern", () => {
    expect(parsePickupAdminDatetimeToUtcIso("2026-05-25")).toBe("2026-05-25T16:00:00.000Z");
  });
});

describe("time-TBD start_at", () => {
  it("is noon Eastern on the day, DST-aware", () => {
    expect(pickupTimeTbdStartAtFromDateString("2026-07-15")).toBe("2026-07-15T16:00:00.000Z");
    expect(pickupTimeTbdStartAtFromDateString("2026-01-15")).toBe("2026-01-15T17:00:00.000Z");
    expect(pickupTimeTbdStartAtFromDateString("2026-03-08")).toBe("2026-03-08T16:00:00.000Z");
    expect(pickupTimeTbdStartAtFromDateString("2026-11-01")).toBe("2026-11-01T17:00:00.000Z");
  });

  it("rejects impossible days", () => {
    expect(() => pickupTimeTbdStartAtFromDateString("2026-02-30")).toThrow();
  });

  it("uses the Eastern day of a kickoff instant", () => {
    const kickoff = easternDatetimeLocalToIsoUtc("2026-05-25T20:00");
    expect(pickupTimeTbdStartAtFromEtInstant(kickoff!)).toBe("2026-05-25T16:00:00.000Z");
    expect(pickupTimeTbdStartAtFromEtInstant("2026-07-15T00:00:00Z")).toBe("2026-07-14T16:00:00.000Z");
  });
});

describe("parsePickupStartInput", () => {
  it("marks a date with no time as time TBD", () => {
    expect(parsePickupStartInput("2026-07-15")).toEqual({ start_at: "2026-07-15T16:00:00.000Z", time_tbd: true });
  });

  it("keeps real times as real times", () => {
    expect(parsePickupStartInput("2026-07-14T20:00")).toEqual({ start_at: "2026-07-15T00:00:00.000Z", time_tbd: false });
    expect(parsePickupStartInput("2026-07-15T00:00:00Z")).toEqual({ start_at: "2026-07-15T00:00:00.000Z", time_tbd: false });
  });
});

describe("pickupStartFromHostBody", () => {
  it("host create with no time stores noon Eastern and time_tbd", () => {
    expect(pickupStartFromHostBody({ start_date: "2026-07-15", start_time: null })).toEqual({
      start_at: "2026-07-15T16:00:00.000Z",
      time_tbd: true,
    });
    expect(pickupStartFromHostBody({ start_date: "2026-01-15" })).toEqual({
      start_at: "2026-01-15T17:00:00.000Z",
      time_tbd: true,
    });
  });

  it("host create with a time stores the Eastern kickoff", () => {
    expect(pickupStartFromHostBody({ start_date: "2026-07-14", start_time: "20:00" })).toEqual({
      start_at: "2026-07-15T00:00:00.000Z",
      time_tbd: false,
    });
  });

  it("falls back to start_at and rejects bad input", () => {
    expect(pickupStartFromHostBody({ start_at: "2026-07-15T00:00:00.000Z" })?.time_tbd).toBe(false);
    expect(pickupStartFromHostBody({ start_date: "07/15/2026" })).toBeNull();
    expect(pickupStartFromHostBody({ start_date: "2026-07-15", start_time: "8pm" })).toBeNull();
    expect(pickupStartFromHostBody({})).toBeNull();
  });
});
