import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import type { PaymentLifecycleStatus } from "@/lib/payments/platformPaymentModel";

const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Deploy time of the pickup refund fix. Runs cancelled before this were settled by the old code
 * (or not at all, e.g. auto-cancel), so the host-cancel retry path must never act on them.
 */
export const REFUND_FIX_CUTOFF = "2026-10-02T14:20:00Z";

export function isOnOrAfterRefundFixCutoff(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t >= new Date(REFUND_FIX_CUTOFF).getTime();
}

/** A card payment only belongs to the current join when it settled close to when the RSVP was confirmed. */
const PAYMENT_MATCH_WINDOW_MS = 2 * 60 * 60 * 1000;
const CREDIT_MATCH_WINDOW_MS = 10 * 60 * 1000;

export type PickupChargeSnapshot = {
  paymentIntentId: string;
  paymentIntentStatus: string;
  amountReceivedCents: number;
  amountRefundedCents: number;
  chargeCreatedMs: number | null;
};

export type PickupRefundOutcome =
  | { kind: "refunded"; refundId: string; amountCents: number; refundStatus: string; recordError: string | null }
  | { kind: "already_refunded"; refundId: string | null; amountCents: number; recordError: string | null }
  | { kind: "nothing_charged" };

export function remainingRefundableCents(snap: Pick<PickupChargeSnapshot, "amountReceivedCents" | "amountRefundedCents">): number {
  return Math.max(0, Math.round(snap.amountReceivedCents) - Math.round(snap.amountRefundedCents));
}

/**
 * "pending" refunds were accepted by Stripe and settle without further action, so the player can be told
 * they were refunded. "failed", "canceled" and "requires_action" are not issued.
 */
export function isRefundIssued(status: string | null | undefined): boolean {
  return status === "succeeded" || status === "pending";
}

export function pickupRefundIdempotencyKey(runId: string, userId: string, paymentIntentId: string): string {
  return `refund:pickup:${runId}:${userId}:${paymentIntentId}`;
}

/** What the card was actually charged (field fee after credits plus photo package) and what was already refunded. */
export async function getPickupChargeSnapshot(stripe: Stripe, paymentIntentId: string): Promise<PickupChargeSnapshot> {
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
  const status = String(pi.status || "");
  const amountReceivedCents = status === "succeeded" ? Number(pi.amount_received ?? 0) || 0 : 0;
  if (amountReceivedCents <= 0) {
    return { paymentIntentId, paymentIntentStatus: status, amountReceivedCents: 0, amountRefundedCents: 0, chargeCreatedMs: null };
  }
  const charge = pi.latest_charge;
  if (!charge || typeof charge === "string") {
    throw new Error(`PaymentIntent ${paymentIntentId} has no expanded charge; cannot verify prior refunds.`);
  }
  return {
    paymentIntentId,
    paymentIntentStatus: status,
    amountReceivedCents,
    amountRefundedCents: Number(charge.amount_refunded ?? 0) || 0,
    chargeCreatedMs: typeof charge.created === "number" ? charge.created * 1000 : null,
  };
}

/**
 * Finds the PaymentIntent behind a pickup RSVP: the RSVP row, then the platform_payments row for that player
 * (payer's own row, or a row paid for them by a friend), then the checkout session.
 */
export async function findPickupPaymentIntentId(
  stripe: Stripe,
  admin: SupabaseClient,
  opts: { runId: string; userId: string; rsvpPaymentIntentId: string | null; checkoutSessionId: string | null },
): Promise<string | null> {
  const fromRsvp = opts.rsvpPaymentIntentId?.trim();
  if (fromRsvp) return fromRsvp;

  const { data, error } = await admin
    .from("platform_payments")
    .select("user_id,stripe_payment_intent_id,lifecycle_status,metadata,created_at")
    .eq("product_type", "pickup")
    .eq("product_entity_id", opts.runId)
    .in("lifecycle_status", ["payment_received", "refunded"])
    .not("stripe_payment_intent_id", "is", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`platform_payments lookup: ${error.message}`);
  for (const p of data || []) {
    const meta = (p.metadata && typeof p.metadata === "object" ? p.metadata : {}) as Record<string, unknown>;
    const paidFor = typeof meta.paid_for_user_id === "string" ? meta.paid_for_user_id : null;
    const forThisPlayer = paidFor ? paidFor === opts.userId : String(p.user_id) === opts.userId;
    if (forThisPlayer && p.stripe_payment_intent_id) return String(p.stripe_payment_intent_id);
  }

  if (opts.checkoutSessionId) {
    const cs = await stripe.checkout.sessions.retrieve(opts.checkoutSessionId);
    if (cs.status === "complete" && cs.payment_intent) {
      return typeof cs.payment_intent === "string" ? cs.payment_intent : cs.payment_intent.id;
    }
  }
  return null;
}

/**
 * Who paid the card charge for a player's spot: the friend whose platform_payments row names this player in
 * metadata.paid_for_user_id, otherwise the player.
 */
export async function findPickupPayerUserId(
  admin: SupabaseClient,
  opts: { playerId: string; paymentIntentId: string; checkoutSessionId: string | null },
): Promise<string> {
  const orFilter = [
    `stripe_payment_intent_id.eq.${opts.paymentIntentId}`,
    ...(opts.checkoutSessionId ? [`stripe_checkout_session_id.eq.${opts.checkoutSessionId}`] : []),
  ].join(",");
  const { data, error } = await admin
    .from("platform_payments")
    .select("user_id,metadata")
    .eq("product_type", "pickup")
    .or(orFilter);
  if (error) throw new Error(`platform_payments payer lookup: ${error.message}`);
  for (const p of data || []) {
    const meta = (p.metadata && typeof p.metadata === "object" ? p.metadata : {}) as Record<string, unknown>;
    const payer = String(p.user_id ?? "");
    if (meta.paid_for_user_id === opts.playerId && payer && payer !== opts.playerId) return payer;
  }
  return opts.playerId;
}

export type ChargeMatch = "current" | "already_compensated" | "unmatched";

/**
 * RSVP rows keep payment_intent_id across re-joins, so a charge may belong to an earlier join of the same run.
 * "already_compensated": a cancellation credit for this run was issued between the charge and the current
 * confirmation (an old leave/cancel converted that payment to credit before the player re-joined).
 * "unmatched": the charge did not confirm this RSVP; money must not move without manual review.
 * creditUserId is whoever an earlier leave credited for this charge (the friend who paid, else the player).
 */
export async function matchChargeToCurrentJoin(
  admin: SupabaseClient,
  opts: {
    runId: string;
    userId: string;
    creditUserId?: string;
    paidAtIso: string | null;
    snap: PickupChargeSnapshot;
    fromCurrentCheckout: boolean;
  },
): Promise<ChargeMatch> {
  if (opts.fromCurrentCheckout) return "current";
  const chargeMs = opts.snap.chargeCreatedMs;
  const paidMs = opts.paidAtIso ? new Date(opts.paidAtIso).getTime() : NaN;
  if (chargeMs == null || !Number.isFinite(paidMs)) return "unmatched";

  const { data, error } = await admin
    .from("pickup_credits")
    .select("id,awarded_at")
    .eq("user_id", opts.creditUserId ?? opts.userId)
    .eq("cancelled_run_id", opts.runId)
    .eq("reason", "cancellation");
  if (error) throw new Error(`pickup_credits lookup: ${error.message}`);
  for (const c of data || []) {
    const awardedMs = new Date(String(c.awarded_at)).getTime();
    if (Number.isFinite(awardedMs) && awardedMs >= chargeMs && awardedMs < paidMs) return "already_compensated";
  }

  return Math.abs(paidMs - chargeMs) <= PAYMENT_MATCH_WINDOW_MS ? "current" : "unmatched";
}

export async function recordPickupRefund(
  admin: SupabaseClient,
  opts: {
    runId: string;
    userId: string;
    paymentIntentId: string;
    checkoutSessionId: string | null;
    refundId: string | null;
    amountCents: number;
    trigger: string;
  },
): Promise<string | null> {
  const errors: string[] = [];
  const nowIso = new Date().toISOString();

  if (opts.refundId) {
    const { error } = await admin
      .from("pickup_run_rsvps")
      .update({ refund_id: opts.refundId, updated_at: nowIso })
      .eq("run_id", opts.runId)
      .eq("user_id", opts.userId);
    if (error) errors.push(`pickup_run_rsvps: ${error.message}`);
  }

  const orFilter = [
    `stripe_payment_intent_id.eq.${opts.paymentIntentId}`,
    ...(opts.checkoutSessionId ? [`stripe_checkout_session_id.eq.${opts.checkoutSessionId}`] : []),
  ].join(",");
  const { data: payments, error: selErr } = await admin
    .from("platform_payments")
    .select("id,metadata,refunded_at")
    .eq("product_type", "pickup")
    .or(orFilter);
  if (selErr) {
    errors.push(`platform_payments lookup: ${selErr.message}`);
  } else {
    for (const p of payments || []) {
      const prevMeta = (p.metadata && typeof p.metadata === "object" ? p.metadata : {}) as Record<string, unknown>;
      const lifecycle: PaymentLifecycleStatus = "refunded";
      const { error } = await admin
        .from("platform_payments")
        .update({
          lifecycle_status: lifecycle,
          refunded_at: p.refunded_at ?? nowIso,
          stripe_payment_intent_id: opts.paymentIntentId,
          metadata: {
            ...prevMeta,
            refund_id: opts.refundId,
            refund_amount_cents: opts.amountCents,
            refund_trigger: opts.trigger,
          },
          updated_at: nowIso,
        })
        .eq("id", p.id);
      if (error) errors.push(`platform_payments update: ${error.message}`);
    }
  }

  return errors.length ? errors.join("; ") : null;
}

/**
 * Refunds whatever is still refundable on a pickup charge. Retry-safe: an existing RSVP refund_id, a
 * platform_payments row already 'refunded', or Stripe amount_refunded >= amount_received all short-circuit,
 * and the Stripe call uses a deterministic idempotency key. Throws when Stripe rejects the refund or the
 * refund is not in an issued state.
 */
export async function refundPickupCharge(
  stripe: Stripe,
  admin: SupabaseClient,
  opts: {
    runId: string;
    userId: string;
    snap: PickupChargeSnapshot;
    checkoutSessionId: string | null;
    existingRefundId: string | null;
    trigger: string;
  },
): Promise<PickupRefundOutcome> {
  const { snap } = opts;
  const paymentIntentId = snap.paymentIntentId;
  const recordBase = { runId: opts.runId, userId: opts.userId, paymentIntentId, checkoutSessionId: opts.checkoutSessionId, trigger: opts.trigger };

  if (snap.amountReceivedCents <= 0) return { kind: "nothing_charged" };

  if (opts.existingRefundId) {
    const prior = await stripe.refunds.retrieve(opts.existingRefundId);
    const priorPi = typeof prior.payment_intent === "string" ? prior.payment_intent : prior.payment_intent?.id ?? null;
    if (priorPi === paymentIntentId && isRefundIssued(prior.status)) {
      const amountCents = Math.max(prior.amount, snap.amountRefundedCents);
      const recordError = await recordPickupRefund(admin, { ...recordBase, refundId: prior.id, amountCents });
      return { kind: "already_refunded", refundId: prior.id, amountCents, recordError };
    }
  }

  const { data: refundedRows, error: refundedErr } = await admin
    .from("platform_payments")
    .select("id,metadata")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .eq("lifecycle_status", "refunded");
  if (refundedErr) throw new Error(`platform_payments lookup: ${refundedErr.message}`);
  const alreadyMarkedRefunded = (refundedRows || []).length > 0;

  const remaining = remainingRefundableCents(snap);
  if (remaining <= 0 || alreadyMarkedRefunded) {
    if (snap.amountRefundedCents <= 0) {
      throw new Error(`platform_payments says refunded but Stripe shows no refund on ${paymentIntentId}; review manually.`);
    }
    const list = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 1 });
    const refundId = list.data[0]?.id ?? null;
    const recordError = await recordPickupRefund(admin, { ...recordBase, refundId, amountCents: snap.amountRefundedCents });
    return { kind: "already_refunded", refundId, amountCents: snap.amountRefundedCents, recordError };
  }

  const refund = await stripe.refunds.create(
    {
      payment_intent: paymentIntentId,
      amount: remaining,
      reason: "requested_by_customer",
      metadata: { kind: "pickup", run_id: opts.runId, user_id: opts.userId, trigger: opts.trigger },
    },
    { idempotencyKey: pickupRefundIdempotencyKey(opts.runId, opts.userId, paymentIntentId) },
  );
  if (!isRefundIssued(refund.status)) {
    throw new Error(`Stripe refund ${refund.id} is ${refund.status ?? "unknown"}, not issued.`);
  }

  const recordError = await recordPickupRefund(admin, { ...recordBase, refundId: refund.id, amountCents: refund.amount });
  return { kind: "refunded", refundId: refund.id, amountCents: refund.amount, refundStatus: String(refund.status), recordError };
}

export type PendingCheckoutSettlement =
  | { kind: "paid"; paymentIntentId: string }
  | { kind: "released"; checkoutExpired: boolean; paymentIntentCanceled: boolean };

const CANCELABLE_PI_STATUSES = new Set([
  "requires_payment_method",
  "requires_confirmation",
  "requires_action",
  "requires_capture",
]);

/**
 * Stops an unfinished pickup checkout so it can no longer charge the player: expires an open checkout session
 * and cancels an unfinished PaymentIntent. If the payment completed in the meantime, reports it as paid.
 */
export async function settlePendingPickupCheckout(
  stripe: Stripe,
  opts: { checkoutSessionId: string | null; paymentIntentId: string | null },
): Promise<PendingCheckoutSettlement> {
  let checkoutExpired = false;
  let paymentIntentId = opts.paymentIntentId?.trim() || null;

  if (opts.checkoutSessionId) {
    let cs = await stripe.checkout.sessions.retrieve(opts.checkoutSessionId);
    if (cs.status === "open") {
      try {
        cs = await stripe.checkout.sessions.expire(cs.id);
        checkoutExpired = true;
      } catch (e) {
        cs = await stripe.checkout.sessions.retrieve(opts.checkoutSessionId);
        if (cs.status === "open") throw e;
      }
    }
    const csPi = cs.payment_intent ? (typeof cs.payment_intent === "string" ? cs.payment_intent : cs.payment_intent.id) : null;
    if (cs.status === "complete") {
      if (cs.payment_status === "paid" && csPi) return { kind: "paid", paymentIntentId: csPi };
      throw new Error(`Checkout ${cs.id} is complete but payment is ${cs.payment_status}; try again shortly.`);
    }
    paymentIntentId = paymentIntentId || csPi;
  }

  let paymentIntentCanceled = false;
  if (paymentIntentId) {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.status === "succeeded") return { kind: "paid", paymentIntentId };
    if (pi.status === "processing") {
      throw new Error(`Payment ${paymentIntentId} is still processing; try again shortly.`);
    }
    if (CANCELABLE_PI_STATUSES.has(pi.status)) {
      await stripe.paymentIntents.cancel(paymentIntentId);
      paymentIntentCanceled = true;
    }
  }
  return { kind: "released", checkoutExpired, paymentIntentCanceled };
}

/** Marks the platform_payments row for an abandoned checkout as expired (only while it is still 'checkout_started'). */
export async function markPickupCheckoutExpired(admin: SupabaseClient, checkoutSessionId: string): Promise<void> {
  const lifecycle: PaymentLifecycleStatus = "checkout_expired";
  const { error } = await admin
    .from("platform_payments")
    .update({
      lifecycle_status: lifecycle,
      fulfillment_message: "Checkout cancelled because the player left or the session was cancelled.",
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_checkout_session_id", checkoutSessionId)
    .eq("lifecycle_status", "checkout_started");
  if (error) throw new Error(`platform_payments checkout_expired: ${error.message}`);
}

export type CreditCoverage = { cents: number; source: "credit_row" | "legacy_counter" | null; creditId: string | null };

/**
 * How much of the field fee a pickup credit covered for the current join. Only the credit consumed when this
 * RSVP was confirmed counts (used_at within minutes of paid_at); credits from earlier joins are ignored.
 * A credit-confirmed RSVP with no credit row was paid with the legacy profile counter (one free run).
 */
export async function pickupCreditCoverageForJoin(
  admin: SupabaseClient,
  opts: { runId: string; userId: string; paidAtIso: string | null; feeCents: number; hasCardPayment: boolean },
): Promise<CreditCoverage> {
  const none: CreditCoverage = { cents: 0, source: null, creditId: null };
  const fee = Math.max(0, Math.round(opts.feeCents));
  const paidMs = opts.paidAtIso ? new Date(opts.paidAtIso).getTime() : NaN;
  if (fee <= 0 || !Number.isFinite(paidMs)) return none;

  const { data, error } = await admin
    .from("pickup_credits")
    .select("id,amount_cents,discount_pct,used_at")
    .eq("user_id", opts.userId)
    .eq("run_id", opts.runId)
    .not("used_at", "is", null)
    .order("used_at", { ascending: false });
  if (error) throw new Error(`pickup_credits lookup: ${error.message}`);

  const match = (data || []).find((c) => {
    const usedMs = new Date(String(c.used_at)).getTime();
    return Number.isFinite(usedMs) && Math.abs(usedMs - paidMs) <= CREDIT_MATCH_WINDOW_MS;
  });
  if (match) {
    const pct = Number(match.discount_pct ?? 0);
    const amt = Number(match.amount_cents ?? 0);
    let cents: number;
    if (Number.isFinite(pct) && pct > 0) cents = Math.round((fee * Math.min(pct, 100)) / 100);
    else if (Number.isFinite(amt) && amt > 0) cents = Math.min(Math.round(amt), fee);
    else cents = fee;
    return { cents, source: "credit_row", creditId: String(match.id) };
  }
  if (!opts.hasCardPayment) return { cents: fee, source: "legacy_counter", creditId: null };
  return none;
}

export type CancellationCreditResult = { kind: "issued"; amountCents: number } | { kind: "already_exists" };

/** One cancellation credit per (player, run), enforced by pickup_credits_user_cancelled_run_unique. */
export async function issuePickupCancellationCredit(
  admin: SupabaseClient,
  opts: { userId: string; runId: string; amountCents: number },
): Promise<CancellationCreditResult> {
  const amountCents = Math.round(opts.amountCents);
  if (amountCents <= 0) throw new Error("Cancellation credit amount must be positive.");
  const { error } = await admin.from("pickup_credits").insert({
    user_id: opts.userId,
    amount_cents: amountCents,
    discount_pct: null,
    reason: "cancellation",
    expires_at: new Date(Date.now() + THREE_MONTHS_MS).toISOString(),
    cancelled_run_id: opts.runId,
  });
  if (error?.code === "23505") return { kind: "already_exists" };
  if (error) throw new Error(`pickup_credits insert: ${error.message}`);
  return { kind: "issued", amountCents };
}
