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
  /** Completed paid games from the last 30 days with at least one payment received. */
  payouts: number;
};

const WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

/**
 * Live counts for the admin home "Needs attention" list.
 *   verifications: existing GET /api/admin/verification?status=pending and GET /api/admin/instagram-verification.
 *   signups, settlements, payouts: new read-only queries on the signed-in admin's client
 *   (profiles, tier_sessions, pickup_runs + platform_payments). None of them change data.
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
    const payouts = async (): Promise<number> => {
      const runs = await supabase
        .from("pickup_runs")
        .select("id")
        .gt("fee_cents", 0)
        .eq("status", "completed")
        .gte("start_at", since)
        .limit(200);
      const ids = ((runs.data ?? []) as Array<{ id: string }>).map((r) => r.id);
      if (runs.error || ids.length === 0) return 0;
      const pays = await supabase
        .from("platform_payments")
        .select("product_entity_id")
        .in("product_entity_id", ids)
        .eq("product_type", "pickup")
        .eq("lifecycle_status", "payment_received");
      if (pays.error) return 0;
      return new Set(((pays.data ?? []) as Array<{ product_entity_id: string }>).map((p) => p.product_entity_id)).size;
    };

    const [doc, ig, s, st, p] = await Promise.all([documentPending(), instagramPending(), signups(), settlements(), payouts()]);
    setCounts({ verifications: doc + ig, signups: s, settlements: st, payouts: p });
  }, [token, supabase]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return { counts, reload: load };
}
