import { NextResponse } from "next/server";
import Stripe from "stripe";

import { assertPlansTestKey, plansWebhookSecret, PLAN_PRODUCT_TAG, subscriptionToRow } from "@/lib/plans/stripePlans";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function saveSubscription(sub: Stripe.Subscription, fallbackUserId: string | null): Promise<"saved" | "ignored"> {
  const admin = getSupabaseAdmin();
  let row = subscriptionToRow(sub, fallbackUserId);
  if (!row && sub.metadata?.product === PLAN_PRODUCT_TAG) {
    // An update with no user in its metadata: reuse the user we stored when the plan started.
    const { data } = await admin.from("plan_subscriptions").select("user_id").eq("stripe_subscription_id", sub.id).maybeSingle();
    const uid = (data as { user_id?: string } | null)?.user_id;
    if (uid) row = subscriptionToRow(sub, uid);
  }
  if (!row) return "ignored";
  const { error } = await admin.from("plan_subscriptions").upsert(row, { onConflict: "stripe_subscription_id" });
  if (error) throw new Error(error.message);
  return "saved";
}

/**
 * POST /api/stripe/plans-webhook  (Stripe TEST mode, Fields plans only)
 * Verifies the signature with STRIPE_PLANS_WEBHOOK_SECRET, then keeps plan_subscriptions in step with Stripe:
 *   checkout.session.completed, customer.subscription.updated, customer.subscription.deleted.
 * Anything else, and subscriptions that are not Fields plans, are acknowledged and ignored.
 * A failure while saving returns 500 so Stripe retries.
 */
export async function POST(req: Request) {
  let secretKey: string;
  let whsec: string;
  try {
    secretKey = assertPlansTestKey();
    whsec = plansWebhookSecret();
  } catch (e) {
    console.error("[plans-webhook] not configured:", e instanceof Error ? e.message : "unknown");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "missing_signature" }, { status: 400 });

  const stripe = new Stripe(secretKey);
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, signature, whsec);
  } catch {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      if (session.mode === "subscription" && subId && session.metadata?.product === PLAN_PRODUCT_TAG) {
        const sub = await stripe.subscriptions.retrieve(subId);
        const result = await saveSubscription(sub, session.client_reference_id ?? session.metadata?.user_id ?? null);
        console.log(JSON.stringify({ plans_webhook: true, event_id: event.id, type: event.type, result }));
      }
    } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const sub = event.data.object as Stripe.Subscription;
      const result = await saveSubscription(sub, null);
      console.log(JSON.stringify({ plans_webhook: true, event_id: event.id, type: event.type, result }));
    }
  } catch (e) {
    console.error("[plans-webhook] handler failed:", e instanceof Error ? e.message : "unknown");
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
