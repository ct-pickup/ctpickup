import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applySurfaceHealth,
  SURFACE_PICKUP_GLOBAL,
  SURFACE_SITE_STATUS,
  SURFACE_TOURNAMENT_HUB,
  surfaceKeyPickupRun,
  surfaceKeyTournament,
} from "@/lib/admin/surfaceHealth";
import { enqueueRevalidateAndRun } from "@/lib/admin/sync/enqueueRevalidate";
import type { DeliveryRow, ExecutePublicationResult, PublishDeps, PublishTargetsInput } from "./types";

async function fetchDeliveries(admin: SupabaseClient, publicationId: string): Promise<DeliveryRow[]> {
  const { data } = await admin.from("admin_publication_deliveries").select("*").eq("publication_id", publicationId);
  return (data || []) as DeliveryRow[];
}

function collectPaths(targets: PublishTargetsInput): string[] {
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
  return Array.from(paths);
}

export async function executePublication(deps: PublishDeps): Promise<ExecutePublicationResult> {
  const { admin, userId, message, targets, idempotencyKey } = deps;
  const trimmed = message.trim();
  if (!trimmed) {
    throw new Error("empty_message");
  }

  if (idempotencyKey) {
    const dup = await admin
      .from("admin_publications")
      .select("id, message")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (dup.data?.id) {
      const deliveries = await fetchDeliveries(admin, dup.data.id);
      return {
        duplicate: true,
        publicationId: dup.data.id,
        message: dup.data.message,
        deliveries,
        revalidateJobId: null,
        revalidateError: null,
      };
    }
  }

  const insPub = await admin
    .from("admin_publications")
    .insert({
      message: trimmed,
      created_by: userId,
      idempotency_key: idempotencyKey || null,
    })
    .select("id, message")
    .single();

  if (insPub.error) {
    if (insPub.error.code === "23505" && idempotencyKey) {
      const dup = await admin
        .from("admin_publications")
        .select("id, message")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (dup.data?.id) {
        const deliveries = await fetchDeliveries(admin, dup.data.id);
        return {
          duplicate: true,
          publicationId: dup.data.id,
          message: dup.data.message,
          deliveries,
          revalidateJobId: null,
          revalidateError: null,
        };
      }
    }
    throw new Error(insPub.error.message);
  }

  const publicationId = insPub.data!.id as string;
  const deliveries: DeliveryRow[] = [];
  const ts = () => new Date().toISOString();

  const pushDelivery = async (row: {
    channel: DeliveryRow["channel"];
    entity_id: string | null;
    sink_table: string;
    sink_row_id: string | null;
    sync_state: DeliveryRow["sync_state"];
    last_error: string | null;
  }) => {
    const ins = await admin
      .from("admin_publication_deliveries")
      .insert({
        publication_id: publicationId,
        channel: row.channel,
        entity_id: row.entity_id,
        sink_table: row.sink_table,
        sink_row_id: row.sink_row_id,
        sync_state: row.sync_state,
        last_error: row.last_error,
        updated_at: ts(),
      })
      .select("*")
      .single();
    if (ins.data) deliveries.push(ins.data as DeliveryRow);
  };

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
    await pushDelivery({
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
    await pushDelivery({
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
      await pushDelivery({
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
    await pushDelivery({
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
      await pushDelivery({
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
      await pushDelivery({
        channel: "tournament_active",
        entity_id: t.id,
        sink_table: "tournaments",
        sink_row_id: t.id,
        sync_state: ok ? "synced" : "failed",
        last_error: err,
      });
    }
  }

  await admin.from("admin_audit_log").insert({
    actor_id: userId,
    action: "publish",
    detail: {
      publication_id: publicationId,
      targets,
      failed: deliveries.filter((d) => d.sync_state === "failed").length,
    },
  });

  const paths = collectPaths(targets);
  const rev =
    paths.length > 0
      ? await enqueueRevalidateAndRun(admin, paths)
      : await enqueueRevalidateAndRun(admin, []);

  return {
    duplicate: false,
    publicationId,
    message: trimmed,
    deliveries,
    revalidateJobId: rev.jobId,
    revalidateError: rev.error,
  };
}

export async function retryPublicationDelivery(
  admin: SupabaseClient,
  deliveryId: string,
  userId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data: d, error: dErr } = await admin
    .from("admin_publication_deliveries")
    .select("*")
    .eq("id", deliveryId)
    .maybeSingle();
  if (dErr || !d) return { ok: false, error: dErr?.message || "delivery_not_found" };

  const { data: pub, error: pErr } = await admin
    .from("admin_publications")
    .select("message")
    .eq("id", d.publication_id as string)
    .maybeSingle();
  if (pErr || !pub?.message) return { ok: false, error: "publication_not_found" };

  const msg = String(pub.message).trim();
  const ts = new Date().toISOString();
  const channel = d.channel as DeliveryRow["channel"];

  if (channel === "site_status") {
    const up = await admin
      .from("status_updates")
      .update({ announcement: msg, updated_at: ts })
      .eq("id", 1)
      .select("id");
    const ok = !up.error && (up.data?.length ?? 0) > 0;
    const err = ok ? null : up.error?.message || "status_updates row id=1 not updated";
    await applySurfaceHealth(admin, SURFACE_SITE_STATUS, "Site-wide status card", ok ? "synced" : "failed", err);
    await admin
      .from("admin_publication_deliveries")
      .update({
        sync_state: ok ? "synced" : "failed",
        last_error: err,
        updated_at: ts,
      })
      .eq("id", deliveryId);
    if (ok) await enqueueRevalidateAndRun(admin, ["/status/pickup", "/status/tournament"]);
    await admin.from("admin_audit_log").insert({ actor_id: userId, action: "retry_delivery", detail: { deliveryId } });
    return ok ? { ok: true } : { ok: false, error: err || undefined };
  }

  if (channel === "pickup_global") {
    const ins = await admin
      .from("pickup_run_updates")
      .insert({ run_id: null, message: msg, created_by: userId })
      .select("id")
      .single();
    const ok = !ins.error && !!ins.data?.id;
    const err = ok ? null : ins.error?.message || "insert failed";
    await applySurfaceHealth(admin, SURFACE_PICKUP_GLOBAL, "Pickup global posts", ok ? "synced" : "failed", err);
    await admin
      .from("admin_publication_deliveries")
      .update({
        sync_state: ok ? "synced" : "failed",
        sink_row_id: ok ? (ins.data!.id as string) : null,
        last_error: err,
        updated_at: ts,
      })
      .eq("id", deliveryId);
    if (ok) await enqueueRevalidateAndRun(admin, ["/pickup", "/status/pickup"]);
    await admin.from("admin_audit_log").insert({ actor_id: userId, action: "retry_delivery", detail: { deliveryId } });
    return ok ? { ok: true } : { ok: false, error: err || undefined };
  }

  if (channel === "pickup_run") {
    const runId = d.entity_id as string;
    const ins = await admin
      .from("pickup_run_updates")
      .insert({ run_id: runId, message: msg, created_by: userId })
      .select("id")
      .single();
    const ok = !ins.error && !!ins.data?.id;
    const err = ok ? null : ins.error?.message || "insert failed";
    const runRes = await admin.from("pickup_runs").select("title").eq("id", runId).maybeSingle();
    await applySurfaceHealth(
      admin,
      surfaceKeyPickupRun(runId),
      `Pickup · ${runRes.data?.title || runId.slice(0, 8)}`,
      ok ? "synced" : "failed",
      err,
    );
    await admin
      .from("admin_publication_deliveries")
      .update({
        sync_state: ok ? "synced" : "failed",
        sink_row_id: ok ? (ins.data!.id as string) : null,
        last_error: err,
        updated_at: ts,
      })
      .eq("id", deliveryId);
    if (ok) await enqueueRevalidateAndRun(admin, ["/pickup", "/status/pickup"]);
    await admin.from("admin_audit_log").insert({ actor_id: userId, action: "retry_delivery", detail: { deliveryId } });
    return ok ? { ok: true } : { ok: false, error: err || undefined };
  }

  if (channel === "tournament_active") {
    const tid = (d.entity_id as string) || null;
    if (!tid) return { ok: false, error: "missing_tournament_id" };
    const up = await admin
      .from("tournaments")
      .update({ staff_announcement: msg, staff_announcement_at: ts })
      .eq("id", tid)
      .select("id,title")
      .single();
    const ok = !up.error && !!up.data?.id;
    const err = ok ? null : up.error?.message || "update failed";
    await applySurfaceHealth(admin, SURFACE_TOURNAMENT_HUB, "Tournament public hub", ok ? "synced" : "failed", err);
    await applySurfaceHealth(
      admin,
      surfaceKeyTournament(tid),
      `Tournament · ${(up.data as { title?: string })?.title || tid.slice(0, 8)}`,
      ok ? "synced" : "failed",
      err,
    );
    await admin
      .from("admin_publication_deliveries")
      .update({
        sync_state: ok ? "synced" : "failed",
        last_error: err,
        updated_at: ts,
      })
      .eq("id", deliveryId);
    if (ok) await enqueueRevalidateAndRun(admin, ["/tournament", "/status/tournament"]);
    await admin.from("admin_audit_log").insert({ actor_id: userId, action: "retry_delivery", detail: { deliveryId } });
    return ok ? { ok: true } : { ok: false, error: err || undefined };
  }

  return { ok: false, error: "unknown_channel" };
}
