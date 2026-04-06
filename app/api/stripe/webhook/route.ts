import { NextResponse } from "next/server";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ensurePickupRunInviteLink } from "@/lib/pickup/ensureRunInviteLink";
import {
  findPlatformPaymentIdByPaymentIntent,
  findPlatformPaymentIdBySession,
  logStripeWebhookEvent,
  patchPlatformPaymentByPaymentIntentId,
  patchPlatformPaymentBySessionId,
} from "@/lib/payments/webhookPersistence";
import { recomputePickupStandingForUser } from "@/lib/pickup/standing/recomputePickupStanding";
import { verifyPickupPaidAndConfirmed, verifyTournamentPaymentApplied } from "@/lib/payments/verifyStripeFulfillment";
import {
  getStripeTournament,
  getStripeWebhookSecret,
  getSupabaseAdmin,
} from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

function stripeEventLog(
  message: string,
  event: Pick<Stripe.Event, "id" | "type">,
  extra?: Record<string, string | null | undefined>,
) {
  const payload: Record<string, unknown> = {
    message,
    event_id: event.id,
    event_type: event.type,
  };
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v != null && v !== "") payload[k] = v;
    }
  }
  console.log(JSON.stringify({ stripe_webhook: true, ...payload }));
}

function paymentIntentIdFromSession(session: Stripe.Checkout.Session): string | null {
  const pi = session.payment_intent;
  if (typeof pi === "string") return pi;
  return pi?.id || null;
}

async function fulfillPickup(
  admin: SupabaseClient,
  opts: {
    sessionId: string | null;
    paymentIntentId: string | null;
    runId: string | undefined;
    userId: string | undefined;
  },
) {
  const { sessionId, paymentIntentId, runId, userId } = opts;
  if (runId && userId) {
    await admin
      .from("pickup_run_rsvps")
      .update({
        status: "confirmed",
        paid_at: new Date().toISOString(),
        payment_intent_id: paymentIntentId,
        updated_at: new Date().toISOString(),
      })
      .eq("run_id", runId)
      .eq("user_id", userId);
    await ensurePickupRunInviteLink(admin, runId, userId);
    return;
  }
  if (!sessionId) return;
  const { data: rsvp } = await admin
    .from("pickup_run_rsvps")
    .select("run_id,user_id")
    .eq("checkout_session_id", sessionId)
    .maybeSingle();
  if (!rsvp) return;
  await admin
    .from("pickup_run_rsvps")
    .update({
      status: "confirmed",
      paid_at: new Date().toISOString(),
      payment_intent_id: paymentIntentId,
      updated_at: new Date().toISOString(),
    })
    .eq("run_id", rsvp.run_id)
    .eq("user_id", rsvp.user_id);
  await ensurePickupRunInviteLink(admin, rsvp.run_id, rsvp.user_id);
}

async function fulfillTournament(
  admin: SupabaseClient,
  opts: {
    sessionId: string | null;
    paymentIntentId: string | null;
    captainId: string | undefined;
  },
) {
  const { sessionId, paymentIntentId, captainId } = opts;
  let pay: { id: string; status: string; captain_id: string } | null = null;

  if (sessionId) {
    const { data } = await admin
      .from("tournament_payments")
      .select("id,status,captain_id")
      .eq("stripe_session_id", sessionId)
      .maybeSingle();
    pay = data;
  }
  if (!pay && captainId) {
    const { data } = await admin
      .from("tournament_payments")
      .select("id,status,captain_id")
      .eq("captain_id", captainId)
      .eq("status", "pending")
      .maybeSingle();
    pay = data;
  }
  if (!pay || pay.status === "captured") return;

  await admin
    .from("tournament_payments")
    .update({ status: "captured", stripe_payment_intent_id: paymentIntentId })
    .eq("id", pay.id);

  await admin
    .from("tournament_captains")
    .update({
      status: "payment_received",
      payment_method: "stripe",
      players_paid: 5,
      payment_received_at: new Date().toISOString(),
    })
    .eq("id", pay.captain_id);
}

async function handlePaidCheckoutSession(
  admin: SupabaseClient,
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
) {
  const sessionId = session.id;
  const paymentIntentId = paymentIntentIdFromSession(session);
  const platformPaymentId = await findPlatformPaymentIdBySession(admin, sessionId);
  const now = new Date().toISOString();

  const md = session.metadata || {};
  const kind = md.kind;

  try {
    if (kind === "pickup") {
      await fulfillPickup(admin, {
        sessionId,
        paymentIntentId,
        runId: md.run_id,
        userId: md.user_id,
      });
      const v = await verifyPickupPaidAndConfirmed(admin, {
        runId: md.run_id,
        userId: md.user_id,
        sessionId,
      });

      await patchPlatformPaymentBySessionId(admin, sessionId, {
        lifecycle_status: "payment_received",
        stripe_payment_intent_id: paymentIntentId,
        stripe_payment_received_at: now,
        fulfillment_status: v.ok ? "succeeded" : "failed",
        fulfillment_message: v.ok ? null : v.detail,
        completed_at: v.ok ? now : null,
      });

      await logStripeWebhookEvent(admin, {
        platform_payment_id: platformPaymentId,
        stripe_event_id: event.id,
        event_type: event.type,
        outcome: v.ok ? "processed_ok" : "processed_failed",
        staff_summary: v.ok
          ? "Checkout finished and the pickup spot was confirmed in the app."
          : "Checkout finished, but the pickup RSVP did not show as confirmed. Someone may need to fix this manually.",
        needs_retry: !v.ok,
        error_detail: v.ok ? null : v.detail,
      });
      if (md.user_id) {
        try {
          await recomputePickupStandingForUser(admin, String(md.user_id));
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("pickup_standing_recompute_after_checkout:", msg);
        }
      }
      return NextResponse.json({ received: true });
    }

    if (kind === "tournament") {
      await fulfillTournament(admin, {
        sessionId,
        paymentIntentId,
        captainId: md.captain_id,
      });
      const v = await verifyTournamentPaymentApplied(admin, {
        sessionId,
        captainId: md.captain_id,
        paymentIntentId,
      });

      await patchPlatformPaymentBySessionId(admin, sessionId, {
        lifecycle_status: "payment_received",
        stripe_payment_intent_id: paymentIntentId,
        stripe_payment_received_at: now,
        fulfillment_status: v.ok ? "succeeded" : "failed",
        fulfillment_message: v.ok ? null : v.detail,
        completed_at: v.ok ? now : null,
      });

      await logStripeWebhookEvent(admin, {
        platform_payment_id: platformPaymentId,
        stripe_event_id: event.id,
        event_type: event.type,
        outcome: v.ok ? "processed_ok" : "processed_failed",
        staff_summary: v.ok
          ? "Checkout finished and tournament registration was updated."
          : "Checkout finished, but tournament registration did not show as paid. Someone may need to fix this manually.",
        needs_retry: !v.ok,
        error_detail: v.ok ? null : v.detail,
      });
      return NextResponse.json({ received: true });
    }

    await logStripeWebhookEvent(admin, {
      platform_payment_id: platformPaymentId,
      stripe_event_id: event.id,
      event_type: event.type,
      outcome: "ignored",
      staff_summary:
        "Checkout completed, but this product type is not handled yet in the payment tracker. No app changes were made from this event.",
      needs_retry: false,
    });
    return NextResponse.json({ received: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    await patchPlatformPaymentBySessionId(admin, sessionId, {
      lifecycle_status: "payment_received",
      stripe_payment_intent_id: paymentIntentId,
      stripe_payment_received_at: now,
      fulfillment_status: "failed",
      fulfillment_message: msg,
      completed_at: null,
    });
    await logStripeWebhookEvent(admin, {
      platform_payment_id: platformPaymentId,
      stripe_event_id: event.id,
      event_type: event.type,
      outcome: "processed_failed",
      staff_summary:
        "Stripe reported a successful checkout, but the app hit an error while updating records. Retrying may help if it was temporary.",
      needs_retry: true,
      error_detail: msg,
    });
    console.error("stripe_webhook_handler_error:", msg);
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }
}

async function handlePaymentIntentSucceeded(admin: SupabaseClient, event: Stripe.Event, pi: Stripe.PaymentIntent) {
  const md = pi.metadata || {};
  const paymentIntentId = pi.id;
  const platformPaymentId = await findPlatformPaymentIdByPaymentIntent(admin, paymentIntentId);
  const now = new Date().toISOString();

  if (md.kind === "pickup" && md.run_id && md.user_id) {
    try {
      await fulfillPickup(admin, {
        sessionId: null,
        paymentIntentId,
        runId: md.run_id,
        userId: md.user_id,
      });
      const v = await verifyPickupPaidAndConfirmed(admin, {
        runId: md.run_id,
        userId: md.user_id,
        sessionId: null,
      });

      await patchPlatformPaymentByPaymentIntentId(admin, paymentIntentId, {
        lifecycle_status: "payment_received",
        stripe_payment_intent_id: paymentIntentId,
        stripe_payment_received_at: now,
        fulfillment_status: v.ok ? "succeeded" : "failed",
        fulfillment_message: v.ok ? null : v.detail,
        completed_at: v.ok ? now : null,
      });

      await logStripeWebhookEvent(admin, {
        platform_payment_id: platformPaymentId,
        stripe_event_id: event.id,
        event_type: event.type,
        outcome: v.ok ? "processed_ok" : "processed_failed",
        staff_summary: v.ok
          ? "Payment cleared and the pickup spot was confirmed."
          : "Payment cleared, but the pickup RSVP did not show as confirmed.",
        needs_retry: !v.ok,
        error_detail: v.ok ? null : v.detail,
      });
      if (md.user_id) {
        try {
          await recomputePickupStandingForUser(admin, String(md.user_id));
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("pickup_standing_recompute_after_pi:", msg);
        }
      }
      return NextResponse.json({ received: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      await patchPlatformPaymentByPaymentIntentId(admin, paymentIntentId, {
        lifecycle_status: "payment_received",
        fulfillment_status: "failed",
        fulfillment_message: msg,
      });
      await logStripeWebhookEvent(admin, {
        platform_payment_id: platformPaymentId,
        stripe_event_id: event.id,
        event_type: event.type,
        outcome: "processed_failed",
        staff_summary: "Payment cleared, but updating pickup records failed.",
        needs_retry: true,
        error_detail: msg,
      });
      console.error("stripe_webhook_handler_error:", msg);
      return NextResponse.json({ error: "handler_failed" }, { status: 500 });
    }
  }

  if (md.kind === "tournament" && md.captain_id) {
    try {
      await fulfillTournament(admin, {
        sessionId: null,
        paymentIntentId,
        captainId: md.captain_id,
      });
      const v = await verifyTournamentPaymentApplied(admin, {
        sessionId: null,
        captainId: md.captain_id,
        paymentIntentId,
      });

      await patchPlatformPaymentByPaymentIntentId(admin, paymentIntentId, {
        lifecycle_status: "payment_received",
        stripe_payment_intent_id: paymentIntentId,
        stripe_payment_received_at: now,
        fulfillment_status: v.ok ? "succeeded" : "failed",
        fulfillment_message: v.ok ? null : v.detail,
        completed_at: v.ok ? now : null,
      });

      await logStripeWebhookEvent(admin, {
        platform_payment_id: platformPaymentId,
        stripe_event_id: event.id,
        event_type: event.type,
        outcome: v.ok ? "processed_ok" : "processed_failed",
        staff_summary: v.ok
          ? "Payment cleared and tournament registration was updated."
          : "Payment cleared, but tournament registration did not show as paid.",
        needs_retry: !v.ok,
        error_detail: v.ok ? null : v.detail,
      });
      return NextResponse.json({ received: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      await patchPlatformPaymentByPaymentIntentId(admin, paymentIntentId, {
        lifecycle_status: "payment_received",
        fulfillment_status: "failed",
        fulfillment_message: msg,
      });
      await logStripeWebhookEvent(admin, {
        platform_payment_id: platformPaymentId,
        stripe_event_id: event.id,
        event_type: event.type,
        outcome: "processed_failed",
        staff_summary: "Payment cleared, but updating tournament records failed.",
        needs_retry: true,
        error_detail: msg,
      });
      console.error("stripe_webhook_handler_error:", msg);
      return NextResponse.json({ error: "handler_failed" }, { status: 500 });
    }
  }

  await logStripeWebhookEvent(admin, {
    platform_payment_id: platformPaymentId,
    stripe_event_id: event.id,
    event_type: event.type,
    outcome: "ignored",
    staff_summary:
      "A payment succeeded in Stripe, but it was not tied to a known product in this app. No records were changed.",
    needs_retry: false,
  });
  return NextResponse.json({ received: true });
}

export async function POST(req: Request) {
  let stripe: ReturnType<typeof getStripeTournament>;
  try {
    stripe = getStripeTournament();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("stripe_webhook_config:", msg);
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const admin = getSupabaseAdmin();
  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "missing_signature" }, { status: 400 });
  }

  const raw = Buffer.from(await req.arrayBuffer());

  let webhookSecret: string;
  try {
    webhookSecret = getStripeWebhookSecret();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("stripe_webhook_config:", msg);
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, webhookSecret);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("stripe_webhook_signature_failed:", msg);
    return NextResponse.json({ error: "bad_signature" }, { status: 400 });
  }

  stripeEventLog("stripe_webhook_received", event);
  stripeEventLog("stripe_webhook_verified", event);

  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const session = event.data.object as Stripe.Checkout.Session;
      return await handlePaidCheckoutSession(admin, event, session);
    }

    if (event.type === "checkout.session.expired") {
      const session = event.data.object as Stripe.Checkout.Session;
      const sessionId = session.id;
      const platformPaymentId = await findPlatformPaymentIdBySession(admin, sessionId);
      const now = new Date().toISOString();
      await patchPlatformPaymentBySessionId(admin, sessionId, {
        lifecycle_status: "checkout_expired",
        fulfillment_status: "pending",
        fulfillment_message: "Checkout expired before payment.",
      });
      await logStripeWebhookEvent(admin, {
        platform_payment_id: platformPaymentId,
        stripe_event_id: event.id,
        event_type: event.type,
        outcome: "processed_ok",
        staff_summary: "Checkout expired before the customer paid. No charge was completed.",
        needs_retry: false,
      });
      const { data: payRow } = await admin
        .from("platform_payments")
        .select("user_id,product_type")
        .eq("stripe_checkout_session_id", sessionId)
        .maybeSingle();
      if (payRow?.product_type === "pickup" && payRow.user_id) {
        try {
          await recomputePickupStandingForUser(admin, payRow.user_id);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("pickup_standing_recompute_after_expired:", msg);
        }
      }
      stripeEventLog("stripe_webhook_checkout_expired", event, { checkout_session_id: sessionId });
      return NextResponse.json({ received: true });
    }

    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object as Stripe.PaymentIntent;
      return await handlePaymentIntentSucceeded(admin, event, pi);
    }

    if (event.type === "payment_intent.payment_failed") {
      const pi = event.data.object as Stripe.PaymentIntent;
      const paymentIntentId = pi.id;
      const platformPaymentId = await findPlatformPaymentIdByPaymentIntent(admin, paymentIntentId);
      const lastErr = pi.last_payment_error?.message || null;
      await patchPlatformPaymentByPaymentIntentId(admin, paymentIntentId, {
        lifecycle_status: "payment_failed",
        fulfillment_status: "pending",
        fulfillment_message: lastErr,
      });
      await logStripeWebhookEvent(admin, {
        platform_payment_id: platformPaymentId,
        stripe_event_id: event.id,
        event_type: event.type,
        outcome: "processed_ok",
        staff_summary: "The card or bank declined this payment (or it could not be completed).",
        needs_retry: false,
        error_detail: lastErr,
      });
      const { data: payRow } = await admin
        .from("platform_payments")
        .select("user_id,product_type")
        .eq("stripe_payment_intent_id", paymentIntentId)
        .maybeSingle();
      if (payRow?.product_type === "pickup" && payRow.user_id) {
        try {
          await recomputePickupStandingForUser(admin, payRow.user_id);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("pickup_standing_recompute_after_payment_failed:", msg);
        }
      }
      return NextResponse.json({ received: true });
    }

    if (event.type === "charge.refunded") {
      const charge = event.data.object as Stripe.Charge;
      const piRaw = charge.payment_intent;
      const paymentIntentId =
        typeof piRaw === "string" ? piRaw : (piRaw as Stripe.PaymentIntent | null)?.id ?? null;
      if (paymentIntentId) {
        const platformPaymentId = await findPlatformPaymentIdByPaymentIntent(admin, paymentIntentId);
        await patchPlatformPaymentByPaymentIntentId(admin, paymentIntentId, {
          lifecycle_status: "refunded",
          refunded_at: new Date().toISOString(),
        });
        await logStripeWebhookEvent(admin, {
          platform_payment_id: platformPaymentId,
          stripe_event_id: event.id,
          event_type: event.type,
          outcome: "processed_ok",
          staff_summary: "A refund was recorded in Stripe for this charge.",
          needs_retry: false,
        });
      } else {
        await logStripeWebhookEvent(admin, {
          platform_payment_id: null,
          stripe_event_id: event.id,
          event_type: event.type,
          outcome: "received_only",
          staff_summary:
            "Stripe sent a refund notice, but it could not be matched to a saved payment in this app.",
          needs_retry: false,
        });
      }
      return NextResponse.json({ received: true });
    }

    await logStripeWebhookEvent(admin, {
      platform_payment_id: null,
      stripe_event_id: event.id,
      event_type: event.type,
      outcome: "received_only",
      staff_summary: "This Stripe event was received. No app action is required for it right now.",
      needs_retry: false,
    });
    return NextResponse.json({ received: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("stripe_webhook_handler_error:", msg);
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }
}
