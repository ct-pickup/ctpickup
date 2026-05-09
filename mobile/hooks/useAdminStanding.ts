import { fetchAdminPickupStanding } from "@/lib/adminApi";
import { useAuth } from "@/context/AuthContext";
import { useCallback, useEffect, useState } from "react";

export type AdminStandingFilter =
  | "all"
  | "good"
  | "warning"
  | "suspended"
  | "banned"
  | "missing_waiver";

export type AdminStandingReliabilityBucket =
  | "building"
  | "good"
  | "watch"
  | "needs_review";

/** Mirrors the row shape returned by `/api/admin/pickup/standing` (see website admin client). */
export type AdminStandingRow = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  instagram: string | null;
  email?: string | null;
  tier: string | null;
  confirmed_count: number | null;
  attended_count: number | null;
  strike_count: number | null;
  reliability_tracked_pickups: number | null;
  reliability_score_pct: number | null;
  reliability_bucket: AdminStandingReliabilityBucket | string | null;
  reliability_override_score_pct?: number | null;
  reliability_override_reason?: string | null;
  waiver_current: boolean;
  effective_standing: string;
  auto_standing: string;
  manual_override: string | null;
  join_ok: boolean;
  standing: {
    manual_reason: string | null;
    staff_notes: string | null;
    auto_codes?: string[] | null;
    rollup_no_shows_90d: number | null;
    rollup_late_cancels_90d: number | null;
    rollup_pickup_payment_issues_90d: number | null;
    updated_at: string | null;
  } | null;
};

type State = {
  loading: boolean;
  error: string | null;
  rows: AdminStandingRow[];
  filter: AdminStandingFilter;
  q: string;
  currentWaiverVersion: string;
  setFilter: (f: AdminStandingFilter) => void;
  setQ: (q: string) => void;
  reload: () => void;
};

export function useAdminStanding(): State {
  const { session, isReady } = useAuth();
  const [filter, setFilter] = useState<AdminStandingFilter>("all");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<AdminStandingRow[]>([]);
  const [currentWaiverVersion, setCurrentWaiverVersion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!isReady) return;
    const token = session?.access_token;
    if (!token) {
      setError("Not signed in.");
      setRows([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const r = await fetchAdminPickupStanding(token, {
          filter,
          q: q.trim() || undefined,
        });
        if (cancelled) return;
        if (!r.ok) {
          const detail =
            r.detail && typeof r.detail === "object"
              ? (r.detail as Record<string, unknown>)
              : null;
          const detailMsgParts = [
            typeof detail?.error === "string" ? detail.error : null,
            typeof detail?.details === "string" ? detail.details : null,
            typeof detail?.hint === "string" ? detail.hint : null,
            typeof detail?.code === "string" ? `code=${detail.code}` : null,
          ].filter(Boolean) as string[];

          console.error("[admin/standing] load failed", {
            status: r.status,
            error: r.error,
            detail: r.detail,
          });

          setError(detailMsgParts.length ? detailMsgParts.join("\n") : r.error);
          setRows([]);
          return;
        }
        const d = r.data;
        const raw = (d as { rows?: unknown }).rows;
        setRows(Array.isArray(raw) ? (raw as AdminStandingRow[]) : []);
        const wv = (d as { currentWaiverVersion?: unknown }).currentWaiverVersion;
        setCurrentWaiverVersion(typeof wv === "string" ? wv : "");
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Request failed");
        setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isReady, session?.access_token, filter, q, nonce]);

  return {
    loading,
    error,
    rows,
    filter,
    q,
    currentWaiverVersion,
    setFilter,
    setQ,
    reload,
  };
}
