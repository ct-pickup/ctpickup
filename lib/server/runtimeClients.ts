import OpenAI from "openai";
import Stripe from "stripe";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

/** Pickup checkout (RSVP / pay) — Stripe API version pinned for this project. */
export function getStripePickup(): Stripe {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret?.trim()) {
    throw new Error("Missing STRIPE_SECRET_KEY");
  }
  return new Stripe(secret, {
    apiVersion: "2026-02-25.clover",
  });
}

/** Tournament checkout + webhooks — respects STRIPE_API_VERSION when set. */
export function getStripeTournament(): Stripe {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret?.trim()) {
    throw new Error("Missing STRIPE_SECRET_KEY");
  }
  return new Stripe(secret, {
    apiVersion: (process.env.STRIPE_API_VERSION as any) || "2026-02-25",
  });
}

export function getStripeWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret?.trim()) {
    throw new Error("Missing STRIPE_WEBHOOK_SECRET");
  }
  return secret;
}

export function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) {
    throw new Error("Missing OPENAI_API_KEY");
  }
  return new OpenAI({ apiKey });
}
