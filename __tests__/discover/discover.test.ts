import { describe, expect, it } from "vitest";

import {
  DISCOVER_PICK_COUNT,
  DISCOVER_REASON_THRESHOLDS,
  discoverReasons,
  discoverScore,
  displayName,
  looksLikeHandle,
  MAX_DISCOVER_REASONS,
  mutualsFit,
  normalizeFullName,
  normalizeHandle,
  SEARCH_HITS_PER_HOUR,
  SEARCH_MAX_RESULTS,
  weekStartET,
} from "@/shared/discover";

describe("discover week", () => {
  it("pins the week to Monday in Eastern time", () => {
    // Wednesday 2026-10-07 12:00 ET
    expect(weekStartET(new Date("2026-10-07T16:00:00Z"))).toBe("2026-10-05");
    // The Monday itself
    expect(weekStartET(new Date("2026-10-05T12:00:00Z"))).toBe("2026-10-05");
    // Sunday belongs to the week that began six days earlier
    expect(weekStartET(new Date("2026-10-11T16:00:00Z"))).toBe("2026-10-05");
  });

  it("rolls over at Monday 00:00 ET, not UTC", () => {
    // Sunday 23:30 ET is 03:30 UTC Monday: still the old week.
    expect(weekStartET(new Date("2026-10-12T03:30:00Z"))).toBe("2026-10-05");
    // Monday 00:30 ET is 04:30 UTC: the new week.
    expect(weekStartET(new Date("2026-10-12T04:30:00Z"))).toBe("2026-10-12");
  });

  it("is stable across every hour of a week", () => {
    const seen = new Set<string>();
    for (let h = 0; h < 24 * 7; h += 1) {
      seen.add(weekStartET(new Date(Date.parse("2026-10-05T04:00:00Z") + h * 3_600_000)));
    }
    expect(seen.size).toBe(1);
  });
});

describe("discover reasons", () => {
  const base = { level: 0, position: 0, distance: 0, mutuals: 0, positionLabel: null, driveMinutes: null, mutualCount: 0 };

  it("names a close level", () => {
    expect(discoverReasons({ ...base, level: 1 })).toEqual(["Same level"]);
  });

  it("only claims the same position on an exact match", () => {
    expect(discoverReasons({ ...base, position: 1, positionLabel: "CB" })).toEqual(["Also a CB"]);
    // Same group but not the same position sits below the threshold.
    expect(discoverReasons({ ...base, position: 0.6, positionLabel: "CB" })).toEqual([]);
  });

  it("reports drive time in whole minutes", () => {
    expect(discoverReasons({ ...base, distance: 0.8, driveMinutes: 11.6 })).toEqual(["12 min away"]);
  });

  it("pluralises mutual teammates", () => {
    expect(discoverReasons({ ...base, mutuals: 1, mutualCount: 1 })).toEqual(["1 mutual teammate"]);
    expect(discoverReasons({ ...base, mutuals: 1, mutualCount: 3 })).toEqual(["3 mutual teammates"]);
  });

  it("returns the two strongest reasons, strongest first", () => {
    const reasons = discoverReasons({
      level: 1,
      position: 1,
      distance: 0.9,
      mutuals: 0.4,
      positionLabel: "ST",
      driveMinutes: 5,
      mutualCount: 1,
    });
    expect(reasons).toHaveLength(MAX_DISCOVER_REASONS);
    expect(reasons[0]).toBe("Same level");
  });

  it("stays quiet when nothing clears its threshold", () => {
    expect(discoverReasons({ ...base, level: 0.5, distance: 0.1 })).toEqual([]);
  });

  it("never emits a score or percentage", () => {
    const reasons = discoverReasons({
      level: 1,
      position: 1,
      distance: 1,
      mutuals: 1,
      positionLabel: "CM",
      driveMinutes: 9,
      mutualCount: 4,
    });
    for (const r of reasons) {
      expect(r).not.toMatch(/%/);
      expect(r).not.toMatch(/score/i);
    }
  });
});

describe("discover scoring", () => {
  it("weights level most heavily", () => {
    const onlyLevel = discoverScore({ level: 1, position: 0, distance: 0, mutuals: 0 });
    const onlyPosition = discoverScore({ level: 0, position: 1, distance: 0, mutuals: 0 });
    const onlyDistance = discoverScore({ level: 0, position: 0, distance: 1, mutuals: 0 });
    expect(onlyLevel).toBeGreaterThan(onlyDistance);
    expect(onlyDistance).toBeGreaterThan(onlyPosition);
  });

  it("is bounded by 1", () => {
    expect(discoverScore({ level: 1, position: 1, distance: 1, mutuals: 1 })).toBeCloseTo(1, 5);
  });

  it("saturates mutual teammates", () => {
    expect(mutualsFit(0)).toBe(0);
    expect(mutualsFit(3)).toBe(1);
    expect(mutualsFit(9)).toBe(1);
    expect(mutualsFit(1)).toBeCloseTo(1 / 3, 5);
    expect(mutualsFit(1)).toBeGreaterThanOrEqual(DISCOVER_REASON_THRESHOLDS.mutuals);
  });
});

describe("discover names and handles", () => {
  it("shows a first name and last initial only", () => {
    expect(displayName("Sam", "R")).toBe("Sam R.");
    expect(displayName("Sam", null)).toBe("Sam");
    expect(displayName(null, "R")).toBe("Player");
  });

  it("normalises names for exact matching", () => {
    expect(normalizeFullName("  Sam   Rivera ")).toBe("sam rivera");
    expect(normalizeFullName("SAM RIVERA")).toBe(normalizeFullName("sam rivera"));
  });

  it("normalises handles and spots them", () => {
    expect(normalizeHandle("@Sam.Rivera")).toBe("sam.rivera");
    expect(normalizeHandle("sam.rivera")).toBe("sam.rivera");
    expect(looksLikeHandle("@sam")).toBe(true);
    expect(looksLikeHandle("sam")).toBe(false);
  });
});

describe("discover limits", () => {
  it("holds the documented limits", () => {
    expect(DISCOVER_PICK_COUNT).toBe(5);
    expect(SEARCH_MAX_RESULTS).toBe(3);
    expect(SEARCH_HITS_PER_HOUR).toBe(30);
    expect(MAX_DISCOVER_REASONS).toBe(2);
  });
});
