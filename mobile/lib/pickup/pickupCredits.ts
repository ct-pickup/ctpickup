import type { SupabaseClient } from "@supabase/supabase-js";
import { addUserToRunBanterRoom } from "@/lib/chat/runBanterRoom";
import { ensurePickupRunInviteLink } from "@/lib/pickup/ensureRunInviteLink";
import { notifyFollowersWhenFollowedPlayerConfirmsRun } from "@/lib/pickup/notifyFollowersOnPickupConfirm";
import { deletePendingWaitlistExpiringReminders } from "@/lib/pickup/waitlist";

export type PickupCreditReason =
  | "referral"
  | "monthly_pod"
  | "monthly_attendance"
  | "cancellation";

export type PickupCreditRow = {
  id: string;
  user_id: string;
  amount_cents: number | null;
  discount_pct: number | null;
  reason: PickupCreditReason;
  awarded_at: string;
  expires_at: string;
  used_at: string | null;
  run_id: string | null;
};

const REASON_PRIORITY: PickupCreditReason[] = [
  "cancellation",
  "monthly_pod",
  "monthly_attendance",
  "referral",
];

function reasonRank(reason: string): number {
  const i = REASON_PRIORITY.indexOf(reason as PickupCreditReason);
  return i === -1 ? 99 : i;
}

export function isFreeRunCredit(row: PickupCreditRow): boolean {
  if (row.discount_pct != null && row.discount_pct > 0) return false;
  return true;
}

export function isDiscountCredit(row: PickupCreditRow): boolean {
  return row.discount_pct != null && row.discount_pct > 0;
}

export function discountMultiplier(row: PickupCreditRow): number {
  const pct = Number(row.discount_pct ?? 0);
  if (!Number.isFinite(pct) || pct <= 0) return 1;
  return Math.max(0, 1 - pct / 100);
}

export async function listActivePickupCredits(
  admin: SupabaseClient,
  userId: string,
): Promise<PickupCreditRow[]> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("pickup_credits")
    .select("id,user_id,amount_cents,discount_pct,reason,awarded_at,expires_at,used_at,run_id")
    .eq("user_id", userId)
    .is("used_at", null)
    .gt("expires_at", now);

  if (error) throw error;
  const rows = (data || []) as PickupCreditRow[];
  return rows.sort((a, b) => reasonRank(a.reason) - reasonRank(b.reason));
}

export async function findBestUnusedPickupCredit(
  admin: SupabaseClient,
  userId: string,
): Promise<PickupCreditRow | null> {
  const rows = await listActivePickupCredits(admin, userId);
  return rows[0] ?? null;
}

export async function markPickupCreditUsed(
  admin: SupabaseClient,
  creditId: string,
  runId: string,
): Promise<void> {
  await admin
    .from("pickup_credits")
    .update({
      used_at: new Date().toISOString(),
      run_id: runId,
    })
    .eq("id", creditId)
    .is("used_at", null);
}

export type PickupCreditApplyResult =
  | { applied: false }
  | { applied: true; kind: "free"; creditId: string; message: string }
  | { applied: true; kind: "discount"; creditId: string; discountedFeeCents: number; message: string };

/**
 * Applies the best available pickup credit (table + legacy profile counter).
 * Free credits are consumed immediately; discount credits are returned for Stripe checkout.
 */
export async function tryApplyPickupCreditToJoin(
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
): Promise<PickupCreditApplyResult> {
  if (opts.feeCents <= 0) return { applied: false };

  let credit = await findBestUnusedPickupCredit(admin, opts.payerUserId);

  if (!credit) {
    const legacy = await tryConsumeLegacyReferralCredit(admin, opts.payerUserId);
    if (!legacy) return { applied: false };
    await confirmPickupRsvpWithCredit(admin, opts);
    return {
      applied: true,
      kind: "free",
      creditId: "legacy",
      message: "1 free run credit applied",
    };
  }

  if (isDiscountCredit(credit)) {
    const mult = discountMultiplier(credit);
    const discounted = Math.max(0, Math.round(opts.feeCents * mult));
    if (discounted <= 0) {
      await markPickupCreditUsed(admin, credit.id, opts.runId);
      await confirmPickupRsvpWithCredit(admin, opts);
      return {
        applied: true,
        kind: "free",
        creditId: credit.id,
        message: `${credit.discount_pct}% off credit applied`,
      };
    }
    return {
      applied: true,
      kind: "discount",
      creditId: credit.id,
      discountedFeeCents: discounted,
      message: `${credit.discount_pct}% off your next run`,
    };
  }

  await markPickupCreditUsed(admin, credit.id, opts.runId);
  await confirmPickupRsvpWithCredit(admin, opts);
  return {
    applied: true,
    kind: "free",
    creditId: credit.id,
    message: "1 free run credit applied",
  };
}

async function tryConsumeLegacyReferralCredit(
  admin: SupabaseClient,
  payerUserId: string,
): Promise<boolean> {
  const { data: prof } = await admin
    .from("profiles")
    .select("referral_credits")
    .eq("id", payerUserId)
    .maybeSingle();

  const credits = Number(prof?.referral_credits ?? 0);
  if (!Number.isFinite(credits) || credits <= 0) return false;

  const consumed = await admin.rpc("consume_referral_credit", { p_user_id: payerUserId });
  return !consumed.error && consumed.data === true;
}

async function confirmPickupRsvpWithCredit(
  admin: SupabaseClient,
  opts: {
    targetUserId: string;
    runId: string;
    tierAtTime: string | null;
    previousRsvpStatus: string | null;
    hadPendingConfirm: boolean;
  },
): Promise<void> {
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
      console.error("pickup_rsvp_credit_follower_notify_error:", msg);
    }
  }
}

/** @deprecated Use tryApplyPickupCreditToJoin */
export const tryApplyReferralCreditToPickupJoin = tryApplyPickupCreditToJoin;
