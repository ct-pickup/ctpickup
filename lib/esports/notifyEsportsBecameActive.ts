import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchApprovedUserIds } from "@/lib/push/approvedUserIds";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";

/** Sends when status transitions into `active` from any other value. Best-effort (never throws). */
export async function notifyEsportsBecameActive(
  admin: SupabaseClient,
  tournamentId: string,
  prevStatus: string | null | undefined,
  nextStatus: string,
): Promise<void> {
  if (nextStatus !== "active" || prevStatus === "active") return;
  const idsRes = await fetchApprovedUserIds(admin);
  if ("error" in idsRes) return;
  await sendPushToUsers(admin, idsRes.ids, {
    title: "Esports tournament live",
    body: "A new esports tournament is active. Register now — $10 entry fee.",
    data: { kind: "esports_tournament_live", tournament_id: tournamentId },
  });
}
