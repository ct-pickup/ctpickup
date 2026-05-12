import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { recordLegacyPickupPost } from "@/lib/admin/surfaceHealth";
import {
  describePickupAutoStatus,
  processAutoPickupRun,
} from "@/lib/pickup/autoRunCheckpoints";
import { insertInvitesForTierRanks, sendPickupInviteSms } from "@/lib/pickup/pickupInvites";
import { isPublicPickupRunType, normalizePickupRunTypeForDb } from "@/lib/pickup/pickupRunType";
import { addWaveIntervalIso } from "@/lib/pickup/pickupWaveSchedule";
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
      "id,title,status,start_at,created_at,run_type,capacity,fee_cents,currency,open_tier_rank,wave1_started_at,likely_on_slot_id,final_slot_id,is_current,outreach_started_at,auto_managed,service_region,location_private,show_location_to_confirmed_only,cancellation_deadline,next_wave_at,current_wave,is_completed",
    )
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

  // Enrich availability with profile info
  const availUserIds = Array.from(new Set(availability.map((a: { user_id: string }) => a.user_id)));
  const availProfiles = availUserIds.length
    ? await admin
        .from("profiles")
        .select(
          "id,first_name,last_name,username,tier,tier_rank,playing_position,instagram,wins_override,losses_override,player_of_day_override",
        )
        .in("id", availUserIds)
    : { data: [] };
  const availProfileMap = new Map((availProfiles.data || []).map((p: { id: string }) => [p.id, p]));

  const statsWins = new Map<string, number>();
  const statsLosses = new Map<string, number>();
  const statsPotd = new Map<string, number>();
  const statsGotd = new Map<string, number>();

  if (availUserIds.length) {
    const [assignRes, potdRes, gotdRes] = await Promise.all([
      admin.from("pickup_run_team_assignments").select("user_id,team,run_id").in("user_id", availUserIds),
      admin.from("pickup_run_results").select("player_of_day").in("player_of_day", availUserIds),
      admin.from("pickup_run_results").select("goalie_of_the_day").in("goalie_of_the_day", availUserIds),
    ]);

    const runIds = Array.from(
      new Set((assignRes.data || []).map((row: { run_id: string }) => String(row.run_id || "")).filter(Boolean)),
    );
    const resultsRes = runIds.length
      ? await admin.from("pickup_run_results").select("run_id,winning_team").in("run_id", runIds)
      : { data: [] as { run_id: string; winning_team: string }[] };

    const winTeamByRun = new Map(
      (resultsRes.data || []).map((r: { run_id: string; winning_team: string }) => [r.run_id, r.winning_team]),
    );

    for (const row of assignRes.data || []) {
      const uid = String((row as { user_id: string }).user_id || "");
      const runId = String((row as { run_id: string }).run_id || "");
      const team = String((row as { team: string }).team || "");
      const wt = winTeamByRun.get(runId);
      if (!uid || !runId || !wt) continue;
      if (team === wt) statsWins.set(uid, (statsWins.get(uid) || 0) + 1);
      else statsLosses.set(uid, (statsLosses.get(uid) || 0) + 1);
    }

    for (const row of potdRes.data || []) {
      const uid = String((row as { player_of_day: string | null }).player_of_day || "");
      if (!uid) continue;
      statsPotd.set(uid, (statsPotd.get(uid) || 0) + 1);
    }

    for (const row of gotdRes.data || []) {
      const uid = String((row as { goalie_of_the_day: string | null }).goalie_of_the_day || "");
      if (!uid) continue;
      statsGotd.set(uid, (statsGotd.get(uid) || 0) + 1);
    }
  }

  const availabilityEnriched = availability.map((a: { user_id: string }) => {
    const p = availProfileMap.get(a.user_id) as
      | {
          first_name: string | null;
          last_name: string | null;
          username: string | null;
          tier: string | null;
          tier_rank: number | null;
          playing_position: string | null;
          instagram: string | null;
          wins_override: number | null;
          losses_override: number | null;
          player_of_day_override: number | null;
        }
      | undefined;
    const uid = a.user_id;
    return {
      ...a,
      full_name: p
        ? `${p.first_name || ""} ${p.last_name || ""}`.trim() || p.username || null
        : null,
      username: p?.username ?? null,
      tier: p?.tier ?? null,
      tier_rank: p?.tier_rank ?? null,
      playing_position: p?.playing_position ?? null,
      instagram: p?.instagram ?? null,
      wins_override: p?.wins_override ?? null,
      losses_override: p?.losses_override ?? null,
      player_of_day_override: p?.player_of_day_override ?? null,
      stats_wins: statsWins.get(uid) ?? 0,
      stats_losses: statsLosses.get(uid) ?? 0,
      stats_player_of_day: statsPotd.get(uid) ?? 0,
      stats_goalie_of_day: statsGotd.get(uid) ?? 0,
    };
  });

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
      ? admin.from("profiles").select("id,first_name,last_name,playing_position").in("id", confirmedIds)
      : Promise.resolve({
          data: [] as {
            id: string;
            first_name: string | null;
            last_name: string | null;
            playing_position: string | null;
          }[],
        }),
    standbyIds.length
      ? admin.from("profiles").select("id,first_name,last_name").in("id", standbyIds)
      : Promise.resolve({ data: [] as { id: string; first_name: string | null; last_name: string | null }[] }),
  ]);

  const mapProfile = (r: { id: string; first_name: string | null; last_name: string | null }) => ({
    id: r.id,
    full_name: `${String(r.first_name || "").trim()} ${String(r.last_name || "").trim()}`.trim() || null,
  });

  const mapConfirmedProfile = (r: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    playing_position: string | null;
  }) => ({
    id: r.id,
    full_name: `${String(r.first_name || "").trim()} ${String(r.last_name || "").trim()}`.trim() || null,
    playing_position: r.playing_position ?? null,
  });

  const confirmed = (confirmedRes.data || []).map(mapConfirmedProfile);
  const standby = (standbyRes.data || []).map(mapProfile);

  const auto_status = describePickupAutoStatus(run, slots, availability, rsvps, messages);

  return NextResponse.json({
    runs,
    run,
    slots,
    availability: availabilityEnriched,
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

  // 1) Create run (promoted hub); outreach is launched manually when staff are ready.
  if (action === "create_run") {
    console.log("[pickup/switch create_run] raw body", JSON.stringify(body));

    const title = String(body.title || "CT Pickup Run");
    const run_type = normalizePickupRunTypeForDb(body.run_type);
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
    if (clearPrev.error) {
      console.error("[pickup/switch create_run] clearPrev hub error", clearPrev.error);
      return NextResponse.json({ error: clearPrev.error.message }, { status: 500 });
    }

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

    console.log("[pickup/switch create_run] Supabase insert response", {
      error: ins.error ? { message: ins.error.message, code: (ins.error as { code?: string }).code } : null,
      data: ins.data,
      status: ins.status,
      run_type_normalized: run_type,
    });

    if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });
    const newId = ins.data?.id as string | undefined;
    if (!newId) return NextResponse.json({ error: "Insert returned no id" }, { status: 500 });

    revalidatePath("/pickup");
    revalidatePath("/status/pickup");

    return NextResponse.json({ ok: true, run_id: newId, run_type });
  }

  if (action === "add_slot") {
    const run_id = String(body.run_id || "");
    const rawStart = String(body.start_at || "");
    const label = body.label ? String(body.label) : null;

    if (!run_id) return NextResponse.json({ error: "Missing run_id" }, { status: 400 });
    if (!rawStart.trim()) return NextResponse.json({ error: "Missing start_at" }, { status: 400 });

    const parsedMs = Date.parse(rawStart.trim());
    if (!Number.isFinite(parsedMs)) {
      console.warn("[pickup/switch add_slot] invalid datetime parse", { rawStart: rawStart.trim() });
      return NextResponse.json({ error: "Invalid start_at datetime" }, { status: 400 });
    }
    const start_at = new Date(parsedMs).toISOString();

    console.log("[pickup/switch add_slot] saving slot", JSON.stringify({ run_id, start_at_raw: rawStart.trim(), start_at_utc: start_at, label }));

    const ins = await admin.from("pickup_run_time_slots").insert({
      run_id,
      start_at,
      label,
    }).select("id").maybeSingle();

    console.log("[pickup/switch add_slot] Supabase insert response", {
      error: ins.error ? { message: ins.error.message, code: (ins.error as { code?: string }).code } : null,
      data: ins.data,
      status: ins.status,
    });

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

    const now = new Date().toISOString();
    const runTypeRaw = run.run_type;
    const publicRun = isPublicPickupRunType(runTypeRaw);

    console.log("[pickup/switch launch_outreach] start", {
      action,
      run_id,
      run_type_raw: runTypeRaw,
      public_run: publicRun,
      service_region: run.service_region ?? null,
    });

    if (!publicRun) {
      console.log("[pickup/switch launch_outreach] tier invite path (non-public run_type)", {
        run_id,
        tier_ranks: [1, 2],
      });

      const inv = await insertInvitesForTierRanks(
        admin,
        run_id,
        [1, 2],
        1,
        now,
        run.service_region ?? null,
      );
      if (!inv.ok) {
        console.error("[pickup/switch launch_outreach] insertInvitesForTierRanks failed", { run_id, error: inv.error });
        return NextResponse.json({ error: inv.error }, { status: 500 });
      }

      console.log("[pickup/switch launch_outreach] insertInvitesForTierRanks result", {
        run_id,
        newly_invited: inv.newlyInvited.length,
        user_ids: inv.newlyInvited.map((p) => p.user_id),
      });

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
        if (newRoom.error) {
          console.error("[pickup/switch launch_outreach] chat_rooms insert/select error", {
            run_id,
            message: newRoom.error.message,
          });
        }
      }

      console.log("[pickup/switch launch_outreach] chat room", { run_id, room_id: roomId, existing: !!existingRoom.data?.id });

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
        console.log("[pickup/switch launch_outreach] sending push", { run_id, count: invitedUserIds.length });
        await sendPushToUsers(admin, invitedUserIds, {
          title: "You've been invited to a Select Pickup",
          body: "You've been selected for an exclusive pickup run. Open the app for full details and to submit your availability.",
          data: { kind: "pickup_invite", run_id },
        });
      } else {
        console.log("[pickup/switch launch_outreach] skip chat/push", {
          run_id,
          room_id: roomId,
          newly_invited: inv.newlyInvited.length,
        });
      }

      const slotsForWave = await admin.from("pickup_run_time_slots").select("start_at").eq("run_id", run_id);
      const slotRows = (slotsForWave.data || []) as { start_at: string }[];
      const anchorMs = anchorStartAtMs(
        { start_at: (run.start_at as string | null) ?? null },
        slotRows,
      );
      const hoursUntil =
        anchorMs === null ? 168 : Math.max(0.25, (anchorMs - Date.parse(now)) / 3600000);
      const next_wave_at = addWaveIntervalIso(Date.parse(now), hoursUntil);

      const up = await admin
        .from("pickup_runs")
        .update({
          outreach_started_at: now,
          auto_managed: true,
          open_tier_rank: 2,
          wave1_started_at: now,
          current_wave: 1,
          next_wave_at,
          updated_at: now,
        })
        .eq("id", run_id);

      console.log("[pickup/switch launch_outreach] pickup_runs update (select path)", {
        run_id,
        error: up.error?.message ?? null,
        status: up.status,
      });

      if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });

      const handles = inv.newlyInvited.map((p) => p.instagram).filter(Boolean);

      return NextResponse.json({
        ok: true,
        invited: inv.newlyInvited.length,
        handles,
        dm_template,
        sms_sent: 0,
        sms_failed: 0,
        run_type_raw: runTypeRaw,
        invite_path: "tier_ranks_1_2",
      });
    }

    console.log("[pickup/switch launch_outreach] public run path — no tier invites or push", { run_id, run_type_raw: runTypeRaw });

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

    console.log("[pickup/switch launch_outreach] pickup_runs update (public path)", {
      run_id,
      error: up.error?.message ?? null,
      status: up.status,
    });

    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });

    return NextResponse.json({
      ok: true,
      invited: 0,
      handles: [] as string[],
      dm_template: "",
      sms_sent: 0,
      sms_failed: 0,
      run_type_raw: runTypeRaw,
      invite_path: "public_no_tier_invites",
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

    const nowIso = new Date().toISOString();
    const up = await admin
      .from("pickup_runs")
      .update({ status: "in_progress", locked_at: nowIso, updated_at: nowIso })
      .eq("id", run_id)
      .eq("status", "active");

    if (up.error) {
      const msg = up.error.message || "Update failed";
      const missingCol =
        /locked_at/i.test(msg) &&
        (/column/i.test(msg) || /schema cache/i.test(msg) || /Could not find/i.test(msg));
      if (!missingCol) return NextResponse.json({ error: msg }, { status: 500 });
      // Older databases without locked_at — fall back to status-only update.
      const fallback = await admin
        .from("pickup_runs")
        .update({ status: "in_progress", updated_at: nowIso })
        .eq("id", run_id)
        .eq("status", "active");
      if (fallback.error) return NextResponse.json({ error: fallback.error.message }, { status: 500 });
    }

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
    if ("location_private" in body) {
      patch.location_private =
        body.location_private == null || body.location_private === ""
          ? null
          : String(body.location_private);
    }
    if (body.show_location_to_confirmed_only != null)
      patch.show_location_to_confirmed_only = !!body.show_location_to_confirmed_only;
    if (body.run_type != null) {
      patch.run_type = normalizePickupRunTypeForDb(body.run_type);
    }

    console.log("[pickup/switch edit_run] patch", JSON.stringify({ run_id, ...patch }));

    const up = await admin.from("pickup_runs").update(patch).eq("id", run_id);
    console.log("[pickup/switch edit_run] Supabase update response", {
      run_id,
      error: up.error ? { message: up.error.message, code: (up.error as { code?: string }).code } : null,
      status: up.status,
    });
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
