import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { composePublishMessage } from "@/lib/admin/publish/composePublishMessage";
import { executePublication } from "@/lib/admin/publish/executePublication";
import {
  collectRevalidatePaths,
  writePublishTargetDeliveries,
} from "@/lib/admin/publish/publishTargetWrites";
import {
  effectsFromPublication,
  verifyLinksFromTargets,
} from "@/lib/admin/publish/publicationResponse";
import type { PublishTargetsInput } from "@/lib/admin/publish/types";
import { enqueueRevalidateAndRun } from "@/lib/admin/sync/enqueueRevalidate";
import { isPublishLayerAvailable } from "@/lib/admin/publishLayer";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { processAutoPickupRun } from "@/lib/pickup/autoRunCheckpoints";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

type PublishTargets = {
  /** `status_updates` row id=1 — help assistant + admin dashboards */
  status_updates?: boolean;
  /** `pickup_run_updates` with run_id null — `/status/pickup` global block + feed */
  pickup_global?: boolean;
  /** `pickup_run_updates` for this run */
  pickup_run_id?: string | null;
  /** Active `tournaments` row — `staff_*` columns when migration applied; surfaced via `/api/tournament/public` */
  tournament_active?: boolean;
};

export async function POST(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  const admin = getSupabaseAdmin();
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");

  if (action === "set_hub_pickup") {
    const run_id = body.run_id === null || body.run_id === "" ? null : String(body.run_id);
    const now = new Date().toISOString();

    if (run_id) {
      const runRes = await admin.from("pickup_runs").select("id,status").eq("id", run_id).maybeSingle();
      if (!runRes.data) {
        return NextResponse.json({ error: "Run not found." }, { status: 404 });
      }
      if (runRes.data.status === "canceled") {
        return NextResponse.json({ error: "Cannot promote a canceled run." }, { status: 400 });
      }
    }

    const clear = await admin.from("pickup_runs").update({ is_current: false, updated_at: now }).eq("is_current", true);
    if (clear.error) {
      return NextResponse.json({ error: clear.error.message }, { status: 500 });
    }

    if (run_id) {
      const up = await admin.from("pickup_runs").update({ is_current: true, updated_at: now }).eq("id", run_id);
      if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });
    }

    revalidatePath("/pickup");
    revalidatePath("/admin/pickup");
    revalidatePath("/admin/relationships");
    revalidatePath("/admin");

    return NextResponse.json({
      ok: true,
      action: "set_hub_pickup",
      effects: [
        {
          record: "Pickup hub",
          detail: run_id ? "This run is now the one on the public pickup hub." : "No run is set on the pickup hub.",
        },
      ],
      verify: [
        { label: "Pickup hub", href: "/pickup" },
        { label: "Pickup status page", href: "/status/pickup" },
      ],
    });
  }

  if (action === "set_hub_tournament") {
    const tournament_id =
      body.tournament_id === null || body.tournament_id === "" ? null : String(body.tournament_id);

    const { data: all, error: listErr } = await admin.from("tournaments").select("id");
    if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 });

    for (const r of all ?? []) {
      const { error: uErr } = await admin.from("tournaments").update({ is_active: false }).eq("id", r.id);
      if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });
    }

    if (tournament_id) {
      const { error: actErr } = await admin.from("tournaments").update({ is_active: true }).eq("id", tournament_id);
      if (actErr) return NextResponse.json({ error: actErr.message }, { status: 500 });
    }

    revalidatePath("/tournament");
    revalidatePath("/admin/tournament");
    revalidatePath("/admin/relationships");
    revalidatePath("/admin");

    return NextResponse.json({
      ok: true,
      action: "set_hub_tournament",
      effects: [
        {
          record: "Tournament hub",
          detail: tournament_id
            ? "This tournament is now live for players on the public tournament pages."
            : "No tournament is live on the public hub.",
        },
      ],
      verify: [
        { label: "Tournament hub", href: "/tournament" },
        { label: "Tournament status", href: "/status/tournament" },
      ],
    });
  }

  if (action === "publish") {
    const targetsIn = (body.targets || {}) as PublishTargets;
    const composed = composePublishMessage(String(body.message || ""), body.label as string | undefined);
    if (!composed.ok) {
      return NextResponse.json({ error: composed.error }, { status: 400 });
    }

    const mapped: PublishTargetsInput = {
      siteStatus: !!targetsIn.status_updates,
      pickupGlobal: !!targetsIn.pickup_global,
      pickupRunIds: targetsIn.pickup_run_id ? [String(targetsIn.pickup_run_id)] : [],
      tournamentActive: !!targetsIn.tournament_active,
    };

    if (
      !mapped.siteStatus &&
      !mapped.pickupGlobal &&
      !(mapped.pickupRunIds && mapped.pickupRunIds.length) &&
      !mapped.tournamentActive
    ) {
      return NextResponse.json(
        {
          error: "Choose at least one place to send this message (site status, pickup, or live tournament).",
        },
        { status: 400 },
      );
    }

    for (const runId of mapped.pickupRunIds || []) {
      const runRes = await admin.from("pickup_runs").select("id,status").eq("id", runId).maybeSingle();
      if (!runRes.data) {
        return NextResponse.json({ error: "Pickup run not found for scoped post." }, { status: 404 });
      }
      if (runRes.data.status === "canceled") {
        return NextResponse.json({ error: "Cannot post to a canceled run." }, { status: 400 });
      }
    }

    const publishLayerOk = await isPublishLayerAvailable(admin);

    if (publishLayerOk) {
      try {
        const result = await executePublication({
          admin,
          userId: guard.userId,
          message: composed.text,
          targets: mapped,
          idempotencyKey: null,
        });
        return NextResponse.json({
          ok: true,
          action: "publish",
          duplicate: result.duplicate,
          publicationId: result.publicationId,
          deliveries: result.deliveries,
          revalidateJobId: result.revalidateJobId,
          revalidateError: result.revalidateError,
          effects: effectsFromPublication(result),
          verify: verifyLinksFromTargets(mapped),
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return NextResponse.json({ error: msg }, { status: 500 });
      }
    }

    const drafts = await writePublishTargetDeliveries(admin, guard.userId, composed.text, mapped);
    const paths = collectRevalidatePaths(mapped);
    const rev =
      paths.length > 0 ? await enqueueRevalidateAndRun(admin, paths) : await enqueueRevalidateAndRun(admin, []);

    return NextResponse.json({
      ok: true,
      action: "publish",
      duplicate: false,
      publicationId: null,
      deliveries: drafts,
      revalidateJobId: rev.jobId,
      revalidateError: rev.error,
      effects: effectsFromPublication({ deliveries: drafts }),
      verify: verifyLinksFromTargets(mapped),
    });
  }

  if (action === "process_pickup_run") {
    const run_id = String(body.run_id || "");
    if (!run_id) return NextResponse.json({ error: "Missing run_id" }, { status: 400 });

    const runRes = await admin.from("pickup_runs").select("id,auto_managed,status").eq("id", run_id).maybeSingle();
    if (!runRes.data) return NextResponse.json({ error: "Run not found" }, { status: 404 });

    if (!runRes.data.auto_managed) {
      return NextResponse.json(
        {
          ok: false,
          blocked: true,
          error: "Automation isn’t on for this run yet. Launch outreach from Pickups first.",
        },
        { status: 409 }
      );
    }

    if (runRes.data.status === "canceled" || runRes.data.status === "active") {
      return NextResponse.json({
        ok: true,
        skipped: true,
        messages: [`Processor skipped: run status is ${runRes.data.status}.`],
        effects: [{ record: "Pickup automation", detail: "Nothing to do — this run is already finished or canceled." }],
      });
    }

    const { messages } = await processAutoPickupRun(admin, run_id);
    revalidatePath("/admin/sync");
    revalidatePath("/admin/pickup");
    revalidatePath("/pickup");

    return NextResponse.json({
      ok: true,
      action: "process_pickup_run",
      messages,
      effects: [
        {
          record: "Pickup automation",
          detail:
            messages.length > 0
              ? messages.join(" · ")
              : "No checkpoint ran — timing or prior steps already handled it.",
        },
      ],
      verify: [
        { label: "Sync & status", href: "/admin/sync" },
        { label: "Pickup admin", href: "/admin/pickup" },
      ],
    });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
