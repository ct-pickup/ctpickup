import type { SupabaseClient } from "@supabase/supabase-js";

/** Staff accounts that receive tournament / operations alerts. */
export async function fetchAdminUserIds(admin: SupabaseClient): Promise<{ ids: string[] } | { error: string }> {
  const res = await admin.from("profiles").select("id").eq("is_admin", true);
  if (res.error) return { error: res.error.message };
  const ids = (res.data ?? [])
    .map((p) => (p as { id: string }).id)
    .filter((id) => typeof id === "string" && id.length > 0);
  return { ids };
}
