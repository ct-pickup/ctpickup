import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { recomputePickupStandingForUser } from "@/lib/pickup/standing/recomputePickupStanding";
import { parseCancelledAt } from "@/lib/pickup/cancelledAt";
import { pickupRefundCutoffMs } from "@/lib/pickup/runScheduling";
import { deletePendingWaitlistExpiringReminders, promoteNextWaitlistPlayer } from "@/lib/pickup/waitlist";
import {
  commitPlayerWithdrawal,
  planPlayerWithdrawal,
  withdrawalResponseFields,
  type WithdrawalResult,
  type WithdrawalRsvp,
} from "@/lib/payments/playerWithdrawal";
import { refundWindowOpen } from "@/lib/payments/refundPolicy";
import { getStripePickup, getSupabaseAdmin } from "@/lib/server/runtimeClients";

function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

function adminOutcomeMessage(opts: {
  playerName: string;
  early: boolean;
  prevStatus: string | null;
  heldSpot: boolean;
  standingRecorded: boolean;
  withdrawal: WithdrawalResult | null;
}): string {
  const { playerName, early, prevStatus, heldSpot, standingRecorded, withdrawal: w } = opts;
  const timing = early ? "more than 24 hours before kickoff" : "within 24 hours of kickoff";
  const late = standingRecorded ? " A late cancel was recorded against their standing." : "";
  if (!heldSpot) {
    const already = prevStatus === "canceled" || prevStatus === "late_canceled";
    return `${playerName} ${already ? "was already cancelled" : "had no spot to cancel"}; no money was moved.${late}`;
  }
  const head = `Cancelled ${playerName}'s spot (${timing}).`;
  if (!w) return `${head} No payment was involved.${late}`;
  const { plan } = w;
  if (plan.checkoutReleased) return `${head} Their unfinished payment was cancelled, so nothing was charged.${late}`;
  const parts: string[] = [head];
  if (plan.payerCredit) {
    const payer = w.payerName ?? "The friend who paid";
    if (w.payerCreditIssuedCents > 0) parts.push(`${payer} paid for the spot and got a $${dollars(w.payerCreditIssuedCents)} credit.`);
    else if (w.payerAlreadyCredited) parts.push(`${payer} paid for the spot and was already credited earlier.`);
    else parts.push(`${payer} paid for the spot; their $${dollars(plan.payerCredit.cents)} credit needs to be added manually.`);
  }
  if (w.creditIssuedCents > 0) parts.push(`${playerName} got a $${dollars(w.creditIssuedCents)} credit.`);
  else if (w.alreadyCredited) parts.push(`${playerName} was already credited for this run earlier.`);
  if (parts.length === 1) {
    const paid = !!plan.paymentIntentId || !!plan.paidAt;
    parts.push(paid && !early ? "No refund or credit applies within 24 hours of kickoff." : "No payment to return.");
  }
  return parts.join(" ") + late;
}

/**
 * Records a player's own cancellation that they asked an admin to make. It is settled exactly like the player leaving
 * (lib/payments/playerWithdrawal): cancelled more than 24 hours before kickoff, what was actually paid becomes credit
 * (to the friend who paid, if one did); within 24 hours nothing comes back; an unfinished checkout is stopped.
 * cancelled_at (default now) is when the player asked, and decides the 24-hour window. Only a cancellation inside the
 * window is recorded as a late cancel for standing (idempotent per user + run + kind via unique index). A freed spot
 * goes to the waitlist. Retries are safe: the spot moves only from its current status and credits are one per run.
 */
export async function POST(req: Request) {
  const admin = getSupabaseAdmin();

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const u = await admin.auth.getUser(token);
  const user = u.data.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const prof = await admin.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (!prof.data?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const run_id = String(body?.run_id || "").trim();
  const user_id = String(body?.user_id || "").trim();
  const note = body?.note != null ? String(body.note).trim() || null : null;

  if (!run_id || !user_id) {
    return NextResponse.json({ error: "run_id and user_id required" }, { status: 400 });
  }

  const runRes = await admin
    .from("pickup_runs")
    .select("id, title, fee_cents, start_at, cancellation_deadline")
    .eq("id", run_id)
    .maybeSingle();
  if (runRes.error) return NextResponse.json({ error: runRes.error.message }, { status: 500 });
  if (!runRes.data) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  const run = {
    id: String(runRes.data.id),
    title: (runRes.data.title as string | null) ?? null,
    fee_cents: (runRes.data.fee_cents as number | null) ?? null,
    start_at: (runRes.data.start_at as string | null) ?? null,
    cancellation_deadline: (runRes.data.cancellation_deadline as string | null) ?? null,
  };

  const cancelledAt = parseCancelledAt(body?.cancelled_at, run, Date.now());
  if (!cancelledAt.ok) return NextResponse.json({ error: cancelledAt.error }, { status: 400 });
  const cancelledAtIso = new Date(cancelledAt.ms).toISOString();
  const early = refundWindowOpen({ kickoffAt: run.start_at, refundCutoffAt: pickupRefundCutoffMs(run), now: cancelledAt.ms });

  const current = await admin
    .from("pickup_run_rsvps")
    .select("status, paid_at, payment_intent_id, checkout_session_id")
    .eq("run_id", run_id)
    .eq("user_id", user_id)
    .maybeSingle();
  const prev = (current.data?.status as string | undefined) || null;
  const holdsSpot = prev === "confirmed" || prev === "pending_payment";
  const newStatus = early ? "canceled" : "late_canceled";
  const sentryCtx = {
    tags: { route: "admin/pickup/late-cancel" },
    extra: { run_id, user_id, admin_id: user.id, cancelled_at: cancelledAtIso } as Record<string, unknown>,
  };

  let withdrawal: WithdrawalResult | null = null;
  if (holdsSpot) {
    let stripe: Stripe | null = null;
    const ctx = {
      admin,
      getStripe: () => {
        if (!stripe) stripe = getStripePickup();
        return stripe;
      },
      run,
      userId: user_id,
      cancelledAtMs: cancelledAt.ms,
      sentryCtx,
    };
    const planned = await planPlayerWithdrawal(ctx, current.data as WithdrawalRsvp, { preview: false });
    if (!planned.ok) return NextResponse.json({ error: planned.error }, { status: planned.status });
    const committed = await commitPlayerWithdrawal(ctx, planned.plan, { newStatus });
    if (!committed.ok) return NextResponse.json({ error: committed.error }, { status: committed.status });
    withdrawal = committed.result;
  } else if (prev === "pending_confirm") {
    const up = await admin
      .from("pickup_run_rsvps")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("run_id", run_id)
      .eq("user_id", user_id)
      .eq("status", "pending_confirm");
    if (up.error) return NextResponse.json({ error: `Could not cancel the spot: ${up.error.message}` }, { status: 500 });
    await deletePendingWaitlistExpiringReminders(admin, user_id, run_id);
  }

  const warnings = [...(withdrawal?.warnings ?? [])];

  let standingRecorded = false;
  if (!early) {
    const ins = await admin.from("pickup_reliability_incidents").insert({
      run_id,
      user_id,
      kind: "late_cancel",
      source: "admin",
      note,
    });
    if (ins.error && ins.error.code !== "23505") {
      Sentry.captureException(new Error(`late_cancel incident not saved: ${ins.error.message}`), sentryCtx);
      warnings.push(`Late cancel could not be recorded for standing: ${ins.error.message}`);
    } else {
      standingRecorded = true;
      try {
        await recomputePickupStandingForUser(admin, user_id);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        Sentry.captureException(e, sentryCtx);
        warnings.push(`Standing recompute failed: ${msg}`);
      }
    }
  }

  const freedSpot = holdsSpot || prev === "pending_confirm";
  if (freedSpot) {
    const promoted = await promoteNextWaitlistPlayer(admin, run_id, {
      requestedBy: user.id,
      reason: "admin_late_cancel",
    });
    if (!promoted.ok) {
      Sentry.captureException(new Error(`Waitlist promotion after admin late cancel failed: ${promoted.error}`), sentryCtx);
      warnings.push(`Waitlist promotion failed: ${promoted.error}`);
    }
  }

  const nameRes = await admin.from("profiles").select("first_name,last_name,username").eq("id", user_id).maybeSingle();
  const p = nameRes.data as { first_name?: string | null; last_name?: string | null; username?: string | null } | null;
  const playerName =
    [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim() || (p?.username ? `@${p.username}` : "The player");

  const fields = withdrawal ? withdrawalResponseFields(withdrawal) : {};
  return NextResponse.json({
    ok: true,
    ...fields,
    status: freedSpot ? newStatus : prev,
    cancelled_at: cancelledAtIso,
    within_24h: !early,
    standing_recorded: standingRecorded,
    message: adminOutcomeMessage({ playerName, early, prevStatus: prev, heldSpot: freedSpot, standingRecorded, withdrawal }),
    ...(withdrawal ? { player_message: withdrawal.message } : {}),
    ...(warnings.length ? { warnings } : {}),
  });
}
