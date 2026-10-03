import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { siteOrigin } from "@/lib/env";
import { fetchInstagramQueue } from "@/lib/instagramVerifyApi";

export type AttentionCounts = {
  /** Pending Instagram and document verification requests. */
  verifications: number;
  /** Profiles created in the last 30 days that are not approved yet. */
  signups: number;
  /** Rating sessions that have started but are not settled (last 30 days). */
  settlements: number;
  // No payouts count: it needs a "paid out" marker (a migration) before it can be a real queue.
};

const WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

/**
 * Live counts for the admin home "Needs attention" list.
 *   verifications: existing GET /api/admin/verification?status=pending and GET /api/admin/instagram-verification.
 *   signups, settlements: new read-only queries on the signed-in admin's client
 *   (profiles, tier_sessions). None of them change data.
 * A count that fails to load reads as 0 so one broken query never hides the rest.
 */
export function useAdminAttention() {
  const { session, supabase } = useAuth();
  const token = session?.access_token ?? null;
  const [counts, setCounts] = useState<AttentionCounts | null>(null);

  const load = useCallback(async () => {
    if (!token || !supabase) return;
    const origin = siteOrigin();
    const since = new Date(Date.now() - WINDOW_DAYS * DAY_MS).toISOString();
    const nowIso = new Date().toISOString();

    const documentPending = async (): Promise<number> => {
      if (!origin) return 0;
      try {
        const r = await fetch(`${origin}/api/admin/verification?status=pending`, { headers: { Authorization: `Bearer ${token}` } });
        const j = (await r.json().catch(() => null)) as { items?: unknown[] } | null;
        return r.ok ? (j?.items?.length ?? 0) : 0;
      } catch {
        return 0;
      }
    };
    const instagramPending = async (): Promise<number> => {
      const res = await fetchInstagramQueue(token);
      return res.ok ? (res.data.items ?? []).filter((i) => i.status === "pending").length : 0;
    };
    const signups = async (): Promise<number> => {
      const { count, error } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .or("approved.is.null,approved.eq.false")
        .or("is_banned.is.null,is_banned.eq.false")
        .gte("created_at", since);
      return error ? 0 : (count ?? 0);
    };
    const settlements = async (): Promise<number> => {
      const { count, error } = await supabase
        .from("tier_sessions")
        .select("id", { count: "exact", head: true })
        .neq("state", "settled")
        .lt("starts_at", nowIso)
        .gte("starts_at", since);
      return error ? 0 : (count ?? 0);
    };
    const [doc, ig, s, st] = await Promise.all([documentPending(), instagramPending(), signups(), settlements()]);
    setCounts({ verifications: doc + ig, signups: s, settlements: st });
  }, [token, supabase]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return { counts, reload: load };
}
