/** Supabase public URL + anon key only — safe to import from Edge (proxy) without `next/headers`. */
export function getSupabasePublicEnv(): { url: string; anonKey: string } | null {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    process.env.SUPABASE_URL?.trim() ||
    "";
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    process.env.SUPABASE_ANON_KEY?.trim() ||
    "";

  if (!url || !anonKey) return null;
  return { url, anonKey };
}
