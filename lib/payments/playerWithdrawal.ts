import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import { pickupRefundCutoffMs } from "@/lib/pickup/runScheduling";
import {
  findPickupPayerUserId,
  findPickupPaymentIntentId,
  getPickupChargeSnapshot,
  issuePickupCancellationCredit,
  markPickupCheckoutExpired,
  matchChargeToCurrentJoin,
  pickupCreditCoverageForJoin,
  remainingRefundableCents,
  settlePendingPickupCheckout,
} from "@/lib/payments/pickupRefunds";
import { decidePickupRefund, refundWindowOpen, type RefundCredit } from "@/lib/payments/refundPolicy";

export type WithdrawalRun = {
  id: string;
  title: string | null;
  fee_cents: number | null;
  start_at: string | null;
  cancellation_deadline?: string | null;
};

export type WithdrawalRsvp = {
  status: string;
  paid_at: string | null;
  payment_intent_id: string | null;
  checkout_session_id: string | null;
};

export type WithdrawalPlan = {
  prevStatus: string;
  earlyEnough: boolean;
  checkoutReleased: boolean;
  fromCurrentCheckout: boolean;
  paymentIntentId: string | null;
  paidAt: string | null;
  checkoutSessionId: string | null;
  payerId: string;
  selfCredit: RefundCredit | null;
  payerCredit: RefundCredit | null;
};

export type WithdrawalResult = {
  plan: WithdrawalPlan;
  creditIssuedCents: number;
  alreadyCredited: boolean;
  payerCreditIssuedCents: number;
  payerAlreadyCredited: boolean;
  payerCreditNeedsReview: string | null;
  payerName: string | null;
  message: string;
  warnings: string[];
};

export type WithdrawalFailure = { ok: false; status: number; error: string };

type Ctx = {
  admin: SupabaseClient;
  getStripe: () => Stripe;
  run: WithdrawalRun;
  userId: string;
  /** When the player gave up the spot, for the 24-hour decision; an admin recording a cancellation sets it. Defaults to now. */
  cancelledAtMs?: number;
  sentryCtx: { tags: Record<string, string>; extra: Record<string, unknown> };
};

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * What a player gets back for giving up a confirmed or pending spot themselves (leave, or declining their own RSVP).
 * In preview mode nothing is mutated: a pending checkout is reported as released without being expired.
 */
export async function planPlayerWithdrawal(
  ctx: Ctx,
  rsvp: WithdrawalRsvp,
  opts: { preview: boolean },
): Promise<{ ok: true; plan: WithdrawalPlan } | WithdrawalFailure> {
  const { admin, getStripe, run, userId, sentryCtx } = ctx;
  const now = Date.now();
  const cancelledAt = ctx.cancelledAtMs ?? now;
  const earlyEnough = refundWindowOpen({ kickoffAt: run.start_at, refundCutoffAt: pickupRefundCutoffMs(run), now: cancelledAt });
  const prevStatus = String(rsvp.status);
  const checkoutSessionId = rsvp.checkout_session_id || null;
  let paidAt = rsvp.paid_at || null;
  let paymentIntentId: string | null = null;
  let fromCurrentCheckout = false;
  let checkoutReleased = false;

  try {
    if (prevStatus === "pending_payment") {
      if (!opts.preview && (checkoutSessionId || rsvp.payment_intent_id)) {
        const settled = await settlePendingPickupCheckout(getStripe(), {
          checkoutSessionId,
          paymentIntentId: rsvp.payment_intent_id || null,
        });
        if (settled.kind === "paid") {
          paymentIntentId = settled.paymentIntentId;
          fromCurrentCheckout = true;
          paidAt = paidAt ?? new Date(now).toISOString();
        } else {
          checkoutReleased = true;
        }
      } else {
        checkoutReleased = true;
      }
    } else if (earlyEnough && paidAt) {
      paymentIntentId = await findPickupPaymentIntentId(getStripe(), admin, {
        runId: run.id,
        userId,
        rsvpPaymentIntentId: rsvp.payment_intent_id || null,
        checkoutSessionId,
      });
    }
  } catch (e) {
    Sentry.captureException(e, { ...sentryCtx, extra: { ...sentryCtx.extra, checkout_session_id: checkoutSessionId } });
    return {
      ok: false,
      status: 502,
      error: `Could not check your payment with Stripe (${errMsg(e)}). You are still in the session. Try again.`,
    };
  }

  let cardCents = 0;
  let coverageCents = 0;
  let payerId = userId;
  if (earlyEnough && !checkoutReleased) {
    try {
      if (paymentIntentId) {
        const snap = await getPickupChargeSnapshot(getStripe(), paymentIntentId);
        if (snap.amountReceivedCents > 0) {
          payerId = await findPickupPayerUserId(admin, { playerId: userId, paymentIntentId, checkoutSessionId });
          const match = await matchChargeToCurrentJoin(admin, {
            runId: run.id,
            userId,
            creditUserId: payerId,
            paidAtIso: paidAt,
            snap,
            fromCurrentCheckout,
          });
          if (match === "unmatched" && remainingRefundableCents(snap) > 0) {
            throw new Error(`Card payment ${paymentIntentId} could not be matched to this spot.`);
          }
          if (match === "current") cardCents = remainingRefundableCents(snap);
        }
      }
      const coverage = await pickupCreditCoverageForJoin(admin, {
        runId: run.id,
        userId,
        paidAtIso: paidAt,
        feeCents: Number(run.fee_cents ?? 0),
        hasCardPayment: cardCents > 0,
      });
      coverageCents = coverage.cents;
    } catch (e) {
      Sentry.captureException(e, { ...sentryCtx, extra: { ...sentryCtx.extra, payment_intent_id: paymentIntentId } });
      return {
        ok: false,
        status: 502,
        error: "We could not verify what you paid for this session. You are still in the session. Try again or contact support.",
      };
    }
  }

  const decision = decidePickupRefund({
    initiator: "player",
    trigger: "leave",
    kickoffAt: run.start_at,
    refundCutoffAt: pickupRefundCutoffMs(run),
    now: cancelledAt,
    paymentPending: checkoutReleased,
    hasCardCharge: cardCents > 0,
    cardNetCents: cardCents,
    creditCoveredCents: coverageCents,
    playerId: userId,
    cardPayerId: payerId,
  });
  const credits = decision.kind === "settle" ? decision.credits : [];

  return {
    ok: true,
    plan: {
      prevStatus,
      earlyEnough,
      checkoutReleased,
      fromCurrentCheckout,
      paymentIntentId,
      paidAt,
      checkoutSessionId,
      payerId,
      selfCredit: credits.find((c) => c.userId === userId && c.creditedForUserId == null) ?? null,
      payerCredit: credits.find((c) => c.creditedForUserId === userId) ?? null,
    },
  };
}

function wasPaid(plan: WithdrawalPlan): boolean {
  return !plan.checkoutReleased && (!!plan.paymentIntentId || !!plan.paidAt);
}

/** Confirmation copy shown before the player gives up the spot, built from a preview plan. */
export function withdrawalPreviewMessage(plan: WithdrawalPlan, payerName: string | null): string {
  if (plan.checkoutReleased) {
    return "Your unfinished payment will be cancelled and you won't be charged. If it already went through, you'll be treated as a paid player.";
  }
  const parts: string[] = [];
  if (plan.payerCredit) {
    parts.push(`${payerName ?? "The friend who paid"} paid for your spot, so the $${dollars(plan.payerCredit.cents)} credit will go to them.`);
  }
  if (plan.selfCredit) parts.push(`You'll get a $${dollars(plan.selfCredit.cents)} credit.`);
  if (parts.length === 0 && wasPaid(plan) && !plan.earlyEnough) parts.push("No refund or credit applies within 24 hours of kickoff.");
  if (parts.length === 0) parts.push("No payment to return.");
  return parts.join(" ");
}

export async function previewPlayerWithdrawal(
  ctx: Ctx,
  rsvp: WithdrawalRsvp,
): Promise<{ ok: true; preview: Record<string, unknown> } | WithdrawalFailure> {
  const planned = await planPlayerWithdrawal(ctx, rsvp, { preview: true });
  if (!planned.ok) return planned;
  const { plan } = planned;
  const names = plan.payerCredit ? await displayNames(ctx.admin, [plan.payerId]) : new Map<string, string>();
  const payerName = names.get(plan.payerId) ?? null;
  return {
    ok: true,
    preview: {
      credit_cents: plan.selfCredit?.cents ?? 0,
      payer_credit_cents: plan.payerCredit?.cents ?? 0,
      ...(plan.payerCredit ? { payer_name: payerName } : {}),
      payment_cancelled: plan.checkoutReleased && plan.prevStatus === "pending_payment",
      paid_but_late: wasPaid(plan) && !plan.earlyEnough,
      message: withdrawalPreviewMessage(plan, payerName),
    },
  };
}

/**
 * Gives up the spot and settles it as planned: the RSVP moves to newStatus only if it is still in its planned status,
 * credits are issued (one per owner, run and spot), and if the player's own credit fails the RSVP is restored so a
 * retry starts over. Players and payers are notified.
 */
export async function commitPlayerWithdrawal(
  ctx: Ctx,
  plan: WithdrawalPlan,
  opts: { newStatus: string },
): Promise<{ ok: true; result: WithdrawalResult } | WithdrawalFailure> {
  const { admin, run, userId, sentryCtx } = ctx;
  const runTitle = run.title ?? "the session";
  const { selfCredit, payerCredit, payerId, prevStatus } = plan;
  const friendPaid = payerCredit != null;
  const nowIso = new Date().toISOString();

  const { data: cancelledRows, error: cancelErr } = await admin
    .from("pickup_run_rsvps")
    .update({
      status: opts.newStatus,
      waitlist_position: null,
      waitlist_offered_at: null,
      waitlist_expires_at: null,
      ...(plan.fromCurrentCheckout && plan.paymentIntentId ? { payment_intent_id: plan.paymentIntentId, paid_at: plan.paidAt } : {}),
      updated_at: nowIso,
    })
    .eq("run_id", run.id)
    .eq("user_id", userId)
    .eq("status", prevStatus)
    .select("user_id");
  if (cancelErr) {
    Sentry.captureException(cancelErr, sentryCtx);
    return { ok: false, status: 500, error: `Could not leave the session: ${cancelErr.message}` };
  }
  if (!cancelledRows || cancelledRows.length === 0) {
    return { ok: false, status: 409, error: "Your spot changed while leaving. Refresh and try again." };
  }

  let creditIssuedCents = 0;
  let alreadyCredited = false;
  let payerCreditIssuedCents = 0;
  let payerAlreadyCredited = false;
  let payerCreditNeedsReview: string | null = null;
  try {
    if (selfCredit) {
      const credit = await issuePickupCancellationCredit(admin, { userId, runId: run.id, amountCents: selfCredit.cents });
      if (credit.kind === "issued") creditIssuedCents = credit.amountCents;
      else if (credit.kind === "already_exists") alreadyCredited = true;
      else throw new Error(`Own cancellation credit needs review: ${credit.detail}`);
    }
    if (payerCredit) {
      const credit = await issuePickupCancellationCredit(admin, {
        userId: payerCredit.userId,
        runId: run.id,
        amountCents: payerCredit.cents,
        creditedForUserId: payerCredit.creditedForUserId,
      });
      if (credit.kind === "issued") payerCreditIssuedCents = credit.amountCents;
      else if (credit.kind === "already_exists") payerAlreadyCredited = true;
      else payerCreditNeedsReview = credit.detail;
    }
  } catch (e) {
    Sentry.captureException(e, {
      ...sentryCtx,
      extra: { ...sentryCtx.extra, self_credit_cents: selfCredit?.cents ?? 0, payer_id: payerId, payer_credit_cents: payerCredit?.cents ?? 0 },
    });
    const { error: revertErr } = await admin
      .from("pickup_run_rsvps")
      .update({ status: prevStatus, updated_at: new Date().toISOString() })
      .eq("run_id", run.id)
      .eq("user_id", userId);
    if (revertErr) {
      Sentry.captureException(revertErr, sentryCtx);
      return { ok: false, status: 500, error: "You left the session but your credit could not be issued. Contact support." };
    }
    return { ok: false, status: 500, error: "Could not issue your credit. You are still in the session. Try again." };
  }

  const warnings: string[] = [];
  if (payerCreditNeedsReview) {
    const msg = `Payer ${payerId} could not be credited for run ${run.id} (${payerCreditNeedsReview}); ${payerCredit?.cents ?? 0} cents for player ${userId}'s spot must be credited manually.`;
    Sentry.captureException(new Error(msg), { ...sentryCtx, extra: { ...sentryCtx.extra, payer_id: payerId, payer_credit_cents: payerCredit?.cents ?? 0 } });
    warnings.push(msg);
  }
  if (plan.checkoutReleased && plan.checkoutSessionId) {
    try {
      await markPickupCheckoutExpired(admin, plan.checkoutSessionId);
    } catch (e) {
      Sentry.captureException(e, sentryCtx);
      warnings.push(errMsg(e));
    }
  }

  const names = friendPaid ? await displayNames(admin, [userId, payerId]) : new Map<string, string>();
  const payerName = names.get(payerId) ?? "The friend who paid";
  const playerName = names.get(userId) ?? "The player you paid for";

  const parts: string[] = [];
  if (plan.checkoutReleased) {
    parts.push(`You left ${runTitle}. Your unfinished payment was cancelled and you were not charged.`);
  } else if (friendPaid) {
    parts.push(
      payerCreditIssuedCents > 0
        ? `You left ${runTitle}. ${payerName} paid for your spot, so the $${dollars(payerCreditIssuedCents)} credit went to them.`
        : `You left ${runTitle}. ${payerName} paid for your spot, so the credit for it goes to them.`,
    );
    if (creditIssuedCents > 0) parts.push(`A credit of $${dollars(creditIssuedCents)} has been added to your account.`);
  } else if (creditIssuedCents > 0) {
    parts.push(`You left ${runTitle}. A credit of $${dollars(creditIssuedCents)} has been added to your account.`);
  } else if (alreadyCredited) {
    parts.push(`You left ${runTitle}. A credit for this session was already added to your account earlier.`);
  } else if (wasPaid(plan) && !plan.earlyEnough) {
    parts.push(`You left ${runTitle}. No refund or credit applies within 24 hours of kickoff.`);
  } else {
    parts.push(`You have left ${runTitle}.`);
  }
  const message = parts.join(" ");

  try {
    await sendPushToUsers(admin, [userId], {
      title: "You left the session",
      body: message,
      data: { kind: "session_left", run_id: run.id },
    });
  } catch (e) {
    console.error("[pickup withdrawal] push failed", errMsg(e));
  }

  if (friendPaid) {
    const payerCreditCents = payerCredit?.cents ?? 0;
    try {
      await sendPushToUsers(admin, [payerId], payerCreditIssuedCents > 0
        ? {
            title: "Credit added",
            body: `${playerName} left ${runTitle}. A credit of $${dollars(payerCreditIssuedCents)} for the spot you paid for has been added to your account.`,
            data: { kind: "session_left_payer_credit", run_id: run.id },
          }
        : payerAlreadyCredited
        ? {
            title: "Credit already added",
            body: `${playerName} left ${runTitle}. The credit for the spot you paid for was already added to your account earlier.`,
            data: { kind: "session_left_payer_credit", run_id: run.id },
          }
        : {
            title: "Credit on its way",
            body: `${playerName} left ${runTitle}. We owe you a $${dollars(payerCreditCents)} credit for the spot you paid for; our team will add it to your account.`,
            data: { kind: "session_left_payer_credit", run_id: run.id },
          });
    } catch (e) {
      console.error("[pickup withdrawal] payer push failed", errMsg(e));
    }
  }

  return {
    ok: true,
    result: {
      plan,
      creditIssuedCents,
      alreadyCredited,
      payerCreditIssuedCents,
      payerAlreadyCredited,
      payerCreditNeedsReview,
      payerName: friendPaid ? names.get(payerId) ?? null : null,
      message,
      warnings,
    },
  };
}

/** Response fields shared by leave and decline so both clients read the same contract. */
export function withdrawalResponseFields(r: WithdrawalResult): Record<string, unknown> {
  const friendPaid = r.plan.payerCredit != null;
  return {
    credit_issued: r.creditIssuedCents > 0,
    amount_cents: r.creditIssuedCents,
    already_credited: r.alreadyCredited,
    payer_credited: r.payerCreditIssuedCents > 0,
    payer_credit_cents: friendPaid ? r.plan.payerCredit!.cents : 0,
    payer_already_credited: r.payerAlreadyCredited,
    payer_credit_needs_review: r.payerCreditNeedsReview != null,
    ...(friendPaid ? { payer_name: r.payerName } : {}),
    payment_cancelled: r.plan.checkoutReleased && r.plan.prevStatus === "pending_payment",
    paid_but_late: wasPaid(r.plan) && !r.plan.earlyEnough,
    message: r.message,
  };
}

async function displayNames(admin: SupabaseClient, userIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const { data, error } = await admin.from("profiles").select("id,first_name,last_name,username").in("id", userIds);
  if (error) {
    console.error("[pickup withdrawal] profile lookup failed", error.message);
    return names;
  }
  for (const p of data || []) {
    const full = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
    const label = full || (p.username ? `@${p.username}` : "");
    if (label) names.set(String(p.id), label);
  }
  return names;
}
