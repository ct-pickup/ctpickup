import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Exact two decimal rating and rated games for a set of players, from the player_cards view (migration 20261102000000).
 * Display only: the stored half star (player_ratings.star_rating) still decides everything. Returns an empty map when the
 * view does not have the columns yet (migration not applied) or the read fails, so callers just leave the fields off.
 */
export type ExactRating = { exact: number; ratedGames: number | null };

const CHUNK = 200;

export async function loadExactRatings(admin: SupabaseClient, ids: readonly string[]): Promise<Map<string, ExactRating>> {
  const out = new Map<string, ExactRating>();
  const unique = Array.from(new Set(ids.filter(Boolean)));
  for (let i = 0; i < unique.length; i += CHUNK) {
    const { data, error } = await admin
      .from("player_cards")
      .select("user_id,rating_exact,rated_games")
      .in("user_id", unique.slice(i, i + CHUNK));
    if (error) return new Map();
    for (const row of (data ?? []) as Array<{ user_id: string; rating_exact: number | string | null; rated_games: number | string | null }>) {
      const exact = row.rating_exact == null ? NaN : Number(row.rating_exact);
      if (!Number.isFinite(exact)) continue;
      const games = row.rated_games == null ? NaN : Number(row.rated_games);
      out.set(row.user_id, { exact, ratedGames: Number.isFinite(games) ? games : null });
    }
  }
  return out;
}
