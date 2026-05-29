import { describe, expect, it } from "vitest";
import {
  easternDatetimeLocalToIsoUtc,
  parsePickupAdminDatetimeToUtcIso,
  pickupDateOnlyStartAtFromEtInstant,
  pickupDateOnlyStartAtFromPollDateString,
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

  it("builds date-only start_at from Eastern calendar day", () => {
    expect(parsePickupAdminDatetimeToUtcIso("2026-05-25")).toBe("2026-05-25T00:00:00.000Z");
  });

  it("maps poll_date string to UTC midnight without timezone shift", () => {
    expect(pickupDateOnlyStartAtFromPollDateString("2026-05-31")).toBe("2026-05-31T00:00:00.000Z");
  });

  it("derives date-only anchor from kickoff instant in Eastern", () => {
    const kickoff = easternDatetimeLocalToIsoUtc("2026-05-25T20:00");
    expect(kickoff).toBeTruthy();
    expect(pickupDateOnlyStartAtFromEtInstant(kickoff!)).toBe("2026-05-25T00:00:00.000Z");
  });
});
