import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cancelAllPickupRsvpsAndIssueCancellationCredits,
  type CancelPickupRunRsvpsResult,
} from "@/lib/pickup/cancellationCreditsOnRunCancel";

/** @deprecated Use cancelAllPickupRsvpsAndIssueCancellationCredits */
export async function cancelAllPickupRsvpsAndRefundPaidConfirmed(
  supabaseAdmin: SupabaseClient,
  runId: string,
): Promise<{ refunded: string[]; failed: { user_id: string; error: string }[] }> {
  const result = await cancelAllPickupRsvpsAndIssueCancellationCredits(supabaseAdmin, runId);
  return {
    refunded: result.credited,
    failed: result.creditFailed,
  };
}

export { cancelAllPickupRsvpsAndIssueCancellationCredits, type CancelPickupRunRsvpsResult };
