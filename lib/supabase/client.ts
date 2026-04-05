import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-only Supabase client. Call from `useEffect` or event handlers — not during
 * render/`useMemo`, or static prerender / SSR can invoke @supabase/ssr without a real browser env.
 */
export function supabaseBrowser() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url?.trim() || !anon?.trim()) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }
  return createBrowserClient(url, anon);
}
