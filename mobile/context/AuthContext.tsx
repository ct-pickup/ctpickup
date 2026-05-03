import { getMobileSupabaseClient } from "@/lib/supabase";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type AuthContextValue = {
  supabase: SupabaseClient | null;
  session: Session | null;
  isReady: boolean;
  signOut: () => Promise<void>;
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
    } = client.auth.onAuthStateChange((_event, next) => {
      setSession(next);
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

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  }, [supabase]);

  const value = useMemo(
    () => ({ supabase, session, isReady, signOut }),
    [supabase, session, isReady, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
