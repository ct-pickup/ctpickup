/** Skip duplicate pickup fulfillment when Stripe retries a webhook for an already-confirmed RSVP. */
export function shouldSkipPickupFulfillmentForConfirmedStatus(status: unknown): boolean {
  return String(status || "").trim() === "confirmed";
}

/**
 * Skip fulfillment when the RSVP tied to this exact checkout/payment was already canceled (player left or host
 * cancelled while checkout was in flight). Those routes settle the money themselves; re-confirming would give
 * the player a spot on top of their credit or refund.
 */
export function shouldSkipPickupFulfillmentForCanceledRsvp(
  row: { status?: unknown; checkout_session_id?: unknown; payment_intent_id?: unknown } | null | undefined,
  ids: { sessionId: string | null; paymentIntentId: string | null },
): boolean {
  if (!row || String(row.status || "").trim() !== "canceled") return false;
  const sessionMatch = !!ids.sessionId && String(row.checkout_session_id || "") === ids.sessionId;
  const piMatch = !!ids.paymentIntentId && String(row.payment_intent_id || "") === ids.paymentIntentId;
  return sessionMatch || piMatch;
}
