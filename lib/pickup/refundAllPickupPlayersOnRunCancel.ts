import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getStripePickup } from "@/lib/server/runtimeClients";

/**
 * After a pickup run is marked canceled, refund every confirmed player who paid
 * (Stripe payment_intent, no prior refund) and set RSVPs to canceled.
 */
export async function cancelAllPickupRsvpsAndRefundPaidConfirmed(
  supabaseAdmin: SupabaseClient,
  runId: string,
): Promise<{ refunded: string[]; failed: { user_id: string; error: string }[] }> {
  const rsvpsRes = await supabaseAdmin
    .from("pickup_run_rsvps")
    .select("user_id,payment_intent_id,refund_id,status")
    .eq("run_id", runId);

  const rsvps = rsvpsRes.data || [];

  let stripe: Stripe | null = null;
  const refunded: string[] = [];
  const failed: { user_id: string; error: string }[] = [];

  for (const r of rsvps) {
    try {
      const st = String(r.status || "").trim().toLowerCase();
      if (st === "confirmed" && r.payment_intent_id && !r.refund_id) {
        if (!stripe) stripe = getStripePickup();
        const refund = await stripe.refunds.create({
          payment_intent: String(r.payment_intent_id),
        });

        await supabaseAdmin
          .from("pickup_run_rsvps")
          .update({
            refund_id: refund.id,
            status: "canceled",
            updated_at: new Date().toISOString(),
          })
          .eq("run_id", runId)
          .eq("user_id", r.user_id);

        refunded.push(r.user_id);
      } else {
        await supabaseAdmin
          .from("pickup_run_rsvps")
          .update({ status: "canceled", updated_at: new Date().toISOString() })
          .eq("run_id", runId)
          .eq("user_id", r.user_id);
      }
    } catch (e: unknown) {
      failed.push({ user_id: r.user_id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return { refunded, failed };
}
