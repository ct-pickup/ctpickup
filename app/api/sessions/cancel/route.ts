import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin, getStripePickup } from "@/lib/server/runtimeClients";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import {
  findPickupPaymentIntentId,
  getPickupChargeSnapshot,
  isOnOrAfterRefundFixCutoff,
  issuePickupCancellationCredit,
  markPickupCheckoutExpired,
  matchChargeToCurrentJoin,
  pickupCreditCoverageForJoin,
  refundPickupCharge,
  remainingRefundableCents,
  settlePendingPickupCheckout,
  type PickupChargeSnapshot,
} from "@/lib/payments/pickupRefunds";
import { decidePickupRefund, type RefundInitiator } from "@/lib/payments/refundPolicy";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function usd(cents: number): string {
  return `$${(Math.max(0, cents) / 100).toFixed(2)}`;
}

type RsvpRow = {
  user_id: string;
  status: string;
  paid_at: string | null;
  checkout_session_id: string | null;
  payment_intent_id: string | null;
  refund_id: string | null;
};

type Settlement = {
  refundedCents: number;
  creditCents: number;
  alreadyCredited: boolean;
  paymentIntentId: string | null;
};

type Failure = { user_id: string; name: string | null; error: string };

async function settleRsvp(
  admin: SupabaseClient,
  getStripe: () => Stripe,
  run: { id: string; fee_cents: number | null; start_at: string | null },
  rsvp: RsvpRow,
  initiator: RefundInitiator,
): Promise<Settlement> {
  const runId = run.id;
  const userId = rsvp.user_id;
  const out: Settlement = { refundedCents: 0, creditCents: 0, alreadyCredited: false, paymentIntentId: null };

  let paymentIntentId: string | null = null;
  let fromCurrentCheckout = false;
  let checkoutReleased = false;

  if (rsvp.status === "pending_payment") {
    checkoutReleased = true;
    if (rsvp.checkout_session_id || rsvp.payment_intent_id) {
      const settled = await settlePendingPickupCheckout(getStripe(), {
        checkoutSessionId: rsvp.checkout_session_id,
        paymentIntentId: rsvp.payment_intent_id,
      });
      if (settled.kind === "paid") {
        paymentIntentId = settled.paymentIntentId;
        fromCurrentCheckout = true;
        checkoutReleased = false;
      } else if (rsvp.checkout_session_id) {
        await markPickupCheckoutExpired(admin, rsvp.checkout_session_id);
      }
    }
  } else if (rsvp.payment_intent_id || rsvp.checkout_session_id || rsvp.paid_at) {
    paymentIntentId = await findPickupPaymentIntentId(getStripe(), admin, {
      runId,
      userId,
      rsvpPaymentIntentId: rsvp.payment_intent_id,
      checkoutSessionId: rsvp.checkout_session_id,
    });
  }

  let currentCharge: PickupChargeSnapshot | null = null;
  if (paymentIntentId) {
    const snap = await getPickupChargeSnapshot(getStripe(), paymentIntentId);
    if (snap.amountReceivedCents > 0) {
      const match = await matchChargeToCurrentJoin(admin, {
        runId,
        userId,
        paidAtIso: rsvp.paid_at,
        snap,
        fromCurrentCheckout,
      });
      if (match === "unmatched" && remainingRefundableCents(snap) > 0) {
        throw new Error(
          `Card payment ${paymentIntentId} could not be matched to this player's current spot; refund it manually in Stripe after review.`,
        );
      }
      if (match === "current") currentCharge = snap;
      else if (match === "already_compensated") out.alreadyCredited = true;
    }
  }

  let creditCoveredCents = 0;
  if (rsvp.status === "confirmed" && !out.alreadyCredited) {
    const coverage = await pickupCreditCoverageForJoin(admin, {
      runId,
      userId,
      paidAtIso: rsvp.paid_at,
      feeCents: Number(run.fee_cents ?? 0),
      hasCardPayment: currentCharge != null,
    });
    creditCoveredCents = coverage.cents;
  }

  const decision = decidePickupRefund({
    initiator,
    trigger: "run_cancel",
    kickoffAt: run.start_at,
    now: Date.now(),
    paymentPending: checkoutReleased,
    hasCardCharge: currentCharge != null,
    cardNetCents: currentCharge ? remainingRefundableCents(currentCharge) : 0,
    creditCoveredCents,
    playerId: userId,
    cardPayerId: userId,
  });

  if (decision.kind === "settle") {
    if (decision.refundToCard && currentCharge) {
      out.paymentIntentId = currentCharge.paymentIntentId;
      const outcome = await refundPickupCharge(getStripe(), admin, {
        runId,
        userId,
        snap: currentCharge,
        checkoutSessionId: rsvp.checkout_session_id,
        existingRefundId: rsvp.refund_id,
        trigger: "host_cancel",
      });
      if (outcome.kind !== "nothing_charged") {
        out.refundedCents = outcome.amountCents;
        if (outcome.recordError) {
          Sentry.captureException(new Error(`Refund issued but not recorded: ${outcome.recordError}`), {
            tags: { route: "sessions/cancel" },
            extra: { run_id: runId, user_id: userId, payment_intent_id: currentCharge.paymentIntentId, refund_id: outcome.refundId },
          });
        }
      }
    }
    for (const c of decision.credits) {
      const credit = await issuePickupCancellationCredit(admin, {
        userId: c.userId,
        runId,
        amountCents: c.cents,
        creditedForUserId: c.creditedForUserId,
      });
      if (credit.kind === "issued") out.creditCents += credit.amountCents;
      else if (credit.kind === "already_exists") out.alreadyCredited = true;
      else throw new Error(`Cancellation credit needs review: ${credit.detail}`);
    }
  }

  const { error: upErr } = await admin
    .from("pickup_run_rsvps")
    .update({
      status: "canceled",
      ...(fromCurrentCheckout && paymentIntentId ? { payment_intent_id: paymentIntentId } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("run_id", runId)
    .eq("user_id", userId);
  if (upErr) throw new Error(`RSVP update failed after settlement: ${upErr.message}`);

  return out;
}

async function displayNames(admin: SupabaseClient, userIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (userIds.length === 0) return names;
  const { data, error } = await admin.from("profiles").select("id,first_name,last_name,username").in("id", userIds);
  if (error) {
    console.error("[sessions/cancel] profile lookup failed", error.message);
    return names;
  }
  for (const p of data || []) {
    const full = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
    const label = full || (p.username ? `@${p.username}` : "");
    if (label) names.set(String(p.id), label);
  }
  return names;
}

/**
 * Host cancel. Each player is refunded to their card for what Stripe actually charged them, credit-paid players
 * get a cancellation credit for what their credit covered, and free players are only notified. An RSVP is moved
 * to canceled only once its money is settled, so a failure leaves it active and calling this again retries it.
 */
export async function POST(req: Request) {
  const admin = getSupabaseAdmin();
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { run_id, reason } = await req.json() as { run_id: string; reason?: string };
  if (!run_id) return NextResponse.json({ error: "run_id required" }, { status: 400 });

  const { data: run } = await admin
    .from("pickup_runs")
    .select("id, title, created_by, fee_cents, start_at, status, canceled_at")
    .eq("id", run_id)
    .maybeSingle();

  const { data: prof } = await admin.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();

  if (!run) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (run.created_by !== user.id && !prof?.is_admin) {
    return NextResponse.json({ error: "Only the host can cancel this session." }, { status: 403 });
  }
  if (run.status === "completed") {
    return NextResponse.json({ error: "Session is already ended." }, { status: 409 });
  }

  const alreadyCanceled = run.status === "canceled";
  if (alreadyCanceled && !isOnOrAfterRefundFixCutoff(run.canceled_at)) {
    return NextResponse.json({ error: "Session is already ended." }, { status: 409 });
  }

  const { data: rsvpData, error: rsvpErr } = await admin
    .from("pickup_run_rsvps")
    .select("user_id, status, paid_at, checkout_session_id, payment_intent_id, refund_id")
    .eq("run_id", run_id)
    .in("status", ["confirmed", "pending_payment"]);
  if (rsvpErr) {
    Sentry.captureException(rsvpErr, { tags: { route: "sessions/cancel" }, extra: { run_id } });
    return NextResponse.json({ error: `Could not load players: ${rsvpErr.message}` }, { status: 500 });
  }
  const rsvps = (rsvpData || []) as RsvpRow[];

  if (alreadyCanceled && rsvps.length === 0) {
    return NextResponse.json({ error: "Session is already cancelled and every player is settled." }, { status: 409 });
  }

  if (!alreadyCanceled) {
    const now = new Date().toISOString();
    const { error: runErr } = await admin.from("pickup_runs").update({
      status: "canceled",
      canceled_at: now,
      canceled_reason: reason ?? "Host cancelled",
      updated_at: now,
    }).eq("id", run_id);
    if (runErr) {
      Sentry.captureException(runErr, { tags: { route: "sessions/cancel" }, extra: { run_id } });
      return NextResponse.json({ error: `Could not cancel session: ${runErr.message}` }, { status: 500 });
    }
  }

  let stripe: Stripe | null = null;
  const getStripe = () => {
    if (!stripe) stripe = getStripePickup();
    return stripe;
  };

  const initiator: RefundInitiator = run.created_by === user.id ? "host" : "admin";
  const settled = new Map<string, Settlement>();
  const failedRows: { rsvp: RsvpRow; error: string }[] = [];

  for (const rsvp of rsvps) {
    try {
      settled.set(rsvp.user_id, await settleRsvp(admin, getStripe, { id: run.id, fee_cents: run.fee_cents, start_at: run.start_at }, rsvp, initiator));
    } catch (e) {
      Sentry.captureException(e, {
        tags: { route: "sessions/cancel" },
        extra: { run_id, user_id: rsvp.user_id, payment_intent_id: rsvp.payment_intent_id, checkout_session_id: rsvp.checkout_session_id },
      });
      console.error("[sessions/cancel] player settlement failed", { run_id, user_id: rsvp.user_id, error: errMsg(e) });
      failedRows.push({ rsvp, error: errMsg(e) });
    }
  }

  const pushJobs: Promise<unknown>[] = [];
  for (const [uid, s] of settled) {
    const parts: string[] = [`${run.title} was cancelled by the host.`];
    if (s.refundedCents > 0) {
      parts.push(`Your payment of ${usd(s.refundedCents)} has been refunded to your card. It can take 5 to 10 business days to appear.`);
    }
    if (s.creditCents > 0) parts.push(`A ${usd(s.creditCents)} credit for the credit you used has been added to your account.`);
    if (s.alreadyCredited && s.refundedCents <= 0 && s.creditCents <= 0) parts.push("A credit for this session was already added to your account earlier.");
    pushJobs.push(sendPushToUsers(admin, [uid], {
      title: s.refundedCents > 0 ? "Session cancelled, refund issued" : "Session cancelled",
      body: parts.join(" "),
      data: { kind: "session_canceled", run_id },
    }));
  }
  const pushResults = await Promise.allSettled(pushJobs);
  for (const r of pushResults) {
    if (r.status === "rejected") console.error("[sessions/cancel] push failed", errMsg(r.reason));
  }

  const names = await displayNames(admin, failedRows.map((f) => f.rsvp.user_id));
  const failures: Failure[] = failedRows.map((f) => ({
    user_id: f.rsvp.user_id,
    name: names.get(f.rsvp.user_id) ?? null,
    error: f.error,
  }));

  const settledList = [...settled.values()];
  const body = {
    ok: failures.length === 0,
    refunded: settledList.filter((s) => s.refundedCents > 0).length,
    credited: settledList.filter((s) => s.creditCents > 0).length,
    cancelled: settled.size,
    failures,
  };
  if (failures.length > 0) {
    return NextResponse.json(
      {
        ...body,
        error: `Session is cancelled, but ${failures.length} player${failures.length === 1 ? "" : "s"} could not be refunded or credited yet. They have not been told they were refunded. Tap Cancel session again to retry.`,
      },
      { status: 502 },
    );
  }
  return NextResponse.json(body);
}
