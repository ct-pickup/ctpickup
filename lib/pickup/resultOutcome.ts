/**
 * Pickup result rules shared by the result routes, the record helper and the mobile app.
 * Pure: no Supabase, no React. Keep mobile/lib/pickup/resultOutcome.ts identical.
 */

export type ResultTeam = "A" | "B" | "C";
export type PlayerOutcome = "W" | "D" | "L";

export const SCORE_MIN = 0;
export const SCORE_MAX = 30;
export const HOST_EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** A posted result. `winning_team` null means a draw (two-team games only). */
export type StoredResult = {
  winning_team: string | null | undefined;
  score_a?: number | null;
  score_b?: number | null;
};

export type ResultSubmission =
  | { ok: true; winning_team: ResultTeam | null; score_a: number | null; score_b: number | null }
  | { ok: false; error: string };

function isTeam(v: unknown): v is ResultTeam {
  return v === "A" || v === "B" || v === "C";
}

function present(v: unknown): boolean {
  return v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "");
}

function parseScore(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\s*\d+\s*$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= SCORE_MIN && n <= SCORE_MAX ? n : null;
}

function wantsDraw(body: Record<string, unknown>): boolean {
  const wt = typeof body.winning_team === "string" ? body.winning_team.trim().toUpperCase() : "";
  const outcome = typeof body.outcome === "string" ? body.outcome.trim().toLowerCase() : "";
  return wt === "DRAW" || outcome === "draw" || body.is_draw === true;
}

/** Winner implied by a final score: higher wins, equal is a draw. */
export function winnerFromScore(scoreA: number, scoreB: number): ResultTeam | null {
  if (scoreA > scoreB) return "A";
  if (scoreB > scoreA) return "B";
  return null;
}

/**
 * Validates a posted result. With a score, the outcome comes from the score and any separate
 * winner must agree with it. Without one ("didn't track the score"), the body names a team or a draw.
 */
export function parseResultSubmission(body: Record<string, unknown>, totalTeams: number): ResultSubmission {
  const hasA = present(body.score_a);
  const hasB = present(body.score_b);
  const draw = wantsDraw(body);
  const rawTeam = typeof body.winning_team === "string" ? body.winning_team.trim().toUpperCase() : "";

  if (hasA || hasB) {
    if (!hasA || !hasB) return { ok: false, error: "Enter both scores, or choose \"Didn't track the score\"." };
    const a = parseScore(body.score_a);
    const b = parseScore(body.score_b);
    if (a == null || b == null) {
      return { ok: false, error: `Scores must be whole numbers from ${SCORE_MIN} to ${SCORE_MAX}.` };
    }
    if (totalTeams !== 2) return { ok: false, error: "Scores can only be recorded for two-team games." };
    const winner = winnerFromScore(a, b);
    const sentTeam = isTeam(rawTeam) ? rawTeam : null;
    if ((draw && winner != null) || (sentTeam && sentTeam !== winner)) {
      return { ok: false, error: "The score decides the result. Don't send a different winner." };
    }
    return { ok: true, winning_team: winner, score_a: a, score_b: b };
  }

  if (draw) {
    if (totalTeams !== 2) return { ok: false, error: "Draws can only be recorded for two-team games." };
    return { ok: true, winning_team: null, score_a: null, score_b: null };
  }
  if (!isTeam(rawTeam)) return { ok: false, error: "Choose the winning team or a draw." };
  if (totalTeams !== 3 && rawTeam === "C") return { ok: false, error: "Team C only exists in three-team games." };
  return { ok: true, winning_team: rawTeam, score_a: null, score_b: null };
}

function scoresOf(result: StoredResult): { a: number; b: number } | null {
  return typeof result.score_a === "number" && typeof result.score_b === "number"
    ? { a: result.score_a, b: result.score_b }
    : null;
}

/** W, D or L for a player on `team`. Null without a posted result or a team. */
export function outcomeForTeam(team: string | null | undefined, result: StoredResult | null | undefined): PlayerOutcome | null {
  if (!result || !isTeam(team)) return null;
  const s = scoresOf(result);
  const winner = s ? winnerFromScore(s.a, s.b) : isTeam(result.winning_team) ? result.winning_team : null;
  if (winner == null) return "D";
  return winner === team ? "W" : "L";
}

/** "5–3" from the player's side (their score first). Null without a score or for Team C. */
export function scoreLineForTeam(team: string | null | undefined, result: StoredResult | null | undefined): string | null {
  const s = result ? scoresOf(result) : null;
  if (!s || (team !== "A" && team !== "B")) return null;
  const [mine, theirs] = team === "A" ? [s.a, s.b] : [s.b, s.a];
  return `${mine}\u2013${theirs}`;
}

export type EditCheck = { ok: true; role: "host" | "admin" } | { ok: false; error: string };

/** Admins edit anytime; the host for 24 hours after the result was first posted. */
export function canEditResult(args: {
  isAdmin: boolean;
  isHost: boolean;
  postedAt: string | null | undefined;
  now?: number;
}): EditCheck {
  if (args.isAdmin) return { ok: true, role: "admin" };
  if (!args.isHost) return { ok: false, error: "Only the host can record results." };
  const posted = args.postedAt ? Date.parse(args.postedAt) : NaN;
  const now = args.now ?? Date.now();
  if (Number.isFinite(posted) && now - posted <= HOST_EDIT_WINDOW_MS) return { ok: true, role: "host" };
  return { ok: false, error: "Results can only be edited for 24 hours after posting. Ask an admin to change it." };
}

/** Push copy: "Team A won 5–3.", "It ended 2–2, a draw.", "Team B won." */
export function resultSummary(result: StoredResult): string {
  const s = scoresOf(result);
  const winner = s ? winnerFromScore(s.a, s.b) : isTeam(result.winning_team) ? result.winning_team : null;
  if (winner == null) return s ? `It ended ${s.a}\u2013${s.b}, a draw.` : "It ended in a draw.";
  if (!s) return `Team ${winner} won.`;
  const [w, l] = winner === "A" ? [s.a, s.b] : [s.b, s.a];
  return `Team ${winner} won ${w}\u2013${l}.`;
}
