import type { SupabaseClient } from "@supabase/supabase-js";

import { SCORE_MAX, SCORE_MIN, winnerFromScore, type ResultTeam } from "@/lib/pickup/resultOutcome";

/** Host/admin result form: a final score, or "didn't track the score" plus a winner or a draw. */
export type ResultFormState = {
  tracked: boolean;
  scoreA: string;
  scoreB: string;
  pick: ResultTeam | "draw" | null;
};

export const EMPTY_RESULT_FORM: ResultFormState = { tracked: true, scoreA: "", scoreB: "", pick: null };

export type ResultFormBody =
  | { ok: true; body: { score_a: number; score_b: number } | { winning_team: ResultTeam } | { outcome: "draw" } }
  | { ok: false; error: string };

function score(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d{1,2}$/.test(t)) return null;
  const n = Number(t);
  return n >= SCORE_MIN && n <= SCORE_MAX ? n : null;
}

/** Request fields for the result routes. With scores tracked, no winner is sent: the server derives it. */
export function resultFormBody(state: ResultFormState, scoresAvailable: boolean): ResultFormBody {
  if (state.tracked && scoresAvailable) {
    const a = score(state.scoreA);
    const b = score(state.scoreB);
    if (a == null || b == null) return { ok: false, error: `Enter both scores (${SCORE_MIN} to ${SCORE_MAX}).` };
    return { ok: true, body: { score_a: a, score_b: b } };
  }
  if (state.pick === "draw") return { ok: true, body: { outcome: "draw" } };
  if (state.pick) return { ok: true, body: { winning_team: state.pick } };
  return { ok: false, error: "Choose the winning team or a draw." };
}

/** "Team A wins", "Draw", or null while the score is incomplete. */
export function scorePreview(state: ResultFormState): string | null {
  const a = score(state.scoreA);
  const b = score(state.scoreB);
  if (a == null || b == null) return null;
  const w = winnerFromScore(a, b);
  return w ? `Team ${w} wins` : "Draw";
}

/** Prefill from a posted result (null winner on a posted result is a draw). */
export function resultFormFromStored(row: {
  winning_team: string | null;
  score_a?: number | null;
  score_b?: number | null;
}): ResultFormState {
  if (typeof row.score_a === "number" && typeof row.score_b === "number") {
    return { tracked: true, scoreA: String(row.score_a), scoreB: String(row.score_b), pick: null };
  }
  const t = row.winning_team;
  return { tracked: false, scoreA: "", scoreB: "", pick: t === "A" || t === "B" || t === "C" ? t : "draw" };
}

export type PostedResult = {
  winning_team: string | null;
  score_a: number | null;
  score_b: number | null;
  created_at: string | null;
};

/** The run's posted result, or null. Reads without score columns until the migration runs. */
export async function fetchPostedResult(supabase: SupabaseClient, runId: string): Promise<PostedResult | null> {
  const full = await supabase
    .from("pickup_run_results")
    .select("winning_team,score_a,score_b,created_at")
    .eq("run_id", runId)
    .maybeSingle();
  if (!full.error) return (full.data as PostedResult | null) ?? null;
  const base = await supabase.from("pickup_run_results").select("winning_team,created_at").eq("run_id", runId).maybeSingle();
  if (base.error || !base.data) return null;
  const row = base.data as { winning_team: string | null; created_at: string | null };
  return { ...row, score_a: null, score_b: null };
}

let scoresSupportedCache: boolean | null = null;

/** Scores and draws need the 20261002220000 migration; until then the form shows the winner picker only. */
export async function probeResultScoresSupported(supabase: SupabaseClient): Promise<boolean> {
  if (scoresSupportedCache != null) return scoresSupportedCache;
  const { error } = await supabase.from("pickup_run_results").select("score_a").limit(1);
  if (!error) return (scoresSupportedCache = true);
  const missing = error.code === "42703" || /score_a/.test(error.message ?? "");
  if (missing) scoresSupportedCache = false;
  return !missing;
}
