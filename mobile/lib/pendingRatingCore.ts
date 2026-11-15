/**
 * The "Rate your game" card and the "Rate your last game first" sheet, as plain data and plain words.
 * Pure: no React and no `@/` imports, so the root tests can run it. The rule itself is in shared/ratingGate.ts and runs on the
 * server; the app only reads the answer, and never sees a score.
 */
import { ratingTimeLeftText, type PendingRating } from "../../shared/ratingGate";

export const RATE_CARD_TITLE = "Rate your game";
export const RATING_SHEET_TITLE = "Rate your last game first";
export const RATING_SHEET_BODY = "It only takes a few seconds, then you can join another game.";
export const RATING_SHEET_BUTTON = "Rate it now";

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Reads GET /api/sessions/pending-rating. Anything that is not a pending game reads as none. */
export function parsePendingRating(json: unknown): PendingRating | null {
  const o = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
  const p = o?.pending && typeof o.pending === "object" ? (o.pending as Record<string, unknown>) : null;
  const run = str(p?.run_id);
  const expires = str(p?.expires_at);
  if (!p || !run || !expires || !Number.isFinite(new Date(expires).getTime())) return null;
  return { run_id: run, title: str(p.title), kickoff_at: str(p.kickoff_at) ?? "", expires_at: expires };
}

/** The game screen with its ballot already open. */
export function ballotHref(runId: string): string {
  return `/session/${encodeURIComponent(runId)}?ballot=1`;
}

/** The card shows only while the rating is still pending by this phone's clock too, so it never lingers past the deadline. */
export function visiblePending(p: PendingRating | null, now: number): PendingRating | null {
  if (!p) return null;
  const end = new Date(p.expires_at).getTime();
  return Number.isFinite(end) && end > now ? p : null;
}

/** "Sunday Pickup · 2 days left", or "Your last game · 5 hours left" when the game has no name. */
export function cardSubtitle(p: PendingRating, now: number): string {
  return `${p.title ?? "Your last game"} · ${ratingTimeLeftText(new Date(p.expires_at).getTime(), now)}`;
}

/**
 * Should the game screen open the ballot by itself? Only when it was opened from the sheet, a card or the reminder (ballot=1), the
 * game has loaded, the player joined and is not the host, and has not already voted.
 */
export function shouldOpenBallot(a: { ballotParam: string | undefined; loaded: boolean; joined: boolean; isHost: boolean; hasVoted: boolean; alreadyOpened: boolean }): boolean {
  return a.ballotParam === "1" && a.loaded && a.joined && !a.isHost && !a.hasVoted && !a.alreadyOpened;
}
