import { useAuth } from "@/context/AuthContext";
import { useSelectedRegion } from "@/context/SelectedRegionContext";
import { siteOrigin } from "@/lib/env";
import { cacheData, getCachedData } from "@/lib/offlineCache";
import { fetchPickupPublic } from "@/lib/siteApi";
import { logPickupDiagnostic } from "@/lib/pickup/pickupDiagnostics";
import { playerMayParticipateInPublicPickupRun } from "@/lib/pickup/publicRunParticipation";
import { isPublicPickupRunType, isSelectPickupRunType } from "@/lib/pickupRunType";
import { parsePickupPayload, type PickupPublicPayload } from "@/lib/pickupPublic";
import type { RealtimeChannel } from "@supabase/supabase-js";
import NetInfo from "@react-native-community/netinfo";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type PickupPublicLoadOpts = { background?: boolean };

/** Featured hub uses `pickup_run`; inline polls use `pickup_run:{runId}` so runs never share stale payloads. */
function pickupPublicCacheKey(runId?: string): string {
  const id = typeof runId === "string" ? runId.trim() : "";
  return id ? `pickup_run:${id}` : "pickup_run";
}

function cachedPayloadMatchesRunId(data: unknown, expectedRunId: string | undefined): boolean {
  if (!expectedRunId) return true;
  if (!data || typeof data !== "object") return false;
  const run = (data as Record<string, unknown>).run;
  if (!run || typeof run !== "object") return false;
  return String((run as Record<string, unknown>).id) === expectedRunId;
}

/** Module-scoped so rapid effect re-runs never reuse a topic while removeChannel is in flight. */
let pickupPublicRealtimeTopicSeq = 0;

export function usePickupPublic(
  accessToken: string | null,
  opts?: { focusRunId?: string | null; skipFeatured?: boolean },
) {
  const { supabase } = useAuth();
  const { region, ready: regionReady } = useSelectedRegion();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [netOffline, setNetOffline] = useState(false);
  const [offlineNoCache, setOfflineNoCache] = useState(false);
  const [displaySource, setDisplaySource] = useState<"live" | "cache">("live");
  const [dataAsOfMs, setDataAsOfMs] = useState<number | null>(null);
  const [lastLiveSuccessAt, setLastLiveSuccessAt] = useState<number | null>(null);

  const focusRunId = typeof opts?.focusRunId === "string" ? opts.focusRunId.trim() : "";
  const skipFeatured = opts?.skipFeatured === true;
  const effectiveRunIdParam = focusRunId || undefined;
  const shouldFetch = !skipFeatured || Boolean(effectiveRunIdParam);
  const cacheKey = pickupPublicCacheKey(effectiveRunIdParam);
  const useFocusedRunCacheOnly = Boolean(effectiveRunIdParam);

  const originOk = useMemo(() => Boolean(siteOrigin()), []);

  const loadRef = useRef<(opts?: PickupPublicLoadOpts) => Promise<void>>(async () => {});

  const load = useCallback(
    async (loadOpts?: PickupPublicLoadOpts) => {
      const background = loadOpts?.background === true;
      if (!originOk) {
        setError("Set EXPO_PUBLIC_SITE_URL in mobile/.env");
        setLoading(false);
        return;
      }
      if (!shouldFetch) {
        setData(null);
        setError(null);
        if (!background) setLoading(false);
        return;
      }
      if (!regionReady) {
        // Avoid flashing "no runs" before AsyncStorage region is ready.
        if (!background) setLoading(true);
        return;
      }
      if (useFocusedRunCacheOnly && effectiveRunIdParam && !background) {
        const cachedRaw = await getCachedData<unknown>(cacheKey);
        if (cachedRaw && cachedPayloadMatchesRunId(cachedRaw.data, effectiveRunIdParam)) {
          setData(cachedRaw.data);
        } else {
          setData(null);
        }
      }
      if (!background) setLoading(true);
      setError(null);
      setOfflineNoCache(false);

      let netState;
      try {
        netState = await NetInfo.fetch();
      } catch {
        netState = { isConnected: true };
      }
      const offline = netState.isConnected === false;
      setNetOffline(offline);

      if (offline) {
        if (useFocusedRunCacheOnly) {
          const cached = await getCachedData<unknown>(cacheKey);
          if (cached && cachedPayloadMatchesRunId(cached.data, effectiveRunIdParam)) {
            setData(cached.data);
            setError(null);
            setDisplaySource("cache");
            setDataAsOfMs(cached.cachedAt);
          } else {
            setData(null);
            setDisplaySource("cache");
            setDataAsOfMs(null);
            setOfflineNoCache(true);
            setError("Offline — connect to load this run's availability poll.");
          }
        } else {
          const cached = await getCachedData<unknown>(cacheKey);
          if (cached) {
            setData(cached.data);
            setError(null);
            setDisplaySource("cache");
            setDataAsOfMs(cached.cachedAt);
          } else {
            setData(null);
            setDisplaySource("cache");
            setDataAsOfMs(null);
            setOfflineNoCache(true);
          }
        }
        if (!background) setLoading(false);
        return;
      }

      try {
        const r = await fetchPickupPublic(accessToken, { region, run_id: effectiveRunIdParam });
        if (r.ok) {
          await cacheData(cacheKey, r.json);
          if (!useFocusedRunCacheOnly) {
            await cacheData("pickup_run", r.json);
          }
          setData(r.json);
          setError(null);
          setDisplaySource("live");
          const now = Date.now();
          setDataAsOfMs(now);
          setLastLiveSuccessAt(now);
          const j = r.json as Record<string, unknown>;
          const vis = (j.visibility as Record<string, unknown> | undefined) ?? {};
          const runRow = (j.run as Record<string, unknown> | undefined) ?? null;
          const me = (j.me as Record<string, unknown> | undefined) ?? {};
          logPickupDiagnostic(
            "public_load_ok",
            {
              focusRunId: effectiveRunIdParam || null,
              cacheKey,
              region,
              invitedNow: vis.invitedNow === true,
              runId: runRow?.id ?? null,
              runStatus: runRow?.status ?? null,
              runType: runRow?.run_type ?? null,
              topStatus: j.status ?? null,
              approved: me.approved === true,
              hasPlanning: j.planning != null,
            },
            {
              always:
                Boolean(effectiveRunIdParam) &&
                (!runRow || vis.invitedNow !== true),
            },
          );
        } else {
          const cachedRaw = await getCachedData<unknown>(cacheKey);
          const cached =
            cachedRaw && cachedPayloadMatchesRunId(cachedRaw.data, effectiveRunIdParam) ? cachedRaw : null;
          if (cached) {
            setData(cached.data);
            setError(null);
            setDisplaySource("cache");
            setDataAsOfMs(cached.cachedAt);
          } else {
            setError(
              typeof (r.json as { error?: string })?.error === "string"
                ? String((r.json as { error: string }).error)
                : "Could not load pickup.",
            );
            setData(null);
            setDataAsOfMs(null);
          }
          const j = cached?.data as Record<string, unknown> | undefined;
          const runRow = j && typeof j.run === "object" ? (j.run as Record<string, unknown>) : null;
          logPickupDiagnostic(
            "public_load_fail",
            {
              focusRunId: effectiveRunIdParam || null,
              cacheKey,
              status: r.status,
              usedCache: Boolean(cached),
              runId: runRow?.id ?? null,
              apiError:
                r.json && typeof r.json === "object" && typeof (r.json as { error?: string }).error === "string"
                  ? (r.json as { error: string }).error
                  : null,
            },
            { always: Boolean(effectiveRunIdParam) },
          );
        }
      } catch {
        const cachedRaw = await getCachedData<unknown>(cacheKey);
        const cached =
          cachedRaw && cachedPayloadMatchesRunId(cachedRaw.data, effectiveRunIdParam) ? cachedRaw : null;
        if (cached) {
          setData(cached.data);
          setError(null);
          setDisplaySource("cache");
          setDataAsOfMs(cached.cachedAt);
        } else {
          setError("Network error. Pull down to retry.");
          setData(null);
          setDataAsOfMs(null);
        }
      }
      if (!background) setLoading(false);
    },
    [accessToken, originOk, region, regionReady, effectiveRunIdParam, shouldFetch, cacheKey, useFocusedRunCacheOnly],
  );

  loadRef.current = load;

  useEffect(() => {
    let cancelled = false;
    const wasOfflineRef = { current: false };
    void NetInfo.fetch()
      .then((s) => {
        if (cancelled) return;
        const off = s.isConnected === false;
        wasOfflineRef.current = off;
        setNetOffline(off);
      })
      .catch(() => {});
    const unsub = NetInfo.addEventListener((s) => {
      if (cancelled) return;
      const off = s.isConnected === false;
      if (wasOfflineRef.current && !off) {
        void loadRef.current?.({ background: true });
      }
      wasOfflineRef.current = off;
      setNetOffline(off);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!effectiveRunIdParam) return;
    let cancelled = false;
    void (async () => {
      const cachedRaw = await getCachedData<unknown>(cacheKey);
      if (cancelled) return;
      if (cachedRaw && cachedPayloadMatchesRunId(cachedRaw.data, effectiveRunIdParam)) {
        setData(cachedRaw.data);
        setDisplaySource("cache");
        setDataAsOfMs(cachedRaw.cachedAt);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveRunIdParam, cacheKey]);

  const parsed: PickupPublicPayload = useMemo(() => parsePickupPayload(data), [data]);
  const run = useMemo(() => {
    const row = parsed.run;
    if (!row || typeof row !== "object") return null;
    const id = typeof (row as { id?: unknown }).id === "string" ? (row as { id: string }).id : null;
    if (effectiveRunIdParam && id && id !== effectiveRunIdParam) return null;
    return row as Record<string, unknown>;
  }, [parsed.run, effectiveRunIdParam]);
  const runIdFromPayload =
    run && typeof (run as { id?: unknown }).id === "string" ? ((run as { id: string }).id) : null;
  const runId = focusRunId || runIdFromPayload;

  // Realtime: refresh when this run's row changes (status, counts, etc.) or
  // when any RSVP for this run is inserted/updated. We re-`load()` via loadRef
  // (not `load`) so this effect never depends on the load callback identity.
  // Channel setup is fully synchronous: topic → channel → all .on() → subscribe once.
  useEffect(() => {
    if (!supabase || !runId) return;

    let cancelled = false;
    const client = supabase;
    const subscribedRunId = runId;
    const topic = `pickup_public:${subscribedRunId}:${++pickupPublicRealtimeTopicSeq}`;

    const refresh = () => {
      if (cancelled) return;
      void loadRef.current?.({ background: true });
    };

    const pickupChannel: RealtimeChannel = client.channel(topic);

    pickupChannel.on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "pickup_runs",
        filter: `id=eq.${subscribedRunId}`,
      },
      refresh,
    );
    pickupChannel.on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "pickup_run_rsvps",
        filter: `run_id=eq.${subscribedRunId}`,
      },
      refresh,
    );
    pickupChannel.on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "pickup_run_rsvps",
        filter: `run_id=eq.${subscribedRunId}`,
      },
      refresh,
    );
    pickupChannel.on(
      "postgres_changes",
      {
        event: "DELETE",
        schema: "public",
        table: "pickup_run_rsvps",
        filter: `run_id=eq.${subscribedRunId}`,
      },
      refresh,
    );

    pickupChannel.subscribe();

    return () => {
      cancelled = true;
      void client.removeChannel(pickupChannel);
    };
  }, [supabase, runId]);

  /** API echoes run lifecycle as top-level `status` when a run exists (e.g. planning); only trust `run`. */
  const noFeaturedRun = run == null;
  const counts = parsed.counts ?? {};
  const visibility = parsed.visibility ?? {};

  const invitedNow = visibility.invitedNow === true;

  const me = parsed.me ?? {};
  const approved = me.approved === true;

  const canParticipateInPlanning = useMemo(() => {
    if (!run) return false;
    const runType = run.run_type;
    if (isSelectPickupRunType(runType)) return invitedNow;
    if (!isPublicPickupRunType(runType)) return false;
    if (invitedNow) return true;
    return playerMayParticipateInPublicPickupRun({
      approved,
      runServiceRegion: typeof run.service_region === "string" ? run.service_region : null,
      hubRegion: region,
      runType,
      explicitRunAccess: Boolean(effectiveRunIdParam),
    });
  }, [run, invitedNow, approved, region, effectiveRunIdParam]);

  const myStatus: string | null =
    parsed.my_status === undefined || parsed.my_status === null
      ? null
      : typeof parsed.my_status === "string"
        ? parsed.my_status
        : null;

  const myWaitlistExpiresAt: string | null =
    typeof parsed.my_waitlist_expires_at === "string" && parsed.my_waitlist_expires_at.trim()
      ? parsed.my_waitlist_expires_at.trim()
      : null;

  return {
    loading,
    error,
    data,
    run: run as Record<string, unknown> | null,
    counts,
    visibility,
    invitedNow,
    canParticipateInPlanning,
    approved,
    myStatus,
    myWaitlistExpiresAt,
    noFeaturedRun,
    load,
    originOk,
    netOffline,
    offlineNoCache,
    displaySource,
    dataAsOfMs,
    lastLiveSuccessAt,
  };
}
