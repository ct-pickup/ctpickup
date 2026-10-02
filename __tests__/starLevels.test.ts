import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isStarLevel, STAR_LEVELS, starLevelFor, starLevelLabel, starLevelName } from "@/shared/starLevels";

const root = join(__dirname, "..");
const levelsSql = readFileSync(join(root, "supabase/migrations/20261005000300_star_levels.sql"), "utf8");
const bandsSql = readFileSync(join(root, "supabase/migrations/20261002150000_star_ratings.sql"), "utf8");

function sqlLevels(): Array<{ star: number; name: string; description: string }> {
  const block = levelsSql.split("insert into public.star_levels")[1].split("on conflict")[0];
  return [...block.matchAll(/\((\d\.\d),\s*'([^']*)',\s*'([^']*)'\)/g)].map((m) => ({
    star: Number(m[1]),
    name: m[2],
    description: m[3],
  }));
}

function sqlBands(): Array<{ star: number; lower: number; upper: number | null }> {
  const block = bandsSql.split("insert into public.star_bands")[1].split("on conflict")[0];
  return [...block.matchAll(/\((\d\.\d),\s*(\d+),\s*(\d+|null),/g)].map((m) => ({
    star: Number(m[1]),
    lower: Number(m[2]),
    upper: m[3] === "null" ? null : Number(m[3]),
  }));
}

describe("star levels", () => {
  it("matches public.star_levels in SQL exactly", () => {
    expect(sqlLevels()).toEqual(STAR_LEVELS.map((l) => ({ ...l })));
  });

  it("has one level per star band, highest first", () => {
    const bands = sqlBands().map((b) => b.star).sort((a, b) => b - a);
    expect(STAR_LEVELS.map((l) => l.star)).toEqual(bands);
  });

  it("band midpoints sit well inside each band (hysteresis margin is 1.0)", () => {
    for (const b of sqlBands()) {
      const upper = b.upper ?? 100;
      const mid = (b.lower + upper) / 2;
      expect(mid - b.lower).toBeGreaterThan(1);
      expect(upper - mid).toBeGreaterThan(1);
    }
  });

  it("names and labels", () => {
    expect(starLevelName(4)).toBe("College");
    expect(starLevelName(4.2)).toBe("College");
    expect(starLevelName(5)).toBe("Pro");
    expect(starLevelName(0.5)).toBe("New");
    expect(starLevelName(null)).toBeNull();
    expect(starLevelFor(3)?.description).toMatch(/varsity/);
    expect(starLevelLabel(3.5)).toBe("3.5 · Advanced");
  });

  it("isStarLevel accepts half steps only", () => {
    expect(isStarLevel(3)).toBe(true);
    expect(isStarLevel(4.5)).toBe(true);
    expect(isStarLevel(0)).toBe(false);
    expect(isStarLevel(3.2)).toBe(false);
    expect(isStarLevel("3")).toBe(false);
  });

  it("seed functions are service role only and gate on provisional", () => {
    const fn = readFileSync(join(root, "supabase/migrations/20261005000400_star_seed_functions.sql"), "utf8");
    expect(fn).toMatch(/revoke execute on function public\.seed_star_level_from_signup\(uuid, numeric\) from public, anon, authenticated/);
    expect(fn).toMatch(/grant execute on function public\.seed_star_level_from_signup\(uuid, numeric\) to service_role/);
    expect(fn).not.toMatch(/grant execute[^;]*to authenticated/);
    expect(fn).toMatch(/not r\.star_provisional/);
    expect(fn).toMatch(/verification = 'self'/);
  });
});
