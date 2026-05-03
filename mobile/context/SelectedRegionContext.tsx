import { appAsyncStorage } from "@/lib/appAsyncStorage";
import { isServiceRegionCode, type ServiceRegionCode } from "@/lib/serviceRegions";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "ctpickup:service_region";

const DEFAULT_REGION: ServiceRegionCode = "CT";

type Ctx = {
  /** Ready after first read from storage (avoid mismatching first fetch). */
  ready: boolean;
  region: ServiceRegionCode;
  setRegion: (code: ServiceRegionCode) => Promise<void>;
};

const SelectedRegionContext = createContext<Ctx | null>(null);

export function SelectedRegionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [region, setRegionState] = useState<ServiceRegionCode>(DEFAULT_REGION);

  useEffect(() => {
    void (async () => {
      try {
        const raw = await appAsyncStorage.getItem(STORAGE_KEY);
        if (raw && isServiceRegionCode(raw)) {
          setRegionState(raw);
        }
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const setRegion = useCallback(async (code: ServiceRegionCode) => {
    setRegionState(code);
    await appAsyncStorage.setItem(STORAGE_KEY, code);
  }, []);

  const value = useMemo(() => ({ ready, region, setRegion }), [ready, region, setRegion]);

  return <SelectedRegionContext.Provider value={value}>{children}</SelectedRegionContext.Provider>;
}

export function useSelectedRegion(): Ctx {
  const ctx = useContext(SelectedRegionContext);
  if (!ctx) {
    throw new Error("useSelectedRegion must be used within SelectedRegionProvider");
  }
  return ctx;
}
