import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  countDistinctCommittedPlayers,
} from "@/lib/pickup/autoRunCheckpoints";
import { insertInvitesForTierRanks } from "@/lib/pickup/pickupInvites";
import { isSelectPickupRunType } from "@/lib/pickup/pickupRunType";
import { addWaveIntervalIso } from "@/lib/pickup/pickupWaveSchedule";
import { anchorStartAtMs } from "@/lib/pickup/runScheduling";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";

export const runtime = "nodejs";

/**
 * Vercel Cron: GET /api/cron/pickup-waves (every 30 minutes).
 * Opens the next tier wave for select pickup runs on a schedule; see lib/pickup/pickupWaveSchedule.ts.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 500 });
  }

  const auth = req.headers.get("authorization") || "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "Missing Supabase env." }, { status: 500 });
  }

  const admin = createClient(url, key);
  const isoNow = new Date().toISOString();
  const nowMs = Date.now();

  const runsRes = await admin
    .from("pickup_runs")
    .select(
      "id,title,status,start_at,capacity,open_tier_rank,current_wave,next_wave_at,outreach_started_at,run_type,service_region",
    )
    .not("outreach_started_at", "is", null)
    .in("status", ["planning", "likely_on"])
    .not("next_wave_at", "is", null)
    .lte("next_wave_at", isoNow);

  if (runsRes.error) {
    return NextResponse.json({ error: runsRes.error.message }, { status: 500 });
  }

  const runs = runsRes.data || [];
  const results: { run_id: string; action: string; detail?: string }[] = [];

  for (const row of runs) {
    const run_id = String(row.id || "");
    if (!run_id) continue;

    if (!isSelectPickupRunType(row.run_type)) {
      await admin.from("pickup_runs").update({ next_wave_at: null, updated_at: isoNow }).eq("id", run_id);
      results.push({ run_id, action: "cleared_next_wave_non_select" });
      continue;
    }

    const slotsRes = await admin.from("pickup_run_time_slots").select("start_at").eq("run_id", run_id);
    const slotRows = (slotsRes.data || []) as { start_at: string }[];
    const anchorMs = anchorStartAtMs(
      { start_at: (row.start_at as string | null) ?? null },
      slotRows,
    );
    const hoursUntil =
      anchorMs === null ? 168 : Math.max(0.25, (anchorMs - nowMs) / 3600000);

    const availRes = await admin
      .from("pickup_run_availability")
      .select("user_id,slot_id,state")
      .eq("run_id", run_id);
    const availability = (availRes.data || []) as {
      user_id: string;
      slot_id: string | null;
      state: string;
    }[];
    const committed = countDistinctCommittedPlayers(availability);

    const cap = Number(row.capacity || 0);
    const fillRate = cap > 0 ? committed / cap : 0;

    if (fillRate >= 0.8) {
      const pushed = addWaveIntervalIso(nowMs, hoursUntil);
      await admin
        .from("pickup_runs")
        .update({ next_wave_at: pushed, updated_at: isoNow })
        .eq("id", run_id);
      results.push({
        run_id,
        action: "delayed_capacity",
        detail: `fill=${fillRate.toFixed(2)} next=${pushed}`,
      });
      continue;
    }

    const open = Number(row.open_tier_rank ?? 2);
    if (open >= 6) {
      await admin
        .from("pickup_runs")
        .update({ next_wave_at: null, updated_at: isoNow })
        .eq("id", run_id);
      results.push({ run_id, action: "stopped_max_tier" });
      continue;
    }

    if (cap > 0 && committed >= cap) {
      await admin
        .from("pickup_runs")
        .update({ next_wave_at: null, updated_at: isoNow })
        .eq("id", run_id);
      results.push({ run_id, action: "stopped_full", detail: `committed=${committed}` });
      continue;
    }

    const nextOpen = Math.min(6, open + 1);
    const nextWaveNum = Number(row.current_wave ?? 1) + 1;

    const inv = await insertInvitesForTierRanks(
      admin,
      run_id,
      [nextOpen],
      nextWaveNum,
      isoNow,
      (row.service_region as string | null | undefined) ?? null,
    );

    if (!inv.ok) {
      results.push({ run_id, action: "invite_failed", detail: inv.error });
      continue;
    }

    const runTitle = (row.title as string) || "Pickup Run";
    const roomSlug = `pickup-run-${run_id}`;
    const roomRes = await admin
      .from("chat_rooms")
      .select("id,created_by,slug,title,room_type")
      .eq("slug", roomSlug)
      .maybeSingle();

    const room = roomRes.data as
      | { id: string; created_by: string | null; slug: string; title: string; room_type: string | null }
      | null;

    if (room?.id && inv.newlyInvited.length > 0) {
      const memberRows = inv.newlyInvited.map((p) => ({ room_id: room.id, user_id: p.user_id }));
      await admin.from("chat_room_members").upsert(memberRows, { onConflict: "room_id,user_id" });

      const posterId = room.created_by;
      if (posterId) {
        const startLabel =
          anchorMs !== null ? new Date(anchorMs).toLocaleString("en-US", { timeZone: "America/New_York" }) : "TBD";
        await admin.from("chat_messages").insert({
          room_id: room.id,
          user_id: posterId,
          body: `More players have been invited to ${runTitle} (${startLabel}). Open the Pickup tab for details and to submit availability if you have not yet.`,
        });
      }

      const invitedUserIds = inv.newlyInvited.map((p) => p.user_id);
      await sendPushToUsers(admin, invitedUserIds, {
        title: "Pickup invite update",
        body: `You've been invited to ${runTitle}. Open the app to see details and submit your availability.`,
        data: { kind: "pickup_invite", run_id },
      });
    }

    const next_wave_at = nextOpen >= 6 ? null : addWaveIntervalIso(nowMs, hoursUntil);

    const up = await admin
      .from("pickup_runs")
      .update({
        open_tier_rank: nextOpen,
        current_wave: nextWaveNum,
        next_wave_at,
        updated_at: isoNow,
      })
      .eq("id", run_id);

    if (up.error) {
      results.push({ run_id, action: "update_failed", detail: up.error.message });
      continue;
    }

    results.push({
      run_id,
      action: "opened_wave",
      detail: `open=${nextOpen} wave=${nextWaveNum} new_invites=${inv.newlyInvited.length}`,
    });
  }

  return NextResponse.json({ ok: true, processed: runs.length, results });
}
