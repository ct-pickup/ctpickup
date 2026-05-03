import { useAuth } from "@/context/AuthContext";
import { useCallback, useEffect, useState } from "react";

/** One row from `esports_tournaments` (EA FC / online). */
export type NextTournamentRow = {
  id: string;
  title: string;
  game: string;
  prize: string;
  start_date: string;
  status: string;
};

/** Earliest upcoming or active digital (esports) tournament. */
export function useNextTournament() {
  const { supabase, isReady } = useAuth();
  const [loading, setLoading] = useState(true);
  const [next, setNext] = useState<NextTournamentRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!supabase) {
      setError(!isReady ? null : "Configure Supabase env in mobile/.env");
      setNext(null);
      setLoading(false);
      return;
    }
    setError(null);
    const { data, error: qErr } = await supabase
      .from("esports_tournaments")
      .select("id, title, game, prize, start_date, status")
      .in("status", ["upcoming", "active"])
      .order("start_date", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (qErr) {
      setError(qErr.message);
      setNext(null);
    } else if (data && typeof data === "object" && "id" in data) {
      setNext(data as NextTournamentRow);
    } else {
      setNext(null);
    }
    setLoading(false);
  }, [supabase, isReady]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { loading, error, next, reload };
}
