import { describe, expect, it } from "vitest";
import { checkPlayerCards, findLegacyPlayerCardsReads } from "../../scripts/check-player-cards.mjs";

// player_cards legacy columns are for App Store v1.3.5 only and are dropped on 2026-12-01.
describe("player_cards legacy column check", () => {
  it("passes on the current tree", () => {
    expect(checkPlayerCards()).toEqual([]);
  });

  it("allows the star columns", () => {
    const src = `await supabase\n  .from("player_cards")\n  .select("user_id,star_rating,star_provisional,percentile")\n  .in("user_id", ids);`;
    expect(findLegacyPlayerCardsReads(src)).toEqual([]);
  });

  it("flags legacy columns in a single-line select", () => {
    const hits = findLegacyPlayerCardsReads(`supabase.from('player_cards').select('user_id, tier')`);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(1);
  });

  it("flags legacy columns in a multi-line select and reports the from() line", () => {
    const src = [
      "const x = 1;",
      "const { data } = await supabase",
      "  .from(`player_cards`)",
      "  .select(`",
      "    user_id,",
      "    star_rating,",
      "    reliability",
      "  `)",
      "  .eq('user_id', id);",
    ].join("\n");
    const hits = findLegacyPlayerCardsReads(src);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(3);
    expect(hits[0].kind).toContain("reliability");
  });

  it("flags concatenated strings, constants and select('*')", () => {
    expect(findLegacyPlayerCardsReads(`db.from("player_cards").select("user_id," + "sessions")`)).toHaveLength(1);
    expect(
      findLegacyPlayerCardsReads(`const COLS = "user_id,verification";\ndb.from("player_cards").select(COLS);`),
    ).toHaveLength(1);
    expect(findLegacyPlayerCardsReads(`db.from("player_cards").select("*")`)).toHaveLength(1);
  });

  it("flags embedded selects", () => {
    expect(findLegacyPlayerCardsReads(`db.from("profiles").select("id, player_cards(tier)")`)).toHaveLength(1);
    expect(findLegacyPlayerCardsReads(`db.from("profiles").select("player_cards(tier)")`)).toHaveLength(1);
    expect(
      findLegacyPlayerCardsReads(`db.from("profiles").select(\`\n  id,\n  card:player_cards!fk (\n    star_rating,\n    sessions\n  )\n\`)`),
    ).toHaveLength(1);
    expect(findLegacyPlayerCardsReads(`db.from("profiles").select("id, player_cards(star_rating)")`)).toEqual([]);
  });

  it("ignores other tables, comments and look-alike names", () => {
    expect(findLegacyPlayerCardsReads(`db.from("player_ratings").select("tier, score")`)).toEqual([]);
    expect(findLegacyPlayerCardsReads(`// never read player_cards(tier)\nconst a = 1;`)).toEqual([]);
    expect(findLegacyPlayerCardsReads(`db.from("player_cards").select("user_id, star_rating, sessions_count")`)).toEqual([]);
    expect(
      findLegacyPlayerCardsReads(`db.from("player_cards").select("user_id");\ndb.from("x").select("tier");`),
    ).toEqual([]);
  });
});
