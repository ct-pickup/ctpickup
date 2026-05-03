import "react-native-url-polyfill/auto";

import { appAsyncStorage } from "@/lib/appAsyncStorage";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { hasSupabaseEnv } from "@/lib/env";

/**
 * One shared client for the whole app so session recovery, refresh, and
 * AsyncStorage stay in a single GoTrue instance (avoids duplicate listeners / races).
 */
let clientSingleton: SupabaseClient | null = null;

function createMobileSupabaseClient(): SupabaseClient {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anon) {
    throw new Error("Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY");
  }
  return createClient(url, anon, {
    auth: {
      storage: appAsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
}

export function getMobileSupabaseClient(): SupabaseClient | null {
  if (!hasSupabaseEnv()) return null;
  if (!clientSingleton) {
    try {
      clientSingleton = createMobileSupabaseClient();
    } catch {
      return null;
    }
  }
  return clientSingleton;
}

export function tryCreateMobileSupabaseClient() {
  return getMobileSupabaseClient();
}
