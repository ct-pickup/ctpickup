import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";

import { useAuth } from "@/context/AuthContext";
import { useProfileAdmin } from "@/context/ProfileAdminContext";
import { FLAGS_OFF, flagOn, flagsLoader, type FlagKey, type Flags } from "@/lib/flags";

type Value = { flags: Flags; isReady: boolean; refresh: () => Promise<void> };
const Ctx = createContext<Value | undefined>(undefined);

/** Reads the remote switches at launch, when the user changes, and each time the app comes to the foreground (cached for a minute). */
export function FeatureFlagsProvider({ children }: { children: React.ReactNode }) {
  const { supabase, session } = useAuth();
  const userId = session?.user?.id ?? null;
  // The answer is stored with the user it belongs to, so a signed-out or switched account never sees the previous one's flags.
  const [answer, setAnswer] = useState<{ userId: string; flags: Flags } | null>(null);

  const refresh = useCallback(
    async (force = false) => {
      if (!userId) return;
      const r = await flagsLoader.load(supabase, userId, force);
      setAnswer({ userId, flags: r.flags });
    },
    [supabase, userId],
  );

  useEffect(() => {
    if (!userId) {
      flagsLoader.clear();
      return;
    }
    let cancelled = false;
    void flagsLoader.load(supabase, userId).then((r) => {
      if (!cancelled) setAnswer({ userId, flags: r.flags });
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, userId]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const mine = userId !== null && answer?.userId === userId;
  const flags = mine ? answer.flags : FLAGS_OFF;
  const isReady = userId === null || mine;
  const value = useMemo(() => ({ flags, isReady, refresh: () => refresh(true) }), [flags, isReady, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFeatureFlags(): Value {
  const v = useContext(Ctx);
  if (!v) throw new Error("useFeatureFlags must be used within FeatureFlagsProvider");
  return v;
}

/** True when the switch is ON for this user (admins always). False while loading, signed out, or when the switch cannot be read. */
export function useFeatureFlag(key: FlagKey): boolean {
  const { flags } = useFeatureFlags();
  const { isAdmin } = useProfileAdmin();
  return flagOn(flags, key, isAdmin);
}
