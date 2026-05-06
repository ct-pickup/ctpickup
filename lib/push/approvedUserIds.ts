import type { SupabaseClient } from "@supabase/supabase-js";

export async function fetchApprovedUserIds(admin: SupabaseClient): Promise<{ ids: string[] } | { error: string }> {
  const res = await admin.from("profiles").select("id").eq("approved", true);
  if (res.error) return { error: res.error.message };
  const ids = (res.data ?? []).map((p) => (p as { id: string }).id).filter((id) => typeof id === "string" && id.length > 0);
  return { ids };
}
