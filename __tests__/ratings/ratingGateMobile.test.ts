import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  RATE_CARD_TITLE,
  RATING_SHEET_BODY,
  RATING_SHEET_BUTTON,
  RATING_SHEET_TITLE,
  ballotHref,
  cardSubtitle,
  parsePendingRating,
  shouldOpenBallot,
  visiblePending,
} from "../../mobile/lib/pendingRatingCore";

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const NOW = Date.parse("2026-11-14T19:00:00Z");
const H = 3_600_000;
const pending = (hoursLeft: number, title: string | null = "Sunday Pickup") => ({
  run_id: "r1",
  title,
  kickoff_at: new Date(NOW - 2 * H).toISOString(),
  expires_at: new Date(NOW + hoursLeft * H).toISOString(),
});

describe("the pending rating, as the app reads it", () => {
  it("reads the endpoint's answer, and anything else is none", () => {
    expect(parsePendingRating({ pending: pending(70) })).toEqual(pending(70));
    expect(parsePendingRating({ pending: null })).toBeNull();
    expect(parsePendingRating({ pending: { run_id: "r1" } })).toBeNull();
    expect(parsePendingRating({ pending: { run_id: "r1", expires_at: "nope" } })).toBeNull();
    expect(parsePendingRating(null)).toBeNull();
    expect(parsePendingRating("x")).toBeNull();
  });

  it("goes straight to that game's ballot", () => {
    expect(ballotHref("abc-123")).toBe("/session/abc-123?ballot=1");
    expect(ballotHref("a b")).toBe("/session/a%20b?ballot=1");
  });

  it("the card is hidden once the time is up on this phone's clock too", () => {
    expect(visiblePending(pending(1), NOW)).not.toBeNull();
    expect(visiblePending(pending(0), NOW)).toBeNull();
    expect(visiblePending(pending(-3), NOW)).toBeNull();
    expect(visiblePending(null, NOW)).toBeNull();
  });

  it("the card says what and how long, in plain words", () => {
    expect(RATE_CARD_TITLE).toBe("Rate your game");
    expect(cardSubtitle(pending(70), NOW)).toBe("Sunday Pickup · 2 days left");
    expect(cardSubtitle(pending(5), NOW)).toBe("Sunday Pickup · 5 hours left");
    expect(cardSubtitle(pending(0.5), NOW)).toBe("Sunday Pickup · 30 minutes left");
    expect(cardSubtitle(pending(5, null), NOW)).toBe("Your last game · 5 hours left");
  });

  it("the sheet says Rate your last game first and offers one way forward", () => {
    expect(RATING_SHEET_TITLE).toBe("Rate your last game first");
    expect(RATING_SHEET_BUTTON).toBe("Rate it now");
    expect(RATING_SHEET_BODY).not.toMatch(/—|tier|wave|score/i);
  });
});

describe("when the game screen opens the ballot by itself", () => {
  const base = { ballotParam: "1", loaded: true, joined: true, isHost: false, hasVoted: false, alreadyOpened: false };
  it("only when asked to, loaded, joined, not the host, not voted, and not already opened", () => {
    expect(shouldOpenBallot(base)).toBe(true);
    expect(shouldOpenBallot({ ...base, ballotParam: undefined })).toBe(false);
    expect(shouldOpenBallot({ ...base, ballotParam: "0" })).toBe(false);
    expect(shouldOpenBallot({ ...base, loaded: false })).toBe(false);
    expect(shouldOpenBallot({ ...base, joined: false })).toBe(false);
    expect(shouldOpenBallot({ ...base, isHost: true })).toBe(false);
    expect(shouldOpenBallot({ ...base, hasVoted: true })).toBe(false);
    expect(shouldOpenBallot({ ...base, alreadyOpened: true })).toBe(false);
  });
});

describe("the 409 is handled everywhere a player joins, books or creates", () => {
  const join = src("mobile/hooks/usePickupJoin.ts");

  it("joining, paying and both ways of committing to a slot", () => {
    expect((join.match(/handleRatingRequired\(r\.status, j\)/g) ?? []).length).toBe(4);
    for (const name of ["joinPickup", "payPickup", "commitAvailability", "commitAvailabilitySlots"]) {
      const at = join.indexOf(`const ${name} = useCallback(`);
      expect(at, name).toBeGreaterThan(0);
      const end = join.indexOf("\n  );\n", at);
      expect(join.slice(at, end), name).toMatch(/handleRatingRequired\(r\.status, j\)/);
      expect(join.slice(at, end), name).toMatch(/\[[^\]]*handleRatingRequired[^\]]*\],?\s*$/);
    }
  });

  it("declining, leaving and saying you cannot make it are never stopped", () => {
    for (const name of ["declinePickup", "recordCantMakeIt"]) {
      const at = join.indexOf(`const ${name} = useCallback(`);
      expect(at, name).toBeGreaterThan(0);
      const end = join.indexOf("\n  );\n", at);
      expect(join.slice(at, end), name).not.toMatch(/handleRatingRequired/);
    }
  });

  it("the game screen's own Join button, and creating a game", () => {
    expect(src("mobile/app/session/[id].tsx")).toMatch(/if \(handleRatingRequired\(r\.status, j\)\) return;/);
    expect(src("mobile/app/session-create.tsx")).toMatch(/if \(handleRatingRequired\(r\.status, j\)\) return;/);
  });

  it("one provider, mounted once, holds the sheet", () => {
    const layout = src("mobile/app/_layout.tsx");
    expect(layout).toMatch(/<RatingGateProvider>/);
    expect(layout.indexOf("<ProfilePhotoProvider>")).toBeLessThan(layout.indexOf("<RatingGateProvider>"));
    expect(layout.indexOf("</RatingGateProvider>")).toBeLessThan(layout.indexOf("</ProfilePhotoProvider>"));
    const ctx = src("mobile/context/RatingGateContext.tsx");
    expect(ctx).toMatch(/parseRatingRequired\(status, json\)/);
    expect(ctx).toMatch(/ballotHref\(runId\)/);
  });
});

describe("the sheet and the cards", () => {
  const sheet = src("mobile/components/rating/RatingRequiredSheet.tsx");
  const card = src("mobile/components/rating/RateGameCard.tsx");

  it("the sheet is the title, one line and one button: no cancel, no second action", () => {
    expect(sheet).toMatch(/<SheetModal/);
    expect((sheet.match(/<AnimatedPressScale/g) ?? []).length).toBe(1);
    expect(sheet).not.toMatch(/Cancel|Not now|Later|Skip|FontAwesome|name="close"/);
    expect(sheet).toMatch(/MOTION\.pressScale\.button/);
  });

  it("the card uses the shared motion config and Reduce Motion, and opens that game's ballot", () => {
    expect(card).toMatch(/MOTION\.duration\.base/);
    expect(card).toMatch(/MOTION\.pressScale\.card/);
    expect(card).toMatch(/useReduceMotion/);
    expect(card).toMatch(/ballotHref\(pending\.run_id\)/);
    expect(card).toMatch(/if \(!pending\) return null;/);
    expect(card).not.toMatch(/duration: \d{3,}/);
  });

  it("Home shows the card at the top and the older banner steps aside while it shows", () => {
    const home = src("mobile/app/(tabs)/index.tsx");
    expect(home).toMatch(/<RateGameCard pending=\{pendingRating\} now=\{ratingNow\} \/>/);
    expect(home.indexOf("<RateGameCard")).toBeLessThan(home.indexOf("rateBanner && !pendingRating"));
    expect(home).toMatch(/\{rateBanner && !pendingRating \? \(/);
  });

  it("the Games tab shows it at the top, above the Season, Fields and Events switch", () => {
    const games = src("mobile/app/(tabs)/sessions.tsx");
    expect(games.indexOf("<RateGameCard")).toBeGreaterThan(games.indexOf("styles.headerRow"));
    expect(games.indexOf("<RateGameCard")).toBeLessThan(games.indexOf('accessibilityRole="tablist"'));
  });

  it("the game screen opens the ballot for ballot=1, once", () => {
    const g = src("mobile/app/session/[id].tsx");
    expect(g).toMatch(/ballot: ballotParam/);
    expect(g).toMatch(/shouldOpenBallot\(\{/);
    expect(g).toMatch(/setBallotOpened\(true\);\s*setVoteStep\(1\);\s*setVoteOpen\(true\);/);
  });

  it("tapping the reminder opens that game's ballot", () => {
    const push = src("mobile/hooks/usePushRegistration.ts");
    expect(push).toMatch(/"rating_required_reminder"/);
    expect(push).toMatch(/router\.push\(ballotHref\(runId\) as never\)/);
  });

  it("the admin flags screen can switch it on, and the words are plain", () => {
    expect(src("mobile/app/(tabs)/admin/feature-flags.tsx")).toMatch(/require_ratings: \{ title: "Require ratings"/);
    for (const f of [
      "mobile/lib/pendingRatingCore.ts",
      "mobile/components/rating/RateGameCard.tsx",
      "mobile/components/rating/RatingRequiredSheet.tsx",
      "mobile/context/RatingGateContext.tsx",
      "mobile/hooks/usePendingRating.ts",
      "shared/ratingGate.ts",
      "lib/ratings/pendingRating.ts",
      "lib/ratings/ratingReminders.ts",
      "app/api/sessions/pending-rating/route.ts",
      "app/api/cron/rating-reminders/route.ts",
      "supabase/migrations/20261105000000_require_ratings_flag.sql",
    ]) {
      expect(src(f), f).not.toMatch(/—/);
      expect(src(f), f).not.toMatch(/\btier\b|\bwave\b/i);
    }
  });
});
