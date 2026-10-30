import type { SupabaseClient } from "@supabase/supabase-js";

import { parseCardStats, type CardStats } from "@/lib/playerStatsCore";

export * from "@/lib/playerStatsCore";

/** The stats row for a player, or null when there are none yet or the view is not set up. Never throws. */
export async function fetchCardStats(supabase: SupabaseClient, userId: string): Promise<CardStats | null> {
  try {
    const { data, error } = await supabase
      .from("player_card_stats")
      .select("wins,draws,losses,partner_stars,opponent_stars,partner_games,opponent_games,perf_games,perf_vs_expected,min_games")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return null;
    return parseCardStats(data);
  } catch {
    return null;
  }
}
