import { useAuth } from "@/context/AuthContext";
import { useWaiver } from "@/context/WaiverContext";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

type ProfileCompletionContextValue = {
  /** True while checking whether profile fields are set (only after waiver is resolved). */
  profileGateLoading: boolean;
  /** True when signed-in user must complete profile before tabs (both first_name and username empty). */
  profileNeedsCompletion: boolean;
  /** Re-run profile completion check (e.g. after saving on complete-profile). */
  refreshProfileCompletion: () => void;
};

const ProfileCompletionContext = createContext<ProfileCompletionContextValue | undefined>(undefined);

/** Loaded from root `app/_layout.tsx` after waiver status is known; drives the tabs profile gate. */
export function ProfileCompletionProvider({ children }: { children: React.ReactNode }) {
  const { session, supabase, isReady } = useAuth();
  const { waiverAccepted, waiverLoading } = useWaiver();
  const [tick, setTick] = useState(0);
  const [profileGateLoading, setProfileGateLoading] = useState(true);
  const [profileNeedsCompletion, setProfileNeedsCompletion] = useState(false);

  const refreshProfileCompletion = useMemo(
    () => () => {
      setTimeout(() => setTick((t) => t + 1), 500);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    if (!isReady || !supabase || !session?.user?.id) {
      setProfileGateLoading(false);
      setProfileNeedsCompletion(false);
      return;
    }

    if (waiverLoading) {
      if (session?.user?.id) setProfileGateLoading(true);
      return;
    }

    if (!waiverAccepted) {
      setProfileGateLoading(false);
      setProfileNeedsCompletion(false);
      return;
    }

    setProfileGateLoading(true);

    void (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("first_name, username")
        .eq("id", session.user.id)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        console.warn("[profile-completion] profiles lookup failed:", error.message);
        setProfileNeedsCompletion(false);
        setProfileGateLoading(false);
        return;
      }

      const fn = data?.first_name as string | null | undefined;
      const un = data?.username as string | null | undefined;
      const firstEmpty = fn == null || String(fn).trim() === "";
      const userEmpty = un == null || String(un).trim() === "";
      setProfileNeedsCompletion(firstEmpty && userEmpty);
      setProfileGateLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [isReady, supabase, session?.user?.id, waiverLoading, waiverAccepted, tick]);

  const value = useMemo(
    () => ({
      profileGateLoading,
      profileNeedsCompletion,
      refreshProfileCompletion,
    }),
    [profileGateLoading, profileNeedsCompletion, refreshProfileCompletion],
  );

  return <ProfileCompletionContext.Provider value={value}>{children}</ProfileCompletionContext.Provider>;
}

export function useProfileCompletionGate() {
  const ctx = useContext(ProfileCompletionContext);
  if (!ctx) throw new Error("useProfileCompletionGate must be used within ProfileCompletionProvider");
  return ctx;
}
