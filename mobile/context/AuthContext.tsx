import { authRouteRef } from "@/lib/authRouteRef";
import { getMobileSupabaseClient } from "@/lib/supabase";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { router } from "expo-router";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type AuthContextValue = {
  supabase: SupabaseClient | null;
  session: Session | null;
  isReady: boolean;
  signOut: () => Promise<void>;
  /** Re-read session from Supabase (e.g. after verifyOtp) so React state matches storage on all devices. */
  refreshSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const client = getMobileSupabaseClient();
    setSupabase(client);
    if (!client) {
      setIsReady(true);
      return;
    }

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === "SIGNED_IN" && next?.user?.email) {
        const path = authRouteRef.current;
        const onLoginScreen = path === "/login" || path.endsWith("/login");
        if (onLoginScreen) {
          router.replace("/(tabs)");
        }
      }
    });

    void (async () => {
      try {
        const { data } = await client.auth.getSession();
        setSession(data.session ?? null);
      } catch (e) {
        console.warn("[auth] getSession failed:", e);
      } finally {
        setIsReady(true);
      }
    })();

    return () => subscription.unsubscribe();
  }, []);

  const refreshSession = useCallback(async () => {
    if (!supabase) return;
    try {
      const { data } = await supabase.auth.getSession();
      setSession(data.session ?? null);
    } catch (e) {
      console.warn("[auth] refreshSession getSession failed:", e);
    }
  }, [supabase]);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  }, [supabase]);

  const value = useMemo(
    () => ({ supabase, session, isReady, signOut, refreshSession }),
    [supabase, session, isReady, signOut, refreshSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
