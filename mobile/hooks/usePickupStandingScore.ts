import { useAuth } from "@/context/AuthContext";
import { siteOrigin } from "@/lib/env";
import { computePickupReliability } from "@/lib/pickupReliabilityScore";
import { fetchPickupStanding } from "@/lib/siteApi";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

export type PickupStandingScoreState = {
  loading: boolean;
  /** 0–100 when eligible; null while still “building” (fewer than 3 tracked pickups). */
  scorePct: number | null;
  trackedPickups: number;
  attendedPickups: number;
};

const initial: PickupStandingScoreState = {
  loading: true,
  scorePct: null,
  trackedPickups: 0,
  attendedPickups: 0,
};

async function loadScoreFromSupabase(
  supabase: SupabaseClient,
  userId: string,
): Promise<PickupStandingScoreState | null> {
  const prof = await supabase
    .from("profiles")
    .select("confirmed_count,attended_count,strike_count")
    .eq("id", userId)
    .maybeSingle();

  if (prof.error || !prof.data) return null;

  let lateCancels = 0;
  const late = await supabase
    .from("pickup_reliability_incidents")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("kind", "late_cancel");
  if (!late.error && late.count != null) lateCancels = late.count;

  const reliability = computePickupReliability({
    confirmed: Number(prof.data.confirmed_count ?? 0),
    attended: Number(prof.data.attended_count ?? 0),
    lateCancels,
    noShows: Number(prof.data.strike_count ?? 0),
  });

  return {
    loading: false,
    scorePct: reliability.scorePct == null ? null : Math.round(Number(reliability.scorePct)),
    trackedPickups: reliability.trackedPickups,
    attendedPickups: Number(prof.data.attended_count ?? 0),
  };
}

/**
 * Reliability score (same rules as `/api/pickup/standing`). Uses the site API when
 * `EXPO_PUBLIC_SITE_URL` is set; otherwise reads counts from Supabase directly.
 */
export function usePickupStandingScore() {
  const { session, isReady, supabase } = useAuth();
  const [state, setState] = useState<PickupStandingScoreState>(initial);

  useEffect(() => {
    if (!isReady) return;
    const token = session?.access_token;
    const uid = session?.user?.id;
    if (!token || !uid) {
      setState({ loading: false, scorePct: null, trackedPickups: 0, attendedPickups: 0 });
      return;
    }
    if (!supabase) {
      setState({ loading: false, scorePct: null, trackedPickups: 0, attendedPickups: 0 });
      return;
    }

    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));

    void (async () => {
      let resolved = false;

      if (siteOrigin()) {
        const r = await fetchPickupStanding(token);
        if (cancelled) return;
        if (r.ok && r.data?.ok && r.data.reliability) {
          const rel = r.data.reliability;
          resolved = true;
          setState({
            loading: false,
            scorePct: rel.score_pct == null ? null : Math.round(Number(rel.score_pct)),
            trackedPickups: rel.tracked_pickups ?? 0,
            attendedPickups: rel.attended_count ?? 0,
          });
        }
      }

      if (cancelled) return;
      if (!resolved) {
        const fb = await loadScoreFromSupabase(supabase, uid);
        if (cancelled) return;
        if (fb) {
          setState(fb);
          return;
        }
        setState({ loading: false, scorePct: null, trackedPickups: 0, attendedPickups: 0 });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isReady, session?.access_token, session?.user?.id, supabase]);

  return state;
}
