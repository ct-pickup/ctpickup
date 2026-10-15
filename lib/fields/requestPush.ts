import type { SupabaseClient } from "@supabase/supabase-js";

import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import { formatRequestWhen, playerStatusPush, type RequestStatus } from "@/shared/fields/requestEmail";

/** Tells the player their field request changed status (unless they turned request updates off). Never throws. */
export async function pushRequestStatus(
  admin: SupabaseClient,
  requestId: string,
  prev: { user_id: string; venue_key: string; requested_date: string; start_time: string; duration_hours: number },
  next: RequestStatus,
): Promise<void> {
  try {
    const { data: venue } = await admin.from("venues").select("name").eq("venue_key", prev.venue_key).maybeSingle();
    const msg = playerStatusPush(next, (venue as { name?: string } | null)?.name ?? "the venue", formatRequestWhen(prev.requested_date, prev.start_time, Number(prev.duration_hours)));
    // Respect a player who turned request updates off (no row means on).
    const { data: pref } = await admin.from("alert_subscriptions").select("enabled").eq("user_id", prev.user_id).eq("alert_type", "request_updates").maybeSingle();
    const muted = (pref as { enabled?: boolean } | null)?.enabled === false;
    if (msg && !muted) await sendPushToUsers(admin, [prev.user_id], { ...msg, data: { screen: "field-requests", request_id: requestId } });
  } catch (e) {
    console.error("[field-requests] player push failed", e);
  }
}
