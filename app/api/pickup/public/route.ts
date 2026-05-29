import { NextResponse } from "next/server";
import type { PublicPickupRunRow } from "@/lib/pickup/publicUpcomingRuns";
import {
  fetchFirstPublicUpcomingPickupRun,
  fetchInvitedFeaturedPickupRun,
  fetchPickupRunById,
  fetchPickupRunCandidate,
  userCanViewPickupRun,
} from "@/lib/pickup/featuredPickupRun";
import {
  jsonConfigErrorResponse,
  jsonUnexpectedErrorResponse,
} from "@/lib/server/publicApiRouteErrors";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";
import { isPublicPickupRunType } from "@/lib/pickup/pickupRunType";
import {
  explainPlayerMayParticipateInPublicPickupRun,
  type PublicPickupParticipationBranch,
} from "@/lib/pickup/publicRunParticipation";
import { parseHubRegion } from "@/lib/pickup/hubRegions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "pickup/public";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

/** Tier 1a / 1b — used only for attendance analytics (`tier1Confirmed`), not run access. */
function isTier1(rank: number | null | undefined) {
  return rank === 1 || rank === 2;
}

export async function GET(req: Request) {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch (err) {
    return jsonConfigErrorResponse(ROUTE, "getSupabaseAdmin", err);
  }

  try {
    const token = bearer(req);

    let userId: string | null = null;
    let approved = false;
    let isAdmin = false;
    let tier: string | null = null;
    let tierRank: number | null = null;
    let nearestVenue: string | null = null;
    if (token) {
      const u = await admin.auth.getUser(token);
      if (u.error) {
        console.error(`[api/${ROUTE}] auth.getUser:`, u.error.message);
        userId = null;
      } else {
        userId = u.data.user?.id || null;
      }

      if (userId) {
        const prof = await admin
          .from("profiles")
          .select("approved,is_admin,tier,tier_rank,first_name,last_name,instagram,nearest_venue")
          .eq("id", userId)
          .maybeSingle();

        if (prof.error) {
          console.error(`[api/${ROUTE}] profiles_session_user:`, prof.error.message, prof.error);
        }

        approved = !!prof.data?.approved;
        isAdmin = !!prof.data?.is_admin;
        tier = (prof.data?.tier ?? null) as any;
        tierRank =
          prof.data?.tier_rank === null || prof.data?.tier_rank === undefined
            ? null
            : Number(prof.data?.tier_rank);
        nearestVenue =
          prof.data?.nearest_venue != null && String(prof.data.nearest_venue).trim()
            ? String(prof.data.nearest_venue).trim()
            : null;
      }
    }

    const url = new URL(req.url);
    const runIdParam = url.searchParams.get("run_id");
    const hubRegion = parseHubRegion(url.searchParams.get("region"));

    console.log(`[api/${ROUTE}] GET start`, {
      runIdParam,
      hubRegion,
      hasToken: Boolean(token),
      approved,
      isAdmin,
    });

    let runLoadReason: "ok" | "not_found" | "not_allowed" | "featured" = "featured";
    let run: PublicPickupRunRow | null = null;

    if (runIdParam) {
      run = await fetchPickupRunById(admin, runIdParam);
      runLoadReason = run ? "ok" : "not_found";
      console.log(`[api/${ROUTE}] fetchPickupRunById`, {
        runIdParam,
        runLoadReason,
        found: Boolean(run),
        runId: run?.id ?? null,
        status: run?.status ?? null,
        run_type: run?.run_type ?? null,
        service_region: run?.service_region ?? null,
      });
      if (!run) {
        const rawRes = await admin
          .from("pickup_runs")
          .select("id,status,run_type,is_current,service_region")
          .eq("id", runIdParam)
          .maybeSingle();
        console.log(`[api/${ROUTE}] fetchPickupRunById miss — raw row`, {
          runIdParam,
          rawExists: Boolean(rawRes.data),
          rawStatus: rawRes.data?.status ?? null,
          rawRunType: rawRes.data?.run_type ?? null,
          rawError: rawRes.error?.message ?? null,
        });
      }
      if (run) {
        const canView = await userCanViewPickupRun(admin, run, {
          userId,
          approved,
          isAdmin,
          tierRank,
        });
        if (!canView) {
          console.log(`[api/${ROUTE}] userCanViewPickupRun denied (keeping run for run_id lookup)`, {
            runIdParam,
          });
          runLoadReason = "not_allowed";
          // Inline planning poll needs the run row (slots, status) even when invite-gated.
        }
      }
    } else {
      run = await fetchPickupRunCandidate(admin, { region: hubRegion });
      if (run) {
        const canView = await userCanViewPickupRun(admin, run, {
          userId,
          approved,
          isAdmin,
          tierRank,
        });
        if (!canView) run = null;
      }
    }

    if (!run && userId && approved && !runIdParam) {
      const invitedRun = await fetchInvitedFeaturedPickupRun(admin, userId);
      if (invitedRun) run = invitedRun;
    }

    if (!run && !runIdParam) {
      const fb = await fetchFirstPublicUpcomingPickupRun(admin);
      if (fb) run = fb;
    }

    if (!run) {
      if (runIdParam) {
        let rawRow: Record<string, unknown> | null = null;
        const rawRes = await admin
          .from("pickup_runs")
          .select("id,status,run_type,is_current,service_region")
          .eq("id", runIdParam)
          .maybeSingle();
        if (rawRes.data) rawRow = rawRes.data as Record<string, unknown>;
        console.warn(`[api/${ROUTE}] run_id load missed`, {
          runIdParam,
          runLoadReason,
          hubRegion,
          approved,
          hasUserId: Boolean(userId),
          rawStatus: rawRow?.status ?? null,
          rawRunType: rawRow?.run_type ?? null,
          rawIsCurrent: rawRow?.is_current ?? null,
          rawServiceRegion: rawRow?.service_region ?? null,
          rawExists: Boolean(rawRow),
        });
      }
      return NextResponse.json({
        status: "inactive",
        run: null,
        ...(runIdParam && runLoadReason === "not_allowed"
          ? { error: "not_invited", run_id: runIdParam }
          : {}),
        visibility: { invitedNow: false, attendanceVisible: false },
        counts: {
          confirmed: 0,
          standby: 0,
          pending_payment: 0,
          tier1Confirmed: 0,
        },
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

    if (rsvpRes.error) {
      console.error(`[api/${ROUTE}] pickup_run_rsvps:`, rsvpRes.error.message, rsvpRes.error);
    }

    const rsvpRows = rsvpRes.data || [];
    const confirmedRows = rsvpRows.filter((r) => r.status === "confirmed");
    const standbyRows = rsvpRows.filter((r) => r.status === "standby");
    const waitlistRows = rsvpRows.filter((r) => r.status === "waitlist");
    const pendingConfirmRows = rsvpRows.filter((r) => r.status === "pending_confirm");
    const pendingRows = rsvpRows.filter((r) => r.status === "pending_payment");

    // Tier-1 confirmed count using profiles.tier_rank (canonical)
    let tier1Confirmed = 0;
    if (confirmedRows.length) {
      const ids = Array.from(new Set(confirmedRows.map((r) => r.user_id)));
      const profs = await admin.from("profiles").select("id,tier_rank").in("id", ids);

      if (profs.error) {
        console.error(`[api/${ROUTE}] profiles_tier_ranks:`, profs.error.message, profs.error);
      }

      const rankById = new Map<string, number>();
      for (const p of profs.data || []) {
        rankById.set(String(p.id), Number(p.tier_rank ?? 6));
      }

      tier1Confirmed = confirmedRows.filter((r) => isTier1(rankById.get(String(r.user_id)))).length;
    }

    // invitedNow / canParticipateInPlanning — planning poll + join flow:
    // - public runs: venue region, active hub tab, or explicit run_id (Runs list / deep link)
    // - select runs: approved + row in pickup_run_invites (invite is the gate; no venue match)
    let invitedNow = false;
    let canParticipateInPlanning = false;
    let participationBranch: PublicPickupParticipationBranch | "select_invite" | "none" = "none";

    if (userId && approved) {
      if (isPublicPickupRunType(run.run_type)) {
        const participation = explainPlayerMayParticipateInPublicPickupRun({
          approved: true,
          nearestVenue,
          runServiceRegion: run.service_region,
          hubRegion,
          runType: run.run_type,
          explicitRunAccess: Boolean(runIdParam),
        });
        invitedNow = participation.allowed;
        canParticipateInPlanning = participation.allowed;
        participationBranch = participation.branch;
      } else {
        const inv = await admin
          .from("pickup_run_invites")
          .select("id")
          .eq("run_id", run.id)
          .eq("user_id", userId)
          .limit(1);

        if (inv.error) {
          console.error(`[api/${ROUTE}] pickup_run_invites:`, inv.error.message, inv.error);
        }

        invitedNow = (inv.data || []).length > 0;
        canParticipateInPlanning = invitedNow;
        participationBranch = invitedNow ? "select_invite" : "none";
      }
    }

    const runInPlanningPhase =
      run.status === "planning" || run.status === "likely_on" ? true : false;

    console.log(`[api/${ROUTE}] participation`, {
      run_id: run.id,
      runIdParam,
      hubRegion,
      service_region: run.service_region ?? null,
      run_type: run.run_type,
      run_status: run.status,
      approved,
      invitedNow,
      canParticipateInPlanning,
      participationBranch,
      runInPlanningPhase,
      nearestVenue,
    });

    if (runIdParam && isPublicPickupRunType(run.run_type) && approved && !invitedNow) {
      console.warn(`[api/${ROUTE}] public run_id invitedNow false`, {
        runId: run.id,
        runLoadReason,
        hubRegion,
        serviceRegion: run.service_region,
        nearestVenue,
        participationBranch,
      });
    }

    let attendanceVisible = false;
    if (invitedNow) attendanceVisible = true;

    // My status: latest row for this user
    let myStatus: string | null = null;
    let myWaitlistPosition: number | null = null;
    let myWaitlistExpiresAt: string | null = null;
    if (userId) {
      const mine = await admin
        .from("pickup_run_rsvps")
        .select("status,waitlist_position,waitlist_expires_at,updated_at,created_at")
        .eq("run_id", run.id)
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1);

      if (mine.error) {
        console.error(`[api/${ROUTE}] pickup_run_rsvps_mine:`, mine.error.message, mine.error);
      }

      myStatus = mine.data?.[0]?.status || null;
      myWaitlistPosition =
        mine.data?.[0]?.waitlist_position === null || mine.data?.[0]?.waitlist_position === undefined
          ? null
          : Number(mine.data?.[0]?.waitlist_position);
      const rawExpires = mine.data?.[0]?.waitlist_expires_at;
      myWaitlistExpiresAt = typeof rawExpires === "string" && rawExpires.trim() ? rawExpires.trim() : null;
    }

    // Attendees list (confirmed only) if visible
    let attendees: any[] = [];
    if (attendanceVisible && confirmedRows.length) {
      const ids = Array.from(new Set(confirmedRows.map((r) => r.user_id)));
      const ppl = await admin
        .from("profiles")
        .select("id,first_name,last_name,instagram,tier,tier_rank")
        .in("id", ids);

      if (ppl.error) {
        console.error(`[api/${ROUTE}] profiles_attendees:`, ppl.error.message, ppl.error);
      }

      attendees = (ppl.data || []).map((p) => ({
        full_name: `${p.first_name || ""} ${p.last_name || ""}`.trim() || "Player",
        instagram: p.instagram || null,
        tier: p.tier ?? null,
        tier_rank: p.tier_rank ?? null,
      }));
    }

    const slotsRes = await admin
      .from("pickup_run_time_slots")
      .select("id,start_at,label")
      .eq("run_id", run.id)
      .order("start_at", { ascending: true });

    if (slotsRes.error) {
      console.error(`[api/${ROUTE}] pickup_run_time_slots:`, slotsRes.error.message, slotsRes.error);
    }

    const pickup_run_time_slots = (slotsRes.data || []).map((s) => ({
      id: String(s.id),
      start_at: s.start_at,
      label: typeof s.label === "string" ? s.label : null,
    }));

    // Location privacy (canonical):
    // only confirmed players (or admin) can see exact location.
    const locationText =
      (isAdmin || myStatus === "confirmed") && run.location_private
        ? String(run.location_private)
        : null;

    // Planning poll: user's committed time windows (multiple rows allowed)
    let planning: {
      my_availability: { slot_id: string | null; slot_label: string | null; state: string }[];
    } | null = null;
    if (
      userId &&
      (run.status === "planning" || run.status === "likely_on") &&
      !run.final_slot_id
    ) {
      const minePlan = await admin
        .from("pickup_run_availability")
        .select("slot_id,state")
        .eq("run_id", run.id)
        .eq("user_id", userId);

      if (minePlan.error) {
        console.error(`[api/${ROUTE}] pickup_run_availability_mine:`, minePlan.error.message, minePlan.error);
      }

      const rows = minePlan.data || [];
      const declinedRow = rows.find((r) => r.state === "declined");
      const availRows = rows.filter((r) => r.state === "available" && r.slot_id);
      let my_availability: { slot_id: string | null; slot_label: string | null; state: string }[] = [];

      if (declinedRow) {
        my_availability = [{ slot_id: null, slot_label: null, state: "declined" }];
      } else if (availRows.length) {
        const slotIds = Array.from(new Set(availRows.map((r) => String(r.slot_id))));
        const labelsRes = await admin
          .from("pickup_run_time_slots")
          .select("id,label")
          .eq("run_id", run.id)
          .in("id", slotIds);

        if (labelsRes.error) {
          console.error(`[api/${ROUTE}] pickup_run_time_slots_mine:`, labelsRes.error.message, labelsRes.error);
        }

        const labelById = new Map<string, string | null>();
        for (const s of labelsRes.data || []) {
          labelById.set(String(s.id), typeof s.label === "string" ? s.label : null);
        }

        my_availability = availRows.map((r) => ({
          slot_id: String(r.slot_id),
          slot_label: labelById.get(String(r.slot_id)) ?? null,
          state: "available",
        }));
      }

      planning = { my_availability };
    }

    return NextResponse.json({
      status: run.status || "inactive",
      run: {
        id: run.id,
        status: run.status,
        run_type: run.run_type,
        title: run.title,
        start_at: run.start_at,
        capacity: run.capacity,
        fee_cents: run.fee_cents,
        currency: run.currency,
        cancellation_deadline: run.cancellation_deadline,

        // Keep this key name so your current frontend keeps working:
        location_text: locationText,

        likely_on_at: run.likely_on_at,
        likely_on_slot_id: run.likely_on_slot_id,
        final_slot_id: run.final_slot_id,
        service_region: run.service_region ?? null,
        pickup_run_time_slots,
      },
      visibility: { invitedNow, canParticipateInPlanning, attendanceVisible },
      counts: {
        confirmed: confirmedRows.length,
        standby: standbyRows.length,
        waitlist: waitlistRows.length,
        pending_confirm: pendingConfirmRows.length,
        pending_payment: pendingRows.length,
        tier1Confirmed,
      },
      my_status: myStatus,
      my_waitlist_position: myWaitlistPosition,
      my_waitlist_expires_at: myWaitlistExpiresAt,
      attendees,
      me: { approved, is_admin: isAdmin, tier, tier_rank: tierRank },
      ...(planning ? { planning } : {}),
    });
  } catch (err) {
    return jsonUnexpectedErrorResponse(ROUTE, "GET", err);
  }
}
