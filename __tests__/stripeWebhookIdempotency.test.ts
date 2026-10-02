import { describe, expect, it } from "vitest";
import {
  shouldSkipPickupFulfillmentForCanceledRsvp,
  shouldSkipPickupFulfillmentForConfirmedStatus,
} from "@/lib/pickup/stripeWebhookPickup";

describe("Stripe webhook pickup idempotency", () => {
  it("skips fulfillment when RSVP is already confirmed", () => {
    expect(shouldSkipPickupFulfillmentForConfirmedStatus("confirmed")).toBe(true);
    expect(shouldSkipPickupFulfillmentForConfirmedStatus(" pending_payment ")).toBe(false);
    expect(shouldSkipPickupFulfillmentForConfirmedStatus(null)).toBe(false);
  });

  it("skips fulfillment for a canceled RSVP tied to the same checkout or payment", () => {
    const ids = { sessionId: "cs_1", paymentIntentId: "pi_1" };
    expect(shouldSkipPickupFulfillmentForCanceledRsvp({ status: "canceled", checkout_session_id: "cs_1" }, ids)).toBe(true);
    expect(shouldSkipPickupFulfillmentForCanceledRsvp({ status: "canceled", payment_intent_id: "pi_1" }, ids)).toBe(true);
    expect(shouldSkipPickupFulfillmentForCanceledRsvp({ status: "canceled", checkout_session_id: "cs_other" }, ids)).toBe(false);
    expect(shouldSkipPickupFulfillmentForCanceledRsvp({ status: "pending_payment", checkout_session_id: "cs_1" }, ids)).toBe(false);
    expect(shouldSkipPickupFulfillmentForCanceledRsvp(null, ids)).toBe(false);
  });
});
