import type { SupabaseClient } from "@supabase/supabase-js";
import { addUserToRunBanterRoom } from "@/lib/chat/runBanterRoom";
import { ensurePickupRunInviteLink } from "@/lib/pickup/ensureRunInviteLink";
import { notifyFollowersWhenFollowedPlayerConfirmsRun } from "@/lib/pickup/notifyFollowersOnPickupConfirm";
import { deletePendingWaitlistExpiringReminders } from "@/lib/pickup/waitlist";

export type ReferralCreditPickupResult =
  | { applied: false }
  | { applied: true; message: string };

/**
 * If the payer has referral credits, confirm the RSVP without Stripe and consume one credit.
 */
export async function tryApplyReferralCreditToPickupJoin(
  admin: SupabaseClient,
  opts: {
    payerUserId: string;
    targetUserId: string;
    runId: string;
    tierAtTime: string | null;
    feeCents: number;
    previousRsvpStatus: string | null;
    hadPendingConfirm: boolean;
  },
): Promise<ReferralCreditPickupResult> {
  if (opts.feeCents <= 0) return { applied: false };

  const { data: prof } = await admin
    .from("profiles")
    .select("referral_credits")
    .eq("id", opts.payerUserId)
    .maybeSingle();

  const credits = Number(prof?.referral_credits ?? 0);
  if (!Number.isFinite(credits) || credits <= 0) return { applied: false };

  const consumed = await admin.rpc("consume_referral_credit", { p_user_id: opts.payerUserId });
  if (consumed.error || consumed.data !== true) {
    return { applied: false };
  }

  const prevRsvpStatus = opts.previousRsvpStatus;
  await admin.from("pickup_run_rsvps").upsert(
    {
      run_id: opts.runId,
      user_id: opts.targetUserId,
      tier_at_time: opts.tierAtTime,
      status: "confirmed",
      checkout_session_id: null,
      waitlist_position: null,
      waitlist_offered_at: null,
      waitlist_expires_at: null,
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "run_id,user_id" },
  );

  if (opts.hadPendingConfirm) {
    await deletePendingWaitlistExpiringReminders(admin, opts.targetUserId, opts.runId);
  }

  await ensurePickupRunInviteLink(admin, opts.runId, opts.targetUserId);
  await addUserToRunBanterRoom(admin, opts.runId, opts.targetUserId);

  if (prevRsvpStatus !== "confirmed") {
    try {
      await notifyFollowersWhenFollowedPlayerConfirmsRun(admin, {
        runId: opts.runId,
        playerId: opts.targetUserId,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("pickup_rsvp_referral_credit_follower_notify_error:", msg);
    }
  }

  return { applied: true, message: "1 free run credit applied" };
}
