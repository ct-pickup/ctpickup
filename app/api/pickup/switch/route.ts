import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { recordLegacyPickupPost } from "@/lib/admin/surfaceHealth";
import { MIN_LEAD_BEFORE_LAUNCH_MS } from "@/lib/pickup/autoRunConfig";
import {
  describePickupAutoStatus,
  processAutoPickupRun,
} from "@/lib/pickup/autoRunCheckpoints";
import { insertInvitesForTierRanks, sendPickupInviteSms } from "@/lib/pickup/pickupInvites";
import { anchorStartAtMs, computeCancellationDeadline } from "@/lib/pickup/runScheduling";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const HUB_REGIONS = new Set(["NY", "CT", "NJ", "MD"]);

type ListCounts = { confirmed: number; standby: number; invites: number; pending_payment: number };

function emptyListCounts(): ListCounts {
  return { confirmed: 0, standby: 0, invites: 0, pending_payment: 0 };
}

async function advanceActiveRunsToInProgress(
  admin: SupabaseClient,
  runRows: Array<{ id: string; status: string | null; start_at: string | null; is_completed?: boolean | null }>,
): Promise<void> {
  const nowMs = Date.now();
  const ids: string[] = [];
  for (const r of runRows) {
    if (r.is_completed) continue;
    if (String(r.status) !== "active") continue;
    const t = r.start_at ? Date.parse(String(r.start_at)) : NaN;
    if (!Number.isFinite(t) || t > nowMs) continue;
    ids.push(r.id);
  }
  if (!ids.length) return;
  const iso = new Date().toISOString();
  await admin.from("pickup_runs").update({ status: "in_progress", updated_at: iso }).in("id", ids).eq("status", "active");
}

async function enrichRunsWithResultFlags(
  admin: SupabaseClient,
  runs: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const ids = runs.map((r) => String(r.id || "")).filter(Boolean);
  if (!ids.length) return runs;
  const res = await admin.from("pickup_run_results").select("run_id").in("run_id", ids);
  const have = new Set((res.data || []).map((x: { run_id: string }) => x.run_id));
  return runs.map((r) => ({ ...r, has_result: have.has(String(r.id)) }));
}

// GET: returns runs list + optional detail (?run_id=...)
export async function GET(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  const admin = getSupabaseAdmin();

  const url = new URL(req.url);
  const run_id = url.searchParams.get("run_id");
  const regionRaw = String(url.searchParams.get("region") || "").trim().toUpperCase();
  const region = regionRaw && HUB_REGIONS.has(regionRaw) ? regionRaw : null;

  let runsQuery = admin
    .from("pickup_runs")
    .select(
      "id,title,status,start_at,created_at,run_type,capacity,fee_cents,currency,open_tier_rank,wave1_started_at,likely_on_slot_id,final_slot_id,is_current,outreach_started_at,auto_managed,service_region,location_private,show_location_to_confirmed_only,cancellation_deadline",
    )
    .neq("status", "canceled")
    .order("created_at", { ascending: false });

  if (region) {
    runsQuery = runsQuery.eq("service_region", region);
  }

  const runsRes = await runsQuery;

  let runs = runsRes.data || [];

  if (!run_id) {
    await advanceActiveRunsToInProgress(
      admin,
      runs as Array<{ id: string; status: string | null; start_at: string | null; is_completed?: boolean | null }>,
    );
    runs = runs.map((r) => {
      const row = r as {
        id: string;
        status: string | null;
        start_at: string | null;
        is_completed?: boolean | null;
      };
      const t = row.start_at ? Date.parse(String(row.start_at)) : NaN;
      if (row.is_completed) return r;
      if (String(row.status) !== "active" || !Number.isFinite(t) || t > Date.now()) return r;
      return { ...r, status: "in_progress" };
    });

    const runIds = runs.map((r) => r.id).filter((id): id is string => typeof id === "string" && id.length > 0);
    const countsByRun = new Map<string, ListCounts>();
    for (const id of runIds) countsByRun.set(id, emptyListCounts());

    if (runIds.length) {
      const [rsvpsRes, invitesRes] = await Promise.all([
        admin.from("pickup_run_rsvps").select("run_id,status").in("run_id", runIds),
        admin.from("pickup_run_invites").select("run_id").in("run_id", runIds),
      ]);

      for (const row of rsvpsRes.data || []) {
        const id = row.run_id as string;
        const c = countsByRun.get(id) ?? emptyListCounts();
        const st = String(row.status || "");
        if (st === "confirmed") c.confirmed += 1;
        else if (st === "standby") c.standby += 1;
        else if (st === "pending_payment") c.pending_payment += 1;
        countsByRun.set(id, c);
      }
      for (const row of invitesRes.data || []) {
        const id = row.run_id as string;
        const c = countsByRun.get(id) ?? emptyListCounts();
        c.invites += 1;
        countsByRun.set(id, c);
      }
    }

    const enrichedRuns = runs.map((r) => {
      const id = r.id as string;
      return { ...r, list_counts: countsByRun.get(id) ?? emptyListCounts() };
    });

    const withResults = await enrichRunsWithResultFlags(admin, enrichedRuns as Array<Record<string, unknown>>);
    return NextResponse.json({ runs: withResults });
  }

  const peek = await admin
    .from("pickup_runs")
    .select("id,status,start_at,is_completed")
    .eq("id", run_id)
    .maybeSingle();
  if (peek.data) {
    await advanceActiveRunsToInProgress(admin, [peek.data as { id: string; status: string | null; start_at: string | null; is_completed?: boolean | null }]);
  }

  const { messages } = await processAutoPickupRun(admin, run_id);

  const runRes = await admin.from("pickup_runs").select("*").eq("id", run_id).maybeSingle();
  const runRaw = runRes.data;
  const resultPeek = runRaw?.id
    ? await admin.from("pickup_run_results").select("run_id").eq("run_id", runRaw.id).maybeSingle()
    : { data: null };
  const run = runRaw ? { ...runRaw, has_result: !!resultPeek.data } : null;

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

  const confirmedIds = (rsvps || []).filter((r) => r.status === "confirmed").map((r) => r.user_id);
  const standbyIds = (rsvps || []).filter((r) => r.status === "standby").map((r) => r.user_id);

  const [confirmedRes, standbyRes] = await Promise.all([
    confirmedIds.length
      ? admin.from("profiles").select("id,first_name,last_name").in("id", confirmedIds)
      : Promise.resolve({ data: [] as { id: string; first_name: string | null; last_name: string | null }[] }),
    standbyIds.length
      ? admin.from("profiles").select("id,first_name,last_name").in("id", standbyIds)
      : Promise.resolve({ data: [] as { id: string; first_name: string | null; last_name: string | null }[] }),
  ]);

  const mapProfile = (r: { id: string; first_name: string | null; last_name: string | null }) => ({
    id: r.id,
    full_name: `${String(r.first_name || "").trim()} ${String(r.last_name || "").trim()}`.trim() || null,
  });

  const confirmed = (confirmedRes.data || []).map(mapProfile);
  const standby = (standbyRes.data || []).map(mapProfile);

  const auto_status = describePickupAutoStatus(run, slots, availability, rsvps, messages);

  return NextResponse.json({
    runs,
    run,
    slots,
    availability,
    invites,
    rsvps,
    confirmed,
    standby,
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
  | "start_run_now"
  | "edit_run"
  | "post_update"
  | "cancel_run";

export async function POST(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  const admin = getSupabaseAdmin();

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

    revalidatePath("/pickup");
    revalidatePath("/status/pickup");

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
      const inv = await insertInvitesForTierRanks(
        admin,
        run_id,
        [1, 2],
        1,
        now,
        run.service_region ?? null,
      );
      if (!inv.ok) return NextResponse.json({ error: inv.error }, { status: 500 });

      const runDateOrTbd = body.date_or_tbd ? String(body.date_or_tbd) : "TBD";
      const runLink = body.run_link ? String(body.run_link) : "/pickup";
      const dm_template = `Hey — we’re looking to put together a CT Pickup run for ${runDateOrTbd}.\n\nPlease check the website for all details, updates, and to submit your availability:\n${runLink}\n\nThis invite was sent to Tier 1 players first and is an automated message.`;

      const userId = guard.userId;

      // Create or find a group chat room for this run
      const roomSlug = `pickup-run-${run_id}`;
      const runTitle = run.title || "Pickup Run";
      const existingRoom = await admin.from("chat_rooms").select("id").eq("slug", roomSlug).maybeSingle();
      let roomId: string | null = existingRoom.data?.id || null;
      if (!roomId) {
        const newRoom = await admin
          .from("chat_rooms")
          .insert({
            slug: roomSlug,
            title: runTitle,
            room_type: "group",
            announcements_only: false,
            is_active: true,
            created_by: userId,
          })
          .select("id")
          .single();
        roomId = newRoom.data?.id || null;
      }

      if (roomId && inv.newlyInvited.length > 0) {
        const memberRows = inv.newlyInvited.map((p) => ({ room_id: roomId, user_id: p.user_id }));
        await admin.from("chat_room_members").upsert(memberRows, { onConflict: "room_id,user_id" });

        // Send invite message in the room
        await admin.from("chat_messages").insert({
          room_id: roomId,
          user_id: userId,
          body: `You've been invited to ${runTitle} on ${runDateOrTbd}. Check the Pickup tab for details and to submit your availability.`,
        });

        // Send push notifications
        const invitedUserIds = inv.newlyInvited.map((p) => p.user_id);
        await sendPushToUsers(admin, invitedUserIds, {
          title: "You've been invited to a Select Pickup",
          body: "You've been selected for an exclusive pickup run. Open the app for full details and to submit your availability.",
          data: { kind: "pickup_invite", run_id },
        });
      }

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
        sms_sent: 0,
        sms_failed: 0,
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

    const rsvpRes = await admin
      .from("pickup_run_rsvps")
      .select("user_id")
      .eq("run_id", run_id)
      .eq("status", "confirmed");

    if (!rsvpRes.error && (rsvpRes.data?.length ?? 0) > 0) {
      const confirmedIds = (rsvpRes.data ?? []).map((r) => r.user_id as string);
      await sendPushToUsers(admin, confirmedIds, {
        title: "Pickup confirmed",
        body: "Your pickup is confirmed. Check the app for location and time.",
        data: { kind: "pickup_finalized", run_id },
      });
    }

    revalidatePath("/pickup");
    revalidatePath("/status/pickup");

    return NextResponse.json({ ok: true });
  }

  if (action === "start_run_now") {
    const run_id = String(body.run_id || "");
    if (!run_id) return NextResponse.json({ error: "Missing run_id" }, { status: 400 });

    const runRes = await admin.from("pickup_runs").select("id,status,start_at,is_completed").eq("id", run_id).maybeSingle();
    const row = runRes.data;
    if (!row) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    if (row.is_completed) return NextResponse.json({ error: "Run is already completed." }, { status: 400 });

    const st = String(row.status || "");
    if (st === "in_progress") return NextResponse.json({ ok: true });
    if (st !== "active") {
      return NextResponse.json({ error: "Run must be confirmed (active) before it can start." }, { status: 400 });
    }

    const startMs = row.start_at ? Date.parse(String(row.start_at)) : NaN;
    if (!Number.isFinite(startMs)) {
      return NextResponse.json({ error: "Run needs a scheduled kickoff time." }, { status: 400 });
    }

    const now = Date.now();
    const oneH = 60 * 60 * 1000;
    if (now < startMs - oneH || now > startMs + oneH) {
      return NextResponse.json(
        { error: "Start Run Now is only available within 1 hour before or after kickoff." },
        { status: 400 },
      );
    }

    const up = await admin
      .from("pickup_runs")
      .update({ status: "in_progress", updated_at: new Date().toISOString() })
      .eq("id", run_id)
      .eq("status", "active");

    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });

    revalidatePath("/pickup");
    revalidatePath("/status/pickup");

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
    if (body.run_type != null) {
      const rt = String(body.run_type);
      if (!["select", "public"].includes(rt)) {
        return NextResponse.json({ error: "run_type must be select or public" }, { status: 400 });
      }
      patch.run_type = rt;
    }

    const up = await admin.from("pickup_runs").update(patch).eq("id", run_id);
    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });

    revalidatePath("/pickup");
    revalidatePath("/status/pickup");

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
    await recordLegacyPickupPost(admin, { runId: run_id_up, userId: guard.userId });
    revalidatePath("/pickup");
    revalidatePath("/status/pickup");
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
    revalidatePath("/pickup");
    revalidatePath("/status/pickup");
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
