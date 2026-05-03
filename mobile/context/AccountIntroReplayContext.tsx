import { AccountFirst100Intro, clearAccountFirstIntroFlag } from "@/components/AccountFirst100Intro";
import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

type Ctx = {
  replay: (payload?: { trackedPickups?: number; scorePct?: number | null }) => Promise<void>;
};

const AccountIntroReplayContext = createContext<Ctx | null>(null);

export function AccountIntroReplayProvider({ children }: { children: React.ReactNode }) {
  const [key, setKey] = useState(0);
  const [payload, setPayload] = useState<{ trackedPickups?: number; scorePct?: number | null } | null>(null);

  const replay = useCallback(async (next?: { trackedPickups?: number; scorePct?: number | null }) => {
    if (!__DEV__) return;
    setPayload(next ?? null);
    await clearAccountFirstIntroFlag();
    setKey((k) => k + 1);
  }, []);

  const value = useMemo(() => ({ replay }), [replay]);

  return (
    <AccountIntroReplayContext.Provider value={value}>
      {children}
      <AccountFirst100Intro key={key} trackedPickups={payload?.trackedPickups} scorePct={payload?.scorePct ?? null} />
    </AccountIntroReplayContext.Provider>
  );
}

export function useAccountIntroReplay(): Ctx {
  const ctx = useContext(AccountIntroReplayContext);
  if (!ctx) throw new Error("useAccountIntroReplay must be used within AccountIntroReplayProvider");
  return ctx;
}

