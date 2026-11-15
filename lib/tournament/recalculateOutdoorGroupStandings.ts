import type { SupabaseClient } from "@supabase/supabase-js";
import { computeGroupStandings, type StandingsMatch, type StandingsMember } from "@/lib/tournament/standingsMath";

/**
 * Rebuilds W/D/L/GF/GA/GD/Pts for all `tournament_group_members` in a tournament from completed group matches.
 * Fixes double-counting when a group score is re-logged. The arithmetic lives in standingsMath.ts.
 */
export async function recalculateOutdoorGroupStandings(
  admin: SupabaseClient,
  tournamentId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: members, error: mErr } = await admin
    .from("tournament_group_members")
    .select("id,team_id,group_id")
    .eq("tournament_id", tournamentId);
  if (mErr) return { ok: false, error: mErr.message };

  const { data: matches, error: matErr } = await admin
    .from("tournament_matches")
    .select("id,team_a_id,team_b_id,score_a,score_b,completed_at,stage")
    .eq("tournament_id", tournamentId)
    .eq("stage", "group");
  if (matErr) return { ok: false, error: matErr.message };

  const rows = computeGroupStandings((members ?? []) as StandingsMember[], (matches ?? []) as StandingsMatch[]);

  for (const row of rows) {
    const { error: uErr } = await admin
      .from("tournament_group_members")
      .update({
        wins: row.wins,
        draws: row.draws,
        losses: row.losses,
        goals_for: row.goals_for,
        goals_against: row.goals_against,
        goal_difference: row.goal_difference,
        points: row.points,
      })
      .eq("id", row.id);
    if (uErr) return { ok: false, error: uErr.message };
  }

  return { ok: true };
}
