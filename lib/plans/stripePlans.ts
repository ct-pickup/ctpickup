import type Stripe from "stripe";

import { CHECKOUT_PLAN_IDS, type CheckoutPlanId } from "@/shared/fields/plans";

/** Marks the Concierge subscription (subscription metadata, checkout metadata). */
export const PLAN_PRODUCT_TAG = "fields_plan";
/** Marks a one-time "Book my season" payment (checkout metadata, payment intent metadata). */
export const SEASON_PRODUCT_TAG = "fields_season";

const PRICE_ENV: Record<CheckoutPlanId, string> = {
  season: "STRIPE_PRICE_SEASON",
  concierge: "STRIPE_PRICE_CONCIERGE",
};

export function planPriceId(plan: CheckoutPlanId, env: NodeJS.ProcessEnv = process.env): string | null {
  return env[PRICE_ENV[plan]]?.trim() || null;
}

/** Which paid plan a Stripe price id belongs to, from STRIPE_PRICE_SEASON / STRIPE_PRICE_CONCIERGE. */
export function planFromPriceId(priceId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): CheckoutPlanId | null {
  if (!priceId) return null;
  return CHECKOUT_PLAN_IDS.find((p) => planPriceId(p, env) === priceId) ?? null;
}

/** Step 1 is Stripe TEST mode only. A live key is refused here, whatever the environment. */
export function assertPlansTestKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY");
  if (!key.startsWith("sk_test_")) throw new Error("Fields plans run in Stripe test mode only: STRIPE_SECRET_KEY must be an sk_test_ key");
  return key;
}

export function plansWebhookSecret(env: NodeJS.ProcessEnv = process.env): string {
  const s = env.STRIPE_PLANS_WEBHOOK_SECRET?.trim();
  if (!s) throw new Error("Missing STRIPE_PLANS_WEBHOOK_SECRET");
  return s;
}

const KNOWN_STATUSES = ["incomplete", "incomplete_expired", "trialing", "active", "past_due", "canceled", "unpaid", "paused"] as const;

export type PlanSubscriptionRow = {
  user_id: string;
  plan: "concierge";
  status: (typeof KNOWN_STATUSES)[number];
  stripe_customer_id: string | null;
  stripe_subscription_id: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
};

/** Newer Stripe API versions keep the period on each item; older ones on the subscription. Reads either. */
export function subscriptionPeriodEnd(sub: Stripe.Subscription): string | null {
  const itemEnd = (sub.items?.data?.[0] as unknown as { current_period_end?: number } | undefined)?.current_period_end;
  const subEnd = (sub as unknown as { current_period_end?: number }).current_period_end;
  const t = itemEnd ?? subEnd;
  return typeof t === "number" ? new Date(t * 1000).toISOString() : null;
}

/**
 * The plan_subscriptions row for a Stripe subscription, or null when it is not a Fields plan subscription (no tag, no known
 * price) or we cannot tell whose it is. `fallbackUserId` is the checkout session's client_reference_id.
 */
export function subscriptionToRow(sub: Stripe.Subscription, fallbackUserId: string | null = null, env: NodeJS.ProcessEnv = process.env): PlanSubscriptionRow | null {
  if (sub.metadata?.product !== PLAN_PRODUCT_TAG) return null;
  const userId = sub.metadata?.user_id || fallbackUserId;
  if (!userId) return null;
  const priceId = sub.items?.data?.[0]?.price?.id;
  // Only Concierge is a subscription. The price decides; the metadata is a fallback.
  const plan = planFromPriceId(priceId, env) ?? (sub.metadata?.plan === "concierge" ? "concierge" : null);
  if (plan !== "concierge") return null;
  const status = (KNOWN_STATUSES as readonly string[]).includes(sub.status) ? (sub.status as PlanSubscriptionRow["status"]) : "incomplete";
  const customer = typeof sub.customer === "string" ? sub.customer : (sub.customer?.id ?? null);
  return {
    user_id: userId,
    plan,
    status,
    stripe_customer_id: customer,
    stripe_subscription_id: sub.id,
    current_period_end: subscriptionPeriodEnd(sub),
    cancel_at_period_end: sub.cancel_at_period_end === true,
  };
}
