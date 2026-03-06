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

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err: any) {
    return NextResponse.json({ error: "bad_signature", details: String(err?.message || err) }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    const sessionId = session.id;
    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id || null;

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

      // Stage: Payment Received (NOT final confirmed)
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
  }

  return NextResponse.json({ received: true });
}
