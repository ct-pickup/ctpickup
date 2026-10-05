import { describe, expect, it } from "vitest";
import { topPercentLabel } from "../mobile/lib/starRatings";

describe("topPercentLabel", () => {
  it("shows Top X% for rated players in the top half", () => {
    expect(topPercentLabel({ provisional: false, percentile: 18 })).toBe("Top 18%");
    expect(topPercentLabel({ provisional: false, percentile: 50 })).toBe("Top 50%");
    expect(topPercentLabel({ provisional: false, percentile: 0.4 })).toBe("Top 1%");
  });

  it("hides the percentile below the top half", () => {
    expect(topPercentLabel({ provisional: false, percentile: 51 })).toBeNull();
    expect(topPercentLabel({ provisional: false, percentile: 100 })).toBeNull();
  });

  it("hides the percentile for provisional players", () => {
    expect(topPercentLabel({ provisional: true, percentile: 5 })).toBeNull();
  });

  it("hides the percentile when missing", () => {
    expect(topPercentLabel(null)).toBeNull();
    expect(topPercentLabel(undefined)).toBeNull();
    expect(topPercentLabel({ provisional: false, percentile: null })).toBeNull();
    expect(topPercentLabel({ provisional: false, percentile: NaN })).toBeNull();
  });
});

import { fetchRunMinStars } from "../mobile/lib/starRatings";

function fakeRuns(rows: Array<Record<string, unknown>>, noMinStarColumn = false) {
  return {
    from: () => ({
      select: (cols: string) => ({
        in: async () =>
          noMinStarColumn && cols.includes("min_star")
            ? { data: null, error: { message: "column pickup_runs.min_star does not exist" } }
            : { data: cols.includes("min_star") ? rows : rows.map((r) => {
              const c = { ...r };
              delete c.min_star;
              return c;
            }), error: null },
      }),
    }),
  } as never;
}

describe("fetchRunMinStars", () => {
  const rows = [
    { id: "exact", min_star: "2.0", open_tier_rank: 2 },
    { id: "legacy", min_star: null, open_tier_rank: 3 },
    { id: "open", min_star: null, open_tier_rank: 0 },
    { id: "wave", min_star: null, open_tier_rank: 6 },
  ];

  it("prefers min_star, then the open_tier_rank band, and leaves open games out", async () => {
    const m = await fetchRunMinStars(fakeRuns(rows), ["exact", "legacy", "open", "wave"]);
    expect(Object.fromEntries(m)).toEqual({ exact: 2.0, legacy: 2.5 });
  });

  it("falls back to open_tier_rank when the min_star column is missing", async () => {
    const m = await fetchRunMinStars(fakeRuns(rows, true), ["exact", "legacy"]);
    expect(Object.fromEntries(m)).toEqual({ exact: 1.5, legacy: 2.5 });
  });
});
