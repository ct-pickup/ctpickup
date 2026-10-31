import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/runtimeClients", () => ({ getSupabaseAdmin: () => ({}) }));

import { POST } from "../../app/api/stripe/plans-webhook/route";

const post = () => POST(new Request("https://site.test/api/stripe/plans-webhook", { method: "POST", body: "{}" }));

describe("plans webhook follows the same key rule", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("live key without the opt-in: not configured (503)", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_abc");
    vi.stubEnv("STRIPE_PLANS_WEBHOOK_SECRET", "whsec_x");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await post()).status).toBe(503);
  });
  it("live key with the opt-in: configured, so it moves on to the signature check (400)", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_abc");
    vi.stubEnv("STRIPE_PLANS_ALLOW_LIVE", "1");
    vi.stubEnv("STRIPE_PLANS_WEBHOOK_SECRET", "whsec_x");
    expect((await post()).status).toBe(400);
  });
  it("test key: configured (400 without a signature)", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abc");
    vi.stubEnv("STRIPE_PLANS_WEBHOOK_SECRET", "whsec_x");
    expect((await post()).status).toBe(400);
  });
});
