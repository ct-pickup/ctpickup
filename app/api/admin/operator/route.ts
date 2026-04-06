import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
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

function revalidatePublicSurfaces() {
  revalidatePath("/status/pickup");
  revalidatePath("/pickup");
  revalidatePath("/admin/content");
  revalidatePath("/admin/relationships");
  revalidatePath("/admin");
  revalidatePath("/admin/sync");
}

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
    const message = String(body.message || "").trim();
    const targets = (body.targets || {}) as PublishTargets;

    if (!message) {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }

    const doStatus = !!targets.status_updates;
    const doGlobal = !!targets.pickup_global;
    const runId = targets.pickup_run_id ? String(targets.pickup_run_id) : null;
    const doTournament = !!targets.tournament_active;

    if (!doStatus && !doGlobal && !runId && !doTournament) {
      return NextResponse.json(
        {
          error: "Choose at least one place to send this message (site status, pickup, or live tournament).",
        },
        { status: 400 }
      );
    }

    if (runId) {
      const runRes = await admin.from("pickup_runs").select("id,status").eq("id", runId).maybeSingle();
      if (!runRes.data) {
        return NextResponse.json({ error: "Pickup run not found for scoped post." }, { status: 404 });
      }
      if (runRes.data.status === "canceled") {
        return NextResponse.json({ error: "Cannot post to a canceled run." }, { status: 400 });
      }
    }

    const now = new Date().toISOString();
    const effects: { record: string; detail: string }[] = [];

    if (doStatus) {
      const { error } = await admin
        .from("status_updates")
        .update({ announcement: message, updated_at: now })
        .eq("id", 1);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      effects.push({
        record: "Site-wide status",
        detail: "Main announcement updated (help chat and staff tools read this).",
      });
    }

    if (doGlobal) {
      const { error } = await admin.from("pickup_run_updates").insert({
        run_id: null,
        message,
        created_by: guard.userId,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      effects.push({
        record: "Pickup (all players)",
        detail: "Posted to everyone following pickup — shows on pickup status and feeds.",
      });
    }

    if (runId) {
      const { error } = await admin.from("pickup_run_updates").insert({
        run_id: runId,
        message,
        created_by: guard.userId,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      effects.push({
        record: "Pickup (one run)",
        detail: "Posted only for the run you selected.",
      });
    }

    if (doTournament) {
      const tRes = await admin.from("tournaments").select("id,title").eq("is_active", true).maybeSingle();
      if (!tRes.data?.id) {
        effects.push({
          record: "Live tournament",
          detail: "Skipped — mark a tournament live first, then publish again.",
        });
      } else {
        const { error } = await admin
          .from("tournaments")
          .update({ staff_announcement: message, staff_announcement_at: now })
          .eq("id", tRes.data.id);
        if (error) {
          return NextResponse.json(
            {
              error: error.message,
              hint: "Tournament announcements may need a recent database update. Ask whoever deploys the app to run pending migrations.",
            },
            { status: 500 }
          );
        }
        effects.push({
          record: "Live tournament",
          detail: `Announcement saved on “${tRes.data.title || tRes.data.id}”.`,
        });
      }
    }

    revalidatePublicSurfaces();
    if (doTournament) {
      revalidatePath("/tournament");
      revalidatePath("/status/tournament");
    }

    const verify: { label: string; href: string }[] = [];
    if (doGlobal || runId) verify.push({ label: "Pickup status", href: "/status/pickup" });
    if (doStatus) {
      verify.push({ label: "Site-wide status editor", href: "/admin/status" });
    }
    if (doTournament) {
      verify.push({ label: "Tournament hub", href: "/tournament" });
    }
    verify.push({ label: "Pickup hub", href: "/pickup" });

    return NextResponse.json({
      ok: true,
      action: "publish",
      effects,
      verify,
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
