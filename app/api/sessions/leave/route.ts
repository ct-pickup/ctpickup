import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripePickup, getSupabaseAdmin } from "@/lib/server/runtimeClients";
import { promoteNextWaitlistPlayer } from "@/lib/pickup/waitlist";
import {
  commitPlayerWithdrawal,
  planPlayerWithdrawal,
  previewPlayerWithdrawal,
  withdrawalResponseFields,
  type WithdrawalRsvp,
} from "@/lib/payments/playerWithdrawal";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

/**
 * Player leaves a session. Leaving more than 24 hours before kickoff turns what was actually paid for the spot
 * into platform credit: the card charge net of refunds goes to whoever paid it (a friend who paid for the player
 * gets it, and both are notified), what a pickup credit covered goes to the player whose credit it was; card refunds are not
 * issued here. Within 24 hours nothing comes back. A player with an unfinished checkout can leave: the checkout
 * is stopped so it can no longer charge them, unless it already went through, in which case they are treated as paid.
 * With preview: true nothing changes and the response describes what leaving would return.
 */
export async function POST(req: Request) {
  const admin = getSupabaseAdmin();
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { run_id?: string; preview?: boolean };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const { run_id } = body;
  if (!run_id) return NextResponse.json({ error: "run_id required" }, { status: 400 });

  const userId = user.id;

  const { data: run } = await admin
    .from("pickup_runs")
    .select("id, title, created_by, fee_cents, start_at, cancellation_deadline, status")
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

  let stripe: Stripe | null = null;
  const ctx = {
    admin,
    getStripe: () => {
      if (!stripe) stripe = getStripePickup();
      return stripe;
    },
    run,
    userId,
    sentryCtx: { tags: { route: "sessions/leave" }, extra: { run_id, user_id: userId } as Record<string, unknown> },
  };

  if (body.preview === true) {
    const preview = await previewPlayerWithdrawal(ctx, rsvp as WithdrawalRsvp);
    if (!preview.ok) return NextResponse.json({ error: preview.error }, { status: preview.status });
    return NextResponse.json({ ok: true, preview: preview.preview });
  }

  const planned = await planPlayerWithdrawal(ctx, rsvp as WithdrawalRsvp, { preview: false });
  if (!planned.ok) return NextResponse.json({ error: planned.error }, { status: planned.status });
  const committed = await commitPlayerWithdrawal(ctx, planned.plan, { newStatus: "canceled" });
  if (!committed.ok) return NextResponse.json({ error: committed.error }, { status: committed.status });
  const warnings = [...committed.result.warnings];

  const promoted = await promoteNextWaitlistPlayer(admin, run_id, { requestedBy: userId, reason: "player_cancel" });
  if (!promoted.ok) {
    Sentry.captureException(new Error(`Waitlist promotion after leave failed: ${promoted.error}`), ctx.sentryCtx);
    warnings.push(`Waitlist promotion failed: ${promoted.error}`);
  }

  return NextResponse.json({
    ok: true,
    ...withdrawalResponseFields(committed.result),
    ...(warnings.length ? { warnings } : {}),
  });
}
