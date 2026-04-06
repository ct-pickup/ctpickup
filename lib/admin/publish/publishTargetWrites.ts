import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applySurfaceHealth,
  SURFACE_PICKUP_GLOBAL,
  SURFACE_SITE_STATUS,
  SURFACE_TOURNAMENT_HUB,
  surfaceKeyPickupRun,
  surfaceKeyTournament,
} from "@/lib/admin/surfaceHealth";
import type { DeliveryRow, PublishTargetsInput } from "@/lib/admin/publish/types";

export type PublicationDeliveryDraft = Pick<
  DeliveryRow,
  "channel" | "entity_id" | "sink_table" | "sink_row_id" | "sync_state" | "last_error"
>;

export function collectRevalidatePaths(targets: PublishTargetsInput): string[] {
  const paths = new Set<string>();
  if (targets.siteStatus) {
    paths.add("/status/pickup");
    paths.add("/status/tournament");
  }
  if (targets.pickupGlobal || (targets.pickupRunIds && targets.pickupRunIds.length)) {
    paths.add("/pickup");
    paths.add("/status/pickup");
  }
  if (targets.tournamentActive) {
    paths.add("/tournament");
    paths.add("/status/tournament");
  }
  const any =
    targets.siteStatus ||
    targets.pickupGlobal ||
    (targets.pickupRunIds && targets.pickupRunIds.length > 0) ||
    targets.tournamentActive;
  if (any) {
    paths.add("/admin/content");
    paths.add("/admin");
    paths.add("/admin/sync");
    paths.add("/admin/relationships");
  }
  return Array.from(paths);
}

/**
 * Applies status_updates, pickup_run_updates, and tournament announcement writes.
 * Single implementation used by logged (`executePublication`) and legacy (`operator`) entry points.
 */
export async function writePublishTargetDeliveries(
  admin: SupabaseClient,
  userId: string,
  message: string,
  targets: PublishTargetsInput,
): Promise<PublicationDeliveryDraft[]> {
  const trimmed = message.trim();
  const deliveries: PublicationDeliveryDraft[] = [];
  const ts = () => new Date().toISOString();

  if (targets.siteStatus) {
    const up = await admin
      .from("status_updates")
      .update({
        announcement: trimmed,
        updated_at: ts(),
      })
      .eq("id", 1)
      .select("id");
    const ok = !up.error && (up.data?.length ?? 0) > 0;
    const err = ok ? null : up.error?.message || "status_updates row id=1 not updated";
    await applySurfaceHealth(admin, SURFACE_SITE_STATUS, "Site-wide status card", ok ? "synced" : "failed", err);
    deliveries.push({
      channel: "site_status",
      entity_id: null,
      sink_table: "status_updates",
      sink_row_id: null,
      sync_state: ok ? "synced" : "failed",
      last_error: err,
    });
  }

  if (targets.pickupGlobal) {
    const ins = await admin
      .from("pickup_run_updates")
      .insert({
        run_id: null,
        message: trimmed,
        created_by: userId,
      })
      .select("id")
      .single();
    const ok = !ins.error && !!ins.data?.id;
    const err = ok ? null : ins.error?.message || "pickup_run_updates insert failed";
    await applySurfaceHealth(admin, SURFACE_PICKUP_GLOBAL, "Pickup global posts", ok ? "synced" : "failed", err);
    deliveries.push({
      channel: "pickup_global",
      entity_id: null,
      sink_table: "pickup_run_updates",
      sink_row_id: ok ? (ins.data!.id as string) : null,
      sync_state: ok ? "synced" : "failed",
      last_error: err,
    });
  }

  const runIds = Array.from(new Set((targets.pickupRunIds || []).map((x) => String(x).trim()).filter(Boolean)));
  for (const runId of runIds) {
    const runRes = await admin
      .from("pickup_runs")
      .select("id,title,status")
      .eq("id", runId)
      .maybeSingle();
    const run = runRes.data;
    if (!run || run.status === "canceled") {
      const err = !run ? "pickup run not found" : "pickup run canceled";
      await applySurfaceHealth(admin, surfaceKeyPickupRun(runId), "Pickup run post", "failed", err);
      deliveries.push({
        channel: "pickup_run",
        entity_id: runId,
        sink_table: "pickup_run_updates",
        sink_row_id: null,
        sync_state: "failed",
        last_error: err,
      });
      continue;
    }

    const ins = await admin
      .from("pickup_run_updates")
      .insert({
        run_id: runId,
        message: trimmed,
        created_by: userId,
      })
      .select("id")
      .single();
    const ok = !ins.error && !!ins.data?.id;
    const err = ok ? null : ins.error?.message || "pickup_run_updates insert failed";
    await applySurfaceHealth(
      admin,
      surfaceKeyPickupRun(runId),
      `Pickup · ${run.title || runId.slice(0, 8)}`,
      ok ? "synced" : "failed",
      err,
    );
    deliveries.push({
      channel: "pickup_run",
      entity_id: runId,
      sink_table: "pickup_run_updates",
      sink_row_id: ok ? (ins.data!.id as string) : null,
      sync_state: ok ? "synced" : "failed",
      last_error: err,
    });
  }

  if (targets.tournamentActive) {
    const tRes = await admin.from("tournaments").select("id,title").eq("is_active", true).maybeSingle();
    const t = tRes.data;
    if (!t?.id) {
      const err = "no active tournament";
      await applySurfaceHealth(admin, SURFACE_TOURNAMENT_HUB, "Tournament public hub", "failed", err);
      deliveries.push({
        channel: "tournament_active",
        entity_id: null,
        sink_table: "tournaments",
        sink_row_id: null,
        sync_state: "failed",
        last_error: err,
      });
    } else {
      const up = await admin
        .from("tournaments")
        .update({
          staff_announcement: trimmed,
          staff_announcement_at: ts(),
        })
        .eq("id", t.id)
        .select("id")
        .single();
      const ok = !up.error && !!up.data?.id;
      const err = ok ? null : up.error?.message || "tournament update failed";
      await applySurfaceHealth(admin, SURFACE_TOURNAMENT_HUB, "Tournament public hub", ok ? "synced" : "failed", err);
      await applySurfaceHealth(
        admin,
        surfaceKeyTournament(t.id),
        `Tournament · ${t.title || t.id.slice(0, 8)}`,
        ok ? "synced" : "failed",
        err,
      );
      deliveries.push({
        channel: "tournament_active",
        entity_id: t.id,
        sink_table: "tournaments",
        sink_row_id: t.id,
        sync_state: ok ? "synced" : "failed",
        last_error: err,
      });
    }
  }

  return deliveries;
}
