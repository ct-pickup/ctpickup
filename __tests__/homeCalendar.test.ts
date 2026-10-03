import { describe, expect, it } from "vitest";
import { addDays, monthGrid, monthOf, shiftMonth, weekDays, weekStart, weeksBetween } from "../mobile/lib/homeCalendar";
import { etDateKey } from "../mobile/lib/pickup/runStartAtDisplay";

describe("week math", () => {
  it("starts the week on Sunday", () => {
    expect(weekStart("2026-10-07")).toBe("2026-10-04"); // Wednesday
    expect(weekStart("2026-10-04")).toBe("2026-10-04"); // already Sunday
    expect(weekStart("2026-10-10")).toBe("2026-10-04"); // Saturday
  });

  it("lists seven days Sunday to Saturday, across month and year ends", () => {
    expect(weekDays("2026-10-04")).toEqual([
      "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10",
    ]);
    expect(weekDays(weekStart("2026-12-31")).at(-1)).toBe("2027-01-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("counts whole weeks between week starts", () => {
    expect(weeksBetween("2026-10-04", "2026-10-25")).toBe(3);
    expect(weeksBetween("2026-10-04", "2026-09-27")).toBe(-1);
  });
});

describe("month grid", () => {
  it("is six Sunday-first weeks that cover the month", () => {
    const grid = monthGrid({ year: 2026, month: 10 });
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe("2026-09-27"); // Oct 1 2026 is a Thursday
    expect(grid[4]).toBe("2026-10-01");
    expect(grid[34]).toBe("2026-10-31");
    expect(grid[41]).toBe("2026-11-07");
  });

  it("starts on the 1st when it is a Sunday", () => {
    expect(monthGrid({ year: 2026, month: 3 })[0]).toBe("2026-03-01");
  });

  it("shifts months across the year boundary", () => {
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(monthOf("2026-10-07")).toEqual({ year: 2026, month: 10 });
  });
});

describe("which day a game lands on", () => {
  it("a summer game stored at midnight UTC is the previous Eastern evening", () => {
    // 00:00 UTC on Jul 14 is 8:00 PM EDT on Jul 13.
    expect(etDateKey("2026-07-14T00:00:00Z")).toBe("2026-07-13");
  });

  it("a winter game stored at midnight UTC is also the previous day (EST, UTC-5)", () => {
    expect(etDateKey("2026-01-15T00:00:00Z")).toBe("2026-01-14");
  });

  it("an evening game later in UTC stays on its Eastern date", () => {
    expect(etDateKey("2026-07-14T23:30:00Z")).toBe("2026-07-14");
  });
});
