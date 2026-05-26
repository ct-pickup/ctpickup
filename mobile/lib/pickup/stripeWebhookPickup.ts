/** Skip duplicate pickup fulfillment when Stripe retries a webhook for an already-confirmed RSVP. */
export function shouldSkipPickupFulfillmentForConfirmedStatus(status: unknown): boolean {
  return String(status || "").trim() === "confirmed";
}
