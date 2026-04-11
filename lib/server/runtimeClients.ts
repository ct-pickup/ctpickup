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
  const apiVersion = process.env.STRIPE_API_VERSION?.trim();
  if (apiVersion) {
    return new Stripe(secret, {
      apiVersion: apiVersion as Stripe.LatestApiVersion,
    });
  }
  return new Stripe(secret);
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
