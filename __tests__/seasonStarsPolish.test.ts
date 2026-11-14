import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CELEBRATED_BADGES,
  countUpDurationMs,
  countUpValue,
  easeOutCubic,
  medalFor,
  newlyEarnedBadges,
  prizeProgress,
  rankDeltas,
  rankSnapshot,
  seasonCountdownText,
  seasonTimeLeft,
} from "../mobile/lib/motionCore";
import { lockLabel, ratingDisplay } from "../mobile/lib/ratingDisplayCore";
import { standingFromTiers, standingRankText, standingStarsText } from "../mobile/lib/seasonCardCore";
import { starNumberText } from "../mobile/lib/starFillCore";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const ms = (iso: string) => Date.parse(iso);

describe("season card: Stars stat from the Stars leaderboard", () => {
  const tiers = [
    { user_id: "a", star: 4, rating_exact: 4.02, provisional: false, rank: 1 },
    { user_id: "me", star: 3.5, rating_exact: 3.58, provisional: true, rank: 12 },
  ];
  it("uses the viewer's own row: same value and rounding as the leaderboard, with its true rank", () => {
    const s = standingFromTiers(tiers, "me", 58);
    expect(s).toEqual({ star: 3.5, exact: 3.58, provisional: true, rank: 12, total: 58 });
    expect(standingStarsText(s)).toBe("3.58");
    expect(standingStarsText(s)).toBe(starNumberText(3.5, 3.58));
    expect(standingRankText(s)).toBe("#12 of 58");
  });
  it("is Unranked only without a rating", () => {
    const none = standingFromTiers(tiers, "nobody", 58);
    expect(none.star).toBeNull();
    expect(none.rank).toBeNull();
    expect(standingRankText(none)).toBe("Unranked");
    expect(standingStarsText(none)).toBeNull();
    expect(standingRankText(standingFromTiers(tiers, "me", null))).toBe("#12");
  });
  it("falls back to the one decimal star when the exact rating is missing, and ignores an exact that disagrees", () => {
    expect(standingStarsText(standingFromTiers([{ user_id: "me", star: 3.5, rank: 3 }], "me", 9))).toBe("3.5");
    expect(standingStarsText(standingFromTiers([{ user_id: "me", star: 3.5, rating_exact: 4.4, rank: 3 }], "me", 9))).toBe("3.5");
  });
  it("keeps the Provisional state as a New chip and the season header no longer shows points", () => {
    expect(standingFromTiers(tiers, "me", 58).provisional).toBe(true);
    expect(standingFromTiers(tiers, "a", 58).provisional).toBe(false);
    const pieces = src("mobile/components/season/SeasonPieces.tsx");
    expect(pieces).not.toMatch(/Season pts/);
    expect(pieces).toMatch(/label="Player of the Day"/);
    expect(pieces).toMatch(/label="Win %"/);
    expect(pieces).not.toMatch(/cornerStars/);
    const card = src("mobile/components/season/SeasonCard.tsx");
    expect(card).toMatch(/label="Rank"/);
    expect(card).toMatch(/StarsStatValue/);
    expect(card).not.toMatch(/label="Points"/);
    const stat = src("mobile/components/season/StarsStatValue.tsx");
    expect(stat).toMatch(/>New</);
    expect(stat).toMatch(/starNumberText\(star, exact\)/);
  });
});

describe("count-up", () => {
  it("eases out and lands exactly on the target", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
    expect(countUpValue(1, 3.58)).toBe(3.58);
    expect(countUpValue(0, 3.58)).toBe(0);
    expect(countUpValue(0.5, 3.58)).toBeLessThan(3.58);
  });
  it("is short, and never longer than 1.1 s", () => {
    expect(countUpDurationMs(0.5)).toBe(560);
    expect(countUpDurationMs(3.58)).toBeLessThanOrEqual(1100);
    expect(countUpDurationMs(5)).toBe(1100);
  });
  it("the profile block counts up with sequential star fill and a light haptic on landing, and the hook respects Reduce Motion", () => {
    const block = src("mobile/components/profile/RatingBlock.tsx");
    expect(block).toMatch(/useCountUp\(/);
    expect(block).toMatch(/reveal=\{reveal\}/);
    expect(block).toMatch(/hapticTap/);
    const hook = src("mobile/hooks/useCountUp.ts");
    expect(hook).toMatch(/useReduceMotion/);
    expect(hook).toMatch(/if \(reduceMotion\)/);
  });
});

describe("provisional to settled", () => {
  it("says how many more games lock the rating", () => {
    expect(lockLabel(3, 5, false)).toBe("2 more games to lock your rating");
    expect(lockLabel(4, 5, false)).toBe("1 more game to lock your rating");
    expect(lockLabel(5, 5, false)).toBe("Rating locked in");
    expect(lockLabel(9, 5, true)).toBe("Rating locked in");
    expect(lockLabel(null, 5, false)).toBeNull();
    expect(lockLabel(2, null, false)).toBeNull();
  });
  it("comes through ratingDisplay and the bar animates only without Reduce Motion", () => {
    const d = ratingDisplay({ star: 3.5, exact: 3.58, ratedGames: 3, settledGames: 5, provisional: true });
    expect(d.lockLabel).toBe("2 more games to lock your rating");
    expect(d.gamesLabel).toBe("3 of 5 rated games");
    const bar = src("mobile/components/profile/RatingReliability.tsx");
    expect(bar).toMatch(/withTiming\(p/);
    expect(bar).toMatch(/reduceMotion \? p/);
    expect(bar).toMatch(/lockLabel/);
  });
});

describe("leaderboard polish", () => {
  it("medals are the top three only", () => {
    expect(medalFor(1)).toBe("gold");
    expect(medalFor(2)).toBe("silver");
    expect(medalFor(3)).toBe("bronze");
    expect(medalFor(4)).toBeNull();
    expect(medalFor(null)).toBeNull();
  });
  it("rank arrows: up is positive, down is negative, no memory means no arrow", () => {
    const prev = { a: 5, b: 2, c: 9 };
    const now = [
      { user_id: "a", rank: 3 },
      { user_id: "b", rank: 4 },
      { user_id: "c", rank: 9 },
      { user_id: "d", rank: 1 },
    ];
    expect(rankDeltas(prev, now)).toEqual({ a: 2, b: -2, c: 0 });
    expect(rankDeltas({}, now)).toEqual({});
    expect(rankSnapshot(now)).toEqual({ a: 3, b: 4, c: 9, d: 1 });
  });
  it("medal colours are theme tokens in both schemes, and the screen has a pinned You row and skeleton rows", () => {
    const tokens = src("shared/theme/tokens.ts");
    expect((tokens.match(/medalGold: palette.gold/g) ?? []).length).toBe(2);
    expect(tokens).toMatch(/medalSilver: string/);
    const screen = src("mobile/app/(tabs)/leaderboards.tsx");
    expect(screen).toMatch(/styles\.pinnedYou/);
    expect(screen).toMatch(/<StarsListSkeleton \/>/);
    expect(screen).toMatch(/medalFor\(rank\)/);
    expect(screen).not.toMatch(/#[0-9A-Fa-f]{6}/);
  });
});

describe("badge unlocks", () => {
  const badges = [
    { id: "first_game", earned: true },
    { id: "games_10", earned: true },
    { id: "games_25", earned: true },
    { id: "win_streak_3", earned: false },
    { id: "potd", earned: true },
    { id: "verified", earned: true },
  ];
  it("celebrates only the four listed badges, only when newly earned", () => {
    expect(newlyEarnedBadges(new Set(["first_game"]), badges)).toEqual(["games_10", "potd"]);
    expect(newlyEarnedBadges(new Set(["first_game", "games_10", "potd"]), badges)).toEqual([]);
    expect([...CELEBRATED_BADGES]).toEqual(["first_game", "games_10", "win_streak_3", "potd"]);
  });
  it("never fires on a device with no memory (first open), so old badges do not replay", () => {
    expect(newlyEarnedBadges(null, badges)).toEqual([]);
  });
  it("the shelf animates scale, glow and confetti, and skips all of it under Reduce Motion", () => {
    const shelf = src("mobile/components/profile/BadgeShelf.tsx");
    expect(shelf).toMatch(/ConfettiBurst/);
    expect(shelf).toMatch(/Easing\.back/);
    expect(shelf).toMatch(/!reduceMotion \? <ConfettiBurst/);
    const account = src("mobile/app/(tabs)/account.tsx");
    expect(account).toMatch(/newlyEarnedBadges\(seen, nextBadges\)/);
    expect(account).toMatch(/writeSeenBadges\(uid/);
  });
});

describe("prize card", () => {
  it("progress toward the prize is 0 to 1", () => {
    expect(prizeProgress(0, 10)).toBe(0);
    expect(prizeProgress(4, 10)).toBe(0.4);
    expect(prizeProgress(14, 10)).toBe(1);
    expect(prizeProgress(null, 10)).toBe(0);
  });
  it("counts down to the end of the season in Eastern time, from the shared season config", () => {
    const t = seasonTimeLeft(ms("2026-11-29T12:00:00-05:00")); // Fall 2026 ends Nov 30, 23:59 ET
    expect(t.days).toBe(1);
    expect(t.hours).toBe(12);
    expect(t.minutes).toBe(0);
    expect(seasonCountdownText(t)).toBe("1d 12h 0m left");
    expect(seasonCountdownText({ days: 0, hours: 3, minutes: 5, totalMs: 1 })).toBe("3h 5m left");
    expect(seasonCountdownText({ days: 0, hours: 0, minutes: 9, totalMs: 1 })).toBe("9m left");
    expect(seasonCountdownText({ days: 0, hours: 0, minutes: 0, totalMs: 0 })).toBe("Season over");
    const code = src("mobile/lib/motionCore.ts").split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
    expect(code).not.toMatch(/Nov|Sep|2026/);
  });
  it("the card has a progress bar and a live countdown", () => {
    const card = src("mobile/components/season/SeasonCard.tsx");
    expect(card).toMatch(/accessibilityRole="progressbar"/);
    expect(card).toMatch(/setInterval\(\(\) => setNow\(Date\.now\(\)\), 60_000\)/);
    expect(card).toMatch(/seasonCountdownText\(seasonTimeLeft\(now\)\)/);
  });
});

describe("copy", () => {
  it("has no em dash and no tier or wave wording in the new labels", () => {
    const labels = [
      lockLabel(3, 5, false)!,
      lockLabel(5, 5, false)!,
      seasonCountdownText({ days: 2, hours: 1, minutes: 1, totalMs: 1 }),
      "Rating locked in",
      "Stars",
      "No rating yet",
    ];
    for (const t of labels) expect(t).not.toMatch(/—|\btier\b|\bwave\b/i);
  });
});
