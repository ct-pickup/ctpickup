import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Ensures a row exists in pickup_run_invites for this user and run.
 * Select-run hub visibility and invite-based flows key off this link; idempotent.
 */
export async function ensurePickupRunInviteLink(
  admin: SupabaseClient,
  runId: string,
  userId: string,
): Promise<void> {
  const { data: existing, error: selErr } = await admin
    .from("pickup_run_invites")
    .select("run_id")
    .eq("run_id", runId)
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (selErr) {
    console.error("ensurePickupRunInviteLink select:", selErr.message);
    return;
  }
  if (existing) return;

  const ins = await admin.from("pickup_run_invites").insert({ run_id: runId, user_id: userId });
  if (ins.error) {
    const msg = ins.error.message || "";
    if (!/duplicate|unique/i.test(msg)) {
      console.error("ensurePickupRunInviteLink insert:", msg);
    }
  }
}
