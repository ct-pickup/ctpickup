import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Two-sided confirmation of a posted pickup result (rating_results). Twin of the SQL in 20261101000100_rating_results.sql:
 * the captain of a team is the first player named on it (earliest assignment, ties by id), never the game's host.
 * Unconfirmed results still show on the recap; only a result both captains confirmed can count toward ratings.
 */

export type Team = "A" | "B";
export type ConfirmState = {
  /** none: no result posted. waiting: posted, not yet confirmed by both. verified: both teams confirmed this version. unavailable: the feature's tables are not set up. */
  state: "none" | "waiting" | "verified" | "unavailable";
  result: { winning_team: string | null; score_a: number | null; score_b: number | null; total_teams: number } | null;
  confirmed_teams: Team[];
  /** The team this player is captain of, if any. */
  my_team: Team | null;
  can_confirm: boolean;
};

type Assignment = { user_id: string; team: string; created_at?: string | null };

export function captainOf(assignments: Assignment[], team: Team, hostId: string | null): string | null {
  const list = assignments
    .filter((a) => a.team === team && a.user_id !== hostId)
    .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || a.user_id.localeCompare(b.user_id));
  return list[0]?.user_id ?? null;
}

const missing = (e: { message?: string; code?: string } | null | undefined) =>
  !!e && (e.code === "42P01" || e.code === "42703" || e.code === "PGRST205" || e.code === "PGRST204" || /does not exist|could not find/i.test(e.message ?? ""));

export async function loadConfirmState(admin: SupabaseClient, runId: string, userId: string): Promise<ConfirmState> {
  const none: ConfirmState = { state: "none", result: null, confirmed_teams: [], my_team: null, can_confirm: false };
  const run = await admin.from("pickup_runs").select("id,created_by").eq("id", runId).maybeSingle();
  if (run.error || !run.data) return none;
  const res = await admin.from("pickup_run_results").select("*").eq("run_id", runId).maybeSingle();
  if (res.error) return missing(res.error) ? { ...none, state: "unavailable" } : none;
  const row = res.data as Record<string, unknown> | null;
  if (!row) return none;
  if (row.result_version === undefined) return { ...none, state: "unavailable" };
  const version = Number(row.result_version);
  const result = {
    winning_team: typeof row.winning_team === "string" ? row.winning_team : null,
    score_a: typeof row.score_a === "number" ? row.score_a : null,
    score_b: typeof row.score_b === "number" ? row.score_b : null,
    total_teams: Number(row.total_teams ?? 2),
  };
  const [assign, conf] = await Promise.all([
    admin.from("pickup_run_team_assignments").select("user_id,team,created_at").eq("run_id", runId),
    admin.from("pickup_run_result_confirmations").select("team").eq("run_id", runId).eq("result_version", version),
  ]);
  if (conf.error) return missing(conf.error) ? { ...none, state: "unavailable" } : none;
  const confirmed = [...new Set(((conf.data ?? []) as { team: string }[]).map((c) => c.team))].filter((t): t is Team => t === "A" || t === "B");
  const assignments = (assign.data ?? []) as Assignment[];
  const host = (run.data as { created_by?: string | null }).created_by ?? null;
  const myTeam = result.total_teams === 2 ? (["A", "B"] as Team[]).find((t) => captainOf(assignments, t, host) === userId) ?? null : null;
  const verified = row.verified_at != null && confirmed.length === 2;
  return {
    state: verified ? "verified" : "waiting",
    result,
    confirmed_teams: confirmed,
    my_team: myTeam,
    can_confirm: !!myTeam && !confirmed.includes(myTeam) && !verified,
  };
}

export type ConfirmOutcome = { ok: true; state: ConfirmState } | { ok: false; status: number; error: string };

/** A captain confirms the posted result for their team. Confirming twice is fine. */
export async function confirmResult(admin: SupabaseClient, runId: string, userId: string): Promise<ConfirmOutcome> {
  const st = await loadConfirmState(admin, runId, userId);
  if (st.state === "unavailable") return { ok: false, status: 503, error: "Score confirmation isn’t available yet." };
  if (st.state === "none" || !st.result) return { ok: false, status: 404, error: "No score has been posted for this game." };
  if (st.result.total_teams !== 2) return { ok: false, status: 400, error: "Only two-team games can be confirmed." };
  if (!st.my_team) return { ok: false, status: 403, error: "Only a team captain can confirm the score." };
  if (!st.can_confirm) return { ok: true, state: st };
  const res = await admin.from("pickup_run_results").select("result_version").eq("run_id", runId).maybeSingle();
  const version = Number((res.data as { result_version?: number } | null)?.result_version);
  if (!Number.isFinite(version)) return { ok: false, status: 503, error: "Score confirmation isn’t available yet." };
  const ins = await admin.from("pickup_run_result_confirmations").insert({ run_id: runId, team: st.my_team, result_version: version, confirmed_by: userId });
  if (ins.error && ins.error.code !== "23505") {
    console.error("[result-confirm] insert failed", ins.error.message);
    return { ok: false, status: 500, error: "We couldn’t save that. Try again." };
  }
  return { ok: true, state: await loadConfirmState(admin, runId, userId) };
}
