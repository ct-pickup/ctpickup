import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: (process.env.STRIPE_API_VERSION as any) || "2026-02-25",
});

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "missing_signature" }, { status: 400 });

  // IMPORTANT: use raw bytes, not req.text()
  const raw = Buffer.from(await req.arrayBuffer());

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err: any) {
    console.log("WEBHOOK env whsec len:", (process.env.STRIPE_WEBHOOK_SECRET || "").length);
    console.log("WEBHOOK env whsec head:", (process.env.STRIPE_WEBHOOK_SECRET || "").slice(0, 6));
    console.log("WEBHOOK bad_signature:", err?.message || err);
    return NextResponse.json(
      { error: "bad_signature", details: String(err?.message || err) },
      { status: 400 }
    );
  }

  // Always return 200 for events we don't care about
  if (event.type !== "checkout.session.completed") {
    return NextResponse.json({ received: true });
  }

  const session = event.data.object as Stripe.Checkout.Session;

  const sessionId = session.id;
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || null;

  // -------------------------
  // PICKUP (NEW)
  // -------------------------
  if (session.metadata?.kind === "pickup") {
    const runId = session.metadata.run_id;
    const userId = session.metadata.user_id;

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

      return NextResponse.json({ received: true });
    }

    // fallback: match by checkout session id
    const { data: rsvp } = await admin
      .from("pickup_run_rsvps")
      .select("run_id,user_id")
      .eq("checkout_session_id", sessionId)
      .maybeSingle();

    if (rsvp) {
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

      return NextResponse.json({ received: true });
    }

    return NextResponse.json({ received: true });
  }

  // -------------------------
  // TOURNAMENT (EXISTING)
  // -------------------------
  const { data: pay } = await admin
    .from("tournament_payments")
    .select("*")
    .eq("stripe_session_id", sessionId)
    .maybeSingle();

  if (pay && pay.status !== "captured") {
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

  return NextResponse.json({ received: true });
}
