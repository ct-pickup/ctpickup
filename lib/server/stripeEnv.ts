/**
 * Production-safe Stripe environment checks. Server-only.
 */

/** Vercel production, or local `next build && next start` (not Vercel preview). */
export function isStripeProductionMode(): boolean {
  if (process.env.VERCEL_ENV === "production") return true;
  if (process.env.NODE_ENV === "production" && process.env.VERCEL !== "1") return true;
  return false;
}

/**
 * Call before using STRIPE_SECRET_KEY. In production, rejects test keys and requires sk_live_.
 */
export function assertStripeSecretKeyForRuntime(): string {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) {
    throw new Error("Missing STRIPE_SECRET_KEY");
  }
  if (secret.startsWith("sk_test")) {
    if (isStripeProductionMode()) {
      throw new Error(
        "STRIPE_SECRET_KEY must not be a test key (sk_test_) in production",
      );
    }
    return secret;
  }
  if (isStripeProductionMode() && !secret.startsWith("sk_live_")) {
    throw new Error(
      "STRIPE_SECRET_KEY must be a live secret key (sk_live_...) in production",
    );
  }
  return secret;
}

/**
 * Webhook signing secret. In production must be whsec_ (live endpoint secret from Dashboard).
 */
export function assertStripeWebhookSecretForRuntime(): string {
  const w = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!w) {
    throw new Error("Missing STRIPE_WEBHOOK_SECRET");
  }
  if (isStripeProductionMode() && !w.startsWith("whsec_")) {
    throw new Error(
      "STRIPE_WEBHOOK_SECRET must be a webhook signing secret (whsec_...) in production",
    );
  }
  return w;
}

/**
 * Publishable key is optional (hosted Checkout only) unless you add Stripe.js.
 * If set in production, it must be a live publishable key.
 */
export function warnPublishableStripeKeyIfMisconfigured(): void {
  const pk = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim();
  if (!pk) {
    if (isStripeProductionMode()) {
      console.warn(
        "[stripe] NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is unset. OK for hosted Checkout only; set pk_live_ if you add Stripe.js on the client.",
      );
    }
    return;
  }
  if (pk.startsWith("pk_test") && isStripeProductionMode()) {
    console.error(
      "[stripe] NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is a test key (pk_test_) in production",
    );
  }
  if (isStripeProductionMode() && !pk.startsWith("pk_live_")) {
    console.error(
      "[stripe] NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY must be pk_live_... in production when set",
    );
  }
}
