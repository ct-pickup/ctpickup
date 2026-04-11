import type { SupabaseClient } from "@supabase/supabase-js";

export type ConductSeverityRollup = {
  warnings: number;
  strikes: number;
  /** forfeit + disqualification — highest impact */
  severe: number;
};

/**
 * Count conduct records per user within a tournament (for staff triage).
 * Severity mapping: warning → warnings; strike → strikes; forfeit/dq → severe.
 */
export async function fetchConductRollupForUsersInTournament(
  svc: SupabaseClient,
  tournamentId: string,
  userIds: string[],
): Promise<Map<string, ConductSeverityRollup>> {
  const out = new Map<string, ConductSeverityRollup>();
  for (const id of userIds) {
    out.set(id, { warnings: 0, strikes: 0, severe: 0 });
  }
  if (userIds.length === 0) return out;

  const { data, error } = await svc
    .from("esports_conduct_records")
    .select("user_id,severity")
    .eq("tournament_id", tournamentId)
    .in("user_id", userIds);

  if (error) throw new Error(error.message);

  for (const row of data || []) {
    const uid = String((row as { user_id: string }).user_id);
    const sev = String((row as { severity: string }).severity);
    const cur = out.get(uid);
    if (!cur) continue;
    if (sev === "warning") cur.warnings += 1;
    else if (sev === "strike") cur.strikes += 1;
    else if (sev === "forfeit" || sev === "disqualification") cur.severe += 1;
  }

  return out;
}
