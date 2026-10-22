import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { assertPlansTestKey, planFromPriceId, planPriceId, plansWebhookSecret, subscriptionToRow } from "../../lib/plans/stripePlans";
import {
  CHECKOUT_PLAN_IDS,
  classifyUsage,
  extraRequestLine,
  formatPlanPrice,
  isCheckoutPlanId,
  isPlanId,
  PLAN_IDS,
  planPriceSuffix,
  PLANS,
  SEASON_MAX_WEEKS,
  SEASON_WEEK_OPTIONS,
  yourPlanLine,
  type PlanStatus,
} from "../../shared/fields/plans";

const ENV = { STRIPE_PRICE_SEASON: "price_season", STRIPE_PRICE_CONCIERGE: "price_concierge" } as unknown as NodeJS.ProcessEnv;

describe("plan config (board 11)", () => {
  it("has the three plans with the placeholder prices in one place", () => {
    expect(PLANS.free).toMatchObject({ priceCents: 0, billing: "free" });
    expect(PLANS.season).toMatchObject({ priceCents: 3900, billing: "one_time" });
    expect(PLANS.concierge).toMatchObject({ priceCents: 2999, billing: "monthly", monthlyRequests: 4, extraCents: 800 });
    expect(PLAN_IDS).toEqual(["season", "concierge", "free"]);
    expect([...CHECKOUT_PLAN_IDS]).toEqual(["season", "concierge"]);
    expect(isCheckoutPlanId("season")).toBe(true);
    expect(isCheckoutPlanId("free")).toBe(false);
    expect(isPlanId("scout")).toBe(false);
  });
  it("formats prices and suffixes", () => {
    expect(formatPlanPrice(0)).toBe("Free");
    expect(formatPlanPrice(3900)).toBe("$39");
    expect(formatPlanPrice(2999)).toBe("$29.99");
    expect(planPriceSuffix(PLANS.season)).toBe(" one-time");
    expect(planPriceSuffix(PLANS.concierge)).toBe("/month");
    expect(planPriceSuffix(PLANS.free)).toBe("");
    expect(extraRequestLine(PLANS.concierge)).toBe("Extra requests $8 each");
    expect(extraRequestLine(PLANS.season)).toBeNull();
  });
  it("offers season lengths within the server limit", () => {
    expect(Math.max(...SEASON_WEEK_OPTIONS)).toBeLessThanOrEqual(SEASON_MAX_WEEKS);
  });
});

describe("request classification (mirrors record_plan_request_usage)", () => {
  it("makes the first request free for everyone", () => {
    expect(classifyUsage({ freeUsed: false, included: 0, used: 0 })).toBe("free");
    expect(classifyUsage({ freeUsed: false, included: 4, used: 0 })).toBe("free");
  });
  it("then counts Concierge's included requests, then extras", () => {
    expect(classifyUsage({ freeUsed: true, included: 4, used: 3 })).toBe("included");
    expect(classifyUsage({ freeUsed: true, included: 4, used: 4 })).toBe("extra");
  });
  it("flags every later request an extra with no Concierge plan", () => {
    expect(classifyUsage({ freeUsed: true, included: 0, used: 0 })).toBe("extra");
  });
  it("plays out a month on Concierge", () => {
    const kinds: string[] = [];
    let used = 0;
    let freeUsed = false;
    for (let i = 0; i < 7; i++) {
      const k = classifyUsage({ freeUsed, included: 4, used });
      kinds.push(k);
      if (k === "free") freeUsed = true;
      else if (k === "included") used += 1;
    }
    expect(kinds).toEqual(["free", "included", "included", "included", "included", "extra", "extra"]);
  });
});

describe("Your plan line", () => {
  const base: PlanStatus = { plan: null, status: null, current_period_end: null, monthly_requests: 0, requests_used: 0, extra_requests_used: 0, requests_left: 0, free_request_used: false, period_start: null };
  it("defaults to Do it yourself, with the free request and booked seasons", () => {
    expect(yourPlanLine(null).title).toBe("Do it yourself");
    expect(yourPlanLine(null).detail).toContain("Your first request is free.");
    expect(yourPlanLine({ ...base, free_request_used: true }).detail).toContain("Your free request is used.");
    expect(yourPlanLine(null, 1).detail).toContain("1 season booked.");
    expect(yourPlanLine(null, 2).detail).toContain("2 seasons booked.");
  });
  it("shows Concierge requests left", () => {
    const l = yourPlanLine({ ...base, plan: "concierge", monthly_requests: 4, requests_used: 1, requests_left: 3, free_request_used: true });
    expect(l.title).toBe("Concierge");
    expect(l.detail).toBe("3 of 4 requests left this month. Your free request is used.");
  });
});

describe("stripe plan helpers", () => {
  it("maps prices to paid plans", () => {
    expect(planPriceId("season", ENV)).toBe("price_season");
    expect(planFromPriceId("price_concierge", ENV)).toBe("concierge");
    expect(planFromPriceId("price_other", ENV)).toBeNull();
  });
  it("refuses anything but a test key", () => {
    expect(assertPlansTestKey({ STRIPE_SECRET_KEY: "sk_test_abc" } as unknown as NodeJS.ProcessEnv)).toBe("sk_test_abc");
    expect(() => assertPlansTestKey({ STRIPE_SECRET_KEY: "sk_live_abc" } as unknown as NodeJS.ProcessEnv)).toThrow(/test mode/);
    expect(() => assertPlansTestKey({} as NodeJS.ProcessEnv)).toThrow();
    expect(() => plansWebhookSecret({} as NodeJS.ProcessEnv)).toThrow();
  });
});

function sub(over: Record<string, unknown> = {}): Stripe.Subscription {
  return {
    id: "sub_1",
    customer: "cus_1",
    status: "active",
    cancel_at_period_end: false,
    metadata: { product: "fields_plan", user_id: "user-1", plan: "concierge" },
    items: { data: [{ price: { id: "price_concierge" }, current_period_end: 1_800_000_000 }] },
    ...over,
  } as unknown as Stripe.Subscription;
}

describe("subscriptionToRow (Concierge only)", () => {
  it("builds the row from a Concierge subscription", () => {
    const r = subscriptionToRow(sub(), null, ENV)!;
    expect(r).toMatchObject({ user_id: "user-1", plan: "concierge", status: "active", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1" });
    expect(r.current_period_end).toBe(new Date(1_800_000_000 * 1000).toISOString());
  });
  it("ignores anything that is not a Concierge Fields subscription", () => {
    expect(subscriptionToRow(sub({ metadata: { user_id: "user-1" } }), null, ENV)).toBeNull();
    expect(subscriptionToRow(sub({ metadata: { product: "fields_plan" } }), null, ENV)).toBeNull();
    expect(subscriptionToRow(sub({ items: { data: [{ price: { id: "price_season" } }] }, metadata: { product: "fields_plan", user_id: "u" } }), null, ENV)).toBeNull();
    expect(subscriptionToRow(sub({ items: { data: [{ price: { id: "price_x" } }] }, metadata: { product: "fields_plan", user_id: "u", plan: "email" } }), null, ENV)).toBeNull();
  });
  it("uses the fallback user and carries canceled status", () => {
    expect(subscriptionToRow(sub({ metadata: { product: "fields_plan", plan: "concierge" } }), "user-9", ENV)).toMatchObject({ user_id: "user-9" });
    expect(subscriptionToRow(sub({ status: "canceled", cancel_at_period_end: true }), null, ENV)).toMatchObject({ status: "canceled", cancel_at_period_end: true });
  });
});

// ---- webhook route ----
const upsert = vi.fn(async () => ({ error: null }));
const fulfill = vi.fn(async () => "fulfilled" as const);
vi.mock("../../lib/server/runtimeClients", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({ upsert, select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
  }),
}));
vi.mock("../../lib/plans/seasonFulfillment", () => ({ fulfillSeasonPurchase: (...a: unknown[]) => fulfill(...(a as [])) }));

const WHSEC = "whsec_test_secret";

function signed(payload: object): { body: string; sig: string } {
  const body = JSON.stringify(payload);
  const sig = new Stripe("sk_test_x").webhooks.generateTestHeaderString({ payload: body, secret: WHSEC });
  return { body, sig };
}

const seasonSession = (over: Record<string, unknown> = {}) => ({
  id: "cs_1",
  mode: "payment",
  payment_status: "paid",
  payment_intent: "pi_1",
  amount_total: 3900,
  client_reference_id: "user-1",
  metadata: { product: "fields_season", user_id: "user-1", purchase_id: "purchase-1" },
  ...over,
});

describe("POST /api/stripe/plans-webhook", () => {
  beforeEach(() => {
    upsert.mockClear();
    fulfill.mockClear();
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_PLANS_WEBHOOK_SECRET = WHSEC;
    process.env.STRIPE_PRICE_CONCIERGE = "price_concierge";
    process.env.STRIPE_PRICE_SEASON = "price_season";
  });
  async function call(body: string, sig: string | null) {
    const { POST } = await import("../../app/api/stripe/plans-webhook/route");
    return POST(new Request("http://localhost/api/stripe/plans-webhook", { method: "POST", body, headers: sig ? { "stripe-signature": sig } : {} }));
  }
  it("rejects a missing or bad signature", async () => {
    expect((await call("{}", null)).status).toBe(400);
    expect((await call("{}", "t=1,v1=deadbeef")).status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
    expect(fulfill).not.toHaveBeenCalled();
  });
  it("saves a Concierge subscription on customer.subscription.updated", async () => {
    const { body, sig } = signed({ id: "evt_1", object: "event", type: "customer.subscription.updated", data: { object: sub() } });
    expect((await call(body, sig)).status).toBe(200);
    expect((upsert.mock.calls[0] as unknown[])[0]).toMatchObject({ user_id: "user-1", plan: "concierge", status: "active" });
  });
  it("saves a canceled subscription on customer.subscription.deleted", async () => {
    const { body, sig } = signed({ id: "evt_2", object: "event", type: "customer.subscription.deleted", data: { object: sub({ status: "canceled" }) } });
    expect((await call(body, sig)).status).toBe(200);
    expect((upsert.mock.calls[0] as unknown[])[0]).toMatchObject({ status: "canceled" });
  });
  it("marks a paid season purchase on checkout.session.completed (mode=payment)", async () => {
    const { body, sig } = signed({ id: "evt_3", object: "event", type: "checkout.session.completed", data: { object: seasonSession() } });
    expect((await call(body, sig)).status).toBe(200);
    expect(fulfill).toHaveBeenCalledTimes(1);
    expect((fulfill.mock.calls[0] as unknown[])[1]).toMatchObject({ purchaseId: "purchase-1", sessionId: "cs_1", paymentIntentId: "pi_1", amountCents: 3900 });
    expect(upsert).not.toHaveBeenCalled();
  });
  it("waits when the season payment has not settled yet", async () => {
    const { body, sig } = signed({ id: "evt_4", object: "event", type: "checkout.session.completed", data: { object: seasonSession({ payment_status: "unpaid" }) } });
    expect((await call(body, sig)).status).toBe(200);
    expect(fulfill).not.toHaveBeenCalled();
  });
  it("ignores other events, non-plan subscriptions and payments that are not seasons", async () => {
    const other = signed({ id: "evt_5", object: "event", type: "invoice.paid", data: { object: {} } });
    expect((await call(other.body, other.sig)).status).toBe(200);
    const notPlan = signed({ id: "evt_6", object: "event", type: "customer.subscription.updated", data: { object: sub({ metadata: {} }) } });
    expect((await call(notPlan.body, notPlan.sig)).status).toBe(200);
    const otherPay = signed({ id: "evt_7", object: "event", type: "checkout.session.completed", data: { object: seasonSession({ metadata: { product: "tournament" } }) } });
    expect((await call(otherPay.body, otherPay.sig)).status).toBe(200);
    expect(upsert).not.toHaveBeenCalled();
    expect(fulfill).not.toHaveBeenCalled();
  });
  it("refuses to run with a live key", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_x";
    const { body, sig } = signed({ id: "evt_8", object: "event", type: "customer.subscription.updated", data: { object: sub() } });
    expect((await call(body, sig)).status).toBe(503);
    expect(upsert).not.toHaveBeenCalled();
  });
});
