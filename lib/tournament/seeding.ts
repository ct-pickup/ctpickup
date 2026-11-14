/**
 * Team seeds from the exact display rating (player_cards.rating_exact, a two decimal number such as 3.42).
 * Never the raw score. A player with no rating yet counts as the field average, so a roster of newcomers is not seeded
 * as the weakest or the strongest team.
 */

export type ExactRatingLike = { exact: number; ratedGames: number | null };

export type SeedTeamInput = {
  id: string;
  team_name: string;
  /** Captain and accepted roster players, as profile ids. */
  user_ids: readonly string[];
};

export type SeededTeam = {
  id: string;
  /** 1 is the strongest team. Null when the team has no known players or nobody in the field is rated. */
  seed: number | null;
  /** Mean of the roster's exact ratings, two decimals. Null when there is nothing to average. */
  team_avg: number | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Rated means a usable exact rating and at least one rated game when the game count is known. */
export function ratedValue(r: ExactRatingLike | undefined | null): number | null {
  if (!r || !Number.isFinite(r.exact)) return null;
  if (r.ratedGames != null && r.ratedGames <= 0) return null;
  return r.exact;
}

/** Mean exact rating of every distinct rated player across all teams. Null when nobody is rated. */
export function fieldAverage(teams: readonly SeedTeamInput[], ratings: ReadonlyMap<string, ExactRatingLike>): number | null {
  const seen = new Set<string>();
  let sum = 0;
  let n = 0;
  for (const t of teams) {
    for (const uid of t.user_ids) {
      if (seen.has(uid)) continue;
      seen.add(uid);
      const v = ratedValue(ratings.get(uid));
      if (v == null) continue;
      sum += v;
      n += 1;
    }
  }
  return n ? sum / n : null;
}

export function seedTeams(teams: readonly SeedTeamInput[], ratings: ReadonlyMap<string, ExactRatingLike>): SeededTeam[] {
  const field = fieldAverage(teams, ratings);
  const withAvg = teams.map((t) => {
    const ids = Array.from(new Set(t.user_ids));
    if (field == null || ids.length === 0) return { id: t.id, name: t.team_name, avg: null as number | null };
    const total = ids.reduce((s, uid) => s + (ratedValue(ratings.get(uid)) ?? field), 0);
    return { id: t.id, name: t.team_name, avg: round2(total / ids.length) };
  });

  const ranked = withAvg
    .filter((t) => t.avg != null)
    .sort((a, b) => (b.avg as number) - (a.avg as number) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const seedOf = new Map(ranked.map((t, i) => [t.id, i + 1]));

  return withAvg.map((t) => ({ id: t.id, seed: seedOf.get(t.id) ?? null, team_avg: t.avg }));
}
