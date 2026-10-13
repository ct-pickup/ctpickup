/**
 * Production/staging site origin (same host as the Next.js deployment).
 * Used for `/api/*` routes (pickup, push token registration).
 */
export function siteOrigin(): string | null {
  const raw = process.env.EXPO_PUBLIC_SITE_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/$/, "");
}

export function hasSupabaseEnv(): boolean {
  return Boolean(process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() && process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim());
}

/** Host of the Supabase project this build talks to (never the keys). Shown to admins so a dev build is obvious. */
export function supabaseHost(): string | null {
  const raw = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).host;
  } catch {
    return null;
  }
}
