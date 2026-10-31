import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeDb, type FakeDb } from "../helpers/fakeSupabase";

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  flagOff: null as Response | null,
  limited: false,
  portalCreate: vi.fn(),
  sessionCreate: vi.fn(),
}));

vi.mock("@/lib/referral/auth", () => ({
  requireAuthedUser: async () => ({ ok: true, admin: (await import("../helpers/fakeSupabase")).fakeClient(h.db), user: { id: "u1", email: "p@example.com" } }),
}));
vi.mock("@/lib/flags", () => ({ requireFlag: async () => h.flagOff }));
vi.mock("@/lib/server/persistentRateLimit", () => ({
  checkPersistentRateLimit: async () => (h.limited ? { ok: false, retryAfterSeconds: 30 } : { ok: true }),
  rateLimitResponse: () => new Response(JSON.stringify({ error: "rate" }), { status: 429 }),
}));
vi.mock("@/lib/requestSiteUrl", () => ({ requestSiteUrlFromRequest: () => "https://site.test" }));
vi.mock("stripe", () => ({
  default: class {
    billingPortal = { sessions: { create: h.portalCreate } };
    checkout = { sessions: { create: h.sessionCreate } };
  },
}));

import { POST as checkout } from "../../app/api/plans/checkout/route";
import { POST as portal } from "../../app/api/plans/portal/route";

const req = (body: unknown = {}) => new Request("https://site.test/api/plans/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const json = async (r: Response) => (await r.json()) as Record<string, unknown>;

beforeEach(() => {
  h.db = makeDb({ plan_subscriptions: [{ user_id: "u1", plan: "concierge", status: "active", stripe_customer_id: "cus_1" }] });
  h.flagOff = null;
  h.limited = false;
  h.portalCreate.mockReset().mockResolvedValue({ url: "https://billing.stripe.test/p/abc" });
  h.sessionCreate.mockReset().mockResolvedValue({ url: "https://checkout.stripe.test/c/abc", id: "cs_1" });
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abc");
  vi.stubEnv("STRIPE_PRICE_CONCIERGE", "price_c");
  vi.stubEnv("STRIPE_PRICE_SEASON", "price_s");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/plans/portal", () => {
  it("returns a billing portal link for a player with an active plan, returning to the site", async () => {
    const r = await portal(req());
    expect(r.status).toBe(200);
    expect(await json(r)).toEqual({ ok: true, url: "https://billing.stripe.test/p/abc" });
    expect(h.portalCreate).toHaveBeenCalledWith({ customer: "cus_1", return_url: "https://site.test/plans/return?status=portal" });
  });
  it("also works for a trialing plan", async () => {
    (h.db.tables.plan_subscriptions![0] as Record<string, unknown>).status = "trialing";
    expect((await portal(req())).status).toBe(200);
  });
  it("404 when there is no active plan (canceled, or none) and Stripe is not called", async () => {
    (h.db.tables.plan_subscriptions![0] as Record<string, unknown>).status = "canceled";
    const r = await portal(req());
    expect(r.status).toBe(404);
    expect((await json(r)).code).toBe("no_active_plan");
    h.db.tables.plan_subscriptions!.length = 0;
    expect((await portal(req())).status).toBe(404);
    expect(h.portalCreate).not.toHaveBeenCalled();
  });
  it("is closed when either flag is off, and rate limited", async () => {
    h.flagOff = new Response(JSON.stringify({ error: "feature_off" }), { status: 403 });
    expect((await portal(req())).status).toBe(403);
    h.flagOff = null;
    h.limited = true;
    expect((await portal(req())).status).toBe(429);
    expect(h.portalCreate).not.toHaveBeenCalled();
  });
  it("a live key is refused without the opt-in and works with it; the player sees only the friendly message", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_supersecretvalue");
    const refused = await portal(req());
    expect(refused.status).toBe(503);
    const body = JSON.stringify(await json(refused));
    expect(body).toContain("Checkout isn't available right now. Please try again later.");
    expect(body).not.toMatch(/STRIPE|sk_|supersecretvalue/);
    vi.stubEnv("STRIPE_PLANS_ALLOW_LIVE", "1");
    expect((await portal(req())).status).toBe(200);
  });
  it("a Stripe failure gives the friendly message and logs the reason only on the server", async () => {
    h.portalCreate.mockRejectedValue(new Error("No configuration provided and your test mode default configuration has not been created"));
    const r = await portal(req());
    expect(r.status).toBe(502);
    expect(JSON.stringify(await json(r))).not.toMatch(/configuration/);
    expect(console.error).toHaveBeenCalled();
  });
});

describe("POST /api/plans/checkout player messages", () => {
  it("no key: friendly message, detail only in the log", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    const r = await checkout(req({ plan: "concierge" }));
    expect(r.status).toBe(503);
    expect(await json(r)).toEqual({ error: "Checkout isn't available right now. Please try again later." });
    expect(vi.mocked(console.error).mock.calls.flat().join(" ")).toMatch(/Missing STRIPE_SECRET_KEY/);
  });
  it("missing price: friendly message, no plan name or env name shown", async () => {
    vi.stubEnv("STRIPE_PRICE_CONCIERGE", "");
    const r = await checkout(req({ plan: "concierge" }));
    expect(r.status).toBe(503);
    const body = JSON.stringify(await json(r));
    expect(body).toBe('{"error":"Checkout isn\'t available right now. Please try again later."}');
    expect(vi.mocked(console.error).mock.calls.flat().join(" ")).toMatch(/missing the Stripe price for concierge/);
  });
  it("live key without the opt-in is refused; with it checkout starts", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_abc");
    h.db.tables.plan_subscriptions!.length = 0;
    expect((await checkout(req({ plan: "concierge" }))).status).toBe(503);
    expect(h.sessionCreate).not.toHaveBeenCalled();
    vi.stubEnv("STRIPE_PLANS_ALLOW_LIVE", "1");
    const ok = await checkout(req({ plan: "concierge" }));
    expect(ok.status).toBe(200);
    expect((await json(ok)).url).toBe("https://checkout.stripe.test/c/abc");
  });
  it("a test key always works", async () => {
    h.db.tables.plan_subscriptions!.length = 0;
    expect((await checkout(req({ plan: "concierge" }))).status).toBe(200);
  });
});
