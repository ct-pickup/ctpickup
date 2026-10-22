import { describe, expect, it } from "vitest";

import { detailLine, townLine } from "../mobile/lib/fields/presentation";

describe("field card lines", () => {
  it("builds town and state from an address", () => {
    expect(townLine({ address: "45 River Rd, Fairfield, CT", state: "CT" })).toBe("Fairfield, CT");
    expect(townLine({ address: "1 Main St, Stamford, CT 06901", state: null })).toBe("Stamford, CT");
    expect(townLine({ address: "12 Oak Ave", state: "CT" })).toBe("CT");
    expect(townLine({ address: null, state: null })).toBeNull();
  });

  it("puts setting, surface and price on one line", () => {
    const base = { setting: "outdoor" as const, surface: "grass", turf_count: 0, price_status: "free" as const, price_min: null, price_max: null, price_unit: null, price_text: null };
    expect(detailLine(base)).toBe("Outdoor · Grass · Free");
    expect(detailLine({ ...base, setting: "indoor", turf_count: 1, surface: "turf" })).toBe("Indoor · Turf · Free");
  });
});
