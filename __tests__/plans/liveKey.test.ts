import { afterEach, describe, expect, it, vi } from "vitest";

import { assertPlansTestKey, PLANS_ALLOW_LIVE_ENV, PLANS_UNAVAILABLE_MESSAGE } from "../../lib/plans/stripePlans";
import { cancelPlansForUser } from "../../lib/plans/cancelUserPlans";
import { fakeClient, makeDb } from "../helpers/fakeSupabase";

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

describe("assertPlansTestKey and the live opt-in", () => {
  it("a test key always works, with or without the opt-in", () => {
    expect(assertPlansTestKey(env({ STRIPE_SECRET_KEY: "sk_test_abc" }))).toBe("sk_test_abc");
    expect(assertPlansTestKey(env({ STRIPE_SECRET_KEY: "sk_test_abc", [PLANS_ALLOW_LIVE_ENV]: "1" }))).toBe("sk_test_abc");
    expect(assertPlansTestKey(env({ STRIPE_SECRET_KEY: "sk_test_abc", [PLANS_ALLOW_LIVE_ENV]: "0" }))).toBe("sk_test_abc");
  });
  it("a live key is refused without the opt-in", () => {
    expect(() => assertPlansTestKey(env({ STRIPE_SECRET_KEY: "sk_live_abc" }))).toThrow(/test mode only/);
  });
  it("only the exact value 1 opts in", () => {
    for (const v of ["", "0", "true", "yes", "11", " 0 "]) {
      expect(() => assertPlansTestKey(env({ STRIPE_SECRET_KEY: "sk_live_abc", [PLANS_ALLOW_LIVE_ENV]: v })), JSON.stringify(v)).toThrow();
    }
    expect(assertPlansTestKey(env({ STRIPE_SECRET_KEY: "sk_live_abc", [PLANS_ALLOW_LIVE_ENV]: "1" }))).toBe("sk_live_abc");
    expect(assertPlansTestKey(env({ STRIPE_SECRET_KEY: "sk_live_abc", [PLANS_ALLOW_LIVE_ENV]: " 1 " }))).toBe("sk_live_abc");
  });
  it("a missing or odd key is refused, and the error never contains the key", () => {
    expect(() => assertPlansTestKey(env({}))).toThrow(/Missing STRIPE_SECRET_KEY/);
    let msg = "";
    try {
      assertPlansTestKey(env({ STRIPE_SECRET_KEY: "rk_live_supersecretvalue" }));
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/sk_test_ or sk_live_/);
    expect(msg).not.toContain("supersecretvalue");
    try {
      assertPlansTestKey(env({ STRIPE_SECRET_KEY: "sk_live_supersecretvalue" }));
    } catch (e) {
      expect((e as Error).message).not.toContain("supersecretvalue");
    }
  });
  it("the player message has no raw setup details and no em dash", () => {
    expect(PLANS_UNAVAILABLE_MESSAGE).toBe("Checkout isn't available right now. Please try again later.");
    expect(PLANS_UNAVAILABLE_MESSAGE).not.toMatch(/STRIPE|price|key|—|–/i);
  });
});

describe("account deletion follows the same rule", () => {
  afterEach(() => vi.unstubAllEnvs());
  const withLiveSub = () =>
    fakeClient(makeDb({ plan_subscriptions: [{ user_id: "u1", stripe_subscription_id: "sub_1", status: "active" }], season_purchases: [] })) as never;
  const stripe = { subscriptions: { cancel: vi.fn(async () => ({})) }, checkout: { sessions: { expire: vi.fn(async () => ({})) } } };

  it("refuses to build a Stripe client with a live key and no opt-in", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_abc");
    vi.stubEnv(PLANS_ALLOW_LIVE_ENV, "");
    await expect(cancelPlansForUser(withLiveSub(), "u1")).rejects.toThrow(/test mode only/);
  });
  it("a user with no plans never needs a key at all", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_abc");
    await expect(cancelPlansForUser(fakeClient(makeDb({ plan_subscriptions: [], season_purchases: [] })) as never, "u1")).resolves.toEqual({ subscriptionsCanceled: 0, purchasesCanceled: 0 });
  });
  it("with the opt-in it gets as far as using Stripe (injected here)", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_abc");
    vi.stubEnv(PLANS_ALLOW_LIVE_ENV, "1");
    const r = await cancelPlansForUser(withLiveSub(), "u1", () => stripe as never);
    expect(r.subscriptionsCanceled).toBe(1);
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith("sub_1");
  });
});
