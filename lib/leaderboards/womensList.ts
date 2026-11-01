import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The women's leaderboard is opt-in: only players who switched on profiles.womens_leaderboard_opt_in are on it. This reads that one
 * flag and nothing about gender. If the column does not exist yet (migration not applied) or the read fails, nobody is on the list.
 * The ids never leave the server: the API returns the ordinary Stars rows for these players, with no opt-in field.
 */
const PAGE = 1000;

export async function loadWomensOptInIds(admin: SupabaseClient): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("profiles")
      .select("id")
      .eq("womens_leaderboard_opt_in", true)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) return new Set();
    const rows = (data ?? []) as Array<{ id: string }>;
    for (const r of rows) ids.add(r.id);
    if (rows.length < PAGE) return ids;
  }
}

/** "women" only for exactly that value; anything else is the normal Stars list. */
export function parseLeaderboardScope(raw: string | null | undefined): "all" | "women" {
  return raw === "women" ? "women" : "all";
}
