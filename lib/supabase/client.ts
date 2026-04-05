import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let cache: SupabaseClient | null = null;

/**
 * Returns a browser singleton client, or null if not in the browser or env is not set.
 * Safe from client effects and lazy handlers; never throws for missing env.
 */
export function trySupabaseBrowser(): SupabaseClient | null {
  if (typeof window === "undefined") return null;
  if (cache) return cache;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anon) return null;
  cache = createBrowserClient(url, anon);
  return cache;
}

/**
 * Browser-only Supabase client (singleton). Safe to call from `useEffect`, click handlers,
 * etc. Do not call during SSR/render (e.g. not inside `useMemo` without a client guard).
 * Throws if not in the browser or if public Supabase env vars are missing.
 */
export function supabaseBrowser(): SupabaseClient {
  if (typeof window === "undefined") {
    throw new Error("supabaseBrowser() must only run in the browser");
  }
  const client = trySupabaseBrowser();
  if (!client) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }
  return client;
}
