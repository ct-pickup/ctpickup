import type { SupabaseClient } from "@supabase/supabase-js";

export const SURFACE_SITE_STATUS = "site_status";
export const SURFACE_PICKUP_GLOBAL = "pickup_posts_global";
export const SURFACE_TOURNAMENT_HUB = "tournament_hub";

export function surfaceKeyPickupRun(runId: string) {
  return `pickup_run:${runId}`;
}

export function surfaceKeyTournament(tournamentId: string) {
  return `tournament:${tournamentId}`;
}

export async function applySurfaceHealth(
  admin: SupabaseClient,
  surfaceKey: string,
  label: string,
  state: "synced" | "pending" | "failed",
  err?: string | null,
) {
  const now = new Date().toISOString();
  const { data: existing } = await admin
    .from("admin_surface_health")
    .select("last_success_at")
    .eq("surface_key", surfaceKey)
    .maybeSingle();
  const prevOk = (existing?.last_success_at as string | null) ?? null;
  const last_success_at = state === "synced" ? now : prevOk;

  const row: Record<string, unknown> = {
    surface_key: surfaceKey,
    label,
    sync_state: state,
    last_attempt_at: now,
    last_error: err ?? null,
    last_success_at,
    updated_at: now,
  };

  const up = await admin.from("admin_surface_health").upsert(row, { onConflict: "surface_key" });
  if (up.error) {
    console.error("applySurfaceHealth:", up.error.message);
  }
}

export async function recordLegacyPickupPost(
  admin: SupabaseClient,
  opts: { runId: string | null; userId: string },
) {
  const key = opts.runId ? surfaceKeyPickupRun(opts.runId) : SURFACE_PICKUP_GLOBAL;
  const label = opts.runId ? "Pickup · run post" : "Pickup · global post";
  await applySurfaceHealth(admin, key, label, "synced", null);
  await admin.from("admin_audit_log").insert({
    actor_id: opts.userId,
    action: "legacy_pickup_post",
    detail: { run_id: opts.runId },
  });
}

export async function recordTournamentActivationChange(admin: SupabaseClient, actorId: string | null) {
  await applySurfaceHealth(admin, SURFACE_TOURNAMENT_HUB, "Tournament public hub", "synced", null);
  await admin.from("admin_audit_log").insert({
    actor_id: actorId,
    action: "tournament_activation_changed",
    detail: {},
  });
}
