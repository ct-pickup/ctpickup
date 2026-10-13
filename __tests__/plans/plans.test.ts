import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { assertPlansTestKey, planFromPriceId, planPriceId, plansWebhookSecret, subscriptionToRow } from "../../lib/plans/stripePlans";
import { classifyUsage, extraRequestLine, formatPlanPrice, isPlanId, PLANS, yourPlanLine, type PlanStatus } from "../../shared/fields/plans";

const ENV = { STRIPE_PRICE_SCOUT: "price_scout", STRIPE_PRICE_EMAIL: "price_email", STRIPE_PRICE_CONCIERGE: "price_concierge" } as unknown as NodeJS.ProcessEnv;

describe("plan catalog", () => {
  it("matches the design: prices, included requests and extras", () => {
    expect(PLANS.scout).toMatchObject({ priceCents: 599, monthlyRequests: 0, extraCents: null });
    expect(PLANS.email).toMatchObject({ priceCents: 1099, monthlyRequests: 3, extraCents: 300 });
    expect(PLANS.concierge).toMatchObject({ priceCents: 2999, monthlyRequests: 4, extraCents: 800 });
    expect(formatPlanPrice(599)).toBe("$5.99");
    expect(formatPlanPrice(2999)).toBe("$29.99");
    expect(extraRequestLine(PLANS.scout)).toBeNull();
    expect(extraRequestLine(PLANS.email)).toBe("Extra requests $3 each");
    expect(extraRequestLine(PLANS.concierge)).toBe("Extra requests $8 each");
    expect(isPlanId("email")).toBe(true);
    expect(isPlanId("gold")).toBe(false);
  });
});

describe("request classification (mirrors record_plan_request_usage)", () => {
  it("makes the first request free for everyone, with or without a plan", () => {
    expect(classifyUsage({ freeUsed: false, included: 0, used: 0 })).toBe("free");
    expect(classifyUsage({ freeUsed: false, included: 3, used: 0 })).toBe("free");
  });
  it("then counts included requests, then extras", () => {
    expect(classifyUsage({ freeUsed: true, included: 3, used: 0 })).toBe("included");
    expect(classifyUsage({ freeUsed: true, included: 3, used: 2 })).toBe("included");
    expect(classifyUsage({ freeUsed: true, included: 3, used: 3 })).toBe("extra");
    expect(classifyUsage({ freeUsed: true, included: 4, used: 4 })).toBe("extra");
  });
  it("makes every request an extra on Scout or with no plan once the free one is used", () => {
    expect(classifyUsage({ freeUsed: true, included: 0, used: 0 })).toBe("extra");
  });
  it("plays out a month on the Email plan", () => {
    const kinds: string[] = [];
    let used = 0;
    let freeUsed = false;
    for (let i = 0; i < 6; i++) {
      const k = classifyUsage({ freeUsed, included: 3, used });
      kinds.push(k);
      if (k === "free") freeUsed = true;
      else if (k === "included") used += 1;
    }
    expect(kinds).toEqual(["free", "included", "included", "included", "extra", "extra"]);
  });
});

describe("Your plan line", () => {
  const base: PlanStatus = { plan: null, status: null, current_period_end: null, monthly_requests: 0, requests_used: 0, extra_requests_used: 0, requests_left: 0, free_request_used: false, period_start: null };
  it("shows no plan and the free request", () => {
    expect(yourPlanLine(null)).toEqual({ title: "No plan", detail: "Your first request is free." });
    expect(yourPlanLine({ ...base, free_request_used: true }).detail).toBe("Your free request is used.");
  });
  it("shows requests left on a plan", () => {
    const l = yourPlanLine({ ...base, plan: "email", monthly_requests: 3, requests_used: 1, requests_left: 2, free_request_used: true });
    expect(l.title).toBe("Email plan");
    expect(l.detail).toBe("2 of 3 requests left this month. Your free request is used.");
    expect(yourPlanLine({ ...base, plan: "scout", free_request_used: true }).detail).toContain("No requests included");
  });
});

describe("stripe plan helpers", () => {
  it("maps prices to plans", () => {
    expect(planPriceId("email", ENV)).toBe("price_email");
    expect(planFromPriceId("price_concierge", ENV)).toBe("concierge");
    expect(planFromPriceId("price_other", ENV)).toBeNull();
    expect(planFromPriceId(null, ENV)).toBeNull();
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
    metadata: { product: "fields_plan", user_id: "user-1", plan: "email" },
    items: { data: [{ price: { id: "price_email" }, current_period_end: 1_800_000_000 }] },
    ...over,
  } as unknown as Stripe.Subscription;
}

describe("subscriptionToRow", () => {
  it("builds the row from a Fields plan subscription", () => {
    const r = subscriptionToRow(sub(), null, ENV)!;
    expect(r).toMatchObject({ user_id: "user-1", plan: "email", status: "active", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1", cancel_at_period_end: false });
    expect(r.current_period_end).toBe(new Date(1_800_000_000 * 1000).toISOString());
  });
  it("reads the period end from the subscription on older API versions", () => {
    const r = subscriptionToRow(sub({ items: { data: [{ price: { id: "price_email" } }] }, current_period_end: 1_700_000_000 }), null, ENV)!;
    expect(r.current_period_end).toBe(new Date(1_700_000_000 * 1000).toISOString());
  });
  it("uses the price over metadata for the plan, and the fallback user when metadata has none", () => {
    expect(subscriptionToRow(sub({ metadata: { product: "fields_plan", plan: "scout" } }), "user-9", ENV)).toMatchObject({ user_id: "user-9", plan: "email" });
  });
  it("ignores subscriptions that are not Fields plans or have no user or plan", () => {
    expect(subscriptionToRow(sub({ metadata: { user_id: "user-1" } }), null, ENV)).toBeNull();
    expect(subscriptionToRow(sub({ metadata: { product: "fields_plan" } }), null, ENV)).toBeNull();
    expect(subscriptionToRow(sub({ items: { data: [{ price: { id: "price_x" } }] }, metadata: { product: "fields_plan", user_id: "u" } }), null, ENV)).toBeNull();
  });
  it("carries cancel_at_period_end and canceled status", () => {
    expect(subscriptionToRow(sub({ status: "canceled", cancel_at_period_end: true }), null, ENV)).toMatchObject({ status: "canceled", cancel_at_period_end: true });
  });
});

// ---- webhook route ----
const upsert = vi.fn(async () => ({ error: null }));
const maybeSingle = vi.fn(async () => ({ data: null }));
vi.mock("../../lib/server/runtimeClients", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({ upsert, select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
}));

const WHSEC = "whsec_test_secret";

function signed(payload: object): { body: string; sig: string } {
  const body = JSON.stringify(payload);
  const sig = new Stripe("sk_test_x").webhooks.generateTestHeaderString({ payload: body, secret: WHSEC });
  return { body, sig };
}

describe("POST /api/stripe/plans-webhook", () => {
  beforeEach(() => {
    upsert.mockClear();
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_PLANS_WEBHOOK_SECRET = WHSEC;
    process.env.STRIPE_PRICE_EMAIL = "price_email";
  });
  async function call(body: string, sig: string | null) {
    const { POST } = await import("../../app/api/stripe/plans-webhook/route");
    return POST(new Request("http://localhost/api/stripe/plans-webhook", { method: "POST", body, headers: sig ? { "stripe-signature": sig } : {} }));
  }
  it("rejects a missing or bad signature", async () => {
    expect((await call("{}", null)).status).toBe(400);
    expect((await call("{}", "t=1,v1=deadbeef")).status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });
  it("saves the subscription on customer.subscription.updated", async () => {
    const { body, sig } = signed({ id: "evt_1", object: "event", type: "customer.subscription.updated", data: { object: sub() } });
    const res = await call(body, sig);
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect((upsert.mock.calls[0] as unknown[])[0]).toMatchObject({ user_id: "user-1", plan: "email", status: "active" });
  });
  it("saves a canceled subscription on customer.subscription.deleted", async () => {
    const { body, sig } = signed({ id: "evt_2", object: "event", type: "customer.subscription.deleted", data: { object: sub({ status: "canceled" }) } });
    expect((await call(body, sig)).status).toBe(200);
    expect((upsert.mock.calls[0] as unknown[])[0]).toMatchObject({ status: "canceled" });
  });
  it("acknowledges and ignores other events and non-plan subscriptions", async () => {
    const other = signed({ id: "evt_3", object: "event", type: "invoice.paid", data: { object: {} } });
    expect((await call(other.body, other.sig)).status).toBe(200);
    const notPlan = signed({ id: "evt_4", object: "event", type: "customer.subscription.updated", data: { object: sub({ metadata: {} }) } });
    expect((await call(notPlan.body, notPlan.sig)).status).toBe(200);
    expect(upsert).not.toHaveBeenCalled();
  });
  it("refuses to run with a live key", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_x";
    const { body, sig } = signed({ id: "evt_5", object: "event", type: "customer.subscription.updated", data: { object: sub() } });
    expect((await call(body, sig)).status).toBe(503);
    expect(upsert).not.toHaveBeenCalled();
  });
});
