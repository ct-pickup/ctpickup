import { fetchAdminOutdoorTournaments, type AdminOutdoorTournament } from "@/lib/adminApi";
import { useAuth } from "@/context/AuthContext";
import { useCallback, useEffect, useState } from "react";

type State = {
  loading: boolean;
  error: string | null;
  tournaments: AdminOutdoorTournament[];
  reload: () => void;
};

export function useAdminOutdoorTournaments(): State {
  const { session, isReady } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tournaments, setTournaments] = useState<AdminOutdoorTournament[]>([]);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!isReady) return;
    const token = session?.access_token;
    if (!token) {
      setLoading(false);
      setError("Not signed in.");
      setTournaments([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const r = await fetchAdminOutdoorTournaments(token);
        if (cancelled) return;
        if (!r.ok) {
          setError(r.error);
          setTournaments([]);
          return;
        }
        const raw = (r.data as { tournaments?: unknown }).tournaments;
        setTournaments(Array.isArray(raw) ? (raw as AdminOutdoorTournament[]) : []);
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Request failed");
        setTournaments([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isReady, session?.access_token, nonce]);

  return { loading, error, tournaments, reload };
}
