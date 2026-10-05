import { describe, expect, it } from "vitest";

import { APPLE_DISCLAIMER, listPlaceholders, seasonRuleSections, splitPlaceholders } from "@/shared/seasonRules";

const sections = seasonRuleSections({
  prizeUsd: 150,
  minGames: 10,
  points: { played: 1, win: 3, draw: 1, potd: 2 },
  season: { label: "Fall 2026", startText: "Sep 1", endText: "Nov 30, 2026" },
  rulesVersion: "draft-2",
});
const text = JSON.stringify(sections);

describe("season official rules", () => {
  it("has the eleven numbered sections in order", () => {
    expect(sections.map((s) => s.title.split(".")[0])).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]);
  });

  it("states the Apple disclaimer and that Apple is not a sponsor", () => {
    expect(APPLE_DISCLAIMER).toBe("Apple is not a sponsor of this contest.");
    expect(text).toContain(APPLE_DISCLAIMER);
    expect(text).toContain("Apple Inc. is not involved");
  });

  it("keeps every item the sponsor must fill as a visible placeholder", () => {
    expect(listPlaceholders(sections)).toEqual(
      expect.arrayContaining([
        "[SPONSOR LEGAL NAME AND ADDRESS]",
        "[MINIMUM AGE]",
        "[SEASON START]",
        "[SEASON END]",
        "[ANNOUNCE DATE]",
        "[PAYOUT METHOD]",
        "[CLAIM DAYS]",
        "[CONTACT EMAIL]",
      ]),
    );
  });

  it("describes one winner and the tie-break order the code implements", () => {
    expect(text).toContain("There is one winner");
    expect(text).toContain("1. most season points");
    expect(text.indexOf("2. then most wins")).toBeGreaterThan(text.indexOf("1. most season points"));
    expect(text.indexOf("3. then most Player of the Day")).toBeGreaterThan(text.indexOf("2. then most wins"));
    expect(text.indexOf("4. then the earliest season entry time")).toBeGreaterThan(text.indexOf("3. then most Player of the Day"));
    expect(text).toContain("no second or third place prize");
    expect(text).not.toMatch(/top three/i);
  });

  it("says entry is free and that buying anything does not help", () => {
    expect(text).toContain("Entering is free");
    expect(text).toContain("does not improve your chances");
  });

  it("uses the live numbers it is given", () => {
    expect(text).toContain("$150");
    expect(text).toContain("at least 10 games");
  });

  it("splits placeholders out of text", () => {
    expect(splitPlaceholders("Email [CONTACT EMAIL] today")).toEqual([
      { text: "Email ", placeholder: false },
      { text: "[CONTACT EMAIL]", placeholder: true },
      { text: " today", placeholder: false },
    ]);
  });
});
