import OpenAI from "openai";
import Stripe from "stripe";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  assertStripeSecretKeyForRuntime,
  assertStripeWebhookSecretForRuntime,
  warnPublishableStripeKeyIfMisconfigured,
} from "@/lib/server/stripeEnv";

export function getSupabaseAdmin(
  options?: Parameters<typeof createClient>[2],
): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url?.trim()) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  }
  if (!key?.trim()) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, options);
}

export function getSupabaseAnon(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url?.trim()) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  }
  if (!key?.trim()) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return createClient(url, key);
}

function createStripeFromSecret(secret: string): Stripe {
  const raw = process.env.STRIPE_API_VERSION?.trim();
  if (!raw) {
    return new Stripe(secret);
  }
  // Bare "2026-02-25" is not accepted by stripe@20 (SDK default is Stripe.API_VERSION, e.g. …clover).
  // It is a common Vercel mis-set and surfaces as "Invalid Stripe API version: 2026-02-25" on requests.
  if (raw === "2026-02-25") {
    console.warn(
      "[Stripe] Ignoring invalid STRIPE_API_VERSION=2026-02-25 — remove it in Vercel or set the full SDK version string.",
    );
    return new Stripe(secret);
  }
  try {
    return new Stripe(secret, {
      apiVersion: raw as Stripe.LatestApiVersion,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      "[Stripe] STRIPE_API_VERSION is invalid for this SDK; using default. Unset or fix STRIPE_API_VERSION in env.",
      { apiVersion: raw, message },
    );
    return new Stripe(secret);
  }
}

/** Pickup checkout (RSVP / pay) — SDK default API version unless STRIPE_API_VERSION is set. */
export function getStripePickup(): Stripe {
  warnPublishableStripeKeyIfMisconfigured();
  const secret = assertStripeSecretKeyForRuntime();
  return createStripeFromSecret(secret);
}

/** Tournament checkout + webhooks — SDK default unless STRIPE_API_VERSION is set. */
export function getStripeTournament(): Stripe {
  warnPublishableStripeKeyIfMisconfigured();
  const secret = assertStripeSecretKeyForRuntime();
  return createStripeFromSecret(secret);
}

export function getStripeWebhookSecret(): string {
  return assertStripeWebhookSecretForRuntime();
}

export function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) {
    console.error(
      "[OpenAI] Missing OPENAI_API_KEY. Add it to .env.local for local dev or to Vercel → Settings → Environment Variables for production. Server-only; never expose this to the client.",
    );
    throw new Error("Missing OPENAI_API_KEY");
  }
  return new OpenAI({ apiKey });
}
