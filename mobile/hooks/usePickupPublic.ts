import { useSelectedRegion } from "@/context/SelectedRegionContext";
import { siteOrigin } from "@/lib/env";
import { fetchPickupPublic } from "@/lib/siteApi";
import { parsePickupPayload, type PickupPublicPayload } from "@/lib/pickupPublic";
import { useCallback, useEffect, useMemo, useState } from "react";

export function usePickupPublic(accessToken: string | null) {
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
  const hubInactive = parsed.status === "inactive";
  const noFeaturedRun = hubInactive || run == null;
  const counts = parsed.counts;
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
    myStatus,
    noFeaturedRun,
    load,
    originOk,
  };
}
