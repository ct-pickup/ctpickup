import { createClient } from "@supabase/supabase-js";

function getSupabaseServiceEnv(): { url: string; service: string } | null {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    process.env.SUPABASE_URL?.trim() ||
    "";
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  if (!url || !service) return null;
  return { url, service };
}

// SERVER ONLY: uses SUPABASE_SERVICE_ROLE_KEY
export function trySupabaseService() {
  const env = getSupabaseServiceEnv();
  if (!env) return null;
  return createClient(env.url, env.service, { auth: { persistSession: false } });
}

export function supabaseService() {
  const env = getSupabaseServiceEnv();
  if (!env) {
    throw new Error(
      "Missing Supabase service env. Set NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  return createClient(env.url, env.service, { auth: { persistSession: false } });
}
