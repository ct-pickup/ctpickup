import { NextResponse } from "next/server";
import Stripe from "stripe";

import { assertPlansTestKey, planPriceId, PLAN_PRODUCT_TAG } from "@/lib/plans/stripePlans";
import { requestSiteUrlFromRequest } from "@/lib/requestSiteUrl";
import { requireAuthedUser } from "@/lib/referral/auth";
import { checkPersistentRateLimit, rateLimitResponse } from "@/lib/server/persistentRateLimit";
import { isPlanId } from "@/shared/fields/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "plans-checkout";
const PER_HOUR = 10;

/**
 * POST /api/plans/checkout  { plan: "scout" | "email" | "concierge" }
 * Creates a Stripe Checkout Session (subscription mode) and returns its URL. TEST mode only, and admin only for now.
 */
export async function POST(req: Request) {
  const auth = await requireAuthedUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const limited = await checkPersistentRateLimit({ route: ROUTE, ip: auth.user.id, limit: PER_HOUR, windowSeconds: 3600 });
  if (!limited.ok) return rateLimitResponse(limited.retryAfterSeconds);

  // Plans are admin-only until launch.
  const { data: prof } = await auth.admin.from("profiles").select("is_admin").eq("id", auth.user.id).maybeSingle();
  if ((prof as { is_admin?: boolean } | null)?.is_admin !== true) {
    return NextResponse.json({ error: "Plans aren’t available yet." }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!isPlanId(body.plan)) return NextResponse.json({ error: "Pick a plan." }, { status: 400 });
  const plan = body.plan;

  let secret: string;
  try {
    secret = assertPlansTestKey();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Stripe is not set up." }, { status: 503 });
  }
  const priceId = planPriceId(plan);
  if (!priceId) return NextResponse.json({ error: `Missing the Stripe price for ${plan}.` }, { status: 503 });

  // One live plan at a time. Changing plans comes later.
  const { data: existing } = await auth.admin
    .from("plan_subscriptions")
    .select("plan,stripe_customer_id")
    .eq("user_id", auth.user.id)
    .in("status", ["active", "trialing"])
    .limit(1);
  const current = (existing ?? [])[0] as { plan: string; stripe_customer_id: string | null } | undefined;
  if (current) return NextResponse.json({ error: `You already have the ${current.plan} plan.`, code: "already_subscribed" }, { status: 409 });

  const stripe = new Stripe(secret);
  const origin = requestSiteUrlFromRequest(req);
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
      success_url: `${origin}/plans/return?status=success`,
      cancel_url: `${origin}/plans/return?status=canceled`,
    });
    if (!session.url) return NextResponse.json({ error: "Stripe did not return a checkout link." }, { status: 502 });
    return NextResponse.json({ ok: true, url: session.url });
  } catch (e) {
    console.error(`[api/${ROUTE}] stripe error`, e instanceof Error ? e.message : "unknown");
    return NextResponse.json({ error: "We couldn’t start checkout. Please try again." }, { status: 502 });
  }
}
