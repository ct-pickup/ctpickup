/**
 * Auto-balance confirmed players across pickup teams: first by position bucket (as before), then by rating so mixed-skill games are fair.
 * Rating is the exact display rating (player_cards.rating_exact, falling back to the half star). It is never the raw score and never gender.
 * Admin tool only: nothing here is shown to players.
 */

export type PickupTeam = "A" | "B" | "C";
export type PositionBucket = "GK" | "D" | "M" | "A" | "OTHER";

const BUCKET_ORDER: Record<PositionBucket, number> = {
  GK: 0,
  D: 1,
  M: 2,
  A: 3,
  OTHER: 4,
};

export function positionBucket(pos: string | null | undefined): PositionBucket {
  const p = String(pos ?? "")
    .trim()
    .toLowerCase();
  if (p.startsWith("goal") || p === "gk") return "GK";
  if (p.startsWith("def") || p === "d") return "D";
  if (p.startsWith("mid") || p === "m") return "M";
  if (p.startsWith("att") || p.startsWith("for") || p.startsWith("strik") || p === "a") return "A";
  return "OTHER";
}

export type BalancePlayer = {
  id: string;
  playing_position?: string | null;
  /** Exact rating, 0.5 to 5. Null or missing means not rated yet; such players count as the average of the field. */
  rating?: number | null;
};

const finiteRating = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Average rating of the players who have one, or null when nobody does. */
export function fieldAverage(players: readonly BalancePlayer[]): number | null {
  const rated = players.map((p) => p.rating).filter(finiteRating);
  return rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : null;
}

/** Each player's rating for balancing: their own, or the field average when they have none. */
function effectiveRatings(players: readonly BalancePlayer[]): Map<string, number> | null {
  const avg = fieldAverage(players);
  if (avg == null) return null;
  return new Map(players.map((p) => [p.id, finiteRating(p.rating) ? p.rating : avg]));
}

const teamList = (totalTeams: 2 | 3): PickupTeam[] => (totalTeams === 3 ? ["A", "B", "C"] : ["A", "B"]);

/** Team averages (using the field average for unrated players) and the gap between the strongest and weakest team. */
export function teamRatingSummary(
  players: readonly BalancePlayer[],
  teamByUser: Readonly<Record<string, PickupTeam>>,
  totalTeams: 2 | 3,
): { averages: Record<PickupTeam, number | null>; gap: number | null; ratedCount: number; unratedCount: number } | null {
  const eff = effectiveRatings(players);
  const ratedCount = players.filter((p) => finiteRating(p.rating)).length;
  if (!eff) return null;
  const sums: Record<PickupTeam, { sum: number; n: number }> = { A: { sum: 0, n: 0 }, B: { sum: 0, n: 0 }, C: { sum: 0, n: 0 } };
  for (const p of players) {
    const t = teamByUser[p.id];
    if (!t) continue;
    sums[t].sum += eff.get(p.id) ?? 0;
    sums[t].n += 1;
  }
  const averages = { A: null, B: null, C: null } as Record<PickupTeam, number | null>;
  const vals: number[] = [];
  for (const t of teamList(totalTeams)) {
    averages[t] = sums[t].n ? sums[t].sum / sums[t].n : null;
    if (averages[t] != null) vals.push(averages[t] as number);
  }
  const gap = vals.length >= 2 ? Math.max(...vals) - Math.min(...vals) : null;
  return { averages, gap, ratedCount, unratedCount: players.length - ratedCount };
}

/** Admin line under the teams, for example "Teams are within 0.1 rating". Null when there is nothing to say. */
export function teamBalanceLine(
  players: readonly BalancePlayer[],
  teamByUser: Readonly<Record<string, PickupTeam>>,
  totalTeams: 2 | 3,
): string | null {
  const s = teamRatingSummary(players, teamByUser, totalTeams);
  if (!s || s.gap == null || s.ratedCount < 2) return null;
  const within = Math.max(0.1, Math.ceil(s.gap * 10 - 1e-9) / 10);
  const base = `Teams are within ${within.toFixed(1)} rating`;
  return s.unratedCount > 0 ? `${base} (${s.unratedCount} unrated counted as average)` : base;
}

function spread(avgs: number[]): number {
  return avgs.length ? Math.max(...avgs) - Math.min(...avgs) : 0;
}

export function autoBalanceTeams(players: BalancePlayer[], totalTeams: 2 | 3 = 2): Record<string, PickupTeam> {
  const teams = teamList(totalTeams);
  const counts: Record<PickupTeam, Record<PositionBucket, number>> = {
    A: { GK: 0, D: 0, M: 0, A: 0, OTHER: 0 },
    B: { GK: 0, D: 0, M: 0, A: 0, OTHER: 0 },
    C: { GK: 0, D: 0, M: 0, A: 0, OTHER: 0 },
  };
  const eff = effectiveRatings(players); // null when nobody is rated: behave exactly as the position-only balance
  const strength: Record<PickupTeam, number> = { A: 0, B: 0, C: 0 };

  const result: Record<string, PickupTeam> = {};
  const sorted = [...players].sort((a, b) => {
    const da = BUCKET_ORDER[positionBucket(a.playing_position)];
    const db = BUCKET_ORDER[positionBucket(b.playing_position)];
    if (da !== db) return da - db;
    // Within a position group, strongest first (snake-draft style: the weakest team picks next).
    if (eff) {
      const ra = eff.get(a.id) ?? 0;
      const rb = eff.get(b.id) ?? 0;
      if (ra !== rb) return rb - ra;
    }
    return (a.id || "").localeCompare(b.id || "");
  });

  for (const p of sorted) {
    const bucket = positionBucket(p.playing_position);
    let best = teams[0];
    let bestScore = Infinity;
    let bestStrength = Infinity;
    for (const t of teams) {
      const bucketCount = counts[t][bucket];
      const total = Object.values(counts[t]).reduce((sum, n) => sum + n, 0);
      const score = bucketCount * 100 + total;
      // Position spread and team size decide first (as before); equal teams are split by who is weakest so far.
      if (score < bestScore || (eff && score === bestScore && strength[t] < bestStrength)) {
        bestScore = score;
        bestStrength = strength[t];
        best = t;
      }
    }
    result[p.id] = best;
    counts[best][bucket] += 1;
    if (eff) strength[best] += eff.get(p.id) ?? 0;
  }

  if (eff) swapPass(players, result, teams, eff);
  return result;
}

/**
 * Shrinks the gap between team averages by swapping two players of the SAME position group on different teams. A swap keeps every
 * team's size and position mix, so the position spread and team sizes stay exactly as the draft made them.
 */
function swapPass(
  players: readonly BalancePlayer[],
  team: Record<string, PickupTeam>,
  teams: PickupTeam[],
  eff: Map<string, number>,
): void {
  const bucketOf = new Map(players.map((p) => [p.id, positionBucket(p.playing_position)] as const));
  const sums: Record<PickupTeam, number> = { A: 0, B: 0, C: 0 };
  const sizes: Record<PickupTeam, number> = { A: 0, B: 0, C: 0 };
  for (const p of players) {
    sums[team[p.id]] += eff.get(p.id) ?? 0;
    sizes[team[p.id]] += 1;
  }
  const gapOf = (s: Record<PickupTeam, number>) => spread(teams.filter((t) => sizes[t] > 0).map((t) => s[t] / sizes[t]));

  for (let round = 0; round < 200; round++) {
    const current = gapOf(sums);
    let bestGap = current;
    let best: { a: string; b: string } | null = null;
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const a = players[i].id;
        const b = players[j].id;
        if (team[a] === team[b] || bucketOf.get(a) !== bucketOf.get(b)) continue;
        const d = (eff.get(a) ?? 0) - (eff.get(b) ?? 0);
        const next = { ...sums, [team[a]]: sums[team[a]] - d, [team[b]]: sums[team[b]] + d } as Record<PickupTeam, number>;
        const g = gapOf(next);
        if (g < bestGap - 1e-9) {
          bestGap = g;
          best = { a, b };
        }
      }
    }
    if (!best) return;
    const d = (eff.get(best.a) ?? 0) - (eff.get(best.b) ?? 0);
    sums[team[best.a]] -= d;
    sums[team[best.b]] += d;
    const tmp = team[best.a];
    team[best.a] = team[best.b];
    team[best.b] = tmp;
  }
}
