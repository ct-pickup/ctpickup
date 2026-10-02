import type { SupabaseClient } from "@supabase/supabase-js";

type DbError = { message?: string; code?: string } | null | undefined;

/** True when PostgREST rejects a column that a pending migration adds (score_a/score_b). */
export function isMissingColumnError(err: DbError): boolean {
  if (!err) return false;
  const msg = String(err.message ?? "");
  return err.code === "42703" || err.code === "PGRST204" || /column .* does not exist|could not find the .* column/i.test(msg);
}

export function isMissingTableError(err: DbError): boolean {
  if (!err) return false;
  const msg = String(err.message ?? "");
  return err.code === "42P01" || err.code === "PGRST205" || /relation .* does not exist|could not find the table/i.test(msg);
}

/** winning_team is still NOT NULL until the draws migration runs. */
export function isNotNullViolation(err: DbError): boolean {
  return Boolean(err) && (err?.code === "23502" || /null value in column "winning_team"/i.test(String(err?.message ?? "")));
}

export type ExistingResult = {
  winning_team: string | null;
  score_a: number | null;
  score_b: number | null;
  total_teams: number | null;
  created_at: string | null;
  player_of_day: string | null;
  defender_of_day: string | null;
  midfielder_of_day: string | null;
  attacker_of_day: string | null;
  goalie_of_the_day: string | null;
};

const BASE_COLUMNS =
  "winning_team,total_teams,created_at,player_of_day,defender_of_day,midfielder_of_day,attacker_of_day,goalie_of_the_day";

/**
 * The run's current result, if any. `scoresSupported` is false until the scores migration runs;
 * callers must then omit score_a/score_b from writes.
 */
export async function loadExistingResult(
  admin: SupabaseClient,
  runId: string,
): Promise<{ result: ExistingResult | null; scoresSupported: boolean; error: string | null }> {
  const withScores = await admin
    .from("pickup_run_results")
    .select(`${BASE_COLUMNS},score_a,score_b`)
    .eq("run_id", runId)
    .maybeSingle();
  if (!withScores.error) {
    return { result: (withScores.data as ExistingResult | null) ?? null, scoresSupported: true, error: null };
  }
  if (!isMissingColumnError(withScores.error)) {
    return { result: null, scoresSupported: true, error: withScores.error.message };
  }
  const base = await admin.from("pickup_run_results").select(BASE_COLUMNS).eq("run_id", runId).maybeSingle();
  if (base.error) return { result: null, scoresSupported: false, error: base.error.message };
  const row = base.data as Omit<ExistingResult, "score_a" | "score_b"> | null;
  return { result: row ? { ...row, score_a: null, score_b: null } : null, scoresSupported: false, error: null };
}

export type ResultValues = {
  winning_team: string | null;
  score_a: number | null;
  score_b: number | null;
  player_of_day?: string | null;
  defender_of_day?: string | null;
  midfielder_of_day?: string | null;
  attacker_of_day?: string | null;
  goalie_of_the_day?: string | null;
  team_assignments?: { user_id: string; team: string }[];
};

/**
 * Appends one row to pickup_run_result_edits (service role only). Before that migration runs the
 * insert fails; the edit still goes through and the failure is logged.
 */
export async function logResultEdit(
  admin: SupabaseClient,
  entry: { run_id: string; edited_by: string; editor_role: "host" | "admin"; old_values: ResultValues; new_values: ResultValues },
): Promise<boolean> {
  const { error } = await admin.from("pickup_run_result_edits").insert({
    run_id: entry.run_id,
    edited_by: entry.edited_by,
    editor_role: entry.editor_role,
    old_values: entry.old_values,
    new_values: entry.new_values,
    edited_at: new Date().toISOString(),
  });
  if (error) {
    console.warn("[results] edit log not written:", error.message);
    return false;
  }
  return true;
}
