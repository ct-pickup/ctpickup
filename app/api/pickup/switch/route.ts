import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { MIN_LEAD_BEFORE_LAUNCH_MS } from "@/lib/pickup/autoRunConfig";
import {
  describePickupAutoStatus,
  processAutoPickupRun,
} from "@/lib/pickup/autoRunCheckpoints";
import { insertInvitesForTierRanks, sendPickupInviteSms } from "@/lib/pickup/pickupInvites";
import { anchorStartAtMs, computeCancellationDeadline } from "@/lib/pickup/runScheduling";

export const runtime = "nodejs";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET: returns runs list + optional detail (?run_id=...)
export async function GET(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const run_id = url.searchParams.get("run_id");

  const runsRes = await admin
    .from("pickup_runs")
    .select(
      "id,title,status,start_at,created_at,run_type,capacity,fee_cents,currency,open_tier_rank,wave1_started_at,likely_on_slot_id,final_slot_id,is_current,outreach_started_at,auto_managed"
    )
    .neq("status", "canceled")
    .order("created_at", { ascending: false });

  const runs = runsRes.data || [];

  if (!run_id) return NextResponse.json({ runs });

  const { messages } = await processAutoPickupRun(admin, run_id);

  const runRes = await admin.from("pickup_runs").select("*").eq("id", run_id).maybeSingle();
  const run = runRes.data;

  const slotsRes = await admin
    .from("pickup_run_time_slots")
    .select("id,run_id,start_at,label,created_at")
    .eq("run_id", run_id)
    .order("start_at");

  const slots = slotsRes.data || [];

  const availRes = await admin
    .from("pickup_run_availability")
    .select("user_id,slot_id,state,updated_at")
    .eq("run_id", run_id);

  const availability = availRes.data || [];

  const inviteRes = await admin
    .from("pickup_run_invites")
    .select("user_id,invited_at")
    .eq("run_id", run_id);

  const invites = inviteRes.data || [];

  const rsvpRes = await admin
    .from("pickup_run_rsvps")
    .select("user_id,status,updated_at")
    .eq("run_id", run_id);

  const rsvps = rsvpRes.data || [];

  const updateGlobal = await admin
    .from("pickup_run_updates")
    .select("id,run_id,message,created_at,created_by")
    .is("run_id", null)
    .order("created_at", { ascending: false })
    .limit(1);

  const updateRun = await admin
    .from("pickup_run_updates")
    .select("id,run_id,message,created_at,created_by")
    .eq("run_id", run_id)
    .order("created_at", { ascending: false })
    .limit(1);

  const counts = {
    invites: invites.length,
    available: availability.filter((a) => a.state === "available").length,
    declined: availability.filter((a) => a.state === "declined").length,
    confirmed: rsvps.filter((r) => r.status === "confirmed").length,
    standby: rsvps.filter((r) => r.status === "standby").length,
    pending_payment: rsvps.filter((r) => r.status === "pending_payment").length,
  };

  const auto_status = describePickupAutoStatus(run, slots, availability, rsvps, messages);

  return NextResponse.json({
    runs,
    run,
    slots,
    availability,
    invites,
    rsvps,
    updates: {
      global: updateGlobal.data?.[0] || null,
      run: updateRun.data?.[0] || null,
    },
    counts,
    auto_status,
  });
}

type Action =
  | "create_run"
  | "add_slot"
  | "open_wave1"
  | "launch_outreach"
  | "finalize_slot"
  | "edit_run"
  | "post_update"
  | "cancel_run";

export async function POST(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "") as Action;

  if (!action) return NextResponse.json({ error: "Missing action" }, { status: 400 });

  // 1) Create run (promoted hub); outreach deferred until Launch (36h+ before kickoff)
  if (action === "create_run") {
    const title = String(body.title || "CT Pickup Run");
    const run_type = String(body.run_type || "select");
    const capacity = Number(body.capacity || 18);
    const fee_cents = Number(body.fee_cents || 0);
    const currency = String(body.currency || "usd");
    const location_private = body.location_private ? String(body.location_private) : null;
    const show_location_to_confirmed_only = body.show_location_to_confirmed_only !== false;

    const now = new Date().toISOString();

    const clearPrev = await admin
      .from("pickup_runs")
      .update({ is_current: false, updated_at: now })
      .eq("is_current", true);
    if (clearPrev.error) return NextResponse.json({ error: clearPrev.error.message }, { status: 500 });

    const ins = await admin
      .from("pickup_runs")
      .insert({
        title,
        run_type,
        status: "planning",
        start_at: null,
        capacity,
        fee_cents,
        currency,
        location_private,
        show_location_to_confirmed_only,
        is_current: true,
        open_tier_rank: null,
        wave1_started_at: null,
        outreach_started_at: null,
        auto_managed: false,
        likely_on_at: null,
        likely_on_slot_id: null,
        final_slot_id: null,
        created_by: guard.userId,
        updated_at: now,
      })
      .select("id")
      .maybeSingle();

    if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });
    const newId = ins.data?.id as string | undefined;
    if (!newId) return NextResponse.json({ error: "Insert returned no id" }, { status: 500 });

    return NextResponse.json({ ok: true, run_id: newId });
  }

  if (action === "add_slot") {
    const run_id = String(body.run_id || "");
    const start_at = String(body.start_at || "");
    const label = body.label ? String(body.label) : null;

    if (!run_id) return NextResponse.json({ error: "Missing run_id" }, { status: 400 });
    if (!start_at) return NextResponse.json({ error: "Missing start_at" }, { status: 400 });

    const ins = await admin.from("pickup_run_time_slots").insert({
      run_id,
      start_at,
      label,
    }).select("id").maybeSingle();

    if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });
    return NextResponse.json({ ok: true, slot_id: ins.data?.id });
  }

  if (action === "open_wave1" || action === "launch_outreach") {
    const run_id = String(body.run_id || "");
    if (!run_id) return NextResponse.json({ error: "Missing run_id" }, { status: 400 });

    const runRes = await admin.from("pickup_runs").select("*").eq("id", run_id).maybeSingle();
    const run = runRes.data;
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

    if (run.outreach_started_at) {
      return NextResponse.json({ error: "Outreach already launched for this run." }, { status: 400 });
    }

    const slotsRes = await admin.from("pickup_run_time_slots").select("start_at").eq("run_id", run_id);
    const slots = slotsRes.data || [];
    const anchorMs = anchorStartAtMs({ start_at: run.start_at }, slots);
    if (anchorMs === null) {
      return NextResponse.json(
        {
          error:
            "Add at least one time slot with kickoff time before launch. Checkpoints anchor to the earliest slot (or run start).",
        },
        { status: 400 }
      );
    }

    if (anchorMs - Date.now() < MIN_LEAD_BEFORE_LAUNCH_MS) {
      return NextResponse.json(
        {
          error: `Kickoff must be at least ${MIN_LEAD_BEFORE_LAUNCH_MS / (60 * 60 * 1000)} hours away to launch outreach.`,
        },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const runType = String(run.run_type || "select");

    if (runType === "select") {
      const inv = await insertInvitesForTierRanks(admin, run_id, [1, 2], 1, now);
      if (!inv.ok) return NextResponse.json({ error: inv.error }, { status: 500 });

      const runDateOrTbd = body.date_or_tbd ? String(body.date_or_tbd) : "TBD";
      const runLink = body.run_link ? String(body.run_link) : "/pickup";
      const dm_template = `Hey — we’re looking to put together a CT Pickup run for ${runDateOrTbd}.\n\nPlease check the website for all details, updates, and to submit your availability:\n${runLink}\n\nThis invite was sent to Tier 1 players first and is an automated message.`;

      const { sms_sent: smsSent, sms_failed: smsFailed } = await sendPickupInviteSms(
        inv.newlyInvited,
        dm_template
      );

      const up = await admin
        .from("pickup_runs")
        .update({
          outreach_started_at: now,
          auto_managed: true,
          open_tier_rank: 2,
          wave1_started_at: now,
          updated_at: now,
        })
        .eq("id", run_id);

      if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });

      const handles = inv.newlyInvited.map((p) => p.instagram).filter(Boolean);

      return NextResponse.json({
        ok: true,
        invited: inv.newlyInvited.length,
        handles,
        dm_template,
        sms_sent: smsSent,
        sms_failed: smsFailed,
      });
    }

    const up = await admin
      .from("pickup_runs")
      .update({
        outreach_started_at: now,
        auto_managed: true,
        open_tier_rank: 6,
        wave1_started_at: now,
        updated_at: now,
      })
      .eq("id", run_id);

    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });

    return NextResponse.json({
      ok: true,
      invited: 0,
      handles: [] as string[],
      dm_template: "",
      sms_sent: 0,
      sms_failed: 0,
    });
  }

  if (action === "finalize_slot") {
    const run_id = String(body.run_id || "");
    const slot_id = String(body.slot_id || "");
    if (!run_id) return NextResponse.json({ error: "Missing run_id" }, { status: 400 });
    if (!slot_id) return NextResponse.json({ error: "Missing slot_id" }, { status: 400 });

    const slotRes = await admin
      .from("pickup_run_time_slots")
      .select("id,start_at")
      .eq("id", slot_id)
      .maybeSingle();

    const slot = slotRes.data;
    if (!slot) return NextResponse.json({ error: "Slot not found" }, { status: 404 });

    const cancellation_deadline = computeCancellationDeadline(slot.start_at);

    const up = await admin
      .from("pickup_runs")
      .update({
        final_slot_id: slot_id,
        start_at: slot.start_at,
        status: "active",
        cancellation_deadline,
        updated_at: new Date().toISOString(),
      })
      .eq("id", run_id);

    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  }

  if (action === "edit_run") {
    const run_id = String(body.run_id || "");
    if (!run_id) return NextResponse.json({ error: "Missing run_id" }, { status: 400 });

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.title != null) patch.title = String(body.title);
    if (body.capacity != null) patch.capacity = Number(body.capacity);
    if (body.fee_cents != null) patch.fee_cents = Number(body.fee_cents);
    if (body.currency != null) patch.currency = String(body.currency);
    if (body.location_private != null) patch.location_private = String(body.location_private);
    if (body.show_location_to_confirmed_only != null)
      patch.show_location_to_confirmed_only = !!body.show_location_to_confirmed_only;

    const up = await admin.from("pickup_runs").update(patch).eq("id", run_id);
    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  }

  if (action === "post_update") {
    const run_id_up = body.run_id ? String(body.run_id) : null;
    const message = String(body.message || "").trim();
    if (!message) return NextResponse.json({ error: "Missing message" }, { status: 400 });

    const ins = await admin.from("pickup_run_updates").insert({
      run_id: run_id_up,
      message,
      created_by: guard.userId,
    });

    if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "cancel_run") {
    const run_id = String(body.run_id || "");
    const reason = body.reason ? String(body.reason) : null;
    if (!run_id) return NextResponse.json({ error: "Missing run_id" }, { status: 400 });

    const up = await admin.from("pickup_runs").update({
      status: "canceled",
      is_current: false,
      canceled_at: new Date().toISOString(),
      canceled_reason: reason,
      updated_at: new Date().toISOString(),
    }).eq("id", run_id);

    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
