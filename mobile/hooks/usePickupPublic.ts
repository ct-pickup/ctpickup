import { useAuth } from "@/context/AuthContext";
import { useSelectedRegion } from "@/context/SelectedRegionContext";
import { siteOrigin } from "@/lib/env";
import { fetchPickupPublic } from "@/lib/siteApi";
import { parsePickupPayload, type PickupPublicPayload } from "@/lib/pickupPublic";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";

export function usePickupPublic(accessToken: string | null) {
  const { supabase } = useAuth();
  const { region, ready: regionReady } = useSelectedRegion();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  const originOk = useMemo(() => Boolean(siteOrigin()), []);

  const load = useCallback(async () => {
    if (!originOk) {
      setError("Set EXPO_PUBLIC_SITE_URL in mobile/.env");
      setLoading(false);
      return;
    }
    if (!regionReady) {
      // Avoid flashing "no runs" before AsyncStorage region is ready.
      setLoading(true);
      return;
    }
    setLoading(true);
    setError(null);
    const r = await fetchPickupPublic(accessToken, { region });
    if (!r.ok) {
      setError(
        typeof (r.json as { error?: string })?.error === "string" ? String((r.json as { error: string }).error) : "Could not load pickup.",
      );
      setData(null);
    } else {
      setData(r.json);
      setError(null);
    }
    setLoading(false);
  }, [accessToken, originOk, region, regionReady]);

  useEffect(() => {
    void load();
  }, [load]);

  const parsed: PickupPublicPayload = useMemo(() => parsePickupPayload(data), [data]);
  const run = parsed.run && typeof parsed.run === "object" ? parsed.run : null;
  const runId = run && typeof (run as { id?: unknown }).id === "string" ? ((run as { id: string }).id) : null;

  // Realtime: refresh when this run's row changes (status, counts, etc.) or
  // when any RSVP for this run is inserted/updated. We re-`load()` rather than
  // patching state in place because the public payload aggregates many
  // server-computed fields (counts, visibility, my_status) that we can't
  // reliably reconstruct from a single row payload.
  useEffect(() => {
    if (!supabase || !runId) return;
    let runChannel: RealtimeChannel | null = null;
    let rsvpChannel: RealtimeChannel | null = null;

    runChannel = supabase
      .channel(`pickup_runs:${runId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "pickup_runs",
          filter: `id=eq.${runId}`,
        },
        () => {
          void load();
        },
      )
      .subscribe();

    rsvpChannel = supabase
      .channel(`pickup_run_rsvps:${runId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "pickup_run_rsvps",
          filter: `run_id=eq.${runId}`,
        },
        () => {
          void load();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "pickup_run_rsvps",
          filter: `run_id=eq.${runId}`,
        },
        () => {
          void load();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "pickup_run_rsvps",
          filter: `run_id=eq.${runId}`,
        },
        () => {
          void load();
        },
      )
      .subscribe();

    return () => {
      if (runChannel) void supabase.removeChannel(runChannel);
      if (rsvpChannel) void supabase.removeChannel(rsvpChannel);
    };
  }, [supabase, runId, load]);

  /** API echoes run lifecycle as top-level `status` when a run exists (e.g. planning); only trust `run`. */
  const noFeaturedRun = run == null;
  const counts = parsed.counts ?? {};
  const visibility = parsed.visibility ?? {};
  const me = parsed.me ?? {};

  const invitedNow = visibility.invitedNow === true;
  const tier = typeof me.tier === "string" && me.tier.length > 0 ? me.tier : null;
  const tierRank =
    typeof me.tier_rank === "number" && Number.isFinite(me.tier_rank) ? me.tier_rank : null;

  const myStatus: string | null =
    parsed.my_status === undefined || parsed.my_status === null
      ? null
      : typeof parsed.my_status === "string"
        ? parsed.my_status
        : null;

  return {
    loading,
    error,
    data,
    run: run as Record<string, unknown> | null,
    counts,
    visibility,
    me,
    invitedNow,
    tier,
    tierRank,
    myStatus,
    noFeaturedRun,
    load,
    originOk,
  };
}
