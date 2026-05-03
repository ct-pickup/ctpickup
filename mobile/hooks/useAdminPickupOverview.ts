import { fetchAdminPickupOverview, type PickupOverviewResponse } from "@/lib/adminApi";
import { useAuth } from "@/context/AuthContext";
import { useCallback, useEffect, useState } from "react";

type State = {
  loading: boolean;
  error: string | null;
  data: PickupOverviewResponse | null;
  region: string;
  setRegion: (r: string) => void;
  reload: () => void;
};

export function useAdminPickupOverview(initialRegion: string = "CT"): State {
  const { session, isReady } = useAuth();
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

  return { loading, error, data, region, setRegion, reload };
}

