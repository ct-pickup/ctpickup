import { describe, expect, it } from "vitest";

import { gamesPlayedText, POINTS_LABEL, POINTS_LOAD_FAILED_TEXT, seasonPointsCaption } from "../mobile/lib/pointsCopy";

describe("points copy", () => {
  it("says games are played, so all-time games beside season points do not look contradictory", () => {
    expect(gamesPlayedText(6)).toBe("6 games played");
    expect(gamesPlayedText(1)).toBe("1 game played");
    expect(gamesPlayedText(0)).toBe("0 games played");
  });
  it("captions points with the season name, or 'this season' when unknown", () => {
    expect(seasonPointsCaption("Fall 2026")).toBe("Fall 2026");
    expect(seasonPointsCaption("Winter 2026–27")).toBe("Winter 2026–27");
    expect(seasonPointsCaption(null)).toBe("this season");
    expect(seasonPointsCaption("  ")).toBe("this season");
    expect(seasonPointsCaption(undefined)).toBe("this season");
    expect(POINTS_LABEL).toBe("PTS");
  });
  it("has the retry text and no em dash", () => {
    expect(POINTS_LOAD_FAILED_TEXT).toBe("Can’t load points, tap to retry");
    for (const t of [POINTS_LOAD_FAILED_TEXT, gamesPlayedText(6), seasonPointsCaption("Fall 2026")]) expect(t).not.toMatch(/—/);
  });
});
