import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * "Finish tournament": the admin's last step. It turns the tournament off for players (tournaments.is_active = false) once the final
 * has a result, and nothing else.
 *
 *   - Allowed only when the final has a result. Not for a canceled tournament.
 *   - Never sends a push, never refunds or charges anything, never touches a team, a score, a rating or a prize record.
 *   - Safe to press twice: the second time changes nothing and says it was already finished.
 *   - Needs NO migration. "Finished" is not a new column: it is what is already true when the final has a result (its completed_at,
 *     which never goes away) and the tournament is no longer active and was not canceled. isFinished() below is that one definition.
 *   - The Home card and the Events section list only active tournaments (lib/tournament/tournamentList.ts), so a finished tournament
 *     leaves them as soon as it is switched off. The bracket stays readable to anyone who opens it.
 */

export type FinishOutcome =
  | { ok: true; already_finished: boolean }
  | { ok: false; status: number; code: "not_found" | "canceled" | "final_not_scored" | "failed"; error: string };

/** The final match has a result (a bye has none). */
export function finalHasResult(matches: readonly { stage?: string | null; completed_at?: string | null; is_bye?: boolean | null }[]): boolean {
  return matches.some((m) => m.stage === "final" && m.is_bye !== true && !!m.completed_at);
}

/** Finished = the final has a result, the tournament is off for players, and it was not canceled. */
export function isFinished(t: { is_active?: boolean | null; canceled_at?: string | null }, matches: readonly { stage?: string | null; completed_at?: string | null; is_bye?: boolean | null }[]): boolean {
  return t.is_active !== true && !t.canceled_at && finalHasResult(matches);
}

export async function finishTournament(admin: SupabaseClient, tournamentId: string): Promise<FinishOutcome> {
  const t = await admin.from("tournaments").select("id,is_active,canceled_at").eq("id", tournamentId).maybeSingle();
  if (t.error) return { ok: false, status: 500, code: "failed", error: t.error.message };
  const row = t.data as { id: string; is_active: boolean | null; canceled_at: string | null } | null;
  if (!row) return { ok: false, status: 404, code: "not_found", error: "Tournament not found." };
  if (row.canceled_at) return { ok: false, status: 409, code: "canceled", error: "This tournament was canceled, so it cannot be finished." };

  const m = await admin.from("tournament_matches").select("stage,completed_at,is_bye").eq("tournament_id", tournamentId);
  if (m.error) return { ok: false, status: 500, code: "failed", error: m.error.message };
  if (!finalHasResult((m.data ?? []) as { stage?: string | null; completed_at?: string | null; is_bye?: boolean | null }[])) {
    return { ok: false, status: 409, code: "final_not_scored", error: "The final does not have a result yet. Enter it first, then finish the tournament." };
  }

  if (row.is_active !== true) return { ok: true, already_finished: true };

  const up = await admin.from("tournaments").update({ is_active: false }).eq("id", tournamentId);
  if (up.error) return { ok: false, status: 500, code: "failed", error: up.error.message };
  return { ok: true, already_finished: false };
}
