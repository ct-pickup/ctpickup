import { fetchAdminPickupStanding, type StandingListResponse } from "@/lib/adminApi";
import { useAuth } from "@/context/AuthContext";
import { useCallback, useEffect, useMemo, useState } from "react";

export type AdminStandingFilter = "all" | "good" | "warning" | "suspended" | "banned" | "missing_waiver";

type State = {
  loading: boolean;
  error: string | null;
  rows: Record<string, unknown>[];
  filter: AdminStandingFilter;
  q: string;
  setFilter: (f: AdminStandingFilter) => void;
  setQ: (q: string) => void;
  reload: () => void;
};

export function useAdminStanding(initial?: { filter?: AdminStandingFilter; q?: string }): State {
  const { session, isReady } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [filter, setFilter] = useState<AdminStandingFilter>(initial?.filter ?? "all");
  const [q, setQ] = useState(initial?.q ?? "");
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const qNorm = useMemo(() => q.trim(), [q]);

  useEffect(() => {
    if (!isReady) return;
    const token = session?.access_token;
    if (!token) {
      setLoading(false);
      setError("Not signed in.");
      setRows([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const r = await fetchAdminPickupStanding(token, { filter, q: qNorm, limit: 60, offset: 0 });
        if (cancelled) return;
        if (!r.ok) {
          setError(r.error);
          setRows([]);
          return;
        }
        const data = r.data as StandingListResponse;
        setRows(Array.isArray(data.rows) ? (data.rows as Record<string, unknown>[]) : []);
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
  }, [isReady, session?.access_token, filter, qNorm, nonce]);

  return { loading, error, rows, filter, q, setFilter, setQ, reload };
}

