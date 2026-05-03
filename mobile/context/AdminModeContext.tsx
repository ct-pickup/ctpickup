import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { appAsyncStorage } from "@/lib/appAsyncStorage";

type AdminModeContextValue = {
  enabled: boolean;
  isReady: boolean;
  setEnabled: (next: boolean) => Promise<void>;
};

const STORAGE_KEY = "ctpickup.adminMode.enabled.v1";

const AdminModeContext = createContext<AdminModeContextValue | undefined>(undefined);

export function AdminModeProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabledState] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const raw = await appAsyncStorage.getItem(STORAGE_KEY);
        setEnabledState(raw === "1");
      } finally {
        setIsReady(true);
      }
    })();
  }, []);

  const setEnabled = useCallback(async (next: boolean) => {
    setEnabledState(next);
    await appAsyncStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  }, []);

  const value = useMemo(() => ({ enabled, isReady, setEnabled }), [enabled, isReady, setEnabled]);

  return <AdminModeContext.Provider value={value}>{children}</AdminModeContext.Provider>;
}

export function useAdminMode() {
  const ctx = useContext(AdminModeContext);
  if (!ctx) throw new Error("useAdminMode must be used within AdminModeProvider");
  return ctx;
}
