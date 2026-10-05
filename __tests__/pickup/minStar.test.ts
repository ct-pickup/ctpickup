import { describe, expect, it } from "vitest";

import {
  checkSkillEligibility,
  isMissingMinStarColumn,
  MIN_STAR_STEPS,
  parseMinStar,
  tierBandForStar,
  writeWithOptionalMinStar,
} from "@/lib/pickup/minStar";

describe("parseMinStar", () => {
  it("offers every half star from 0.5 to 5.0", () => {
    expect(MIN_STAR_STEPS).toEqual([0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]);
    for (const n of MIN_STAR_STEPS) expect(parseMinStar(n)).toEqual({ ok: true, value: n });
  });
  it("accepts numeric strings and treats absent as no minimum", () => {
    expect(parseMinStar("3.5")).toEqual({ ok: true, value: 3.5 });
    for (const v of [undefined, null, ""]) expect(parseMinStar(v)).toEqual({ ok: true, value: null });
  });
  it("rejects anything else with a clear error, never a silent fallback", () => {
    for (const v of [0, 0.25, 5.5, -1, 2.7, "abc", NaN, true, {}]) {
      const r = parseMinStar(v);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/half star/);
    }
  });
});

describe("tier band for a star (old-app compatibility)", () => {
  it("maps each half star to the band that contains it", () => {
    expect(tierBandForStar(0.5)?.open_tier_rank).toBe(1);
    expect(tierBandForStar(1.0)?.key).toBe("bronze");
    expect(tierBandForStar(1.5)?.key).toBe("silver");
    expect(tierBandForStar(3.0)?.key).toBe("gold");
    expect(tierBandForStar(4.0)?.open_tier_rank).toBe(4);
    expect(tierBandForStar(5.0)?.key).toBe("diamond");
  });
});

describe("writeWithOptionalMinStar", () => {
  it("retries without min_star when the column is missing", async () => {
    const calls: boolean[] = [];
    const r = await writeWithOptionalMinStar(async (withMin) => {
      calls.push(withMin);
      return withMin
        ? { error: { code: "PGRST204", message: "Could not find the 'min_star' column of 'pickup_runs' in the schema cache" } }
        : { error: null };
    });
    expect(calls).toEqual([true, false]);
    expect(r.error).toBeNull();
  });
  it("does not retry on other errors, and writes once when the column exists", async () => {
    let n = 0;
    await writeWithOptionalMinStar(async () => {
      n += 1;
      return { error: { message: "permission denied" } };
    });
    expect(n).toBe(1);
    expect(isMissingMinStarColumn({ code: "42703", message: 'column "min_star" does not exist' })).toBe(true);
    expect(isMissingMinStarColumn({ code: "42703", message: 'column "time_tbd" does not exist' })).toBe(false);
  });
});

describe("checkSkillEligibility", () => {
  it("with min_star, compares the player's star", () => {
    expect(checkSkillEligibility({ min_star: 3.5 }, { tier: "gold", star_rating: 3.5 }).ok).toBe(true);
    expect(checkSkillEligibility({ min_star: 3.5 }, { tier: "platinum", star_rating: 4.0 }).ok).toBe(true);
    const low = checkSkillEligibility({ min_star: 3.5 }, { tier: "gold", star_rating: 3.0 });
    expect(low).toEqual({ ok: false, error: "This session is for players rated 3.5★ and up." });
  });
  it("with min_star, falls back to the tier stand-in when the player has no star", () => {
    expect(checkSkillEligibility({ min_star: 3.0 }, { tier: "gold", star_rating: null }).ok).toBe(true);
    expect(checkSkillEligibility({ min_star: 3.5 }, { tier: "gold", star_rating: null }).ok).toBe(false);
  });
  it("blocks an unrated player from a game with a minimum", () => {
    expect(checkSkillEligibility({ min_star: 0.5 }, null).ok).toBe(false);
  });
  it("with no min_star, the tier gate is unchanged", () => {
    expect(checkSkillEligibility({ open_tier_rank: 0 }, null).ok).toBe(true);
    expect(checkSkillEligibility({ open_tier_rank: 3 }, { tier: "gold" }).ok).toBe(true);
    expect(checkSkillEligibility({ open_tier_rank: 3 }, { tier: "silver" })).toEqual({
      ok: false,
      error: "This session is for players rated 2.5★ and up.",
    });
    expect(checkSkillEligibility({ open_tier_rank: 2, min_star: null }, null).ok).toBe(false);
  });
});
