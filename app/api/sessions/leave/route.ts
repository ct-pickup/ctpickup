import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { getStripePickup, getSupabaseAdmin } from "@/lib/server/runtimeClients";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import { promoteNextWaitlistPlayer } from "@/lib/pickup/waitlist";
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
import { decidePickupRefund, refundWindowOpen } from "@/lib/payments/refundPolicy";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Player leaves a session. Leaving more than 24 hours before kickoff turns what was actually paid for the spot
 * into platform credit: the card charge net of refunds goes to whoever paid it (a friend who paid for the player
 * gets it, and both are notified), what a pickup credit covered goes to the player whose credit it was; card refunds are not
 * issued here. Within 24 hours nothing comes back. A player with an unfinished checkout can leave: the checkout
 * is stopped so it can no longer charge them, unless it already went through, in which case they are treated as paid.
 */
export async function POST(req: Request) {
  const admin = getSupabaseAdmin();
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { run_id?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const { run_id } = body;
  if (!run_id) return NextResponse.json({ error: "run_id required" }, { status: 400 });

  const userId = user.id;

  const { data: run } = await admin
    .from("pickup_runs")
    .select("id, title, created_by, fee_cents, start_at, status")
    .eq("id", run_id)
    .maybeSingle();

  if (!run) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  if (run.status === "canceled" || run.status === "completed") {
    return NextResponse.json({ error: "Session has already ended." }, { status: 409 });
  }

  if (run.created_by === userId) {
    return NextResponse.json(
      { error: "Use the cancel endpoint to cancel your own session." },
      { status: 400 },
    );
  }

  const { data: rsvp } = await admin
    .from("pickup_run_rsvps")
    .select("status, paid_at, payment_intent_id, checkout_session_id")
    .eq("run_id", run_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!rsvp || (rsvp.status !== "confirmed" && rsvp.status !== "pending_payment")) {
    return NextResponse.json({ error: "No active RSVP found." }, { status: 404 });
  }

  const now = new Date();
  const earlyEnough = refundWindowOpen({ kickoffAt: run.start_at ?? null, now: now.getTime() });
  const sentryCtx = { tags: { route: "sessions/leave" }, extra: { run_id, user_id: userId } };

  let stripe: Stripe | null = null;
  const getStripe = () => {
    if (!stripe) stripe = getStripePickup();
    return stripe;
  };

  const prevStatus = String(rsvp.status);
  const checkoutSessionId = (rsvp.checkout_session_id as string | null) || null;
  let paidAt = (rsvp.paid_at as string | null) || null;
  let paymentIntentId: string | null = null;
  let fromCurrentCheckout = false;
  let checkoutReleased = false;

  try {
    if (prevStatus === "pending_payment") {
      if (checkoutSessionId || rsvp.payment_intent_id) {
        const settled = await settlePendingPickupCheckout(getStripe(), {
          checkoutSessionId,
          paymentIntentId: (rsvp.payment_intent_id as string | null) || null,
        });
        if (settled.kind === "paid") {
          paymentIntentId = settled.paymentIntentId;
          fromCurrentCheckout = true;
          paidAt = paidAt ?? now.toISOString();
        } else {
          checkoutReleased = true;
        }
      } else {
        checkoutReleased = true;
      }
    } else if (earlyEnough && paidAt) {
      paymentIntentId = await findPickupPaymentIntentId(getStripe(), admin, {
        runId: run_id,
        userId,
        rsvpPaymentIntentId: (rsvp.payment_intent_id as string | null) || null,
        checkoutSessionId,
      });
    }
  } catch (e) {
    Sentry.captureException(e, { ...sentryCtx, extra: { ...sentryCtx.extra, checkout_session_id: checkoutSessionId } });
    return NextResponse.json(
      { error: `Could not check your payment with Stripe (${errMsg(e)}). You are still in the session. Try again.` },
      { status: 502 },
    );
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
            runId: run_id,
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
        runId: run_id,
        userId,
        paidAtIso: paidAt,
        feeCents: Number(run.fee_cents ?? 0),
        hasCardPayment: cardCents > 0,
      });
      coverageCents = coverage.cents;
    } catch (e) {
      Sentry.captureException(e, { ...sentryCtx, extra: { ...sentryCtx.extra, payment_intent_id: paymentIntentId } });
      return NextResponse.json(
        { error: "We could not verify what you paid for this session. You are still in the session. Try again or contact support." },
        { status: 502 },
      );
    }
  }

  const decision = decidePickupRefund({
    initiator: "player",
    trigger: "leave",
    kickoffAt: run.start_at ?? null,
    now: now.getTime(),
    paymentPending: checkoutReleased,
    hasCardCharge: cardCents > 0,
    cardNetCents: cardCents,
    creditCoveredCents: coverageCents,
    playerId: userId,
    cardPayerId: payerId,
  });
  const credits = decision.kind === "settle" ? decision.credits : [];
  const selfCredit = credits.find((c) => c.userId === userId && c.creditedForUserId == null) ?? null;
  const payerCredit = credits.find((c) => c.creditedForUserId === userId) ?? null;
  const friendPaid = payerCredit != null;
  const selfCreditCents = selfCredit?.cents ?? 0;
  const payerCreditCents = payerCredit?.cents ?? 0;

  const { data: cancelledRows, error: cancelErr } = await admin
    .from("pickup_run_rsvps")
    .update({
      status: "canceled",
      ...(fromCurrentCheckout && paymentIntentId ? { payment_intent_id: paymentIntentId, paid_at: paidAt } : {}),
      updated_at: now.toISOString(),
    })
    .eq("run_id", run_id)
    .eq("user_id", userId)
    .eq("status", prevStatus)
    .select("user_id");
  if (cancelErr) {
    Sentry.captureException(cancelErr, sentryCtx);
    return NextResponse.json({ error: `Could not leave the session: ${cancelErr.message}` }, { status: 500 });
  }
  if (!cancelledRows || cancelledRows.length === 0) {
    return NextResponse.json({ error: "Your spot changed while leaving. Refresh and try again." }, { status: 409 });
  }

  let creditIssuedCents = 0;
  let alreadyCredited = false;
  let payerCreditIssuedCents = 0;
  let payerAlreadyCredited = false;
  let payerCreditNeedsReview: string | null = null;
  try {
    if (selfCredit) {
      const credit = await issuePickupCancellationCredit(admin, { userId, runId: run_id, amountCents: selfCredit.cents });
      if (credit.kind === "issued") creditIssuedCents = credit.amountCents;
      else if (credit.kind === "already_exists") alreadyCredited = true;
      else throw new Error(`Own cancellation credit needs review: ${credit.detail}`);
    }
    if (payerCredit) {
      const credit = await issuePickupCancellationCredit(admin, {
        userId: payerCredit.userId,
        runId: run_id,
        amountCents: payerCredit.cents,
        creditedForUserId: payerCredit.creditedForUserId,
      });
      if (credit.kind === "issued") payerCreditIssuedCents = credit.amountCents;
      else if (credit.kind === "already_exists") payerAlreadyCredited = true;
      else payerCreditNeedsReview = credit.detail;
    }
  } catch (e) {
    Sentry.captureException(e, { ...sentryCtx, extra: { ...sentryCtx.extra, self_credit_cents: selfCreditCents, payer_id: payerId, payer_credit_cents: payerCreditCents } });
    const { error: revertErr } = await admin
      .from("pickup_run_rsvps")
      .update({ status: prevStatus, updated_at: new Date().toISOString() })
      .eq("run_id", run_id)
      .eq("user_id", userId);
    if (revertErr) {
      Sentry.captureException(revertErr, sentryCtx);
      return NextResponse.json(
        { error: "You left the session but your credit could not be issued. Contact support." },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: "Could not issue your credit. You are still in the session. Try again." },
      { status: 500 },
    );
  }

  const warnings: string[] = [];
  if (payerCreditNeedsReview) {
    const msg = `Payer ${payerId} could not be credited for run ${run_id} (${payerCreditNeedsReview}); ${payerCreditCents} cents for player ${userId}'s spot must be credited manually.`;
    Sentry.captureException(new Error(msg), { ...sentryCtx, extra: { ...sentryCtx.extra, payer_id: payerId, payer_credit_cents: payerCreditCents } });
    warnings.push(msg);
  }
  if (checkoutReleased && checkoutSessionId) {
    try {
      await markPickupCheckoutExpired(admin, checkoutSessionId);
    } catch (e) {
      Sentry.captureException(e, sentryCtx);
      warnings.push(errMsg(e));
    }
  }

  const promoted = await promoteNextWaitlistPlayer(admin, run_id, { requestedBy: userId, reason: "player_cancel" });
  if (!promoted.ok) {
    Sentry.captureException(new Error(`Waitlist promotion after leave failed: ${promoted.error}`), sentryCtx);
    warnings.push(`Waitlist promotion failed: ${promoted.error}`);
  }

  const names = friendPaid ? await displayNames(admin, [userId, payerId]) : new Map<string, string>();
  const payerName = names.get(payerId) ?? "The friend who paid";
  const playerName = names.get(userId) ?? "The player you paid for";
  const dollars = (cents: number) => (cents / 100).toFixed(2);

  const paid = !checkoutReleased && (!!paymentIntentId || !!paidAt);
  const parts: string[] = [];
  if (checkoutReleased) {
    parts.push(`You left ${run.title}. Your unfinished payment was cancelled and you were not charged.`);
  } else if (friendPaid) {
    parts.push(
      payerCreditIssuedCents > 0
        ? `You left ${run.title}. ${payerName} paid for your spot, so the $${dollars(payerCreditIssuedCents)} credit went to them.`
        : `You left ${run.title}. ${payerName} paid for your spot, so the credit for it goes to them.`,
    );
    if (creditIssuedCents > 0) parts.push(`A credit of $${dollars(creditIssuedCents)} has been added to your account.`);
  } else if (creditIssuedCents > 0) {
    parts.push(`You left ${run.title}. A credit of $${dollars(creditIssuedCents)} has been added to your account.`);
  } else if (alreadyCredited) {
    parts.push(`You left ${run.title}. A credit for this session was already added to your account earlier.`);
  } else if (paid && !earlyEnough) {
    parts.push(`You left ${run.title}. No refund or credit applies within 24 hours of kickoff.`);
  } else {
    parts.push(`You have left ${run.title}.`);
  }

  try {
    await sendPushToUsers(admin, [userId], {
      title: "You left the session",
      body: parts.join(" "),
      data: { kind: "session_left", run_id },
    });
  } catch (e) {
    console.error("[sessions/leave] push failed", errMsg(e));
  }

  if (friendPaid) {
    try {
      await sendPushToUsers(admin, [payerId], payerCreditIssuedCents > 0
        ? {
            title: "Credit added",
            body: `${playerName} left ${run.title}. A credit of $${dollars(payerCreditIssuedCents)} for the spot you paid for has been added to your account.`,
            data: { kind: "session_left_payer_credit", run_id },
          }
        : payerAlreadyCredited
        ? {
            title: "Credit already added",
            body: `${playerName} left ${run.title}. The credit for the spot you paid for was already added to your account earlier.`,
            data: { kind: "session_left_payer_credit", run_id },
          }
        : {
            title: "Credit on its way",
            body: `${playerName} left ${run.title}. We owe you a $${dollars(payerCreditCents)} credit for the spot you paid for; our team will add it to your account.`,
            data: { kind: "session_left_payer_credit", run_id },
          });
    } catch (e) {
      console.error("[sessions/leave] payer push failed", errMsg(e));
    }
  }

  return NextResponse.json({
    ok: true,
    credit_issued: creditIssuedCents > 0,
    amount_cents: creditIssuedCents,
    already_credited: alreadyCredited,
    payer_credited: payerCreditIssuedCents > 0,
    payer_credit_cents: friendPaid ? payerCreditCents : 0,
    payer_already_credited: payerAlreadyCredited,
    payer_credit_needs_review: payerCreditNeedsReview != null,
    ...(friendPaid ? { payer_name: names.get(payerId) ?? null } : {}),
    payment_cancelled: checkoutReleased && prevStatus === "pending_payment",
    paid_but_late: paid && !earlyEnough,
    ...(warnings.length ? { warnings } : {}),
  });
}

async function displayNames(admin: SupabaseClient, userIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const { data, error } = await admin.from("profiles").select("id,first_name,last_name,username").in("id", userIds);
  if (error) {
    console.error("[sessions/leave] profile lookup failed", error.message);
    return names;
  }
  for (const p of data || []) {
    const full = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
    const label = full || (p.username ? `@${p.username}` : "");
    if (label) names.set(String(p.id), label);
  }
  return names;
}
