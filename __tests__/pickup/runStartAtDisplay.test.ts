import { describe, expect, it } from "vitest";
import {
  etDateKey,
  fmtPickupDateTimeEt,
  fmtPickupRunDateDisplay,
  fmtPickupSlotChipEt,
  fmtPickupTimeEt,
  fmtPickupWhenEt,
  runTimeTbd,
} from "@/lib/pickup/runStartAtDisplay";
import { seasonForStartAt } from "@/lib/pickup/points";

const norm = (s: string) => s.replace(/\u202f/g, " ");

describe("midnight UTC is a real evening kickoff in Eastern time", () => {
  it("2026-07-15T00:00:00Z is 8:00 PM Tue Jul 14 (EDT)", () => {
    const iso = "2026-07-15T00:00:00Z";
    expect(norm(fmtPickupTimeEt(iso))).toBe("8:00 PM");
    expect(norm(fmtPickupSlotChipEt(iso))).toBe("Tue, Jul 14 · 8:00 PM");
    expect(fmtPickupRunDateDisplay(iso)).toBe("Tue, Jul 14, 2026");
    expect(etDateKey(iso)).toBe("2026-07-14");
  });

  it("2026-01-15T00:00:00Z is 7:00 PM Wed Jan 14 (EST)", () => {
    const iso = "2026-01-15T00:00:00+00:00";
    expect(norm(fmtPickupTimeEt(iso))).toBe("7:00 PM");
    expect(norm(fmtPickupSlotChipEt(iso))).toBe("Wed, Jan 14 · 7:00 PM");
    expect(norm(fmtPickupDateTimeEt(iso))).toBe("Wed, Jan 14, 2026, 7:00 PM");
  });
});

describe("time-TBD runs", () => {
  it("show Time TBD on the right Eastern date (noon ET), across DST changes", () => {
    expect(fmtPickupSlotChipEt("2026-07-15T16:00:00.000Z", true)).toBe("Wed, Jul 15 · Time TBD");
    expect(fmtPickupSlotChipEt("2026-03-08T16:00:00.000Z", true)).toBe("Sun, Mar 8 · Time TBD");
    expect(fmtPickupSlotChipEt("2026-11-01T17:00:00.000Z", true)).toBe("Sun, Nov 1 · Time TBD");
    expect(fmtPickupDateTimeEt("2026-01-15T17:00:00.000Z", true)).toBe("Thu, Jan 15, 2026 · Time TBD");
    expect(fmtPickupTimeEt("2026-01-15T17:00:00.000Z", true)).toBe("Time TBD");
  });

  it("reads time_tbd strictly; a missing column is not TBD", () => {
    expect(runTimeTbd({ time_tbd: true })).toBe(true);
    expect(runTimeTbd({ time_tbd: false })).toBe(false);
    expect(runTimeTbd({})).toBe(false);
    expect(runTimeTbd(null)).toBe(false);
  });
});

describe("near midnight Eastern", () => {
  it("11:30 PM ET stays on its Eastern day", () => {
    const iso = "2026-07-15T03:30:00Z";
    expect(norm(fmtPickupSlotChipEt(iso))).toBe("Tue, Jul 14 · 11:30 PM");
    expect(etDateKey(iso)).toBe("2026-07-14");
  });

  it("12:15 AM ET is the next Eastern day", () => {
    const iso = "2026-07-15T04:15:00Z";
    expect(norm(fmtPickupSlotChipEt(iso))).toBe("Wed, Jul 15 · 12:15 AM");
    expect(etDateKey(iso)).toBe("2026-07-15");
  });
});

describe("fmtPickupWhenEt", () => {
  const now = Date.parse("2026-07-14T14:00:00Z");
  it("uses Eastern today and tomorrow", () => {
    expect(norm(fmtPickupWhenEt("2026-07-15T00:00:00Z", false, now))).toBe("Today · 8:00 PM");
    expect(fmtPickupWhenEt("2026-07-15T16:00:00Z", true, now)).toBe("Tomorrow · Time TBD");
    expect(norm(fmtPickupWhenEt("2026-07-17T00:00:00Z", false, now))).toBe("Thu, Jul 16 · 8:00 PM");
  });
});

describe("season by Eastern date", () => {
  it("an Aug 31 8pm EDT game is Summer 2026", () => {
    expect(seasonForStartAt("2026-09-01T00:00:00Z")).toBe("Summer 2026");
  });
});
