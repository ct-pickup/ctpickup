import type { SupabaseClient } from "@supabase/supabase-js";

type GroupMemberRow = {
  id: string;
  team_id: string;
  group_id: string;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  points: number;
};

type MatchRow = {
  id: string;
  team_a_id: string;
  team_b_id: string | null;
  score_a: number | null;
  score_b: number | null;
  completed_at: string | null;
  stage: string;
};

/**
 * Rebuilds W/D/L/GF/GA/GD/Pts for all `tournament_group_members` in a tournament from completed group matches.
 * Fixes double-counting when a group score is re-logged.
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

  const completed = (matches || []).filter(
    (m) => m && String((m as MatchRow).stage) === "group" && (m as MatchRow).completed_at != null,
  ) as MatchRow[];

  const byTeam = new Map<string, GroupMemberRow>();
  for (const mem of members || []) {
    const row = mem as GroupMemberRow;
    byTeam.set(String(row.team_id), {
      ...row,
      wins: 0,
      draws: 0,
      losses: 0,
      goals_for: 0,
      goals_against: 0,
      goal_difference: 0,
      points: 0,
    });
  }

  for (const m of completed) {
    if (m.team_b_id == null) continue;
    const sa = Number(m.score_a);
    const sb = Number(m.score_b);
    if (!Number.isFinite(sa) || !Number.isFinite(sb)) continue;

    const a = byTeam.get(String(m.team_a_id));
    const b = byTeam.get(String(m.team_b_id));
    if (!a || !b) continue;

    const aWin = sa > sb ? 1 : 0;
    const bWin = sb > sa ? 1 : 0;
    const draw = sa === sb ? 1 : 0;

    a.wins += aWin;
    a.draws += draw;
    a.losses += bWin;
    a.goals_for += sa;
    a.goals_against += sb;

    b.wins += bWin;
    b.draws += draw;
    b.losses += aWin;
    b.goals_for += sb;
    b.goals_against += sa;

    a.points += aWin ? 3 : draw ? 1 : 0;
    b.points += bWin ? 3 : draw ? 1 : 0;
  }

  for (const row of byTeam.values()) {
    row.goal_difference = row.goals_for - row.goals_against;
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
