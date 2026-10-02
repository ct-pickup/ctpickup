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
