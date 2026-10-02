import * as Sentry from "@sentry/nextjs";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
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
  routeTag: string,
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
        trigger: initiator === "admin" ? "admin_cancel" : "host_cancel",
      });
      if (outcome.kind !== "nothing_charged") {
        out.refundedCents = outcome.amountCents;
        if (outcome.recordError) {
          Sentry.captureException(new Error(`Refund issued but not recorded: ${outcome.recordError}`), {
            tags: { route: routeTag },
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
    console.error("[run cancel] profile lookup failed", error.message);
    return names;
  }
  for (const p of data || []) {
    const full = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
    const label = full || (p.username ? `@${p.username}` : "");
    if (label) names.set(String(p.id), label);
  }
  return names;
}

export type RunCancelRun = {
  id: string;
  title: string | null;
  fee_cents: number | null;
  start_at: string | null;
  status: string | null;
  canceled_at: string | null;
};

export type RunCancelBody = {
  ok: boolean;
  refunded: number;
  credited: number;
  cancelled: number;
  failures: Failure[];
  error?: string;
};

/**
 * Host or admin cancel. Each player is refunded to their card for what Stripe actually charged them, credit-paid
 * players get a cancellation credit for what their credit covered, and free players are only notified. An RSVP is
 * moved to canceled only once its money is settled, so a failure leaves it active and calling this again retries it.
 * A run that was already cancelled before REFUND_FIX_CUTOFF is never touched.
 */
export async function cancelPickupRunAndSettle(
  admin: SupabaseClient,
  getStripe: () => Stripe,
  opts: { run: RunCancelRun; initiator: "host" | "admin"; reason: string | null; runPatch?: Record<string, unknown>; routeTag: string },
): Promise<{ status: number; body: RunCancelBody | { error: string } }> {
  const { run, initiator, routeTag } = opts;
  const run_id = run.id;
  if (run.status === "completed") {
    return { status: 409, body: { error: "Session is already ended." } };
  }

  const alreadyCanceled = run.status === "canceled";
  if (alreadyCanceled && !isOnOrAfterRefundFixCutoff(run.canceled_at)) {
    return { status: 409, body: { error: "Session is already ended." } };
  }

  const { data: rsvpData, error: rsvpErr } = await admin
    .from("pickup_run_rsvps")
    .select("user_id, status, paid_at, checkout_session_id, payment_intent_id, refund_id")
    .eq("run_id", run_id)
    .in("status", ["confirmed", "pending_payment"]);
  if (rsvpErr) {
    Sentry.captureException(rsvpErr, { tags: { route: routeTag }, extra: { run_id } });
    return { status: 500, body: { error: `Could not load players: ${rsvpErr.message}` } };
  }
  const rsvps = (rsvpData || []) as RsvpRow[];

  if (alreadyCanceled && rsvps.length === 0) {
    return { status: 409, body: { error: "Session is already cancelled and every player is settled." } };
  }

  if (!alreadyCanceled) {
    const now = new Date().toISOString();
    const { error: runErr } = await admin.from("pickup_runs").update({
      ...opts.runPatch,
      status: "canceled",
      canceled_at: now,
      canceled_reason: opts.reason,
      updated_at: now,
    }).eq("id", run_id);
    if (runErr) {
      Sentry.captureException(runErr, { tags: { route: routeTag }, extra: { run_id } });
      return { status: 500, body: { error: `Could not cancel session: ${runErr.message}` } };
    }
  }

  const settled = new Map<string, Settlement>();
  const failedRows: { rsvp: RsvpRow; error: string }[] = [];

  for (const rsvp of rsvps) {
    try {
      settled.set(rsvp.user_id, await settleRsvp(admin, getStripe, { id: run.id, fee_cents: run.fee_cents, start_at: run.start_at }, rsvp, initiator, routeTag));
    } catch (e) {
      Sentry.captureException(e, {
        tags: { route: routeTag },
        extra: { run_id, user_id: rsvp.user_id, payment_intent_id: rsvp.payment_intent_id, checkout_session_id: rsvp.checkout_session_id },
      });
      console.error(`[${routeTag}] player settlement failed`, { run_id, user_id: rsvp.user_id, error: errMsg(e) });
      failedRows.push({ rsvp, error: errMsg(e) });
    }
  }

  const title = run.title ?? "Your session";
  const pushJobs: Promise<unknown>[] = [];
  for (const [uid, s] of settled) {
    const parts: string[] = [initiator === "host" ? `${title} was cancelled by the host.` : `${title} was cancelled.`];
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
    if (r.status === "rejected") console.error(`[${routeTag}] push failed`, errMsg(r.reason));
  }

  const names = await displayNames(admin, failedRows.map((f) => f.rsvp.user_id));
  const failures: Failure[] = failedRows.map((f) => ({
    user_id: f.rsvp.user_id,
    name: names.get(f.rsvp.user_id) ?? null,
    error: f.error,
  }));

  const settledList = [...settled.values()];
  const body: RunCancelBody = {
    ok: failures.length === 0,
    refunded: settledList.filter((s) => s.refundedCents > 0).length,
    credited: settledList.filter((s) => s.creditCents > 0).length,
    cancelled: settled.size,
    failures,
  };
  if (failures.length > 0) {
    return {
      status: 502,
      body: {
        ...body,
        error: `Session is cancelled, but ${failures.length} player${failures.length === 1 ? "" : "s"} could not be refunded or credited yet. They have not been told they were refunded. Cancel again to retry.`,
      },
    };
  }
  return { status: 200, body };
}
