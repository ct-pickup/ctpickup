import { describe, expect, it } from "vitest";
import { BADGES, computeBadges, isVerifiedLevel, longestWinStreak, type BadgeInputs } from "@/shared/badges";
import { countHostedGames } from "@/lib/records/playerBadges";

type Outcome = "W" | "D" | "L" | null;

function games(outcomes: Outcome[]): BadgeInputs["games"] {
  return outcomes.map((outcome, i) => ({ start_at: `2026-09-${String(i + 1).padStart(2, "0")}T22:00:00Z`, outcome }));
}

function inputs(over: Partial<BadgeInputs> = {}): BadgeInputs {
  return { games: [], potdCount: 0, verified: false, hostedCount: 0, referralCount: 0, ...over };
}

function earned(i: BadgeInputs): string[] {
  return computeBadges(i)
    .filter((b) => b.earned)
    .map((b) => b.id);
}

describe("computeBadges", () => {
  it("returns every badge in catalog order, none earned for a new player", () => {
    const out = computeBadges(inputs());
    expect(out.map((b) => b.id)).toEqual(BADGES.map((b) => b.id));
    expect(out.every((b) => !b.earned)).toBe(true);
  });

  it("awards game milestones from decided games only", () => {
    expect(earned(inputs({ games: games(["L"]) }))).toEqual(["first_game"]);
    expect(earned(inputs({ games: games([null, null]) }))).toEqual([]);
    const nine = games(Array(9).fill("D"));
    expect(earned(inputs({ games: nine }))).not.toContain("games_10");
    const ten = games(Array(10).fill("L"));
    expect(earned(inputs({ games: ten }))).toEqual(["first_game", "games_10"]);
    const fifty = Array.from({ length: 50 }, (_, i) => ({ start_at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), outcome: "L" as const }));
    expect(earned(inputs({ games: fifty }))).toEqual(["first_game", "games_10", "games_25", "games_50"]);
  });

  it("awards POTD, verified, hosted and referral from their inputs", () => {
    expect(earned(inputs({ potdCount: 1 }))).toEqual(["potd"]);
    expect(earned(inputs({ verified: true }))).toEqual(["verified"]);
    expect(earned(inputs({ hostedCount: 2 }))).toEqual(["hosted"]);
    expect(earned(inputs({ referralCount: 1 }))).toEqual(["referral"]);
  });

  it("awards the streak for three straight wins at any point", () => {
    expect(earned(inputs({ games: games(["W", "W", "D", "W", "W"]) }))).not.toContain("win_streak_3");
    expect(earned(inputs({ games: games(["L", "W", "W", "W", "L"]) }))).toContain("win_streak_3");
  });
});

describe("longestWinStreak", () => {
  it("orders by kickoff and skips games without a result", () => {
    const shuffled = [
      { start_at: "2026-09-03T22:00:00Z", outcome: "W" as const },
      { start_at: "2026-09-01T22:00:00Z", outcome: "W" as const },
      { start_at: "2026-09-02T22:00:00Z", outcome: null },
      { start_at: "2026-09-02T23:00:00Z", outcome: "W" as const },
      { start_at: "2026-09-04T22:00:00Z", outcome: "L" as const },
    ];
    expect(longestWinStreak(shuffled)).toBe(3);
  });

  it("resets on draws and losses", () => {
    expect(longestWinStreak(games(["W", "W", "D", "W", "L", "W", "W"]))).toBe(2);
    expect(longestWinStreak([])).toBe(0);
  });
});

describe("isVerifiedLevel", () => {
  it("treats anything other than empty or self as verified", () => {
    expect(isVerifiedLevel(null)).toBe(false);
    expect(isVerifiedLevel("")).toBe(false);
    expect(isVerifiedLevel("self")).toBe(false);
    expect(isVerifiedLevel("instagram")).toBe(true);
    expect(isVerifiedLevel("document")).toBe(true);
  });
});

describe("countHostedGames", () => {
  const now = Date.parse("2026-10-02T20:00:00Z");

  it("counts completed and past runs, not canceled or upcoming ones", () => {
    expect(
      countHostedGames(
        [
          { start_at: "2026-09-20T22:00:00Z", status: "completed" },
          { start_at: "2026-09-25T22:00:00Z", status: "open" },
          { start_at: "2026-09-26T22:00:00Z", status: "canceled" },
          { start_at: "2026-09-27T22:00:00Z", status: "Cancelled" },
          { start_at: "2026-10-05T22:00:00Z", status: "open" },
          { start_at: null, status: "open" },
        ],
        now,
      ),
    ).toBe(2);
  });

  it("does not count a game that is still live", () => {
    expect(countHostedGames([{ start_at: "2026-10-02T19:00:00Z", status: "open" }], now)).toBe(0);
  });
});
