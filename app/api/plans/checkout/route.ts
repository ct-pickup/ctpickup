import { NextResponse } from "next/server";
import Stripe from "stripe";

import { assertPlansTestKey, planPriceId, PLANS_UNAVAILABLE_MESSAGE, PLAN_PRODUCT_TAG, SEASON_PRODUCT_TAG } from "@/lib/plans/stripePlans";
import { requireFlag } from "@/lib/flags";
import { requestSiteUrlFromRequest } from "@/lib/requestSiteUrl";
import { requireAuthedUser } from "@/lib/referral/auth";
import { checkPersistentRateLimit, rateLimitResponse } from "@/lib/server/persistentRateLimit";
import { isCheckoutPlanId } from "@/shared/fields/plans";
import { etToday } from "@/shared/fields/requestRules";
import { nextWeekdayDate, validateSeasonInput } from "@/shared/fields/season";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "plans-checkout";
const PER_HOUR = 10;

/**
 * POST /api/plans/checkout
 *   { plan: "concierge" }                                                      subscription, $/month
 *   { plan: "season", venue_key, weekday, start_time, duration_hours?, weeks, players? }   one-time payment
 * Creates a Stripe Checkout Session (mode=subscription for Concierge, mode=payment for a season) and returns its URL.
 * Stripe test mode unless STRIPE_PLANS_ALLOW_LIVE is "1" (see assertPlansTestKey). Gated by the 'paid_plans' and 'fields' flags (lib/flags.ts); admins are always on.
 */
export async function POST(req: Request) {
  const auth = await requireAuthedUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // Paid plans need both switches (admins are always on). Old app builds cannot get past this.
  const off = await requireFlag(auth.admin, ["paid_plans", "fields"], auth.user.id);
  if (off) return off;

  const limited = await checkPersistentRateLimit({ route: ROUTE, ip: auth.user.id, limit: PER_HOUR, windowSeconds: 3600 });
  if (!limited.ok) return rateLimitResponse(limited.retryAfterSeconds);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!isCheckoutPlanId(body.plan)) return NextResponse.json({ error: "Pick a plan." }, { status: 400 });
  const plan = body.plan;

  let secret: string;
  try {
    secret = assertPlansTestKey();
  } catch (e) {
    console.error(`[api/${ROUTE}] plans not available:`, e instanceof Error ? e.message : "unknown");
    return NextResponse.json({ error: PLANS_UNAVAILABLE_MESSAGE }, { status: 503 });
  }
  const priceId = planPriceId(plan);
  if (!priceId) {
    console.error(`[api/${ROUTE}] plans not available: missing the Stripe price for ${plan}`);
    return NextResponse.json({ error: PLANS_UNAVAILABLE_MESSAGE }, { status: 503 });
  }

  const stripe = new Stripe(secret);
  const origin = requestSiteUrlFromRequest(req);
  const successUrl = `${origin}/plans/return?status=success`;
  const cancelUrl = `${origin}/plans/return?status=canceled`;

  if (plan === "season") {
    const v = validateSeasonInput(body);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    const { data: venue } = await auth.admin.from("venues").select("venue_key").eq("venue_key", v.value.venue_key).maybeSingle();
    if (!venue) return NextResponse.json({ error: "That field isn’t available yet." }, { status: 404 });

    // Record the purchase first (pending). The webhook marks it paid and creates the one request.
    const startDate = nextWeekdayDate(etToday(), v.value.weekday);
    const { data: purchase, error: pErr } = await auth.admin
      .from("season_purchases")
      .insert({
        user_id: auth.user.id,
        venue_key: v.value.venue_key,
        requested_start_date: startDate,
        weekday: v.value.weekday,
        start_time: `${v.value.start_time}:00`,
        duration_hours: v.value.duration_hours,
        weeks: v.value.weeks,
        players: v.value.players,
      })
      .select("id")
      .single();
    if (pErr || !purchase) {
      console.error(`[api/${ROUTE}] season insert failed`, pErr?.message);
      return NextResponse.json({ error: "We couldn’t start checkout. Please try again." }, { status: 500 });
    }
    const purchaseId = (purchase as { id: string }).id;
    const meta = { product: SEASON_PRODUCT_TAG, user_id: auth.user.id, purchase_id: purchaseId };
    try {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [{ price: priceId, quantity: 1 }],
        client_reference_id: auth.user.id,
        customer_email: auth.user.email ?? undefined,
        metadata: meta,
        payment_intent_data: { metadata: meta },
        success_url: successUrl,
        cancel_url: cancelUrl,
      });
      if (!session.url) return NextResponse.json({ error: "Stripe did not return a checkout link." }, { status: 502 });
      await auth.admin.from("season_purchases").update({ stripe_checkout_session_id: session.id }).eq("id", purchaseId);
      return NextResponse.json({ ok: true, url: session.url, purchase_id: purchaseId });
    } catch (e) {
      await auth.admin.from("season_purchases").update({ status: "failed" }).eq("id", purchaseId);
      console.error(`[api/${ROUTE}] stripe error`, e instanceof Error ? e.message : "unknown");
      return NextResponse.json({ error: "We couldn’t start checkout. Please try again." }, { status: 502 });
    }
  }

  // Concierge: one live subscription at a time. Changing plans comes later.
  const { data: existing } = await auth.admin
    .from("plan_subscriptions")
    .select("plan,stripe_customer_id")
    .eq("user_id", auth.user.id)
    .in("status", ["active", "trialing"])
    .limit(1);
  const current = (existing ?? [])[0] as { plan: string; stripe_customer_id: string | null } | undefined;
  if (current) return NextResponse.json({ error: "You already have the Concierge plan.", code: "already_subscribed" }, { status: 409 });

  const meta = { product: PLAN_PRODUCT_TAG, user_id: auth.user.id, plan };
  try {
    const { data: priorCustomer } = await auth.admin
      .from("plan_subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", auth.user.id)
      .not("stripe_customer_id", "is", null)
      .limit(1);
    const customer = ((priorCustomer ?? [])[0] as { stripe_customer_id?: string } | undefined)?.stripe_customer_id;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: auth.user.id,
      ...(customer ? { customer } : { customer_email: auth.user.email ?? undefined }),
      metadata: meta,
      subscription_data: { metadata: meta },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
    if (!session.url) return NextResponse.json({ error: "Stripe did not return a checkout link." }, { status: 502 });
    return NextResponse.json({ ok: true, url: session.url });
  } catch (e) {
    console.error(`[api/${ROUTE}] stripe error`, e instanceof Error ? e.message : "unknown");
    return NextResponse.json({ error: "We couldn’t start checkout. Please try again." }, { status: 502 });
  }
}
