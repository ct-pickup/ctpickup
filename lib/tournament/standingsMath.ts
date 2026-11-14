/**
 * Group standings, as pure functions. The database wrapper (recalculateOutdoorGroupStandings) loads the rows, calls this,
 * and writes the result back, so editing a score is just "recompute from every completed group match".
 */

export type StandingsMember = {
  id: string;
  team_id: string;
  group_id: string;
};

export type StandingsMatch = {
  team_a_id: string | null;
  team_b_id: string | null;
  score_a: number | null;
  score_b: number | null;
  completed_at: string | null;
  stage: string;
};

export type StandingsRow = StandingsMember & {
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  points: number;
};

/** Win 3, draw 1, loss 0. Only completed group matches with two teams and two numeric scores count. */
export function computeGroupStandings(members: readonly StandingsMember[], matches: readonly StandingsMatch[]): StandingsRow[] {
  const byTeam = new Map<string, StandingsRow>();
  for (const m of members) {
    byTeam.set(String(m.team_id), {
      id: m.id,
      team_id: m.team_id,
      group_id: m.group_id,
      wins: 0,
      draws: 0,
      losses: 0,
      goals_for: 0,
      goals_against: 0,
      goal_difference: 0,
      points: 0,
    });
  }

  for (const m of matches) {
    if (String(m.stage) !== "group" || m.completed_at == null) continue;
    if (m.team_a_id == null || m.team_b_id == null) continue;
    if (m.score_a == null || m.score_b == null) continue;
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
    a.points += aWin ? 3 : draw ? 1 : 0;

    b.wins += bWin;
    b.draws += draw;
    b.losses += aWin;
    b.goals_for += sb;
    b.goals_against += sa;
    b.points += bWin ? 3 : draw ? 1 : 0;
  }

  for (const row of byTeam.values()) row.goal_difference = row.goals_for - row.goals_against;
  return [...byTeam.values()];
}

/** Points, then goal difference, then goals for. The same order the knockout draw uses. */
export function compareStandings(
  a: Pick<StandingsRow, "points" | "goal_difference" | "goals_for">,
  b: Pick<StandingsRow, "points" | "goal_difference" | "goals_for">,
): number {
  return b.points - a.points || b.goal_difference - a.goal_difference || b.goals_for - a.goals_for;
}
