import { useAuth } from "@/context/AuthContext";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type ProfileAdminContextValue = {
  /** Mirrors `public.profiles.is_admin` for the signed-in user. */
  isAdmin: boolean;
  /** True once we have finished loading admin flag for the current session (or decided there is no session). */
  isReady: boolean;
  /** Re-fetch from Supabase (e.g. after profile changes elsewhere). */
  refresh: () => Promise<void>;
};

const ProfileAdminContext = createContext<ProfileAdminContextValue | undefined>(undefined);

export function ProfileAdminProvider({ children }: { children: React.ReactNode }) {
  const { supabase, session, isReady: authReady } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [bump, setBump] = useState(0);

  const userId = session?.user?.id;

  useEffect(() => {
    if (!authReady) return;

    let cancelled = false;

    if (!supabase || !userId) {
      setIsAdmin(false);
      setIsReady(true);
      return () => {
        cancelled = true;
      };
    }

    setIsReady(false);
    void (async () => {
      try {
        const { data, error } = await supabase.from("profiles").select("is_admin").eq("id", userId).maybeSingle();
        if (cancelled) return;
        if (error) {
          console.warn("[profile-admin] profiles lookup failed:", error.message);
          setIsAdmin(false);
        } else {
          setIsAdmin(!!data?.is_admin);
        }
      } finally {
        if (!cancelled) setIsReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authReady, supabase, userId, bump]);

  const refresh = useCallback(async () => {
    setBump((n) => n + 1);
  }, []);

  const value = useMemo(() => ({ isAdmin, isReady, refresh }), [isAdmin, isReady, refresh]);

  return <ProfileAdminContext.Provider value={value}>{children}</ProfileAdminContext.Provider>;
}

export function useProfileAdmin() {
  const ctx = useContext(ProfileAdminContext);
  if (!ctx) throw new Error("useProfileAdmin must be used within ProfileAdminProvider");
  return ctx;
}
