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
    const err = error as {
      message?: string;
      code?: string;
      details?: string | null;
      hint?: string | null;
    };
    console.error(
      "[waiver] check:",
      JSON.stringify({
        message: err.message,
        code: err.code,
        details: err.details,
        hint: err.hint,
      })
    );
    return false;
  }
  return !!data;
}
