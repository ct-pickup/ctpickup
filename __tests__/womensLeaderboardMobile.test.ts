import { describe, expect, it } from "vitest";

import { parseWomenRows } from "../mobile/lib/womenRows";
import {
  WOMENS_EMPTY_BODY,
  WOMENS_EMPTY_TITLE,
  WOMENS_SAVE_ERROR,
  WOMENS_SWITCH_HELP,
  WOMENS_SWITCH_LABEL,
  WOMENS_TAB_LABEL,
  WOMENS_UNAVAILABLE,
} from "../mobile/lib/womensLeaderboardCopy";

describe("women's leaderboard copy", () => {
  it("uses the agreed switch label and help line", () => {
    expect(WOMENS_SWITCH_LABEL).toBe("Show me on the women's leaderboard");
    expect(WOMENS_SWITCH_HELP).toBe("Only you choose. Your gender is never shown.");
    expect(WOMENS_TAB_LABEL).toBe("Women");
  });
  it("has no em dash and no tier or wave words", () => {
    for (const t of [WOMENS_SWITCH_LABEL, WOMENS_SWITCH_HELP, WOMENS_TAB_LABEL, WOMENS_EMPTY_TITLE, WOMENS_EMPTY_BODY, WOMENS_SAVE_ERROR, WOMENS_UNAVAILABLE]) {
      expect(t).not.toMatch(/—|\btier\b|\bwave\b|bronze|silver|gold|platinum|diamond/i);
    }
  });
  it("the empty state is friendly and says joining is a choice", () => {
    expect(WOMENS_EMPTY_TITLE).toBe("No one here yet");
    expect(WOMENS_EMPTY_BODY).toMatch(/Settings/);
    expect(WOMENS_EMPTY_BODY).toMatch(/choice/);
  });
});

describe("parseWomenRows", () => {
  it("keeps the server's ranks (1, 2, 3...) and the exact rating, sorted by rank", () => {
    const rows = parseWomenRows([
      { user_id: "b", rank: 2, first_name: "Ana", last_name: "R", star: 3.5, rating_exact: 3.38, rated_games: 2, games: 2, points: 0 },
      { user_id: "a", rank: 1, first_name: "Bea", last_name: "S", star: 3.5, rating_exact: 3.6, rated_games: 5, games: 5, points: 0 },
    ]);
    expect(rows.map((r) => r.user_id)).toEqual(["a", "b"]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2]);
    expect(rows[0]?.card).toMatchObject({ star: 3.5, exact: 3.6, ratedGames: 5 });
  });
  it("copies no gender or opt-in fields even if a response carried them", () => {
    const rows = parseWomenRows([{ user_id: "a", rank: 1, star: 3, gender: "female", sex: "female", womens_leaderboard_opt_in: true }]);
    const text = JSON.stringify(rows);
    expect(text).not.toMatch(/gender|sex|female|opt_in/i);
  });
  it("handles an empty or bad payload", () => {
    expect(parseWomenRows([])).toEqual([]);
    expect(parseWomenRows(null)).toEqual([]);
    expect(parseWomenRows([null, 3, { nope: true }])).toEqual([]);
  });
  it("falls back to a username and 'Player' for the name", () => {
    expect(parseWomenRows([{ user_id: "a", username: "sam" }])[0]?.name).toBe("sam");
    expect(parseWomenRows([{ user_id: "a" }])[0]?.name).toBe("Player");
  });
});
