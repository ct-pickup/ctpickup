/**
 * Production-safe Stripe environment checks. Server-only.
 */

type StripeSecretKeyFailureCategory =
  | "missing"
  | "blank"
  | "test_key_in_production"
  | "invalid_live_key_in_production";

/** Vercel production, or local `next build && next start` (not Vercel preview). */
export function isStripeProductionMode(): boolean {
  if (process.env.VERCEL_ENV === "production") return true;
  if (process.env.NODE_ENV === "production" && process.env.VERCEL !== "1") return true;
  return false;
}

function logStripeSecretKeyFailure(category: StripeSecretKeyFailureCategory) {
  // This is intentionally server-side only, and intentionally does not include the secret itself.
  // It is meant to help debug "wrong Vercel project / old deployment" by including deployment identifiers.
  if (!isStripeProductionMode()) return;
  const payload = {
    stripe_config_error: true,
    category,
    env: {
      VERCEL_ENV: process.env.VERCEL_ENV ?? null,
      NODE_ENV: process.env.NODE_ENV ?? null,
      VERCEL: process.env.VERCEL ?? null,
    },
    vercel: {
      VERCEL_URL: process.env.VERCEL_URL ?? null,
      VERCEL_BRANCH_URL: process.env.VERCEL_BRANCH_URL ?? null,
      VERCEL_PROJECT_ID: process.env.VERCEL_PROJECT_ID ?? null,
      VERCEL_DEPLOYMENT_ID: process.env.VERCEL_DEPLOYMENT_ID ?? null,
      VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    },
  };
  console.error(JSON.stringify(payload));
}

/**
 * Call before using STRIPE_SECRET_KEY. In production, rejects test keys and requires sk_live_.
 */
export function assertStripeSecretKeyForRuntime(): string {
  const raw = process.env.STRIPE_SECRET_KEY;
  if (raw == null) {
    logStripeSecretKeyFailure("missing");
    throw new Error("Missing STRIPE_SECRET_KEY");
  }
  const secret = raw.trim();
  if (!secret) {
    logStripeSecretKeyFailure("blank");
    throw new Error("Blank STRIPE_SECRET_KEY");
  }
  if (secret.startsWith("sk_test")) {
    if (isStripeProductionMode()) {
      logStripeSecretKeyFailure("test_key_in_production");
      throw new Error(
        "STRIPE_SECRET_KEY must not be a test key (sk_test_) in production",
      );
    }
    return secret;
  }
  if (isStripeProductionMode() && !secret.startsWith("sk_live_")) {
    logStripeSecretKeyFailure("invalid_live_key_in_production");
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
