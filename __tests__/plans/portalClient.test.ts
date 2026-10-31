import { describe, expect, it, vi } from "vitest";

import { PORTAL_ERROR_MESSAGE, PORTAL_NETWORK_MESSAGE, requestPortalUrl } from "../../mobile/lib/fields/plansPortalCore";
import { SEASON_REFUND_COPY } from "../../shared/fields/plans";

const reply = (status: number, body: unknown) => vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });

describe("requestPortalUrl", () => {
  it("posts to the portal route with the bearer token and returns the Stripe url", async () => {
    const f = reply(200, { ok: true, url: "https://billing.stripe.com/p/x" });
    expect(await requestPortalUrl(f, "https://ctpickup.net", "tok")).toEqual({ ok: true, url: "https://billing.stripe.com/p/x" });
    expect(f).toHaveBeenCalledWith("https://ctpickup.net/api/plans/portal", expect.objectContaining({ method: "POST", headers: expect.objectContaining({ Authorization: "Bearer tok" }) }));
  });
  it("is a friendly no_plan when there is no active plan", async () => {
    const r = await requestPortalUrl(reply(404, { error: "no_active_plan" }), "https://x", "t");
    expect(r).toMatchObject({ ok: false, code: "no_plan" });
  });
  it("is not_available when plans are off", async () => {
    expect(await requestPortalUrl(reply(403, { error: "feature_off" }), "https://x", "t")).toMatchObject({ ok: false, code: "not_available" });
  });
  it("shows the server's friendly sentence but never a raw code", async () => {
    const friendly = await requestPortalUrl(reply(503, { error: "Checkout isn't available right now. Please try again later." }), "https://x", "t");
    expect(friendly).toMatchObject({ ok: false, code: "error", message: "Checkout isn't available right now. Please try again later." });
    const raw = await requestPortalUrl(reply(502, { error: "portal_failed" }), "https://x", "t");
    expect(raw).toMatchObject({ ok: false, message: PORTAL_ERROR_MESSAGE });
  });
  it("handles a 200 without a url, a bad body, no origin and a network failure", async () => {
    expect((await requestPortalUrl(reply(200, { ok: true }), "https://x", "t")).ok).toBe(false);
    const bad = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => { throw new Error("bad json"); } });
    expect(await requestPortalUrl(bad, "https://x", "t")).toMatchObject({ ok: false, message: PORTAL_ERROR_MESSAGE });
    expect(await requestPortalUrl(reply(200, {}), null, "t")).toMatchObject({ ok: false, code: "network", message: PORTAL_NETWORK_MESSAGE });
    expect(await requestPortalUrl(vi.fn().mockRejectedValue(new Error("offline")), "https://x", "t")).toMatchObject({ ok: false, code: "network" });
  });
});

describe("season refund copy", () => {
  it("promises a refund, not credit or a 7 day wait, and has no em dash", () => {
    expect(SEASON_REFUND_COPY).toBe("If the venue can’t offer your season, we refund you in full.");
    expect(SEASON_REFUND_COPY).not.toMatch(/credit|7 days|—/i);
  });
});
