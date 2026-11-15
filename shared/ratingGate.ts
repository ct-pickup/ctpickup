/**
 * "Rate your last game first": the rule for a pending rating, the words, and the codes. Pure: no React Native, Next or Supabase
 * imports, so the server, the app and the tests all use this one definition.
 *
 * The required step is the post-game top 3 ballot (peer_votes). The half star "Rate players" sheet stays optional.
 */

/** The `code` on the 409 every guarded route returns. The app keys on this, never on the wording. */
export const RATING_REQUIRED_CODE = "rating_required";
/** The `error` on that 409. Older app versions print it as is, so it reads as a plain sentence. */
export const RATING_REQUIRED_MESSAGE = "Rate your last game first";
export const RATING_REQUIRED_DETAIL = "Submit your rating for that game, then you can join or book another one. It only takes a few seconds.";

/** Fewer joined players than this and the game never asks for ratings. */
export const RATING_MIN_PLAYERS = 4;
/** A game that has not been marked completed starts asking this long after kickoff. */
export const RATING_MIN_AFTER_KICKOFF_MS = 60 * 60 * 1000;
/** After this long from kickoff the requirement is gone and never blocks again. */
export const RATING_EXPIRES_AFTER_MS = 72 * 60 * 60 * 1000;
/** The one reminder goes out this long after kickoff, if the rating is still pending. */
export const RATING_REMINDER_AFTER_MS = 24 * 60 * 60 * 1000;

/** RSVP statuses that count as having joined a game (the same two the ballot route accepts). */
export const JOINED_RSVP_STATUSES = ["confirmed", "pending_payment"] as const;

/** Everything the rule needs to know about one game and one player. */
export type PendingFacts = {
  run_id: string;
  status: string | null;
  start_at: string | null;
  /** The game's time is still to be announced, so it has no real kickoff. */
  time_tbd: boolean;
  host_id: string | null;
  /** How many players joined the game (confirmed or payment pending). */
  joined_players: number;
  /** This player's RSVP status for the game. */
  my_status: string | null;
  /** From the admin attendance sheet: true attended, false did not, null not marked. */
  attended: boolean | null;
  /** The player has submitted a top 3 ballot for this game. */
  has_ballot: boolean;
  /** The game is a tournament match (excluded for now). */
  in_tournament_match: boolean;
};

export type PendingRating = {
  run_id: string;
  title: string | null;
  kickoff_at: string;
  expires_at: string;
};

const isJoinedStatus = (s: string | null): boolean => s === "confirmed" || s === "pending_payment";

function kickoffMs(f: Pick<PendingFacts, "start_at" | "time_tbd">): number | null {
  if (f.time_tbd) return null;
  const raw = f.start_at != null ? String(f.start_at).trim() : "";
  if (!raw) return null;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : null;
}

export function ratingExpiresAtMs(kickoff: number): number {
  return kickoff + RATING_EXPIRES_AFTER_MS;
}

/**
 * Does this player owe a rating for this game right now? All of these must hold:
 *   - they joined it (confirmed or payment pending) and were not marked as not attending, and they are not the host
 *   - at least 4 players joined, and it is not a tournament match
 *   - it is not canceled, and it has a real kickoff
 *   - the game is completed or kickoff was at least 1 hour ago (and in the past)
 *   - kickoff was less than 72 hours ago (at exactly 72 hours it has expired)
 *   - they have not submitted the ballot
 */
export function isRatingPending(f: PendingFacts, userId: string, now: number): boolean {
  if (!isJoinedStatus(f.my_status)) return false;
  if (f.host_id != null && f.host_id === userId) return false;
  if (f.attended === false) return false;
  if (f.has_ballot) return false;
  if (f.in_tournament_match) return false;
  if (f.joined_players < RATING_MIN_PLAYERS) return false;

  const st = String(f.status ?? "").trim().toLowerCase();
  if (st === "canceled" || st === "cancelled") return false;

  const kickoff = kickoffMs(f);
  if (kickoff == null) return false;
  const age = now - kickoff;
  if (age < 0) return false;
  if (age >= RATING_EXPIRES_AFTER_MS) return false;
  return st === "completed" || age >= RATING_MIN_AFTER_KICKOFF_MS;
}

export function pendingRatingFor(f: PendingFacts, title: string | null): PendingRating | null {
  const kickoff = kickoffMs(f);
  if (kickoff == null) return null;
  return {
    run_id: f.run_id,
    title,
    kickoff_at: new Date(kickoff).toISOString(),
    expires_at: new Date(ratingExpiresAtMs(kickoff)).toISOString(),
  };
}

/** When a player owes more than one, the one that runs out first. */
export function earliestExpiring(list: readonly PendingRating[]): PendingRating | null {
  return [...list].sort((a, b) => a.expires_at.localeCompare(b.expires_at) || a.run_id.localeCompare(b.run_id))[0] ?? null;
}

/** "2 days left", "5 hours left", "40 minutes left". Whole units, rounded down, never negative. */
export function ratingTimeLeftText(expiresAtMs: number, now: number): string {
  const left = Math.max(0, expiresAtMs - now);
  const hour = 60 * 60 * 1000;
  if (left >= 48 * hour) return `${Math.floor(left / (24 * hour))} days left`;
  if (left >= hour) {
    const h = Math.floor(left / hour);
    return h === 1 ? "1 hour left" : `${h} hours left`;
  }
  const m = Math.max(1, Math.floor(left / (60 * 1000)));
  return m === 1 ? "1 minute left" : `${m} minutes left`;
}

/** The 409 body. `error` is the sentence an older app prints; newer apps read `code` and `pending_run_id`. */
export function ratingRequiredBody(p: Pick<PendingRating, "run_id" | "expires_at">) {
  return {
    error: RATING_REQUIRED_MESSAGE,
    code: RATING_REQUIRED_CODE,
    detail: RATING_REQUIRED_DETAIL,
    pending_run_id: p.run_id,
    expires_at: p.expires_at,
  };
}

export type RatingRequired = { run_id: string; expires_at: string | null; message: string };

/** Reads a route response. Returns the pending game when it is the 409 rating_required response, otherwise null. */
export function parseRatingRequired(status: number, json: unknown): RatingRequired | null {
  if (status !== 409 || !json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (o.code !== RATING_REQUIRED_CODE) return null;
  const run = typeof o.pending_run_id === "string" ? o.pending_run_id.trim() : "";
  if (!run) return null;
  return {
    run_id: run,
    expires_at: typeof o.expires_at === "string" && o.expires_at ? o.expires_at : null,
    message: typeof o.error === "string" && o.error.trim() ? o.error.trim() : RATING_REQUIRED_MESSAGE,
  };
}
