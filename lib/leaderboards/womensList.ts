import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The women's leaderboard is opt-in: a row in public.womens_leaderboard_opt_in means the player chose to be on it. The table is private
 * (row level security: owner only), so this must be called with the service role client. It reads nothing about gender. If the table does
 * not exist yet (migration not applied) or the read fails, nobody is on the list. The ids never leave the server: the API returns the
 * ordinary Stars rows for these players, with no opt-in field.
 */
const PAGE = 1000;

export async function loadWomensOptInIds(admin: SupabaseClient): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("womens_leaderboard_opt_in")
      .select("user_id")
      .order("user_id")
      .range(from, from + PAGE - 1);
    if (error) return new Set();
    const rows = (data ?? []) as Array<{ user_id: string }>;
    for (const r of rows) ids.add(r.user_id);
    if (rows.length < PAGE) return ids;
  }
}

/** "women" only for exactly that value; anything else is the normal Stars list. */
export function parseLeaderboardScope(raw: string | null | undefined): "all" | "women" {
  return raw === "women" ? "women" : "all";
}
