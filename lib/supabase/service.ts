import { createClient } from "@supabase/supabase-js";

// SERVER ONLY: uses SUPABASE_SERVICE_ROLE_KEY
export function supabaseService() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url?.trim()) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  }
  if (!service?.trim()) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, service, { auth: { persistSession: false } });
}
