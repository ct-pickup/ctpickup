import type { SupabaseClient } from "@supabase/supabase-js";

export type RunDeletionBlockers = { rsvps: number; payments: number };

export const RUN_HAS_PLAYERS_MESSAGE =
  "This run has players or payments, so it can't be deleted. Cancel it instead so everyone is refunded and notified.";

/** RSVPs in any status and platform payments tied to the run. A run can only be hard deleted when both are zero. */
export async function loadRunDeletionBlockers(
  admin: SupabaseClient,
  runId: string,
): Promise<{ ok: true; blockers: RunDeletionBlockers } | { ok: false; error: string }> {
  const [rsvpRes, byEntityRes, byMetaRes] = await Promise.all([
    admin.from("pickup_run_rsvps").select("user_id").eq("run_id", runId),
    admin.from("platform_payments").select("id").eq("product_entity_id", runId),
    admin.from("platform_payments").select("id").eq("metadata->>run_id", runId),
  ]);
  const err = rsvpRes.error || byEntityRes.error || byMetaRes.error;
  if (err) return { ok: false, error: err.message };
  const paymentIds = new Set<string>();
  for (const r of [...(byEntityRes.data || []), ...(byMetaRes.data || [])]) paymentIds.add(String(r.id));
  return { ok: true, blockers: { rsvps: (rsvpRes.data || []).length, payments: paymentIds.size } };
}
