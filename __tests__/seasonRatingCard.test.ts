import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { seasonRatingCard } from "../mobile/lib/seasonRatingCardCore";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("season rating card visibility", () => {
  const card = { star: 3.5, provisional: false, exact: 3.62, ratedGames: 7, settledGames: 5 };

  it("shows the exact decimal from the same logic as the profile", () => {
    const m = seasonRatingCard(card)!;
    expect(m.display.number).toBe("3.62");
    expect(m.star).toBe(3.5);
    expect(m.exact).toBe(3.62);
  });
  it("is hidden when the player has no rating yet", () => {
    expect(seasonRatingCard(null)).toBeNull();
    expect(seasonRatingCard(undefined)).toBeNull();
    expect(seasonRatingCard({ star: 0, provisional: true })).toBeNull();
    expect(seasonRatingCard({ star: NaN, provisional: true })).toBeNull();
  });
  it("shows Provisional below 5 rated games and not at 5 or more", () => {
    expect(seasonRatingCard({ ...card, ratedGames: 0 })!.provisional).toBe(true);
    expect(seasonRatingCard({ ...card, ratedGames: 4 })!.provisional).toBe(true);
    expect(seasonRatingCard({ ...card, ratedGames: 5 })!.provisional).toBe(false);
    expect(seasonRatingCard({ ...card, ratedGames: 12 })!.provisional).toBe(false);
  });
  it("falls back to the stored provisional flag when the game counts are unknown (migration not applied)", () => {
    expect(seasonRatingCard({ star: 3, provisional: true })!.provisional).toBe(true);
    expect(seasonRatingCard({ star: 3, provisional: false })!.provisional).toBe(false);
  });
  it("falls back to the one decimal star when there is no exact rating", () => {
    expect(seasonRatingCard({ star: 3.5, provisional: false })!.display.number).toBe("3.5");
  });
  it("reuses the profile components and logic, with nothing else on the card", () => {
    const pieces = src("mobile/components/season/SeasonPieces.tsx");
    expect(pieces).toMatch(/seasonRatingCard\(card\)/);
    expect(pieces).toMatch(/<RatingBlock compact/);
    const block = src("mobile/components/profile/RatingBlock.tsx");
    const compact = block.slice(block.indexOf("if (compact)"), block.indexOf("  return (", block.indexOf("if (compact)") + 20));
    expect(compact).toMatch(/StarRating/);
    expect(compact).toMatch(/Provisional/);
    for (const other of ["ReliabilityRing", "SettleProgress", "level", "verified", "starsText"]) expect(compact, other).not.toContain(other);
    expect(src("mobile/lib/seasonRatingCardCore.ts")).toMatch(/from "\.\/ratingDisplayCore"/);
  });
  it("tapping opens the profile", () => {
    expect(src("mobile/app/(tabs)/sessions.tsx")).toMatch(/<SeasonRatingCard card=\{season\.card\} onPress=\{\(\) => push\("\/\(tabs\)\/account"\)\} \/>/);
  });
});
