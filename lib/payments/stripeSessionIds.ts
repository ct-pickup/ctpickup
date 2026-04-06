import type Stripe from "stripe";

export function paymentIntentIdFromCheckoutSession(session: Stripe.Checkout.Session): string | null {
  const pi = session.payment_intent;
  if (typeof pi === "string") return pi;
  return pi?.id ?? null;
}
