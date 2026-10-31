import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";

import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import { assertPlansTestKey } from "@/lib/plans/stripePlans";
import { formatRequestWhen } from "@/shared/fields/requestEmail";

/** The one Stripe call the refund needs, so tests can swap it. */
export type RefundStripe = {
  refunds: { create(params: { payment_intent: string }, options?: { idempotencyKey?: string }): Promise<unknown> };
};

export type SeasonRefundResult =
  | { kind: "none" } // no paid season purchase on this request: nothing to refund
  | { kind: "already" } // already refunded earlier
  | { kind: "refunded"; purchaseId: string; userId: string }
  | { kind: "failed"; message: string };

export const SEASON_REFUND_FAILED_MESSAGE = "The refund didn't go through, so the request was left as it was. Try again, or refund it in the Stripe dashboard.";

/** Stripe's answer when the charge was already refunded (for example by hand in the dashboard). That is the outcome we want. */
function alreadyRefunded(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "charge_already_refunded";
}

/**
 * Refunds, in full, the paid season purchase tied to a request that is being declined, and marks it 'refunded'.
 * Safe to call again: the idempotency key is per purchase, a purchase already 'refunded' returns "already", and a
 * Stripe "charge_already_refunded" counts as success. The purchase is only marked refunded after Stripe accepts the refund.
 * Never throws; a failure comes back as { kind: "failed" } so the caller can show it and leave the request alone.
 */
export async function refundSeasonForRequest(
  admin: SupabaseClient,
  requestId: string,
  makeStripe: () => RefundStripe = () => new Stripe(assertPlansTestKey()) as unknown as RefundStripe,
): Promise<SeasonRefundResult> {
  const { data, error } = await admin
    .from("season_purchases")
    .select("id,user_id,status,stripe_payment_intent_id")
    .eq("venue_request_id", requestId);
  if (error) return { kind: "failed", message: SEASON_REFUND_FAILED_MESSAGE };

  const rows = (data ?? []) as { id: string; user_id: string; status: string; stripe_payment_intent_id: string | null }[];
  const paid = rows.find((r) => r.status === "paid");
  if (!paid) return rows.some((r) => r.status === "refunded") ? { kind: "already" } : { kind: "none" };

  // Paid but no payment to refund against: do not guess. Block so the admin can look at it.
  if (!paid.stripe_payment_intent_id) return { kind: "failed", message: "This season has no payment on record to refund. Refund it in the Stripe dashboard." };

  try {
    await makeStripe().refunds.create({ payment_intent: paid.stripe_payment_intent_id }, { idempotencyKey: `season-refund:${paid.id}` });
  } catch (e) {
    if (!alreadyRefunded(e)) {
      console.error("[season-refund] stripe refund failed", paid.id, e instanceof Error ? e.message : e);
      return { kind: "failed", message: SEASON_REFUND_FAILED_MESSAGE };
    }
  }

  const { error: updErr } = await admin.from("season_purchases").update({ status: "refunded" }).eq("id", paid.id);
  if (updErr) {
    console.error("[season-refund] refunded in Stripe but could not mark the purchase", paid.id, updErr.message);
    return { kind: "failed", message: "The money was refunded in Stripe, but we could not record it. Try Decline again; it will not refund twice." };
  }
  return { kind: "refunded", purchaseId: paid.id, userId: paid.user_id };
}

/** Plain push telling the player their season money is on its way back. Always sent (it is about money). Never throws. */
export async function pushSeasonRefund(
  admin: SupabaseClient,
  requestId: string,
  req: { user_id: string; venue_key: string; requested_date: string; start_time: string; duration_hours: number },
): Promise<void> {
  try {
    const { data: venue } = await admin.from("venues").select("name").eq("venue_key", req.venue_key).maybeSingle();
    const name = (venue as { name?: string } | null)?.name ?? "The venue";
    const when = formatRequestWhen(req.requested_date, req.start_time, Number(req.duration_hours));
    await sendPushToUsers(admin, [req.user_id], {
      title: "Your season is refunded",
      body: `${name} couldn't offer ${when}. Your money is on its way back to your card. It can take a few days to show up.`,
      data: { screen: "field-requests", request_id: requestId },
    });
  } catch (e) {
    console.error("[season-refund] player push failed", e);
  }
}
