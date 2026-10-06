import { describe, expect, it } from "vitest";

import {
  GAME_LOG_MAX_OFFSET,
  pageGameLog,
  parseGameLogCursor,
  ratingDirection,
  ratingTrendOf,
  shapeOf,
  teammateRecords,
  winRate,
  winStreaks,
  type GameLogEntry,
} from "@/lib/records/gameLog";

describe("winRate", () => {
  it("is wins over games, null with no games", () => {
    expect(winRate(3, 4)).toBe(0.75);
    expect(winRate(0, 5)).toBe(0);
    expect(winRate(0, 0)).toBeNull();
  });
});

describe("winStreaks (newest first)", () => {
  it("counts the current streak from the latest game and the longest ever", () => {
    expect(winStreaks(["W", "W", "L", "W", "W", "W", "D"])).toEqual({ current: 2, longest: 3 });
  });
  it("has no current streak when the latest game was not a win; draws break a streak", () => {
    expect(winStreaks(["L", "W", "W"])).toEqual({ current: 0, longest: 2 });
    expect(winStreaks(["W", "D", "W"])).toEqual({ current: 1, longest: 1 });
  });
  it("ignores games without a result and handles an empty log", () => {
    expect(winStreaks([null, "W", null, "W"])).toEqual({ current: 2, longest: 2 });
    expect(winStreaks([])).toEqual({ current: 0, longest: 0 });
  });
});

describe("teammateRecords", () => {
  const a = { id: "a", name: "Ana K." };
  const b = { id: "b", name: "Ben T." };
  const games = [
    { outcome: "W" as const, teammates: [a, b] },
    { outcome: "W" as const, teammates: [a] },
    { outcome: "L" as const, teammates: [a, b] },
    { outcome: "D" as const, teammates: [a] },
    { outcome: null, teammates: [a, b] },
  ];
  it("only lists teammates with 3 or more shared games, with the player's record alongside them", () => {
    expect(teammateRecords(games)).toEqual([{ name: "Ana K.", games: 4, wins: 2, draws: 1, losses: 1 }]);
  });
  it("respects a different minimum and skips games without a result", () => {
    expect(teammateRecords(games, 2).map((r) => r.name)).toEqual(["Ana K.", "Ben T."]);
    expect(teammateRecords(games, 2)[1]).toMatchObject({ games: 2, wins: 1, losses: 1 });
  });
});

describe("rating direction and trend (no numbers leave)", () => {
  it("reports up, down or flat", () => {
    expect(ratingDirection(2)).toBe("up");
    expect(ratingDirection(-1.2)).toBe("down");
    expect(ratingDirection(0.2)).toBe("flat");
    expect(ratingDirection(null)).toBeNull();
    expect(ratingDirection(NaN)).toBeNull();
  });
  it("shapes a series to 0..1", () => {
    expect(shapeOf([40, 50, 60])).toEqual([0, 0.5, 1]);
    expect(shapeOf([50])).toBeNull();
    expect(shapeOf([50, 50])).toEqual([0.5, 0.5]);
  });
  it("marks where the season changes across the year", () => {
    const t = ratingTrendOf([
      { score_after: 50, created_at: "2026-08-01T12:00:00Z" },
      { score_after: 55, created_at: "2026-08-20T12:00:00Z" },
      { score_after: 52, created_at: "2026-09-10T12:00:00Z" },
      { score_after: 60, created_at: "2026-12-10T12:00:00Z" },
    ]);
    expect(t?.shape).toHaveLength(4);
    expect(t?.shape.every((v) => v >= 0 && v <= 1)).toBe(true);
    expect(t?.seasonBreaks).toEqual([2, 3]);
    expect(ratingTrendOf([{ score_after: 50, created_at: "2026-08-01T12:00:00Z" }])).toBeNull();
  });
});

describe("paging", () => {
  const log = Array.from({ length: 45 }, (_, i) => ({ run_id: String(i) }) as unknown as GameLogEntry);
  it("pages 20 at a time with a cursor until the end", () => {
    expect(pageGameLog(log, 0).games).toHaveLength(20);
    expect(pageGameLog(log, 0).nextCursor).toBe("20");
    expect(pageGameLog(log, 40).games).toHaveLength(5);
    expect(pageGameLog(log, 40).nextCursor).toBeNull();
  });
  it("rejects a bad cursor", () => {
    expect(parseGameLogCursor(null)).toEqual({ ok: true, offset: 0 });
    expect(parseGameLogCursor("40")).toEqual({ ok: true, offset: 40 });
    for (const c of ["-1", "1.5", "abc", String(GAME_LOG_MAX_OFFSET + 1)]) expect(parseGameLogCursor(c).ok).toBe(false);
  });
});
