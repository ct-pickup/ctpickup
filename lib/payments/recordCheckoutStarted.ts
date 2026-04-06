import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaymentLifecycleStatus, PlatformProductType } from "@/lib/payments/platformPaymentModel";

type RecordCheckoutArgs = {
  productType: PlatformProductType;
  productEntityId: string;
  userId: string;
  stripeCheckoutSessionId: string;
  /** Present on most Checkout sessions as soon as Stripe creates the PaymentIntent. */
  stripePaymentIntentId?: string | null;
  amountCents: number;
  currency: string;
  title: string;
  summary?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Inserts a visibility row when Stripe Checkout is created.
 * One row per checkout session (audit-friendly).
 */
export async function recordPlatformCheckoutStarted(
  admin: SupabaseClient,
  args: RecordCheckoutArgs,
): Promise<{ id: string } | null> {
  const lifecycle_status: PaymentLifecycleStatus = "checkout_started";
  const row = {
    product_type: args.productType,
    product_entity_id: args.productEntityId,
    user_id: args.userId,
    title: args.title,
    summary: args.summary ?? null,
    stripe_checkout_session_id: args.stripeCheckoutSessionId,
    stripe_payment_intent_id: args.stripePaymentIntentId?.trim() || null,
    amount_cents: args.amountCents,
    currency: (args.currency || "usd").toLowerCase(),
    lifecycle_status,
    fulfillment_status: "pending" as const,
    fulfillment_message: null as string | null,
    stripe_payment_received_at: null as string | null,
    completed_at: null as string | null,
    refunded_at: null as string | null,
    metadata: args.metadata ?? {},
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await admin.from("platform_payments").insert(row).select("id").single();

  if (error) {
    console.error("[platform_payments] insert checkout_started:", error.message);
    return null;
  }

  return data?.id ? { id: data.id as string } : null;
}
