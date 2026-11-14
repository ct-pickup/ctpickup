import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A scored tournament match has a hidden game record (pickup_runs, linked by tournament_match_runs) so the existing result and rating
 * path can run. Clients never see those records (row level security hides them). The server code that reads results and team lists to
 * build records, game logs and team balance uses this to leave them out, unless the tournament counts for the season: then its matches
 * are ordinary played games for points, and stay in.
 *
 * Fails open to "nothing is hidden" when the tables do not exist (a database without rated tournaments).
 */

const CHUNK = 150;

async function inChunks<T>(ids: readonly string[], run: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await run(ids.slice(i, i + CHUNK) as string[])));
  return out;
}

/** The run ids (among `runIds`, or all of them when omitted) that belong to a tournament that does NOT count for the season. */
export async function uncountedTournamentRunIds(admin: SupabaseClient, runIds?: readonly string[]): Promise<Set<string>> {
  const none = new Set<string>();
  try {
    let links: { run_id: string; match_id: string }[];
    if (runIds) {
      if (!runIds.length) return none;
      links = await inChunks(runIds, async (chunk) => {
        const { data, error } = await admin.from("tournament_match_runs").select("run_id,match_id").in("run_id", chunk);
        if (error) throw new Error(error.message);
        return (data ?? []) as { run_id: string; match_id: string }[];
      });
    } else {
      const { data, error } = await admin.from("tournament_match_runs").select("run_id,match_id").limit(5000);
      if (error) return none;
      links = (data ?? []) as { run_id: string; match_id: string }[];
    }
    if (!links.length) return none;

    const matches = await inChunks(
      links.map((l) => l.match_id),
      async (chunk) => {
        const { data, error } = await admin.from("tournament_matches").select("id,tournament_id").in("id", chunk);
        if (error) throw new Error(error.message);
        return (data ?? []) as { id: string; tournament_id: string }[];
      },
    );
    const tournamentOfMatch = new Map(matches.map((m) => [String(m.id), String(m.tournament_id)]));
    const tournaments = await inChunks([...new Set(tournamentOfMatch.values())], async (chunk) => {
      const { data, error } = await admin.from("tournaments").select("id,count_for_season").in("id", chunk);
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; count_for_season: boolean | null }[];
    });
    const counts = new Map(tournaments.map((t) => [String(t.id), t.count_for_season === true]));

    const out = new Set<string>();
    for (const l of links) {
      const t = tournamentOfMatch.get(String(l.match_id));
      // A link whose match or tournament cannot be found is hidden too: never show what cannot be explained.
      if (!t || counts.get(t) !== true) out.add(String(l.run_id));
    }
    return out;
  } catch (e) {
    console.warn("[tournament] hidden run lookup failed; nothing hidden", e instanceof Error ? e.message : String(e));
    return none;
  }
}
