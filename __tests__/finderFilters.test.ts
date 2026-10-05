import { describe, expect, it } from "vitest";
import { activeFilterCount, distanceMiles, filterRuns, NO_FINDER_FILTERS, timeOfDayOf, type FinderRun } from "../mobile/lib/finderFilters";

// Wed 2026-10-07 12:00 ET
const NOW = Date.parse("2026-10-07T16:00:00Z");

function run(id: string, startIso: string, over: Partial<FinderRun> = {}): FinderRun {
  return { id, start_at: startIso, latitude: 41.17, longitude: -73.2, fee_cents: 0, ...over };
}

const none = new Map<string, number>();

describe("time of day (Eastern)", () => {
  it("buckets by the Eastern hour, not UTC", () => {
    expect(timeOfDayOf("2026-10-07T13:00:00Z")).toBe("morning"); // 9 AM ET
    expect(timeOfDayOf("2026-10-07T17:00:00Z")).toBe("afternoon"); // 1 PM ET
    expect(timeOfDayOf("2026-10-07T23:30:00Z")).toBe("evening"); // 7:30 PM ET
    expect(timeOfDayOf("2026-10-08T02:00:00Z")).toBe("evening"); // 10 PM ET the day before
  });
});

describe("filterRuns", () => {
  const today = run("today", "2026-10-07T23:00:00Z"); // 7 PM ET Wed
  const sat = run("sat", "2026-10-10T14:00:00Z"); // Sat 10 AM ET
  const nextWeek = run("next", "2026-10-14T23:00:00Z");
  const all = [today, sat, nextWeek];

  it("returns everything with no filters", () => {
    expect(filterRuns(all, NO_FINDER_FILTERS, none, NOW)).toHaveLength(3);
    expect(activeFilterCount(NO_FINDER_FILTERS)).toBe(0);
  });

  it("filters by day in Eastern time", () => {
    expect(filterRuns(all, { ...NO_FINDER_FILTERS, day: { kind: "today" } }, none, NOW).map((r) => r.id)).toEqual(["today"]);
    expect(filterRuns(all, { ...NO_FINDER_FILTERS, day: { kind: "week" } }, none, NOW).map((r) => r.id)).toEqual(["today", "sat"]);
    expect(filterRuns(all, { ...NO_FINDER_FILTERS, day: { kind: "date", key: "2026-10-14" } }, none, NOW).map((r) => r.id)).toEqual(["next"]);
  });

  it("combines filters with AND", () => {
    const f = { ...NO_FINDER_FILTERS, day: { kind: "week" } as const, timeOfDay: "morning" as const };
    expect(filterRuns(all, f, none, NOW).map((r) => r.id)).toEqual(["sat"]);
  });

  it("drops games with no kickoff time when a time of day is chosen", () => {
    const tbd = run("tbd", "2026-10-07T16:00:00Z", { time_tbd: true });
    expect(filterRuns([tbd], { ...NO_FINDER_FILTERS, timeOfDay: "afternoon" }, none, NOW)).toEqual([]);
  });

  it("filters by price", () => {
    const paid = run("paid", "2026-10-07T23:00:00Z", { fee_cents: 1000 });
    const list = [today, paid];
    expect(filterRuns(list, { ...NO_FINDER_FILTERS, price: "free" }, none, NOW).map((r) => r.id)).toEqual(["today"]);
    expect(filterRuns(list, { ...NO_FINDER_FILTERS, price: "paid" }, none, NOW).map((r) => r.id)).toEqual(["paid"]);
  });

  it("matches a star range against the game's minimum; open games always pass", () => {
    const high = run("high", "2026-10-07T23:00:00Z");
    const low = run("low", "2026-10-07T23:00:00Z");
    const open = run("open", "2026-10-07T23:00:00Z");
    const mins = new Map([["high", 4.0], ["low", 1.0]]);
    const f = { ...NO_FINDER_FILTERS, stars: { low: 3.5, high: 4.0 } };
    expect(filterRuns([high, low, open], f, mins, NOW).map((r) => r.id)).toEqual(["high", "open"]);
  });

  it("keeps only games inside a hub's radius", () => {
    const stamford = run("ct", "2026-10-07T23:00:00Z", { latitude: 41.05, longitude: -73.54 });
    const lewisburg = run("pa", "2026-10-07T23:00:00Z", { latitude: 40.96, longitude: -76.88 });
    const noCoords = run("none", "2026-10-07T23:00:00Z", { latitude: null, longitude: null });
    const f = { ...NO_FINDER_FILTERS, hubId: "fairfield" };
    expect(filterRuns([stamford, lewisburg, noCoords], f, none, NOW).map((r) => r.id)).toEqual(["ct"]);
    expect(filterRuns([stamford, lewisburg], { ...NO_FINDER_FILTERS, hubId: "bucknell" }, none, NOW).map((r) => r.id)).toEqual(["pa"]);
  });

  it("measures miles", () => {
    expect(Math.round(distanceMiles(40.73, -74.0, 41.2, -73.3))).toBeGreaterThan(40);
  });
});
