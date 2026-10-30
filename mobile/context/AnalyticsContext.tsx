import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";

import { useAuth } from "@/context/AuthContext";
import { useFeatureFlag } from "@/context/FeatureFlagsContext";
import { analytics } from "@/lib/analytics/analytics";
import { fetchAnalyticsPreference, saveAnalyticsPreference } from "@/lib/analytics/preference";

type Value = {
  /** The usage-data switch is shown only while the 'analytics_client' flag is on. */
  available: boolean;
  /** True when the player shares usage data. */
  sharing: boolean;
  setSharing: (next: boolean) => Promise<boolean>;
};
const Ctx = createContext<Value>({ available: false, sharing: false, setSharing: async () => false });

/**
 * Switches the event queue on only when the flag is on and the player has not turned usage data off. Unknown means off.
 * Sends what is waiting every 30 seconds while the app is open and when it goes to the background.
 */
export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const flagOn = useFeatureFlag("analytics_client");
  const [pref, setPref] = useState<{ token: string; sharing: boolean } | null>(null);

  useEffect(() => {
    if (!flagOn || !token) return;
    let cancelled = false;
    void fetchAnalyticsPreference(token).then((r) => {
      if (!cancelled) setPref(r.ok ? { token, sharing: r.enabled } : null);
    });
    return () => {
      cancelled = true;
    };
  }, [flagOn, token]);

  const sharing = flagOn && !!token && pref?.token === token && pref.sharing;

  useEffect(() => {
    analytics.configure({ enabled: sharing, token });
  }, [sharing, token]);

  useEffect(() => {
    if (!sharing) return;
    const timer = setInterval(() => void analytics.flush(), 30_000);
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active") void analytics.flush();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [sharing]);

  const setSharing = useCallback(
    async (next: boolean) => {
      if (!token) return false;
      const r = await saveAnalyticsPreference(token, next);
      if (!r.ok) return false;
      setPref({ token, sharing: r.enabled });
      return true;
    },
    [token],
  );

  const value = useMemo(() => ({ available: flagOn && !!token, sharing, setSharing }), [flagOn, token, sharing, setSharing]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAnalyticsPreference = (): Value => useContext(Ctx);
