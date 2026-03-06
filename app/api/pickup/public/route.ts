import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { tiersForPhase, type Tier } from "@/lib/pickup/tiers";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function ms() {
  return Date.now();
}

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

  let userId: string | null = null;
  let userTier: Tier | null = null;
  let approved = false;

  if (token) {
    const u = await supabaseAdmin.auth.getUser(token);
    userId = u.data.user?.id || null;

    if (userId) {
      const prof = await supabaseAdmin
        .from("profiles")
        .select("tier, approved")
        .eq("id", userId)
        .maybeSingle();

      userTier = (prof.data?.tier as Tier) || "TPUBLIC";
      approved = !!prof.data?.approved;
    }
  }

  const runRes = await supabaseAdmin
    .from("pickup_runs")
    .select("*")
    .neq("status", "canceled")
    .gte("start_at", new Date().toISOString())
    .order("start_at", { ascending: true })
    .limit(1);

  const run = runRes.data?.[0] || null;

  if (!run) {
    return NextResponse.json({
      status: "inactive",
      run: null,
      visibility: { invitedTiers: [], attendanceVisible: false, invitedNow: false },
      counts: { confirmed: 0, standby: 0, tier1Confirmed: 0 },
      my_status: null,
      attendees: [],
      me: { tier: userTier, approved },
    });
  }

  const rsvpRes = await supabaseAdmin
    .from("pickup_run_rsvps")
    .select("status, tier_at_time, user_id")
    .eq("run_id", run.id);

  const rows = rsvpRes.data || [];
  const confirmed = rows.filter((r) => r.status === "confirmed").length;
  const standby = rows.filter((r) => r.status === "standby").length;

  const tier1Confirmed = rows.filter(
    (r) =>
      r.status === "confirmed" &&
      (r.tier_at_time === "T1A" || r.tier_at_time === "T1B")
  ).length;

  const openedAt = new Date(run.phase_opened_at).getTime();
  const fourHours = 4 * 60 * 60 * 1000;
  const withinFirst4h = ms() - openedAt < fourHours;

  const prevPeak = Number(run.tier1_peak || 0);
  const tier1Peak = Math.max(prevPeak, tier1Confirmed);

  let phase = Number(run.invite_phase || 0);
  const runType = run.run_type as "select" | "public";

  // Tier 2 invite begins:
  // - after 4 hours
  // - OR sooner only if Tier-1 *dropped* below 5 (peak reached >= 5, current < 5)
  if (phase === 0) {
    const timePassed = !withinFirst4h;
    const droppedBelow = tier1Peak >= 5 && tier1Confirmed < 5;
    if (timePassed || droppedBelow) phase = 1;
  }

  // Auto-lock rule: becomes ACTIVE only when Tier-1 confirmed >= 5
  const shouldLock = tier1Confirmed >= 5 && !run.locked_at;

  // persist best-effort
  if (phase !== Number(run.invite_phase) || shouldLock || tier1Peak !== prevPeak) {
    await supabaseAdmin
      .from("pickup_runs")
      .update({
        invite_phase: phase,
        tier1_peak: tier1Peak,
        status: shouldLock ? "active" : run.status, // only becomes active at lock
        locked_at: shouldLock ? new Date().toISOString() : run.locked_at,
        updated_at: new Date().toISOString(),
      })
      .eq("id", run.id);
  }

  const invitedTiers = tiersForPhase(runType, phase);

  // invitedNow requires: user exists, approved, tier in invited tiers
  const invitedNow =
    !!userTier && approved && invitedTiers.includes(userTier);

  // Attendance visibility rule:
  // During first 4 hours, ONLY Tier-1A/1B can see attendance.
  // After 4 hours, invited tiers can see attendance.
  const attendanceVisible =
    !!userTier &&
    approved &&
    (withinFirst4h
      ? (userTier === "T1A" || userTier === "T1B")
      : invitedTiers.includes(userTier));

  let attendees: any[] = [];
  if (attendanceVisible) {
    const ids = rows.filter((r) => r.status === "confirmed").map((r) => r.user_id);
    if (ids.length) {
      const ppl = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, instagram, tier")
        .in("id", ids);

      attendees = (ppl.data || []).map((p) => ({
        full_name: p.full_name,
        instagram: p.instagram,
        tier: p.tier,
      }));
    }
  }

  let myStatus: string | null = null;
  if (userId) {
    const mine = await supabaseAdmin
      .from("pickup_run_rsvps")
      .select("status")
      .eq("run_id", run.id)
      .eq("user_id", userId)
      .maybeSingle();
    myStatus = mine.data?.status || null;
  }

  return NextResponse.json({
    status: shouldLock ? "active" : run.status,
    run: {
      id: run.id,
      run_type: run.run_type,
      title: run.title,
      start_at: run.start_at,
      capacity: run.capacity,
      fee_cents: run.fee_cents,
      currency: run.currency,
      locked_at: run.locked_at,
      invite_phase: phase,
      cancellation_deadline: run.cancellation_deadline,
      location_text: myStatus === "confirmed" ? run.location_text : null, // confirmed only
    },
    visibility: { invitedTiers, attendanceVisible, invitedNow, withinFirst4h },
    counts: { confirmed, standby, tier1Confirmed, tier1Peak },
    my_status: myStatus,
    attendees,
    me: { tier: userTier, approved },
  });
}
