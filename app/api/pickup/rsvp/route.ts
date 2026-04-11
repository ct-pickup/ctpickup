import { NextResponse } from "next/server";
import { ensurePickupRunInviteLink } from "@/lib/pickup/ensureRunInviteLink";
import { requestSiteUrlFromRequest } from "@/lib/requestSiteUrl";
import { assertPickupStandingAllowsParticipation } from "@/lib/pickup/standing/participationGate";
import { userHasAcceptedCurrentWaiver } from "@/lib/waiver/checkWaiverAccepted";
import { PICKUP_FIELD_FEE_STRIPE_DESCRIPTION } from "@/lib/fees/refundPolicyCopy";
import { paymentIntentIdFromCheckoutSession } from "@/lib/payments/stripeSessionIds";
import { recordPlatformCheckoutStarted } from "@/lib/payments/recordCheckoutStarted";
import { getStripePickup, getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

type Body = { action: "join" | "decline"; run_id: string };

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

  const body = (await req.json()) as Body;
  if (!body?.action || !body?.run_id) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const runRes = await admin.from("pickup_runs").select("*").eq("id", body.run_id).maybeSingle();
  const run = runRes.data;
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });

  // Final RSVP only opens after admin finalizes slot
  if (run.status !== "active" || !run.start_at || !run.final_slot_id) {
    return NextResponse.json({ error: "Final RSVP not open yet." }, { status: 403 });
  }

  const prof = await admin
    .from("profiles")
    .select("approved, tier_rank, tier")
    .eq("id", user.id)
    .maybeSingle();

  if (!prof.data?.approved) {
    return NextResponse.json({ error: "Account pending approval." }, { status: 403 });
  }

  // Must have availability available for final slot
  const myAvail = await admin
    .from("pickup_run_availability")
    .select("state, slot_id")
    .eq("run_id", run.id)
    .eq("user_id", user.id)
    .maybeSingle();

  const eligible =
    myAvail.data?.state === "available" && myAvail.data?.slot_id === run.final_slot_id;

  if (!eligible) {
    return NextResponse.json({ error: "Not eligible for this final RSVP." }, { status: 403 });
  }

  // Cancellation cutoff applies only once start_at exists
  const now = Date.now();
  const deadline = run.cancellation_deadline ? new Date(run.cancellation_deadline).getTime() : null;
  if (deadline && now > deadline) {
    return NextResponse.json({ error: "Deadline passed." }, { status: 403 });
  }

  const existing = await admin
    .from("pickup_run_rsvps")
    .select("*")
    .eq("run_id", run.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (body.action === "decline") {
    if (existing.data?.status === "pending_payment") {
      return NextResponse.json({ error: "Payment is pending. Contact admin." }, { status: 409 });
    }

    const newStatus =
      existing.data?.status && existing.data.status !== "declined" ? "canceled" : "declined";

    await admin.from("pickup_run_rsvps").upsert(
      {
        run_id: run.id,
        user_id: user.id,
        tier_at_time: prof.data?.tier || null,
        status: newStatus,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "run_id,user_id" }
    );

    return NextResponse.json({ ok: true, status: newStatus });
  }

  // JOIN
  const confirmedCountRes = await admin
    .from("pickup_run_rsvps")
    .select("id", { count: "exact", head: true })
    .eq("run_id", run.id)
    .eq("status", "confirmed");

  const confirmedCount = confirmedCountRes.count || 0;
  const capacity = Number(run.capacity || 0);
  const hasSlot = confirmedCount < capacity;

  if (!hasSlot) {
    await admin.from("pickup_run_rsvps").upsert(
      {
        run_id: run.id,
        user_id: user.id,
        tier_at_time: prof.data?.tier || null,
        status: "standby",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "run_id,user_id" }
    );
    await ensurePickupRunInviteLink(admin, run.id, user.id);
    return NextResponse.json({ ok: true, status: "standby" });
  }

  const feeCents = Number(run.fee_cents || 0);
  if (feeCents <= 0) {
    await admin.from("pickup_run_rsvps").upsert(
      {
        run_id: run.id,
        user_id: user.id,
        tier_at_time: prof.data?.tier || null,
        status: "confirmed",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "run_id,user_id" }
    );
    await ensurePickupRunInviteLink(admin, run.id, user.id);
    return NextResponse.json({ ok: true, status: "confirmed" });
  }

  let stripe;
  try {
    stripe = getStripePickup();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("stripe_pickup_rsvp_config_error:", msg);
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
    const currency = String(run.currency || "usd").trim().toLowerCase() || "usd";
    const unitAmount = Number.isFinite(feeCents) ? Math.round(feeCents) : feeCents;
    const successUrl = `${baseUrl}/pickup?paid=1`;
    const cancelUrl = `${baseUrl}/pickup?canceled=1`;

    const snapshot = {
      event: "stripe_checkout_create_attempt" as const,
      route: "app/api/pickup/rsvp/route.ts" as const,
      baseUrl,
      success_url: successUrl,
      cancel_url: cancelUrl,
      mode: "payment" as const,
      currency,
      unit_amount: unitAmount,
      customer_email_present: !!(user.email && String(user.email).trim()),
      metadata_keys: Object.keys(pickupMeta),
    };

    console.log(
      JSON.stringify(snapshot),
    );

    session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: user.email || undefined,
      line_items: [
        {
          price_data: {
            currency,
            unit_amount: unitAmount,
            product_data: {
              name: `CT Pickup Field Fee`,
              description: PICKUP_FIELD_FEE_STRIPE_DESCRIPTION,
            },
          },
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { ...pickupMeta },
      payment_intent_data: {
        metadata: { ...pickupMeta },
      },
    });
  } catch (e: unknown) {
    const err = e as any;
    console.error(
      "stripe_pickup_rsvp_checkout_error:",
      JSON.stringify({
        event: "stripe_checkout_error",
        route: "app/api/pickup/rsvp/route.ts",
        name: err?.name || null,
        message: err?.message || (e instanceof Error ? e.message : String(e)),
        stripe_type: err?.type || null,
        stripe_code: err?.code || null,
        stripe_param: err?.param || null,
        stripe_status_code: err?.statusCode || null,
        stripe_request_id: err?.requestId || null,
        reached_stripe: true,
        request: {
          baseUrl,
          success_url: `${baseUrl}/pickup?paid=1`,
          cancel_url: `${baseUrl}/pickup?canceled=1`,
          mode: "payment",
          currency: String(run.currency || "usd").trim().toLowerCase() || "usd",
          unit_amount: Number.isFinite(feeCents) ? Math.round(feeCents) : feeCents,
          customer_email_present: !!(user.email && String(user.email).trim()),
          metadata_keys: Object.keys({
            kind: "pickup" as const,
            run_id: String(run.id),
            user_id: String(user.id),
          }),
        },
      }),
    );
    return NextResponse.json(
      { error: "Checkout could not be created." },
      { status: 500 },
    );
  }

  console.log(
    JSON.stringify({
      stripe_checkout: true,
      flow: "pickup_rsvp",
      checkout_session_id: session.id,
      run_id: run.id,
    }),
  );

  await admin.from("pickup_run_rsvps").upsert(
    {
      run_id: run.id,
      user_id: user.id,
      tier_at_time: prof.data?.tier || null,
      status: "pending_payment",
      checkout_session_id: session.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "run_id,user_id" }
  );

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
    metadata: { run_id: run.id, flow: "pickup_rsvp" },
  });

  await ensurePickupRunInviteLink(admin, run.id, user.id);

  return NextResponse.json({ ok: true, checkout_url: session.url });
}
