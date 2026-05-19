import { describe, expect, it } from "vitest";
import { shouldSkipPickupFulfillmentForConfirmedStatus } from "@/lib/pickup/stripeWebhookPickup";

describe("Stripe webhook pickup idempotency", () => {
  it("skips fulfillment when RSVP is already confirmed", () => {
    expect(shouldSkipPickupFulfillmentForConfirmedStatus("confirmed")).toBe(true);
    expect(shouldSkipPickupFulfillmentForConfirmedStatus(" pending_payment ")).toBe(false);
    expect(shouldSkipPickupFulfillmentForConfirmedStatus(null)).toBe(false);
  });
});
