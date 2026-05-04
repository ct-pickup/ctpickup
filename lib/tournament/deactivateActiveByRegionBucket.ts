import type { SupabaseClient } from "@supabase/supabase-js";

/** Deactivate active tournaments in the same `service_region` bucket (`null` = only rows with null region). */
export async function deactivateActiveTournamentsInRegionBucket(
  svc: SupabaseClient,
  serviceRegion: string | null,
): Promise<{ error: { message: string } | null }> {
  let q = svc.from("tournaments").update({ is_active: false }).eq("is_active", true);
  if (serviceRegion === null || serviceRegion === "") {
    q = q.is("service_region", null);
  } else {
    q = q.eq("service_region", serviceRegion);
  }
  const { error } = await q;
  return { error };
}
