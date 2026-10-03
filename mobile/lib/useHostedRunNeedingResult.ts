import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

import { useAuth } from "@/context/AuthContext";

/** How many of the host's recent finished games to check for a missing result. */
const LOOKBACK = 20;

/**
 * Id of a finished game the signed-in user hosted that still has no posted result,
 * or null when there is none. Drives the conditional "Post a result" row in the create menu.
 *
 * "Finished" is start_at in the past; a result exists when pickup_run_results has a
 * row for the run. Refreshes on focus so posting a result clears the row.
 */
export function useHostedRunNeedingResult(enabled: boolean): string | null {
  const { session, supabase } = useAuth();
  const userId = session?.user?.id ?? null;
  const [runId, setRunId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!enabled || !supabase || !userId) {
        setRunId(null);
        return;
      }

      let cancelled = false;

      void (async () => {
        const runs = await supabase
          .from("pickup_runs")
          .select("id,start_at")
          .eq("created_by", userId)
          .lt("start_at", new Date().toISOString())
          .order("start_at", { ascending: false })
          .limit(LOOKBACK);

        if (cancelled) return;
        const rows = runs.data;
        if (runs.error || !rows || rows.length === 0) {
          setRunId(null);
          return;
        }

        const ids = rows.map((r) => String(r.id));
        const posted = await supabase.from("pickup_run_results").select("run_id").in("run_id", ids);
        if (cancelled) return;
        if (posted.error) {
          setRunId(null);
          return;
        }

        const done = new Set((posted.data ?? []).map((r) => String(r.run_id)));
        setRunId(ids.find((id) => !done.has(id)) ?? null);
      })();

      return () => {
        cancelled = true;
      };
    }, [enabled, supabase, userId]),
  );

  return runId;
}
