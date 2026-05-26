import type { SupabaseClient } from "@supabase/supabase-js";

const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;

export type CancelPickupRunRsvpsResult = {
  credited: string[];
  creditFailed: { user_id: string; error: string }[];
  paidUserIds: string[];
  freeUserIds: string[];
  venueLabel: string;
};

function venueLabelFromRun(run: { title?: string | null; location_private?: string | null }): string {
  const loc = String(run.location_private || "").trim();
  if (loc) {
    const first = loc.split(/\r?\n/)[0]?.trim();
    if (first) return first;
  }
  const title = String(run.title || "").trim();
  return title || "your";
}

/**
 * After a pickup run is marked canceled: cancel RSVPs (no Stripe refunds),
 * issue one cancellation credit per player who paid, and return user ids for push targeting.
 */
export async function cancelAllPickupRsvpsAndIssueCancellationCredits(
  supabaseAdmin: SupabaseClient,
  runId: string,
): Promise<CancelPickupRunRsvpsResult> {
  const runRes = await supabaseAdmin
    .from("pickup_runs")
    .select("title,location_private,fee_cents")
    .eq("id", runId)
    .maybeSingle();

  const run = runRes.data;
  const runFeeCents = Number(run?.fee_cents ?? 0) || 0;

  const rsvpsRes = await supabaseAdmin
    .from("pickup_run_rsvps")
    .select("user_id,payment_intent_id,refund_id,status,paid_at")
    .eq("run_id", runId);

  const rsvps = rsvpsRes.data || [];

  const paymentsRes = await supabaseAdmin
    .from("platform_payments")
    .select("user_id,amount_cents,lifecycle_status")
    .eq("product_type", "pickup")
    .eq("product_entity_id", runId);

  const amountByUser = new Map<string, number>();
  for (const p of paymentsRes.data || []) {
    const uid = String(p.user_id || "");
    if (!uid) continue;
    if (String(p.lifecycle_status || "") !== "payment_received") continue;
    const cents = Number(p.amount_cents ?? 0) || 0;
    const prev = amountByUser.get(uid) ?? 0;
    if (cents > prev) amountByUser.set(uid, cents);
  }

  const credited: string[] = [];
  const creditFailed: { user_id: string; error: string }[] = [];
  const paidUserIds: string[] = [];
  const freeUserIds: string[] = [];

  const expiresAt = new Date(Date.now() + THREE_MONTHS_MS).toISOString();

  for (const r of rsvps) {
    const userId = String(r.user_id || "");
    if (!userId) continue;

    const st = String(r.status || "").trim().toLowerCase();
    const isConfirmed = st === "confirmed";

    const paymentIntent =
      r.payment_intent_id != null && String(r.payment_intent_id).trim().length > 0
        ? String(r.payment_intent_id).trim()
        : null;
    const platformAmount = amountByUser.get(userId) ?? 0;
    const paidWithMoney =
      isConfirmed && (platformAmount > 0 || (paymentIntent != null && runFeeCents > 0));

    try {
      await supabaseAdmin
        .from("pickup_run_rsvps")
        .update({ status: "canceled", updated_at: new Date().toISOString() })
        .eq("run_id", runId)
        .eq("user_id", userId);

      if (!isConfirmed) continue;

      if (paidWithMoney) {
        paidUserIds.push(userId);

        const cancellationCreditCents =
          platformAmount > 0 ? platformAmount : runFeeCents > 0 ? runFeeCents : 0;

        const { error: insertErr } = await supabaseAdmin.from("pickup_credits").insert({
          user_id: userId,
          amount_cents: cancellationCreditCents > 0 ? cancellationCreditCents : null,
          discount_pct: null,
          reason: "cancellation",
          expires_at: expiresAt,
          cancelled_run_id: runId,
        });

        if (insertErr) {
          if (insertErr.code === "23505") {
            credited.push(userId);
          } else {
            creditFailed.push({ user_id: userId, error: insertErr.message });
          }
        } else {
          credited.push(userId);
        }
      } else {
        freeUserIds.push(userId);
      }
    } catch (e: unknown) {
      creditFailed.push({
        user_id: userId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { credited, creditFailed, paidUserIds, freeUserIds, venueLabel: venueLabelFromRun(run || {}) };
}
