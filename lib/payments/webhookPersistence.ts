import type { SupabaseClient } from "@supabase/supabase-js";
import type { FulfillmentStatus, PaymentLifecycleStatus, WebhookOutcome } from "@/lib/payments/platformPaymentModel";

export async function logStripeWebhookEvent(
  admin: SupabaseClient,
  row: {
    platform_payment_id: string | null;
    stripe_event_id: string;
    event_type: string;
    outcome: WebhookOutcome;
    staff_summary: string;
    needs_retry?: boolean;
    error_detail?: string | null;
  },
): Promise<void> {
  const { error } = await admin.from("stripe_webhook_events").insert({
    platform_payment_id: row.platform_payment_id,
    stripe_event_id: row.stripe_event_id,
    event_type: row.event_type,
    outcome: row.outcome,
    staff_summary: row.staff_summary,
    needs_retry: row.needs_retry ?? false,
    error_detail: row.error_detail ?? null,
  });

  if (error) {
    if (error.message.includes("duplicate") || error.code === "23505") {
      return;
    }
    console.error("[stripe_webhook_events] insert:", error.message);
  }
}

export async function findPlatformPaymentIdBySession(
  admin: SupabaseClient,
  sessionId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("platform_payments")
    .select("id")
    .eq("stripe_checkout_session_id", sessionId)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export async function findPlatformPaymentIdByPaymentIntent(
  admin: SupabaseClient,
  paymentIntentId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("platform_payments")
    .select("id")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

type Patch = {
  lifecycle_status?: PaymentLifecycleStatus;
  fulfillment_status?: FulfillmentStatus;
  fulfillment_message?: string | null;
  stripe_payment_intent_id?: string | null;
  stripe_payment_received_at?: string | null;
  completed_at?: string | null;
  refunded_at?: string | null;
};

export async function patchPlatformPaymentBySessionId(
  admin: SupabaseClient,
  sessionId: string,
  patch: Patch,
): Promise<void> {
  const { error } = await admin
    .from("platform_payments")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("stripe_checkout_session_id", sessionId);

  if (error) {
    console.error("[platform_payments] patch by session:", error.message);
  }
}

export async function patchPlatformPaymentByPaymentIntentId(
  admin: SupabaseClient,
  paymentIntentId: string,
  patch: Patch,
): Promise<void> {
  const { error } = await admin
    .from("platform_payments")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("stripe_payment_intent_id", paymentIntentId);

  if (error) {
    console.error("[platform_payments] patch by pi:", error.message);
  }
}

export async function patchPlatformPaymentById(
  admin: SupabaseClient,
  id: string,
  patch: Patch,
): Promise<void> {
  const { error } = await admin
    .from("platform_payments")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    console.error("[platform_payments] patch by id:", error.message);
  }
}
