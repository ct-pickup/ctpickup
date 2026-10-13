import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";

import { useAuth } from "@/context/AuthContext";
import type { PlanStatus } from "@shared/fields/plans";

/** The signed-in player's plan, requests left, free-request status and number of paid seasons. Null status until loaded or if unavailable. */
export function usePlanStatus() {
  const { supabase, session } = useAuth();
  const uid = session?.user?.id ?? null;
  const [status, setStatus] = useState<PlanStatus | null>(null);
  const [seasons, setSeasons] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!supabase || !uid) {
      setLoading(false);
      return;
    }
    const [plan, season] = await Promise.all([
      supabase.rpc("my_plan_status"),
      supabase.from("season_purchases").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("status", "paid"),
    ]);
    const row = (Array.isArray(plan.data) ? plan.data[0] : plan.data) as PlanStatus | null | undefined;
    setStatus(plan.error || !row ? null : row);
    setSeasons(season.error ? 0 : (season.count ?? 0));
    setLoading(false);
  }, [supabase, uid]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  return { status, seasons, loading, refresh };
}
