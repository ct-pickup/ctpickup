import { describe, expect, it } from "vitest";

import { addressLine, FIELD_DELTA, ilikeTerm, mapKindFor, mergeHits, type PlaceHit } from "../shared/fields/placeSearch";

const hit = (key: string, lat: number, lon: number, source: PlaceHit["source"]): PlaceHit => ({ key, label: key, sub: null, lat, lon, source });

describe("place search", () => {
  it("zooms to field size", () => {
    expect(FIELD_DELTA).toBeLessThan(0.01);
  });

  it("switches to satellite when zoomed in, unless the player chose", () => {
    expect(mapKindFor(0.003, null)).toBe("hybrid");
    expect(mapKindFor(0.3, null)).toBe("standard");
    expect(mapKindFor(0.003, "standard")).toBe("standard");
    expect(mapKindFor(0.3, "hybrid")).toBe("hybrid");
  });

  it("cleans typed text for the filter", () => {
    expect(ilikeTerm("  Lincoln, High (turf) %  ")).toBe("Lincoln High turf");
  });

  it("lists venues first, drops places on top of them and caps at 5", () => {
    const venues = [hit("v1", 41, -73, "venue"), hit("v2", 41.1, -73, "venue")];
    const places = [hit("p1", 41.00005, -73, "place"), ...[2, 3, 4, 5].map((i) => hit(`p${i}`, 42 + i, -73, "place"))];
    const out = mergeHits(venues, places);
    expect(out.map((o) => o.key)).toEqual(["v1", "v2", "p2", "p3", "p4"]);
  });

  it("formats the street and town under the pin", () => {
    expect(addressLine({ street: "River Rd", city: "Fairfield", region: "CT" })).toBe("River Rd, Fairfield, CT");
    expect(addressLine({ name: "45", city: "Fairfield" })).toBe("Fairfield");
    expect(addressLine({ region: "CT" })).toBe("CT");
    expect(addressLine(null)).toBeNull();
  });
});
