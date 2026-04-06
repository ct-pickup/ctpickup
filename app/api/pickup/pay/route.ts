import { NextResponse } from "next/server";
import { requestSiteUrlFromRequest } from "@/lib/requestSiteUrl";
import { assertPickupStandingAllowsParticipation } from "@/lib/pickup/standing/participationGate";
import { userHasAcceptedCurrentWaiver } from "@/lib/waiver/checkWaiverAccepted";
import { paymentIntentIdFromCheckoutSession } from "@/lib/payments/stripeSessionIds";
import { recordPlatformCheckoutStarted } from "@/lib/payments/recordCheckoutStarted";
import { getStripePickup, getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

export async function POST(req: Request) {
  const admin = getSupabaseAdmin();

  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const u = await admin.auth.getUser(token);
  const user = u.data.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const waiverOk = await userHasAcceptedCurrentWaiver(user.id);
  if (!waiverOk) {
    return NextResponse.json({ error: "waiver_required" }, { status: 403 });
  }

  const standingGate = await assertPickupStandingAllowsParticipation(admin, user.id);
  if (!standingGate.ok) {
    return NextResponse.json(
      { error: standingGate.code, detail: standingGate.detail },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const run_id = String(body.run_id || "");
  if (!run_id) return NextResponse.json({ error: "Missing run_id" }, { status: 400 });

  const runRes = await admin.from("pickup_runs").select("*").eq("id", run_id).maybeSingle();
  const run = runRes.data;
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });

  const rsvp = await admin
    .from("pickup_run_rsvps")
    .select("*")
    .eq("run_id", run.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!rsvp.data || rsvp.data.status !== "pending_payment") {
    return NextResponse.json({ error: "No pending payment for this run." }, { status: 409 });
  }

  const feeCents = Number(run.fee_cents || 0);
  if (feeCents <= 0) return NextResponse.json({ error: "This run is free." }, { status: 409 });

  let stripe;
  try {
    stripe = getStripePickup();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("stripe_pickup_pay_config_error:", msg);
    return NextResponse.json(
      { error: "Stripe is not configured." },
      { status: 500 },
    );
  }

  const baseUrl = requestSiteUrlFromRequest(req);

  const pickupMeta = {
    kind: "pickup" as const,
    run_id: String(run.id),
    user_id: String(user.id),
  };

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: user.email || undefined,
      line_items: [
        {
          price_data: {
            currency: run.currency || "usd",
            unit_amount: feeCents,
            product_data: { name: `CT Pickup Field Fee` },
          },
          quantity: 1,
        },
      ],
      success_url: `${baseUrl}/pickup?paid=1`,
      cancel_url: `${baseUrl}/pickup?canceled=1`,
      metadata: { ...pickupMeta },
      payment_intent_data: {
        metadata: { ...pickupMeta },
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("stripe_pickup_pay_checkout_error:", msg);
    return NextResponse.json(
      { error: "Payment session could not be created." },
      { status: 500 },
    );
  }

  console.log(
    JSON.stringify({
      stripe_checkout: true,
      flow: "pickup_pay",
      checkout_session_id: session.id,
      run_id: run.id,
    }),
  );

  await admin
    .from("pickup_run_rsvps")
    .update({
      checkout_session_id: session.id,
      updated_at: new Date().toISOString(),
    })
    .eq("run_id", run.id)
    .eq("user_id", user.id);

  await recordPlatformCheckoutStarted(admin, {
    productType: "pickup",
    productEntityId: String(run.id),
    userId: user.id,
    stripeCheckoutSessionId: session.id,
    stripePaymentIntentId: paymentIntentIdFromCheckoutSession(session),
    amountCents: feeCents,
    currency: String(run.currency || "usd"),
    title: `Pickup field fee — ${String(run.title || "Run").trim() || "Run"}`,
    summary: null,
    metadata: { run_id: run.id, flow: "pickup_pay" },
  });

  return NextResponse.json({ ok: true, url: session.url });
}
