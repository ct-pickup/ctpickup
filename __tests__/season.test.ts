import { describe, expect, it } from "vitest";
import {
  dateBlockEt,
  formStrip,
  groupByMonthEt,
  monthLabelEt,
  outcomeFor,
  privacyName,
  recordLine,
  scoreLine,
} from "../mobile/lib/season";

describe("outcomeFor", () => {
  it("uses the winning team", () => {
    expect(outcomeFor("A", { winning_team: "A" })).toBe("W");
    expect(outcomeFor("B", { winning_team: "A" })).toBe("L");
  });

  it("is null without a result or a team", () => {
    expect(outcomeFor("A", null)).toBeNull();
    expect(outcomeFor(null, { winning_team: "A" })).toBeNull();
  });

  it("reads equal scores and a missing winner as a draw", () => {
    expect(outcomeFor("A", { winning_team: "A", scores: { A: 2, B: 2 } })).toBe("D");
    expect(outcomeFor("A", { winning_team: null })).toBe("D");
  });
});

describe("scoreLine", () => {
  it("puts the viewer's team first with an en dash", () => {
    expect(scoreLine("B", { A: 3, B: 5 })).toBe("5\u20133");
  });

  it("hides incomplete or three-team scores", () => {
    expect(scoreLine("A", { A: 3 })).toBeNull();
    expect(scoreLine("A", { A: 3, B: 1, C: 2 })).toBeNull();
    expect(scoreLine("A", null)).toBeNull();
  });
});

describe("formStrip", () => {
  it("keeps the last five decided games, most recent on the right", () => {
    const g = (day: number, outcome: "W" | "L" | "D" | null) => ({
      start_at: `2026-07-${String(day).padStart(2, "0")}T22:00:00Z`,
      outcome,
    });
    const games = [g(20, "W"), g(18, null), g(16, "L"), g(14, "D"), g(12, "W"), g(10, "L"), g(8, "W")];
    expect(formStrip(games)).toEqual(["L", "W", "D", "L", "W"]);
  });
});

describe("Eastern dates", () => {
  it("labels months and days in Eastern time, not UTC", () => {
    expect(monthLabelEt("2026-08-01T02:00:00Z")).toBe("July 2026");
    expect(dateBlockEt("2026-08-01T02:00:00Z")).toEqual({ month: "Jul", day: "31" });
  });

  it("groups consecutive games by month", () => {
    const groups = groupByMonthEt([
      { start_at: "2026-08-03T22:00:00Z" },
      { start_at: "2026-07-20T22:00:00Z" },
      { start_at: "2026-07-02T22:00:00Z" },
    ]);
    expect(groups.map((s) => [s.label, s.games.length])).toEqual([
      ["August 2026", 1],
      ["July 2026", 2],
    ]);
  });
});

describe("privacy and record", () => {
  it("shows first name and last initial only", () => {
    expect(privacyName("Marcus", "Bell")).toBe("Marcus B.");
    expect(privacyName("Marcus", "")).toBe("Marcus");
    expect(privacyName(null, null)).toBe("Player");
  });

  it("formats the record with en dashes", () => {
    expect(recordLine(2, 1)).toBe("2\u20131");
    expect(recordLine(2, 1, 1)).toBe("2\u20131\u20131");
  });
});
