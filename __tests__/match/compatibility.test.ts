import { describe, expect, it } from "vitest";
import {
  COMPATIBILITY_WEIGHTS,
  distanceFit,
  etSlot,
  formatShape,
  gameLevel,
  internalStar,
  levelFit,
  NEUTRAL_LEVEL_FIT,
  positionLabel,
  positionNeed,
  scoreCompatibility,
  usualTimeFit,
  type ScoringGame,
  type ScoringPlayer,
} from "@/lib/match/compatibility";

const TUE_7PM_ET = "2026-10-06T23:00:00Z";
const PAST_TUE_EVENINGS = ["2026-09-29T23:30:00Z", "2026-09-22T22:00:00Z"];
const PAST_SAT_MORNING = "2026-09-19T14:00:00Z";

function player(overrides: Partial<ScoringPlayer> = {}): ScoringPlayer {
  return { star: 3, primaryPosition: "CB", secondaryPositions: [], maxDriveMinutes: 40, ...overrides };
}

function game(overrides: Partial<ScoringGame> = {}): ScoringGame {
  return {
    startAt: TUE_7PM_ET,
    format: "7v7",
    capacity: 14,
    minStar: null,
    attendeeStars: [],
    attendeePositions: [],
    attendeeIds: [],
    ...overrides,
  };
}

describe("compatibility weights", () => {
  it("sum to 1", () => {
    const sum = Object.values(COMPATIBILITY_WEIGHTS).reduce((s, w) => s + w, 0);
    expect(sum).toBeCloseTo(1, 10);
  });
});

describe("level fit", () => {
  it("is 1 at the same level and falls off by half per star", () => {
    expect(levelFit(3, 3)).toBe(1);
    expect(levelFit(3, 4)).toBe(0.5);
    expect(levelFit(1, 5)).toBe(0);
  });
  it("is neutral when either level is unknown", () => {
    expect(levelFit(null, 3)).toBe(NEUTRAL_LEVEL_FIT);
    expect(levelFit(3, null)).toBe(NEUTRAL_LEVEL_FIT);
  });
  it("uses the attendee average, else min_star", () => {
    expect(gameLevel([3, 4, null], 1)).toBe(3.5);
    expect(gameLevel([null], 2.5)).toBe(2.5);
    expect(gameLevel([], null)).toBeNull();
  });
  it("falls back to tier when star_rating is missing", () => {
    expect(internalStar({ star_rating: 3.5, tier: "bronze" })).toBe(3.5);
    expect(internalStar({ tier: "gold" })).toBe(3);
    expect(internalStar({ star_rating: null, tier: "diamond" })).toBe(5);
    expect(internalStar({ tier: "unknown" })).toBeNull();
  });
});

describe("position need", () => {
  it("scores 1 when the primary group is short", () => {
    expect(positionNeed(player({ primaryPosition: "GK" }), game()).value).toBe(1);
  });
  it("scores 0.5 when only a secondary group is short", () => {
    const fullBackLine = ["CB", "LB", "RB", "Defender"];
    const r = positionNeed(player({ primaryPosition: "CB", secondaryPositions: ["CM"] }), game({ attendeePositions: fullBackLine }));
    expect(r).toEqual({ value: 0.5, position: "CM" });
  });
  it("scores 0 when nothing the player plays is short, or without position data", () => {
    const fullBackLine = ["CB", "LB", "RB", "Defender"];
    expect(positionNeed(player({ secondaryPositions: [] }), game({ attendeePositions: fullBackLine })).value).toBe(0);
    expect(positionNeed(player({ primaryPosition: null }), game()).value).toBe(0);
  });
  it("derives the shape from format, else capacity", () => {
    expect(formatShape("11v11")).toEqual({ GK: 1, DEF: 4, MID: 4, FWD: 2 });
    expect(formatShape(null, 12)).toEqual({ GK: 1, DEF: 2, MID: 2, FWD: 1 });
    expect(formatShape(null, null)).toBeNull();
  });
  it("labels specific codes as codes and broad positions as nouns", () => {
    expect(positionLabel("cb")).toBe("CB");
    expect(positionLabel("Midfielder")).toBe("Midfielder");
    expect(positionLabel("")).toBeNull();
  });
});

describe("distance", () => {
  it("is linear from 1 at 0 minutes to 0 at the max", () => {
    expect(distanceFit(0, 40)).toBe(1);
    expect(distanceFit(20, 40)).toBe(0.5);
    expect(distanceFit(60, 40)).toBe(0);
    expect(distanceFit(null, 40)).toBe(0);
  });
});

describe("usual time", () => {
  it("buckets in ET", () => {
    expect(etSlot(TUE_7PM_ET)).toEqual({ dow: 2, bucket: "evening" });
    expect(etSlot(PAST_SAT_MORNING)).toEqual({ dow: 6, bucket: "morning" });
  });
  it("blends exact weekday-bucket share with bucket share", () => {
    expect(usualTimeFit(TUE_7PM_ET, PAST_TUE_EVENINGS).value).toBe(1);
    expect(usualTimeFit(TUE_7PM_ET, [...PAST_TUE_EVENINGS, PAST_SAT_MORNING, PAST_SAT_MORNING]).value).toBeCloseTo(0.5);
  });
  it("needs history", () => {
    expect(usualTimeFit(TUE_7PM_ET, [PAST_TUE_EVENINGS[0]!]).value).toBe(0);
  });
});

describe("scoreCompatibility", () => {
  it("combines weighted components", () => {
    const r = scoreCompatibility(
      player({ primaryPosition: "GK" }),
      game({ attendeeIds: ["a", "b", "c"], attendeeStars: [3, 3, 3], attendeePositions: [null, null, null] }),
      { driveMinutes: 0, playedWithIds: new Set(["a", "b", "c"]), pastGameStarts: PAST_TUE_EVENINGS },
    );
    expect(r.components).toEqual({ level: 1, position: 1, distance: 1, playedWith: 1, usualTime: 1 });
    expect(r.score).toBeCloseTo(1);
    expect(r.playedWithAttendeeIds).toEqual(["a", "b", "c"]);
  });

  it("returns the two strongest qualifying reasons", () => {
    const r = scoreCompatibility(
      player({ primaryPosition: "CB" }),
      game({ attendeeIds: ["a"], attendeeStars: [3], attendeePositions: ["ST"] }),
      { driveMinutes: 14, playedWithIds: new Set(["a"]), pastGameStarts: PAST_TUE_EVENINGS },
    );
    expect(r.reasons).toEqual(["At your level", "Needs a CB"]);
  });

  it("drops weak components from reasons", () => {
    const r = scoreCompatibility(
      player({ star: 1, primaryPosition: null }),
      game({ attendeeIds: ["a", "b"], attendeeStars: [4, 4] }),
      { driveMinutes: 14, playedWithIds: new Set(["a", "b"]), pastGameStarts: [] },
    );
    expect(r.reasons).toEqual(["14 min away", "2 you've played with"]);
  });

  it("phrases usual-time reasons by bucket", () => {
    const r = scoreCompatibility(
      player({ star: null, primaryPosition: null }),
      game(),
      { driveMinutes: null, playedWithIds: new Set(), pastGameStarts: PAST_TUE_EVENINGS },
    );
    expect(r.reasons).toEqual(["Your usual night"]);
  });
});
