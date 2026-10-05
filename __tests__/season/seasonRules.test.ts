import { describe, expect, it } from "vitest";

import { APPLE_DISCLAIMER, listPlaceholders, seasonRuleSections, splitPlaceholders } from "@/shared/seasonRules";

const sections = seasonRuleSections({
  prizeUsd: 150,
  minGames: 10,
  points: { played: 1, win: 3, draw: 1, potd: 2 },
  season: { label: "Fall 2026", startText: "Sep 1", endText: "Nov 30, 2026" },
  rulesVersion: "draft-3",
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

  it("has no placeholders left, and splitting still highlights any that appear", () => {
    expect(listPlaceholders(sections)).toEqual([]);
    expect(listPlaceholders([{ id: "x", title: "x", blocks: [{ kind: "p", text: "Email [CONTACT EMAIL]" }] }])).toEqual(["[CONTACT EMAIL]"]);
  });

  it("states the filled-in sponsor, age, dates, announcement, payout, claim, contact and exclusions", () => {
    expect(text).toContain("CT Pickup LLC (doing business as Competitive Together), 2389 Main Street, STE 100, Glastonbury, CT 06033, United States");
    expect(text).toContain("be 18 years of age or older");
    expect(text).toContain("The Fall 2026 season runs from Sep 1 through Nov 30, 2026, Eastern Time.");
    expect(text).toContain("within 7 days after the season ends");
    expect(text).toContain("by Venmo, PayPal or check, at the winner\u2019s choice");
    expect(text).toContain("within 14 days of being notified");
    expect(text).toContain("pickupct@gmail.com");
    expect(text).toContain("Employees and administrators of Competitive Together, and members of their households, are not eligible to win.");
  });

  it("says free and paid games count the same toward the minimum", () => {
    expect(text).toContain("Games with no fee count toward the 10-game minimum exactly the same as paid games");
    expect(text).toContain("paid and free games are counted identically");
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
