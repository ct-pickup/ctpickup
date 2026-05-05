import { fetchAdminPickupOverview, type PickupOverviewResponse } from "@/lib/adminApi";
import { useAuth } from "@/context/AuthContext";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";

type State = {
  loading: boolean;
  error: string | null;
  data: PickupOverviewResponse | null;
  region: string;
  setRegion: (r: string) => void;
  reload: () => void;
};

export function useAdminPickupOverview(initialRegion: string = "CT"): State {
  const { session, isReady, supabase } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PickupOverviewResponse | null>(null);
  const [region, setRegion] = useState(initialRegion);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!isReady) return;
    const token = session?.access_token;
    if (!token) {
      setLoading(false);
      setError("Not signed in.");
      setData(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const r = await fetchAdminPickupOverview(token, { region });
        if (cancelled) return;
        if (!r.ok) {
          setError(r.error);
          setData(null);
          return;
        }
        setData(r.data);
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Request failed");
        setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isReady, session?.access_token, nonce, region]);

  const runId = useMemo(() => {
    const run = data?.run;
    if (!run || typeof run !== "object") return null;
    const id = (run as { id?: unknown }).id;
    return typeof id === "string" && id.length > 0 ? id : null;
  }, [data?.run]);

  useEffect(() => {
    if (!supabase || !runId || !session?.access_token) return;

    let runCh: RealtimeChannel | null = null;
    let rsvpCh: RealtimeChannel | null = null;

    const bump = () => {
      reload();
    };

    runCh = supabase
      .channel(`admin-pickup-runs:${runId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "pickup_runs",
          filter: `id=eq.${runId}`,
        },
        bump,
      )
      .subscribe();

    rsvpCh = supabase
      .channel(`admin-pickup-run-rsvps:${runId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "pickup_run_rsvps",
          filter: `run_id=eq.${runId}`,
        },
        bump,
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "pickup_run_rsvps",
          filter: `run_id=eq.${runId}`,
        },
        bump,
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "pickup_run_rsvps",
          filter: `run_id=eq.${runId}`,
        },
        bump,
      )
      .subscribe();

    return () => {
      if (runCh) void supabase.removeChannel(runCh);
      if (rsvpCh) void supabase.removeChannel(rsvpCh);
    };
  }, [supabase, runId, session?.access_token, reload]);

  return { loading, error, data, region, setRegion, reload };
}

