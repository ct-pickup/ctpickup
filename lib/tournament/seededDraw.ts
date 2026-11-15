/**
 * The seeded group draw for Generate Groups. Pure: the only outside input is `random`, which tests replace with a fixed sequence.
 *
 * 1. SEED. Rank the paid teams by the AVERAGE of their players' exact ratings (the numbers seedTeams already computes, so a bigger
 *    roster is neither helped nor hurt). A player with no rating yet counts as the field average (seeding.ts decides that, in one place).
 *    Teams level on the two decimal average are ordered at random. A team with no average at all (nobody in the whole field has a
 *    rating) sits at the middle of the others, so a draw with no ratings is simply a random draw.
 * 2. POTS. Pot 1 is the top N seeds, pot 2 the next N, and so on, where N is the number of groups. The last pot may be smaller.
 * 3. DEAL. Each pot is dealt across the groups at random, never two teams of one pot in the same group while the group sizes allow it.
 *    Only groups that still have a free place are dealt to, so the places are always used up exactly.
 *    11 teams in groups of 4, 4 and 3: pots of 3, 3, 3 and 2. The group of 3 takes one team from each of pots 1 to 3; the last pot of two
 *    can only go to the two groups of 4. Which team of a pot lands in which group is uniformly random.
 */

export type DrawTeam = { id: string; name: string; /** Mean exact rating of the roster, or null when nobody in the field is rated. */ avg: number | null };
export type DrawnTeam = { id: string; name: string; /** 1 is the strongest. */ seed: number; /** 1 is the top pot. */ pot: number; avg: number | null };
export type GroupDraw = {
  /** In seed order. */
  ranked: DrawnTeam[];
  groups: { name: string; teams: DrawnTeam[] }[];
  pot_size: number;
};

export const GROUP_NAMES = ["A", "B", "C"] as const;

export function getGroupConfig(teamCount: number): { groupCount: number; teamsPerGroup: number[] } {
  if (teamCount === 8) return { groupCount: 2, teamsPerGroup: [4, 4] };
  if (teamCount === 9) return { groupCount: 3, teamsPerGroup: [3, 3, 3] };
  if (teamCount === 10) return { groupCount: 2, teamsPerGroup: [5, 5] };
  if (teamCount === 11) return { groupCount: 3, teamsPerGroup: [4, 4, 3] };
  if (teamCount === 12) return { groupCount: 3, teamsPerGroup: [4, 4, 4] };
  return { groupCount: 2, teamsPerGroup: [Math.ceil(teamCount / 2), Math.floor(teamCount / 2)] };
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Seeds 1..n: best average first, level averages in random order. */
export function rankTeams(teams: readonly DrawTeam[], random: () => number): { team: DrawTeam; avg: number | null }[] {
  const known = teams.filter((t) => t.avg != null).map((t) => t.avg as number);
  const middle = known.length ? known.reduce((s, v) => s + v, 0) / known.length : 0;
  const keyed = teams.map((team) => ({ team, avg: team.avg, sort: team.avg ?? middle, tie: random() }));
  keyed.sort((a, b) => b.sort - a.sort || a.tie - b.tie);
  return keyed.map(({ team, avg }) => ({ team, avg }));
}

export function drawSeededGroups(teams: readonly DrawTeam[], random: () => number = Math.random): GroupDraw {
  const { groupCount, teamsPerGroup } = getGroupConfig(teams.length);
  const ranked: DrawnTeam[] = rankTeams(teams, random).map(({ team, avg }, i) => ({
    id: team.id,
    name: team.name,
    seed: i + 1,
    pot: Math.floor(i / groupCount) + 1,
    avg,
  }));

  const groups = teamsPerGroup.map((size, g) => ({ name: GROUP_NAMES[g] ?? String(g + 1), size, teams: [] as DrawnTeam[] }));
  const potCount = Math.ceil(ranked.length / groupCount);
  for (let p = 1; p <= potCount; p++) {
    const pot = ranked.filter((t) => t.pot === p);
    // Only groups with a free place take part. A pot is never bigger than the number of groups, so each group gets at most
    // one team of it; with the sizes in getGroupConfig every group ends up exactly full (the group of 3 in an 11 team draw is full after pot 3,
    // so the last pot of two goes to the two groups of 4).
    const open = groups.filter((g) => g.teams.length < g.size);
    const order = shuffled(pot, random);
    order.forEach((team, i) => {
      // Never happens with the sizes in getGroupConfig; a pot larger than the open groups would have to share one.
      const target = open[i] ?? shuffled(groups.filter((g) => g.teams.length < g.size), random)[0] ?? groups[0]!;
      target.teams.push(team);
    });
  }
  for (const g of groups) g.teams.sort((a, b) => a.seed - b.seed);
  return { ranked, groups: groups.map(({ name, teams: t }) => ({ name, teams: t })), pot_size: groupCount };
}

/** A small deterministic random source for tests and replays (mulberry32). Not for security. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
