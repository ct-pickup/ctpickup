import { trySupabaseServer } from "@/lib/supabase/server";

export type PublicEsportsTournament = {
  id: string;
  title: string;
  game: string;
  prize: string;
  start_date: string;
  end_date: string;
  status: string;
  description: string | null;
};

/**
 * Public hub: upcoming + active only, ordered by start_date ascending.
 * Uses anon session + RLS on `esports_tournaments`.
 */
export async function fetchPublicEsportsTournaments(): Promise<{
  data: PublicEsportsTournament[] | null;
  error: Error | null;
}> {
  try {
    const supabase = await trySupabaseServer();
    if (!supabase) {
      return {
        data: null,
        error: new Error("Missing Supabase env or server client."),
      };
    }
    const { data, error } = await supabase
      .from("esports_tournaments")
      .select(
        "id, title, game, prize, start_date, end_date, status, description"
      )
      .in("status", ["upcoming", "active"])
      .order("start_date", { ascending: true });

    if (error) {
      console.error("[esports_tournaments] public fetch:", error.message);
      return { data: null, error: new Error(error.message) };
    }

    return { data: data as PublicEsportsTournament[], error: null };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error("[esports_tournaments] public fetch:", err.message);
    return { data: null, error: err };
  }
}
