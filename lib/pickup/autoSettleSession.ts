import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";

export type AutoSettleResult = {
  settled: boolean;
  already_settled?: boolean;
  error?: string;
  rows?: number | null;
};

/**
 * Fill null organizer scores with neutral 5, settle the tier session, and
 * notify attendees that ratings updated.
 */
export async function autoSettleTierSession(
  admin: SupabaseClient,
  tier_session_id: string,
): Promise<AutoSettleResult> {
  const { data: ts, error: tsErr } = await admin
    .from("tier_sessions")
    .select("id,state")
    .eq("id", tier_session_id)
    .maybeSingle();

  if (tsErr) return { settled: false, error: tsErr.message };
  if (!ts) return { settled: false, error: "Tier session not found" };
  if (ts.state === "settled") return { settled: false, already_settled: true };

  // Neutral default so settle_session can include every attended player.
  const { error: scoreErr } = await admin
    .from("session_attendance")
    .update({ organizer_score: 5 })
    .eq("session_id", tier_session_id)
    .eq("status", "attended")
    .is("organizer_score", null);

  if (scoreErr) {
    console.error("[autoSettleTierSession] default scores", scoreErr.message);
    return { settled: false, error: scoreErr.message };
  }

  const { data: settleRows, error: settleErr } = await admin.rpc("settle_session", {
    p_session_id: tier_session_id,
  });

  if (settleErr) {
    console.error("[autoSettleTierSession] settle_session", settleErr.message, {
      tier_session_id,
    });
    return { settled: false, error: settleErr.message };
  }

  const { data: attendees } = await admin
    .from("session_attendance")
    .select("user_id")
    .eq("session_id", tier_session_id)
    .eq("status", "attended");

  const recipientIds = Array.from(
    new Set(
      ((attendees ?? []) as Array<{ user_id: string | null }>)
        .map((a) => a.user_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  if (recipientIds.length > 0) {
    await sendPushToUsers(admin, recipientIds, {
      title: "Your rating has been updated",
      body: "Check your tier progress in Rankings",
      data: { screen: "leaderboards" },
    });
  }

  return {
    settled: true,
    rows: typeof settleRows === "number" ? settleRows : null,
  };
}
