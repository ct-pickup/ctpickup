import { useAuth } from "@/context/AuthContext";
import { siteOrigin } from "@/lib/env";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type WaiverStatusResponse = {
  accepted: boolean;
  currentVersion?: string;
  authenticated?: boolean;
};

type WaiverContextValue = {
  waiverAccepted: boolean;
  waiverLoading: boolean;
  refreshWaiver: () => Promise<void>;
};

const WaiverContext = createContext<WaiverContextValue | undefined>(undefined);

async function fetchWaiverStatus(accessToken: string): Promise<boolean> {
  const origin = siteOrigin();
  if (!origin) return false;
  const r = await fetch(`${origin}/api/waiver/status`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });
  if (!r.ok) {
    console.warn("[waiver] GET /api/waiver/status failed:", r.status);
    return false;
  }
  const data = (await r.json()) as WaiverStatusResponse;
  return !!data.accepted;
}

export function WaiverProvider({ children }: { children: React.ReactNode }) {
  const { session, isReady: authReady } = useAuth();
  const [waiverAccepted, setWaiverAccepted] = useState(false);
  const [waiverLoading, setWaiverLoading] = useState(true);

  const token = session?.access_token ?? null;

  const refreshWaiver = useCallback(async () => {
    if (!token) {
      setWaiverAccepted(false);
      return;
    }
    setWaiverLoading(true);
    try {
      const accepted = await fetchWaiverStatus(token);
      setWaiverAccepted(accepted);
    } finally {
      setWaiverLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!authReady) return;

    let cancelled = false;

    void (async () => {
      if (!token) {
        if (!cancelled) {
          setWaiverAccepted(false);
          setWaiverLoading(false);
        }
        return;
      }
      if (!cancelled) setWaiverLoading(true);
      try {
        const accepted = await fetchWaiverStatus(token);
        if (!cancelled) setWaiverAccepted(accepted);
      } finally {
        if (!cancelled) setWaiverLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authReady, token]);

  const value = useMemo(
    () => ({ waiverAccepted, waiverLoading, refreshWaiver }),
    [waiverAccepted, waiverLoading, refreshWaiver],
  );

  return <WaiverContext.Provider value={value}>{children}</WaiverContext.Provider>;
}

export function useWaiver() {
  const ctx = useContext(WaiverContext);
  if (!ctx) throw new Error("useWaiver must be used within WaiverProvider");
  return ctx;
}
