import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { seasonRatingCard } from "../mobile/lib/seasonRatingCardCore";
import { seasonStatsView } from "../mobile/lib/seasonStatLine";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const ms = (iso: string) => Date.parse(iso);

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

describe("season stats line instead of zeros", () => {
  const nov = ms("2026-11-01T12:00:00-04:00");

  it("no points this season: one short line with the real season start", () => {
    expect(seasonStatsView(0, nov)).toEqual({ kind: "line", text: "No points yet this season (started Sep 1)" });
  });
  it("season not started yet: 'Season starts <first day>'", () => {
    const aug = ms("2026-08-20T12:00:00-04:00");
    const sep = ms("2026-09-10T12:00:00-04:00");
    expect(seasonStatsView(0, aug, sep)).toEqual({ kind: "line", text: "Season starts Sep 1" });
    expect(seasonStatsView(null, aug, sep)).toEqual({ kind: "line", text: "Season starts Sep 1" });
  });
  it("uses the season config for other seasons, nothing hardcoded", () => {
    expect(seasonStatsView(0, ms("2026-12-15T12:00:00-05:00"))).toEqual({ kind: "line", text: "No points yet this season (started Dec 1)" });
    expect(seasonStatsView(0, ms("2027-03-20T12:00:00-04:00"))).toEqual({ kind: "line", text: "No points yet this season (started Mar 1)" });
    const code = src("mobile/lib/seasonStatLine.ts").split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//") && !l.trim().startsWith("/*")).join("\n");
    expect(code).not.toMatch(/Sep|Dec|Mar|Jun|\b2026\b/);
  });
  it("keeps the stats when there are points, or when points are unknown", () => {
    expect(seasonStatsView(120, nov)).toEqual({ kind: "stats" });
    expect(seasonStatsView(1, nov)).toEqual({ kind: "stats" });
    expect(seasonStatsView(null, nov)).toEqual({ kind: "stats" });
    expect(seasonStatsView(undefined, nov)).toEqual({ kind: "stats" });
  });
  it("copy has no em dash and no tier or wave words", () => {
    for (const t of [seasonStatsView(0, nov), seasonStatsView(0, ms("2026-08-20T12:00:00-04:00"), ms("2026-09-10T12:00:00-04:00"))]) {
      expect(JSON.stringify(t)).not.toMatch(/—|\btier\b|\bwave\b/i);
    }
  });
});
