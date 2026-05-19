import { REVIEW_MODE_STORAGE_KEY } from "@/lib/reviewMode";
import { appAsyncStorage } from "@/lib/appAsyncStorage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type ReviewModeContextValue = {
  enabled: boolean;
  isReady: boolean;
  setEnabled: (next: boolean) => Promise<void>;
};

const ReviewModeContext = createContext<ReviewModeContextValue | undefined>(undefined);

export function ReviewModeProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabledState] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const raw = await appAsyncStorage.getItem(REVIEW_MODE_STORAGE_KEY);
        setEnabledState(raw === "1");
      } finally {
        setIsReady(true);
      }
    })();
  }, []);

  const setEnabled = useCallback(async (next: boolean) => {
    setEnabledState(next);
    await appAsyncStorage.setItem(REVIEW_MODE_STORAGE_KEY, next ? "1" : "0");
  }, []);

  const value = useMemo(() => ({ enabled, isReady, setEnabled }), [enabled, isReady, setEnabled]);

  return <ReviewModeContext.Provider value={value}>{children}</ReviewModeContext.Provider>;
}

export function useReviewMode() {
  const ctx = useContext(ReviewModeContext);
  if (!ctx) throw new Error("useReviewMode must be used within ReviewModeProvider");
  return ctx;
}
