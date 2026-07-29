export type PotdVoteRow = {
  nominee_id: string;
  created_at?: string | null;
};

export type PotdResolution = {
  winnerId: string | null;
  voteCount: number;
  totalVotes: number;
  tied: boolean;
  counts: Record<string, number>;
};

/** Pure tally + winner (host pick breaks ties; no votes → host pick if any). */
export function resolvePotdWinner(
  votes: PotdVoteRow[],
  hostTiebreaker: string | null = null,
): PotdResolution {
  const counts = new Map<string, number>();
  const firstSeen = new Map<string, string>();

  for (const v of votes) {
    const id = typeof v.nominee_id === "string" ? v.nominee_id.trim() : "";
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
    if (!firstSeen.has(id)) {
      firstSeen.set(id, v.created_at ?? "");
    }
  }

  const countsObj: Record<string, number> = {};
  for (const [k, n] of counts.entries()) countsObj[k] = n;

  const totalVotes = [...counts.values()].reduce((a, b) => a + b, 0);
  if (counts.size === 0) {
    return {
      winnerId: hostTiebreaker,
      voteCount: 0,
      totalVotes: 0,
      tied: false,
      counts: countsObj,
    };
  }

  let max = 0;
  for (const n of counts.values()) max = Math.max(max, n);

  const leaders = [...counts.entries()]
    .filter(([, n]) => n === max)
    .map(([id]) => id)
    .sort((a, b) => {
      const ta = firstSeen.get(a) || "";
      const tb = firstSeen.get(b) || "";
      if (ta !== tb) return ta.localeCompare(tb);
      return a.localeCompare(b);
    });

  const tied = leaders.length > 1;
  if (tied && hostTiebreaker && leaders.includes(hostTiebreaker)) {
    return {
      winnerId: hostTiebreaker,
      voteCount: max,
      totalVotes,
      tied: true,
      counts: countsObj,
    };
  }

  return {
    winnerId: leaders[0] ?? null,
    voteCount: max,
    totalVotes,
    tied,
    counts: countsObj,
  };
}

/** Load potd_votes for a run and resolve the winner. */
export async function resolvePotdFromVotes(
  // Supabase client (service or admin) — keep loose to avoid chaining type friction.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  runId: string,
  hostTiebreaker: string | null = null,
): Promise<PotdResolution> {
  const { data, error } = await admin
    .from("potd_votes")
    .select("nominee_id, created_at")
    .eq("run_id", runId);

  if (error) {
    console.error("[resolvePotdFromVotes] select failed", error.message);
    return resolvePotdWinner([], hostTiebreaker);
  }

  return resolvePotdWinner((data ?? []) as PotdVoteRow[], hostTiebreaker);
}
