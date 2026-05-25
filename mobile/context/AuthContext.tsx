import { authRouteRef } from "@/lib/authRouteRef";
import { clearStoredPin } from "@/lib/appLock";
import { establishRecoverySession, isResetPasswordDeepLink } from "@/lib/authDeepLink";
import { clearBiometricSignIn } from "@/lib/biometricSignIn";
import { getPostAuthHref } from "@/lib/onboarding";
import { getMobileSupabaseClient } from "@/lib/supabase";
import * as Sentry from "@sentry/react-native";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import * as Linking from "expo-linking";
import { router, useNavigationContainerRef } from "expo-router";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export const SESSION_EXPIRED_MESSAGE = "Your session expired. Please sign in again.";

function isExpiredRefreshTokenError(error: unknown): boolean {
  if (!error) return false;
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error);
  return message.includes("Refresh Token Not Found") || message.includes("Invalid Refresh Token");
}

function consoleErrorArgIsExpiredRefreshToken(arg: unknown): boolean {
  if (isExpiredRefreshTokenError(arg)) return true;
  if (arg && typeof arg === "object" && "message" in arg) {
    return isExpiredRefreshTokenError(arg);
  }
  return false;
}

type AuthContextValue = {
  supabase: SupabaseClient | null;
  session: Session | null;
  isReady: boolean;
  signOut: () => Promise<void>;
  /** Re-read session from Supabase (e.g. after verifyOtp) so React state matches storage on all devices. */
  refreshSession: () => Promise<void>;
  sessionExpiredNotice: string | null;
  clearSessionExpiredNotice: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [sessionExpiredNotice, setSessionExpiredNotice] = useState<string | null>(null);
  const navigationRef = useNavigationContainerRef();
  const replaceTabsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const signOutInProgressRef = useRef(false);
  const sessionExpireHandlingRef = useRef(false);
  const hadSessionRef = useRef(false);

  const clearSessionExpiredNotice = useCallback(() => {
    setSessionExpiredNotice(null);
  }, []);

  const redirectToLoginIfNeeded = useCallback(() => {
    const path = authRouteRef.current;
    const onLoginScreen = path === "/login" || path.endsWith("/login");
    if (onLoginScreen || !navigationRef.isReady()) return;
    router.replace("/login");
  }, [navigationRef]);

  const handleExpiredSession = useCallback(
    async (client: SupabaseClient) => {
      if (sessionExpireHandlingRef.current || signOutInProgressRef.current) return;
      sessionExpireHandlingRef.current = true;
      setSessionExpiredNotice(SESSION_EXPIRED_MESSAGE);
      setSession(null);
      try {
        try {
          await clearStoredPin();
        } catch (e) {
          console.warn("[auth] clearStoredPin failed during session expiry:", e);
          Sentry.captureException(e);
        }
        try {
          await clearBiometricSignIn();
        } catch (e) {
          console.warn("[auth] clearBiometricSignIn failed during session expiry:", e);
          Sentry.captureException(e);
        }
        await client.auth.signOut({ scope: "local" });
      } catch {
        // Expected when refresh token is already gone.
      } finally {
        sessionExpireHandlingRef.current = false;
      }
      redirectToLoginIfNeeded();
    },
    [redirectToLoginIfNeeded],
  );

  useEffect(() => {
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      if (args.some((arg) => consoleErrorArgIsExpiredRefreshToken(arg))) return;
      originalConsoleError(...args);
    };
    return () => {
      console.error = originalConsoleError;
    };
  }, []);

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
      if ((event as string) === "TOKEN_REFRESHED_FAILED") {
        setTimeout(() => {
          void handleExpiredSession(client);
        }, 0);
        return;
      }

      if (event === "SIGNED_OUT") {
        const hadSession = hadSessionRef.current;
        hadSessionRef.current = false;
        setSession(null);
        if (!signOutInProgressRef.current && hadSession) {
          setSessionExpiredNotice(SESSION_EXPIRED_MESSAGE);
          redirectToLoginIfNeeded();
        }
        return;
      }

      if (next?.user?.email) {
        hadSessionRef.current = true;
      }
      setSession(next);
      if (event === "SIGNED_IN") {
        setSessionExpiredNotice(null);
      }
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
            void (async () => {
              const href = await getPostAuthHref();
              router.replace(href);
            })();
          }, 100);
        }
      }
    });

    void (async () => {
      try {
        const { data, error } = await client.auth.getSession();
        if (error && isExpiredRefreshTokenError(error)) {
          await handleExpiredSession(client);
          return;
        }
        if (error) {
          console.warn("[auth] getSession failed:", error);
          Sentry.captureException(error);
        }
        if (data.session?.user?.email) {
          hadSessionRef.current = true;
        }
        setSession(data.session ?? null);
      } catch (e) {
        if (isExpiredRefreshTokenError(e)) {
          await handleExpiredSession(client);
          return;
        }
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
  }, [navigationRef, handleExpiredSession, redirectToLoginIfNeeded]);

  useEffect(() => {
    if (!supabase) return;

    async function handleAuthDeepLink(url: string) {
      if (!isResetPasswordDeepLink(url)) return;

      try {
        await establishRecoverySession(supabase, url);
      } catch (e) {
        console.warn("[auth] establishRecoverySession threw", e);
        Sentry.captureException(e);
      }

      const path = authRouteRef.current;
      if (path === "/reset-password" || path.endsWith("/reset-password")) return;
      router.push("/reset-password");
    }

    void Linking.getInitialURL().then((initial) => {
      if (initial) void handleAuthDeepLink(initial);
    });

    const sub = Linking.addEventListener("url", (event) => {
      void handleAuthDeepLink(event.url);
    });

    return () => sub.remove();
  }, [supabase]);

  const refreshSession = useCallback(async () => {
    if (!supabase) return;
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error && isExpiredRefreshTokenError(error)) {
        await handleExpiredSession(supabase);
        return;
      }
      if (error) {
        console.warn("[auth] refreshSession getSession failed:", error);
        Sentry.captureException(error);
        return;
      }
      setSession(data.session ?? null);
    } catch (e) {
      if (isExpiredRefreshTokenError(e)) {
        await handleExpiredSession(supabase);
        return;
      }
      console.warn("[auth] refreshSession getSession failed:", e);
      Sentry.captureException(e);
    }
  }, [supabase, handleExpiredSession]);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    signOutInProgressRef.current = true;
    clearSessionExpiredNotice();
    // Remove the device passcode first so it can't lock the next user on a shared device.
    try {
      await clearStoredPin();
    } catch (e) {
      console.warn("[auth] clearStoredPin failed during signOut:", e);
      Sentry.captureException(e);
    }
    try {
      await clearBiometricSignIn();
    } catch (e) {
      console.warn("[auth] clearBiometricSignIn failed during signOut:", e);
      Sentry.captureException(e);
    }
    try {
      await supabase.auth.signOut();
    } finally {
      queueMicrotask(() => {
        signOutInProgressRef.current = false;
      });
    }
  }, [supabase, clearSessionExpiredNotice]);

  const value = useMemo(
    () => ({
      supabase,
      session,
      isReady,
      signOut,
      refreshSession,
      sessionExpiredNotice,
      clearSessionExpiredNotice,
    }),
    [supabase, session, isReady, signOut, refreshSession, sessionExpiredNotice, clearSessionExpiredNotice],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
