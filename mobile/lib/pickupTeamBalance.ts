/** Auto-balance confirmed players across pickup teams by position bucket. */

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

export function autoBalanceTeams(
  players: { id: string; playing_position?: string | null }[],
  totalTeams: 2 | 3 = 2,
): Record<string, PickupTeam> {
  const teams: PickupTeam[] = totalTeams === 3 ? ["A", "B", "C"] : ["A", "B"];
  const counts: Record<PickupTeam, Record<PositionBucket, number>> = {
    A: { GK: 0, D: 0, M: 0, A: 0, OTHER: 0 },
    B: { GK: 0, D: 0, M: 0, A: 0, OTHER: 0 },
    C: { GK: 0, D: 0, M: 0, A: 0, OTHER: 0 },
  };

  const result: Record<string, PickupTeam> = {};
  const sorted = [...players].sort((a, b) => {
    const da = BUCKET_ORDER[positionBucket(a.playing_position)];
    const db = BUCKET_ORDER[positionBucket(b.playing_position)];
    if (da !== db) return da - db;
    return (a.id || "").localeCompare(b.id || "");
  });

  for (const p of sorted) {
    const bucket = positionBucket(p.playing_position);
    let best = teams[0];
    let bestScore = Infinity;
    for (const t of teams) {
      const bucketCount = counts[t][bucket];
      const total = Object.values(counts[t]).reduce((sum, n) => sum + n, 0);
      const score = bucketCount * 100 + total;
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    }
    result[p.id] = best;
    counts[best][bucket] += 1;
  }

  return result;
}
