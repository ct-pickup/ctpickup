import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";

import { useAuth } from "@/context/AuthContext";
import type { PlanStatus } from "@shared/fields/plans";

/** The signed-in player's plan, requests left and free-request status (my_plan_status). Null until loaded or if unavailable. */
export function usePlanStatus() {
  const { supabase, session } = useAuth();
  const uid = session?.user?.id ?? null;
  const [status, setStatus] = useState<PlanStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!supabase || !uid) {
      setLoading(false);
      return;
    }
    const { data, error } = await supabase.rpc("my_plan_status");
    const row = (Array.isArray(data) ? data[0] : data) as PlanStatus | null | undefined;
    setStatus(error || !row ? null : row);
    setLoading(false);
  }, [supabase, uid]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  return { status, loading, refresh };
}
