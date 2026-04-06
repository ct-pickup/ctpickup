import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Whether the optional admin publish / audit tables from migration
 * `20260410120000_admin_publish_sync.sql` are reachable.
 */
export async function isPublishLayerAvailable(supabase: SupabaseClient): Promise<boolean> {
  const { error } = await supabase.from("admin_publications").select("id").limit(1);
  if (!error) return true;
  const msg = error.message || "";
  if (/relation|does not exist|schema cache|not find the table/i.test(msg)) return false;
  return true;
}
