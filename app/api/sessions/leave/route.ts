import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripePickup, getSupabaseAdmin } from "@/lib/server/runtimeClients";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import { promoteNextWaitlistPlayer } from "@/lib/pickup/waitlist";
import {
  findPickupPaymentIntentId,
  getPickupChargeSnapshot,
  issuePickupCancellationCredit,
  markPickupCheckoutExpired,
  matchChargeToCurrentJoin,
  pickupCreditCoverageForJoin,
  remainingRefundableCents,
  settlePendingPickupCheckout,
} from "@/lib/payments/pickupRefunds";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Player leaves a session. Leaving more than 24 hours before kickoff turns what the player actually paid
 * (card charge net of refunds, plus what a pickup credit covered) into a platform credit; card refunds are not
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
  const earlyEnough = new Date(run.start_at).getTime() - now.getTime() > 24 * 60 * 60 * 1000;
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

  let creditCents = 0;
  if (earlyEnough && !checkoutReleased) {
    try {
      let cardCents = 0;
      if (paymentIntentId) {
        const snap = await getPickupChargeSnapshot(getStripe(), paymentIntentId);
        if (snap.amountReceivedCents > 0) {
          const match = await matchChargeToCurrentJoin(admin, { runId: run_id, userId, paidAtIso: paidAt, snap, fromCurrentCheckout });
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
      creditCents = cardCents + coverage.cents;
    } catch (e) {
      Sentry.captureException(e, { ...sentryCtx, extra: { ...sentryCtx.extra, payment_intent_id: paymentIntentId } });
      return NextResponse.json(
        { error: "We could not verify what you paid for this session. You are still in the session. Try again or contact support." },
        { status: 502 },
      );
    }
  }

  const { error: cancelErr } = await admin
    .from("pickup_run_rsvps")
    .update({
      status: "canceled",
      ...(fromCurrentCheckout && paymentIntentId ? { payment_intent_id: paymentIntentId, paid_at: paidAt } : {}),
      updated_at: now.toISOString(),
    })
    .eq("run_id", run_id)
    .eq("user_id", userId)
    .eq("status", prevStatus);
  if (cancelErr) {
    Sentry.captureException(cancelErr, sentryCtx);
    return NextResponse.json({ error: `Could not leave the session: ${cancelErr.message}` }, { status: 500 });
  }

  let creditIssuedCents = 0;
  let alreadyCredited = false;
  if (creditCents > 0) {
    try {
      const credit = await issuePickupCancellationCredit(admin, { userId, runId: run_id, amountCents: creditCents });
      if (credit.kind === "issued") creditIssuedCents = credit.amountCents;
      else alreadyCredited = true;
    } catch (e) {
      Sentry.captureException(e, { ...sentryCtx, extra: { ...sentryCtx.extra, credit_cents: creditCents } });
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
  }

  const warnings: string[] = [];
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

  const creditDollars = (creditIssuedCents / 100).toFixed(2);
  const paid = !checkoutReleased && (!!paymentIntentId || !!paidAt);
  let pushBody: string;
  if (checkoutReleased) {
    pushBody = `You left ${run.title}. Your unfinished payment was cancelled and you were not charged.`;
  } else if (creditIssuedCents > 0) {
    pushBody = `You left ${run.title}. A credit of $${creditDollars} has been added to your account.`;
  } else if (alreadyCredited) {
    pushBody = `You left ${run.title}. A credit for this session was already added to your account earlier.`;
  } else if (paid && !earlyEnough) {
    pushBody = `You left ${run.title}. No refund or credit applies within 24 hours of kickoff.`;
  } else {
    pushBody = `You have left ${run.title}.`;
  }

  try {
    await sendPushToUsers(admin, [userId], {
      title: "You left the session",
      body: pushBody,
      data: { kind: "session_left", run_id },
    });
  } catch (e) {
    console.error("[sessions/leave] push failed", errMsg(e));
  }

  return NextResponse.json({
    ok: true,
    credit_issued: creditIssuedCents > 0,
    amount_cents: creditIssuedCents,
    already_credited: alreadyCredited,
    payment_cancelled: checkoutReleased && prevStatus === "pending_payment",
    paid_but_late: paid && !earlyEnough,
    ...(warnings.length ? { warnings } : {}),
  });
}
