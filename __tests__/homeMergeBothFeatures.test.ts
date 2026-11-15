import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Home carries two features that were built on separate branches: the "Rate your game" card (pending rating) and the tournament card.
 * This pins that both stay, and that the older "session to rate" banner steps aside exactly when the new card shows.
 */
const home = readFileSync(new URL("../mobile/app/(tabs)/index.tsx", import.meta.url), "utf8");
const card = readFileSync(new URL("../mobile/components/rating/RateGameCard.tsx", import.meta.url), "utf8");

describe("Home keeps both the rating card and the tournament card", () => {
  it("imports and renders the Rate your game card from the pending rating hook", () => {
    expect(home).toMatch(/import \{ RateGameCard \} from "@\/components\/rating\/RateGameCard"/);
    expect(home).toMatch(/import \{ usePendingRating \} from "@\/hooks\/usePendingRating"/);
    expect(home).toMatch(/const \{ pending: pendingRating, now: ratingNow \} = usePendingRating\(\)/);
    expect(home).toMatch(/<RateGameCard pending=\{pendingRating\} now=\{ratingNow\} \/>/);
  });

  it("still shows the tournament card in the calendar's slot under the date strip", () => {
    expect(home).toMatch(/import \{ HomeTournamentCard \} from "@\/components\/tournament\/HomeTournamentCard"/);
    expect(home).toMatch(/belowStrip=\{<HomeTournamentCard \/>\}/);
  });

  it("the old session to rate banner steps aside only when the new card shows", () => {
    expect(home).toMatch(/\{rateBanner && !pendingRating \? \(/);
    // the card shows exactly when there is a pending rating
    expect(card).toMatch(/if \(!pending\) return null;/);
  });

  it("the card sits above the banner, and nothing in the file is a leftover conflict marker", () => {
    expect(home.indexOf("<RateGameCard")).toBeLessThan(home.indexOf("rateBanner && !pendingRating"));
    expect(home).not.toMatch(/^(<<<<<<<|=======|>>>>>>>)/m);
  });
});
