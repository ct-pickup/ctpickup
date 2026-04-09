import { trySupabaseServer } from "@/lib/supabase/server";
import type { PublicEsportsTournament } from "@/lib/esports/fetchPublicEsportsTournaments";

/**
 * Public tournament detail (same visibility as the list: upcoming + active only).
 */
export async function fetchPublicEsportsTournamentById(
  id: string,
): Promise<{ data: PublicEsportsTournament | null; error: Error | null }> {
  try {
    const supabase = await trySupabaseServer();
    if (!supabase) {
      return { data: null, error: new Error("Missing Supabase env or server client.") };
    }
    const { data, error } = await supabase
      .from("esports_tournaments")
      .select("id, title, game, prize, start_date, end_date, status, description")
      .eq("id", id)
      .in("status", ["upcoming", "active"])
      .maybeSingle();

    if (error) {
      console.error("[esports_tournaments] public fetch by id:", error.message);
      return { data: null, error: new Error(error.message) };
    }

    return { data: data as PublicEsportsTournament | null, error: null };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    return { data: null, error: err };
  }
}
