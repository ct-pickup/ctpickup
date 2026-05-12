import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getStripeTournament } from "@/lib/server/runtimeClients";

/**
 * Refunds captured Stripe captain payments for a tournament and marks rows refunded.
 */
export async function refundPaidCaptainsOnTournamentCancel(
  admin: SupabaseClient,
  tournamentId: string,
): Promise<{ refunded: string[]; failed: { captain_id: string; error: string }[] }> {
  const payRes = await admin
    .from("tournament_payments")
    .select("id,captain_id,status,stripe_payment_intent_id,refund_id")
    .eq("tournament_id", tournamentId);

  const rows = payRes.data || [];
  let stripe: Stripe | null = null;
  const refunded: string[] = [];
  const failed: { captain_id: string; error: string }[] = [];

  for (const row of rows) {
    const r = row as {
      id: string;
      captain_id: string;
      status: string;
      stripe_payment_intent_id: string | null;
      refund_id: string | null;
    };
    try {
      if (r.status === "captured" && r.stripe_payment_intent_id && !r.refund_id) {
        if (!stripe) stripe = getStripeTournament();
        const refund = await stripe.refunds.create({
          payment_intent: String(r.stripe_payment_intent_id),
        });
        await admin
          .from("tournament_payments")
          .update({ refund_id: refund.id, status: "refunded" })
          .eq("id", r.id);
        refunded.push(r.captain_id);
      }
    } catch (e: unknown) {
      failed.push({ captain_id: r.captain_id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return { refunded, failed };
}
