import { useAuth } from "@/context/AuthContext";
import { useWaiver } from "@/context/WaiverContext";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type ProfileCompletionContextValue = {
  /** True while checking whether profile fields are set (only after waiver is resolved). */
  profileGateLoading: boolean;
  /** True when signed-in user must complete profile before tabs (both first_name and username empty). */
  profileNeedsCompletion: boolean;
  /** Re-run profile completion check (e.g. after saving on complete-profile). */
  refreshProfileCompletion: () => Promise<void>;
  /** Mark profile complete locally without a Supabase round-trip (e.g. after successful save). */
  markProfileComplete: () => void;
};

const ProfileCompletionContext = createContext<ProfileCompletionContextValue | undefined>(undefined);

/** Loaded from root `app/_layout.tsx` after waiver status is known; drives the tabs profile gate. */
export function ProfileCompletionProvider({ children }: { children: React.ReactNode }) {
  const { session, supabase, isReady } = useAuth();
  const { waiverAccepted, waiverLoading } = useWaiver();
  const [profileGateLoading, setProfileGateLoading] = useState(true);
  const [profileNeedsCompletion, setProfileNeedsCompletion] = useState(false);

  const refreshProfileCompletion = useCallback(async () => {
    if (!supabase || !session?.user?.id) {
      setProfileNeedsCompletion(false);
      return;
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("first_name, username")
      .eq("id", session.user.id)
      .maybeSingle();

    if (error) {
      console.warn("[profile-completion] profiles lookup failed:", error.message);
      setProfileNeedsCompletion(false);
      return;
    }

    const fn = data?.first_name;
    const un = data?.username;
    const needsCompletion =
      (fn == null || String(fn).trim() === "") && (un == null || String(un).trim() === "");
    setProfileNeedsCompletion(needsCompletion);
  }, [supabase, session?.user?.id]);

  const markProfileComplete = useCallback(() => {
    setProfileNeedsCompletion(false);
    setProfileGateLoading(false);
  }, []);

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
      await refreshProfileCompletion();
      if (cancelled) return;
      setProfileGateLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [isReady, supabase, session?.user?.id, waiverLoading, waiverAccepted, refreshProfileCompletion]);

  const value = useMemo(
    () => ({
      profileGateLoading,
      profileNeedsCompletion,
      refreshProfileCompletion,
      markProfileComplete,
    }),
    [profileGateLoading, profileNeedsCompletion, refreshProfileCompletion, markProfileComplete],
  );

  return <ProfileCompletionContext.Provider value={value}>{children}</ProfileCompletionContext.Provider>;
}

export function useProfileCompletionGate() {
  const ctx = useContext(ProfileCompletionContext);
  if (!ctx) throw new Error("useProfileCompletionGate must be used within ProfileCompletionProvider");
  return ctx;
}
