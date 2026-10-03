import { describe, expect, it } from "vitest";
import { isValidHalfStar, starFill, starValueFromTap } from "../mobile/lib/halfStars";

describe("starValueFromTap", () => {
  it("left half is .5, right half is whole", () => {
    expect(starValueFromTap(0, 5, 40)).toBe(0.5);
    expect(starValueFromTap(0, 25, 40)).toBe(1);
    expect(starValueFromTap(2, 19, 40)).toBe(2.5);
    expect(starValueFromTap(4, 20, 40)).toBe(5);
  });
});

describe("isValidHalfStar", () => {
  it("accepts 0.5 steps in range only", () => {
    expect(isValidHalfStar(0.5)).toBe(true);
    expect(isValidHalfStar(5)).toBe(true);
    expect(isValidHalfStar(0)).toBe(false);
    expect(isValidHalfStar(5.5)).toBe(false);
    expect(isValidHalfStar(3.2)).toBe(false);
    expect(isValidHalfStar(NaN)).toBe(false);
  });
});

describe("starFill", () => {
  it("fills whole, half and empty stars", () => {
    expect([0, 1, 2, 3, 4].map((i) => starFill(i, 2.5))).toEqual([1, 1, 0.5, 0, 0]);
    expect([0, 1, 2, 3, 4].map((i) => starFill(i, 0.5))).toEqual([0.5, 0, 0, 0, 0]);
    expect([0, 1, 2, 3, 4].map((i) => starFill(i, 5))).toEqual([1, 1, 1, 1, 1]);
  });
});
