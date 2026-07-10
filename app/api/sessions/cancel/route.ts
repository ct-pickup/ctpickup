import { NextResponse } from "next/server";
import { getSupabaseAdmin, getStripePickup } from "@/lib/server/runtimeClients";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

export async function POST(req: Request) {
  const admin = getSupabaseAdmin();
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { run_id, reason } = await req.json() as { run_id: string; reason?: string };
  if (!run_id) return NextResponse.json({ error: "run_id required" }, { status: 400 });

  // Verify caller is host or admin
  const { data: run } = await admin
    .from("pickup_runs")
    .select("id, title, created_by, fee_cents, status")
    .eq("id", run_id)
    .maybeSingle();

  const { data: prof } = await admin.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();

  if (!run) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (run.created_by !== user.id && !prof?.is_admin) {
    return NextResponse.json({ error: "Only the host can cancel this session." }, { status: 403 });
  }
  if (run.status === "canceled" || run.status === "completed") {
    return NextResponse.json({ error: "Session is already ended." }, { status: 409 });
  }

  const now = new Date().toISOString();

  // Cancel the run
  await admin.from("pickup_runs").update({
    status: "canceled",
    canceled_at: now,
    canceled_reason: reason ?? "Host cancelled",
    updated_at: now,
  }).eq("id", run_id);

  // Get all confirmed RSVPs
  const { data: rsvps } = await admin
    .from("pickup_run_rsvps")
    .select("user_id, status, checkout_session_id")
    .eq("run_id", run_id)
    .in("status", ["confirmed", "pending_payment"]);

  const refundedIds: string[] = [];
  const cancelledIds: string[] = [];

  // Issue Stripe refunds for paid RSVPs
  if (run.fee_cents > 0 && rsvps && rsvps.length > 0) {
    let stripe;
    try { stripe = getStripePickup(); } catch {}

    for (const rsvp of rsvps) {
      // Look up payment
      const { data: payment } = await admin
        .from("platform_payments")
        .select("stripe_payment_intent_id")
        .eq("product_entity_id", run_id)
        .eq("user_id", rsvp.user_id)
        .eq("lifecycle_status", "captured")
        .maybeSingle();

      if (payment?.stripe_payment_intent_id && stripe) {
        try {
          await stripe.refunds.create({
            payment_intent: payment.stripe_payment_intent_id,
          });
          refundedIds.push(rsvp.user_id);
        } catch (e) {
          console.error("[sessions/cancel] refund failed", e);
          cancelledIds.push(rsvp.user_id);
        }
      } else {
        cancelledIds.push(rsvp.user_id);
      }
    }
  } else if (rsvps) {
    cancelledIds.push(...rsvps.map((r: any) => r.user_id));
  }

  // Cancel all RSVPs
  if (rsvps && rsvps.length > 0) {
    await admin.from("pickup_run_rsvps")
      .update({ status: "canceled", updated_at: now })
      .eq("run_id", run_id)
      .in("status", ["confirmed", "pending_payment"]);
  }

  // Notify refunded players
  if (refundedIds.length > 0) {
    await sendPushToUsers(admin, refundedIds, {
      title: "Session cancelled — refunded",
      body: `${run.title} was cancelled. Your payment has been refunded.`,
      data: { kind: "session_canceled", run_id },
    });
  }

  // Notify non-paid players
  if (cancelledIds.length > 0) {
    await sendPushToUsers(admin, cancelledIds, {
      title: "Session cancelled",
      body: `${run.title} has been cancelled by the host.`,
      data: { kind: "session_canceled", run_id },
    });
  }

  return NextResponse.json({ ok: true, refunded: refundedIds.length, cancelled: cancelledIds.length });
}
