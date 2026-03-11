import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

// tier_rank mapping (locked):
// 1A=1, 1B=2, 2=3, 3=4, 4=5, PUBLIC=6
function isTier1(rank: number | null | undefined) {
  return rank === 1 || rank === 2;
}

export async function GET(req: Request) {
  const token = bearer(req);

  let userId: string | null = null;
  let approved = false;
  let isAdmin = false;
  let tier: string | null = null;
  let tierRank: number | null = null;

  if (token) {
    const u = await admin.auth.getUser(token);
    userId = u.data.user?.id || null;

    if (userId) {
      const prof = await admin
        .from("profiles")
        .select("approved,is_admin,tier,tier_rank,first_name,last_name,instagram")
        .eq("id", userId)
        .maybeSingle();

      approved = !!prof.data?.approved;
      isAdmin = !!prof.data?.is_admin;
      tier = (prof.data?.tier ?? null) as any;
      tierRank =
        prof.data?.tier_rank === null || prof.data?.tier_rank === undefined
          ? null
          : Number(prof.data?.tier_rank);
    }
  }

  // SAFEST (matches your current UI): only show upcoming runs with a real start_at.
  // Planning runs with start_at=null belong in a separate "planning context" endpoint later.
  const runRes = await admin
    .from("pickup_runs")
    .select("*")
    .neq("status", "canceled")
    .not("start_at", "is", null)
    .gte("start_at", new Date().toISOString())
    .order("start_at", { ascending: true })
    .limit(1);

  const run = runRes.data?.[0] || null;

  if (!run) {
    return NextResponse.json({
      status: "inactive",
      run: null,
      visibility: { invitedNow: false, attendanceVisible: false },
      counts: { confirmed: 0, standby: 0, pending_payment: 0, tier1Confirmed: 0 },
      my_status: null,
      attendees: [],
      me: { approved, is_admin: isAdmin, tier, tier_rank: tierRank },
    });
  }

  // RSVP rows (do NOT assume a unique constraint exists)
  const rsvpRes = await admin
    .from("pickup_run_rsvps")
    .select("id,user_id,status,updated_at,created_at")
    .eq("run_id", run.id);

  const rsvpRows = rsvpRes.data || [];
  const confirmedRows = rsvpRows.filter((r) => r.status === "confirmed");
  const standbyRows = rsvpRows.filter((r) => r.status === "standby");
  const pendingRows = rsvpRows.filter((r) => r.status === "pending_payment");

  // Tier-1 confirmed count using profiles.tier_rank (canonical)
  let tier1Confirmed = 0;
  if (confirmedRows.length) {
    const ids = Array.from(new Set(confirmedRows.map((r) => r.user_id)));
    const profs = await admin.from("profiles").select("id,tier_rank").in("id", ids);

    const rankById = new Map<string, number>();
    for (const p of profs.data || []) {
      rankById.set(String(p.id), Number(p.tier_rank ?? 6));
    }

    tier1Confirmed = confirmedRows.filter((r) => isTier1(rankById.get(String(r.user_id)))).length;
  }

  // invitedNow (canonical rules):
  // - user must be approved
  // - run.open_tier_rank must be non-null (starts null; do NOT use 0)
  // - tier_rank <= open_tier_rank
  // - invite row exists in pickup_run_invites for (run_id,user_id)
  let invitedNow = false;

  const runOpenTierRank =
    run.open_tier_rank === null || run.open_tier_rank === undefined
      ? null
      : Number(run.open_tier_rank);

  if (
    userId &&
    approved &&
    tierRank !== null &&
    runOpenTierRank !== null &&
    tierRank <= runOpenTierRank
  ) {
    const inv = await admin
      .from("pickup_run_invites")
      .select("id")
      .eq("run_id", run.id)
      .eq("user_id", userId)
      .limit(1);

    invitedNow = (inv.data || []).length > 0;
  }

  // Attendance visibility:
  // - within 4 hours of wave1_started_at: only Tier 1A/1B can see
  // - after that: invitedNow can see
  let attendanceVisible = false;
  if (invitedNow && tierRank !== null) {
    const waveStartedAt = run.wave1_started_at ? new Date(run.wave1_started_at).getTime() : null;
    if (!waveStartedAt) {
      attendanceVisible = true;
    } else {
      const within4h = Date.now() - waveStartedAt < 4 * 60 * 60 * 1000;
      attendanceVisible = within4h ? isTier1(tierRank) : true;
    }
  }

  // My status: latest row for this user
  let myStatus: string | null = null;
  if (userId) {
    const mine = await admin
      .from("pickup_run_rsvps")
      .select("status,updated_at,created_at")
      .eq("run_id", run.id)
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1);

    myStatus = mine.data?.[0]?.status || null;
  }

  // Attendees list (confirmed only) if visible
  let attendees: any[] = [];
  if (attendanceVisible && confirmedRows.length) {
    const ids = Array.from(new Set(confirmedRows.map((r) => r.user_id)));
    const ppl = await admin
      .from("profiles")
      .select("id,first_name,last_name,instagram,tier,tier_rank")
      .in("id", ids);

    attendees = (ppl.data || []).map((p) => ({
      full_name: `${p.first_name || ""} ${p.last_name || ""}`.trim() || "Player",
      instagram: p.instagram || null,
      tier: p.tier ?? null,
      tier_rank: p.tier_rank ?? null,
    }));
  }

  // Location privacy (canonical):
  // only confirmed players (or admin) can see exact location.
  const locationText =
    (isAdmin || myStatus === "confirmed") && run.location_private
      ? String(run.location_private)
      : null;

  return NextResponse.json({
    status: run.status || "inactive",
    run: {
      id: run.id,
      run_type: run.run_type,
      title: run.title,
      start_at: run.start_at,
      capacity: run.capacity,
      fee_cents: run.fee_cents,
      currency: run.currency,
      cancellation_deadline: run.cancellation_deadline,

      // Keep this key name so your current frontend keeps working:
      location_text: locationText,

      // Canonical fields (safe to include):
      open_tier_rank: run.open_tier_rank,
      wave1_started_at: run.wave1_started_at,
      likely_on_at: run.likely_on_at,
      likely_on_slot_id: run.likely_on_slot_id,
      final_slot_id: run.final_slot_id,
    },
    visibility: { invitedNow, attendanceVisible },
    counts: {
      confirmed: confirmedRows.length,
      standby: standbyRows.length,
      pending_payment: pendingRows.length,
      tier1Confirmed,
    },
    my_status: myStatus,
    attendees,
    me: { approved, is_admin: isAdmin, tier, tier_rank: tierRank },
  });
}
