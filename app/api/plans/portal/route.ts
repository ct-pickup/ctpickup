import { NextResponse } from "next/server";
import Stripe from "stripe";

import { requireFlag } from "@/lib/flags";
import { assertPlansTestKey, PLANS_UNAVAILABLE_MESSAGE } from "@/lib/plans/stripePlans";
import { requireAuthedUser } from "@/lib/referral/auth";
import { requestSiteUrlFromRequest } from "@/lib/requestSiteUrl";
import { checkPersistentRateLimit, rateLimitResponse } from "@/lib/server/persistentRateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "plans-portal";
const PER_HOUR = 10;

/**
 * POST /api/plans/portal
 * Opens the Stripe billing portal for the signed-in player's Concierge subscription (update the card, cancel) and returns its URL.
 * Same rules as checkout: both 'paid_plans' and 'fields' flags (admins always on), rate limited, Stripe test mode unless
 * STRIPE_PLANS_ALLOW_LIVE is "1". Needs a billing portal configuration saved in the Stripe dashboard for the mode in use.
 */
export async function POST(req: Request) {
  const auth = await requireAuthedUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const off = await requireFlag(auth.admin, ["paid_plans", "fields"], auth.user.id);
  if (off) return off;

  const limited = await checkPersistentRateLimit({ route: ROUTE, ip: auth.user.id, limit: PER_HOUR, windowSeconds: 3600 });
  if (!limited.ok) return rateLimitResponse(limited.retryAfterSeconds);

  let secret: string;
  try {
    secret = assertPlansTestKey();
  } catch (e) {
    console.error(`[api/${ROUTE}] plans not available:`, e instanceof Error ? e.message : "unknown");
    return NextResponse.json({ error: PLANS_UNAVAILABLE_MESSAGE }, { status: 503 });
  }

  const { data, error } = await auth.admin
    .from("plan_subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", auth.user.id)
    .in("status", ["active", "trialing"])
    .not("stripe_customer_id", "is", null)
    .limit(1);
  if (error) {
    console.error(`[api/${ROUTE}] subscription lookup failed`, error.message);
    return NextResponse.json({ error: PLANS_UNAVAILABLE_MESSAGE }, { status: 500 });
  }
  const customer = ((data ?? [])[0] as { stripe_customer_id?: string | null } | undefined)?.stripe_customer_id;
  if (!customer) return NextResponse.json({ error: "You don't have an active plan.", code: "no_active_plan" }, { status: 404 });

  try {
    const stripe = new Stripe(secret);
    const session = await stripe.billingPortal.sessions.create({
      customer,
      return_url: `${requestSiteUrlFromRequest(req)}/plans/return?status=portal`,
    });
    if (!session.url) {
      console.error(`[api/${ROUTE}] stripe returned no portal url`);
      return NextResponse.json({ error: PLANS_UNAVAILABLE_MESSAGE }, { status: 502 });
    }
    return NextResponse.json({ ok: true, url: session.url });
  } catch (e) {
    console.error(`[api/${ROUTE}] stripe error`, e instanceof Error ? e.message : "unknown");
    return NextResponse.json({ error: PLANS_UNAVAILABLE_MESSAGE }, { status: 502 });
  }
}
