import { supabaseService } from "@/lib/supabase/service";
import { CURRENT_WAIVER_VERSION } from "@/lib/waiver/constants";

/**
 * Server-only: true if the user has a row for the current waiver version.
 */
export async function userHasAcceptedCurrentWaiver(userId: string): Promise<boolean> {
  const svc = supabaseService();
  const { data, error } = await svc
    .from("user_waiver_acceptance")
    .select("id")
    .eq("user_id", userId)
    .eq("version", CURRENT_WAIVER_VERSION)
    .maybeSingle();

  if (error) {
    console.error("[waiver] check:", error.message);
    return false;
  }
  return !!data;
}
