import { describe, expect, it } from "vitest";
import {
  RATING_REQUIRED_CODE,
  RATING_REQUIRED_MESSAGE,
  earliestExpiring,
  isRatingPending,
  parseRatingRequired,
  ratingRequiredBody,
  ratingTimeLeftText,
  type PendingFacts,
} from "../../shared/ratingGate";
import { ratingGateActive } from "../../lib/ratings/pendingRating";

const NOW = Date.parse("2026-11-14T19:00:00Z");
const H = 3_600_000;
const S = 1000;

const facts = (o: Partial<PendingFacts> = {}): PendingFacts => ({
  run_id: "r1",
  status: "active",
  start_at: new Date(NOW - 2 * H).toISOString(),
  time_tbd: false,
  host_id: "host1",
  joined_players: 4,
  my_status: "confirmed",
  attended: null,
  has_ballot: false,
  in_tournament_match: false,
  ...o,
});
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const pending = (o: Partial<PendingFacts> = {}) => isRatingPending(facts(o), "p1", NOW);

describe("when a rating is pending: the timing edges", () => {
  it("a game that is not marked completed starts asking at exactly 1 hour after kickoff, not before", () => {
    expect(pending({ start_at: ago(H) })).toBe(true);
    expect(pending({ start_at: ago(H - S) })).toBe(false);
    expect(pending({ start_at: ago(H + S) })).toBe(true);
  });

  it("a completed game asks as soon as it is over, even inside the first hour", () => {
    expect(pending({ status: "completed", start_at: ago(10 * 60 * S) })).toBe(true);
    expect(pending({ status: "active", start_at: ago(10 * 60 * S) })).toBe(false);
  });

  it("a completed game whose kickoff is still ahead asks nothing", () => {
    expect(pending({ status: "completed", start_at: new Date(NOW + H).toISOString() })).toBe(false);
  });

  it("it expires at exactly 72 hours after kickoff and never blocks again", () => {
    expect(pending({ start_at: ago(72 * H - S) })).toBe(true);
    expect(pending({ start_at: ago(72 * H) })).toBe(false);
    expect(pending({ start_at: ago(72 * H + S) })).toBe(false);
    expect(pending({ status: "completed", start_at: ago(100 * H) })).toBe(false);
  });
});

describe("when a rating is pending: who and what", () => {
  it("needs at least 4 players: 3 never asks, 4 does", () => {
    expect(pending({ joined_players: 3 })).toBe(false);
    expect(pending({ joined_players: 4 })).toBe(true);
    expect(pending({ joined_players: 12 })).toBe(true);
  });

  it("never for the host of the game", () => {
    expect(isRatingPending(facts({ host_id: "p1" }), "p1", NOW)).toBe(false);
    expect(isRatingPending(facts({ host_id: "host1" }), "p1", NOW)).toBe(true);
  });

  it("never for a tournament match", () => {
    expect(pending({ in_tournament_match: true })).toBe(false);
  });

  it("not once the ballot is in", () => {
    expect(pending({ has_ballot: true })).toBe(false);
  });

  it("only for someone who joined: confirmed or payment pending, not the waitlist or a decline", () => {
    expect(pending({ my_status: "confirmed" })).toBe(true);
    expect(pending({ my_status: "pending_payment" })).toBe(true);
    for (const s of ["waitlist", "declined", "cancelled", "pending_confirm", null]) expect(pending({ my_status: s })).toBe(false);
  });

  it("someone marked as not attending is not asked, and someone nobody marked is", () => {
    expect(pending({ attended: false })).toBe(false);
    expect(pending({ attended: true })).toBe(true);
    expect(pending({ attended: null })).toBe(true);
  });

  it("not for a canceled game or one with no real kickoff", () => {
    expect(pending({ status: "canceled" })).toBe(false);
    expect(pending({ status: "cancelled" })).toBe(false);
    expect(pending({ time_tbd: true })).toBe(false);
    expect(pending({ start_at: null })).toBe(false);
    expect(pending({ start_at: "not a date" })).toBe(false);
  });
});

describe("the flag: admins are exempt, not always on", () => {
  const row = { enabled: false, allowlist: ["p1"] };
  it("off for everyone when the flag is off and nobody is listed", () => {
    expect(ratingGateActive({ enabled: false, allowlist: [] }, "p1", false)).toBe(false);
    expect(ratingGateActive(null, "p1", false)).toBe(false);
    expect(ratingGateActive(undefined, "p1", false)).toBe(false);
  });
  it("on for a listed player while it is off for everyone else", () => {
    expect(ratingGateActive(row, "p1", false)).toBe(true);
    expect(ratingGateActive(row, "p2", false)).toBe(false);
  });
  it("on for everyone when enabled", () => {
    expect(ratingGateActive({ enabled: true, allowlist: [] }, "p2", false)).toBe(true);
  });
  it("an admin is exempt even when the flag is on for everyone or they are listed", () => {
    expect(ratingGateActive({ enabled: true, allowlist: ["adm"] }, "adm", true)).toBe(false);
  });
  it("no user means off", () => {
    expect(ratingGateActive({ enabled: true }, null, false)).toBe(false);
  });
});

describe("the words and the response", () => {
  it("the 409 body says it in plain words an older app can print, with the game's id", () => {
    const b = ratingRequiredBody({ run_id: "r1", expires_at: "2026-11-17T17:00:00.000Z" });
    expect(b).toMatchObject({ error: "Rate your last game first", code: RATING_REQUIRED_CODE, pending_run_id: "r1", expires_at: "2026-11-17T17:00:00.000Z" });
    expect(b.error).toBe(RATING_REQUIRED_MESSAGE);
    expect(JSON.stringify(b)).not.toMatch(/—|tier|wave|score/i);
  });

  it("the app reads that response, and nothing else", () => {
    const body = ratingRequiredBody({ run_id: "r1", expires_at: "2026-11-17T17:00:00.000Z" });
    expect(parseRatingRequired(409, body)).toEqual({ run_id: "r1", expires_at: "2026-11-17T17:00:00.000Z", message: "Rate your last game first" });
    expect(parseRatingRequired(403, body)).toBeNull();
    expect(parseRatingRequired(409, { error: "No pending payment for this run." })).toBeNull();
    expect(parseRatingRequired(409, { code: RATING_REQUIRED_CODE })).toBeNull();
    expect(parseRatingRequired(409, null)).toBeNull();
  });

  it("when two are pending, the one that runs out first comes first", () => {
    const a = { run_id: "a", title: null, kickoff_at: "x", expires_at: "2026-11-16T10:00:00.000Z" };
    const b = { run_id: "b", title: null, kickoff_at: "x", expires_at: "2026-11-15T10:00:00.000Z" };
    expect(earliestExpiring([a, b])?.run_id).toBe("b");
    expect(earliestExpiring([])).toBeNull();
  });

  it("time left reads in whole days, hours or minutes", () => {
    const at = (left: number) => ratingTimeLeftText(NOW + left, NOW);
    expect(at(71 * H)).toBe("2 days left");
    expect(at(48 * H)).toBe("2 days left");
    expect(at(47 * H)).toBe("47 hours left");
    expect(at(H)).toBe("1 hour left");
    expect(at(40 * 60 * S)).toBe("40 minutes left");
    expect(at(10 * S)).toBe("1 minute left");
    expect(at(-5 * H)).toBe("1 minute left");
  });
});
