import { NextResponse } from "next/server";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ensurePickupRunInviteLink } from "@/lib/pickup/ensureRunInviteLink";
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
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const sessionId = session.id;
      const paymentIntentId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id || null;

      if (session.metadata?.kind === "pickup") {
        await fulfillPickup(admin, {
          sessionId,
          paymentIntentId,
          runId: session.metadata.run_id,
          userId: session.metadata.user_id,
        });
        stripeEventLog("stripe_webhook_fulfilled_pickup", event, {
          checkout_session_id: sessionId,
        });
        return NextResponse.json({ received: true });
      }

      await fulfillTournament(admin, {
        sessionId,
        paymentIntentId,
        captainId: session.metadata?.captain_id,
      });
      stripeEventLog("stripe_webhook_fulfilled_tournament", event, {
        checkout_session_id: sessionId,
      });
      return NextResponse.json({ received: true });
    }

    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object as Stripe.PaymentIntent;
      const md = pi.metadata || {};
      const paymentIntentId = pi.id;

      if (md.kind === "pickup" && md.run_id && md.user_id) {
        await fulfillPickup(admin, {
          sessionId: null,
          paymentIntentId,
          runId: md.run_id,
          userId: md.user_id,
        });
        stripeEventLog("stripe_webhook_fulfilled_pickup_pi", event, {
          payment_intent_id: paymentIntentId,
        });
        return NextResponse.json({ received: true });
      }

      if (md.kind === "tournament" && md.captain_id) {
        await fulfillTournament(admin, {
          sessionId: null,
          paymentIntentId,
          captainId: md.captain_id,
        });
        stripeEventLog("stripe_webhook_fulfilled_tournament_pi", event, {
          payment_intent_id: paymentIntentId,
        });
        return NextResponse.json({ received: true });
      }

      stripeEventLog("stripe_webhook_payment_intent_unhandled", event, {
        payment_intent_id: paymentIntentId,
      });
      return NextResponse.json({ received: true });
    }

    return NextResponse.json({ received: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("stripe_webhook_handler_error:", msg);
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }
}
