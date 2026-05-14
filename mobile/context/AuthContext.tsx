import { authRouteRef } from "@/lib/authRouteRef";
import { clearStoredPin } from "@/lib/appLock";
import { getMobileSupabaseClient } from "@/lib/supabase";
import * as Sentry from "@sentry/react-native";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { router, useNavigationContainerRef } from "expo-router";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

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
  const navigationRef = useNavigationContainerRef();
  const replaceTabsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
          if (!navigationRef.isReady()) return;
          if (replaceTabsTimeoutRef.current !== null) {
            clearTimeout(replaceTabsTimeoutRef.current);
          }
          replaceTabsTimeoutRef.current = setTimeout(() => {
            replaceTabsTimeoutRef.current = null;
            router.replace("/(tabs)");
          }, 100);
        }
      }
    });

    void (async () => {
      try {
        const { data } = await client.auth.getSession();
        setSession(data.session ?? null);
      } catch (e) {
        console.warn("[auth] getSession failed:", e);
        Sentry.captureException(e);
      } finally {
        setIsReady(true);
      }
    })();

    return () => {
      subscription.unsubscribe();
      if (replaceTabsTimeoutRef.current !== null) {
        clearTimeout(replaceTabsTimeoutRef.current);
        replaceTabsTimeoutRef.current = null;
      }
    };
  }, [navigationRef]);

  const refreshSession = useCallback(async () => {
    if (!supabase) return;
    try {
      const { data } = await supabase.auth.getSession();
      setSession(data.session ?? null);
    } catch (e) {
      console.warn("[auth] refreshSession getSession failed:", e);
      Sentry.captureException(e);
    }
  }, [supabase]);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    // Remove the device passcode first so it can't lock the next user on a shared device.
    try {
      await clearStoredPin();
    } catch (e) {
      console.warn("[auth] clearStoredPin failed during signOut:", e);
      Sentry.captureException(e);
    }
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
