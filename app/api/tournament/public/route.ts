import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  jsonConfigErrorResponse,
  jsonSupabaseErrorResponse,
  jsonUnexpectedErrorResponse,
} from "@/lib/server/publicApiRouteErrors";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const dynamic = "force-dynamic";

const ROUTE = "tournament/public";

const ACTIVE_CLAIM_STATUSES = [
  "claim_submitted",
  "payment_pending",
  "payment_received",
  "roster_pending",
  "verification_in_progress",
  "flagged_for_review",
  "confirmed",
];

async function expireOverduePaymentHolds(supabase: SupabaseClient, tournamentId: string) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("tournament_captains")
    .update({ status: "released_expired" })
    .eq("tournament_id", tournamentId)
    .eq("status", "payment_pending")
    .lt("payment_due_at", now);

  if (error) {
    console.error(`[api/${ROUTE}] expireOverduePaymentHolds:`, error.message, error);
  }
}

export async function GET() {
  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (err) {
    return jsonConfigErrorResponse(ROUTE, "getSupabaseAdmin", err);
  }

  try {
    const { data: t, error: tErr } = await supabase
      .from("tournaments")
      .select("*")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (tErr) {
      return jsonSupabaseErrorResponse(ROUTE, "tournaments_active", tErr);
    }

    if (!t) {
      return NextResponse.json({
        tournament: null,
        claimedTeams: 0,
        confirmedTeams: 0,
        official: false,
        full: false,
      });
    }

    await expireOverduePaymentHolds(supabase, t.id);

    const { data: captains, error: cErr } = await supabase
      .from("tournament_captains")
      .select("status")
      .eq("tournament_id", t.id);

    if (cErr) {
      return jsonSupabaseErrorResponse(ROUTE, "tournament_captains", cErr);
    }

    const claimedTeams = (captains || []).filter((c) => ACTIVE_CLAIM_STATUSES.includes(c.status)).length;
    const confirmedTeams = (captains || []).filter((c) => c.status === "confirmed").length;

    const official = confirmedTeams >= t.official_threshold; // 8
    const full = confirmedTeams >= t.max_teams; // 12

    const staffAnnouncement =
      "staff_announcement" in t && typeof (t as { staff_announcement?: unknown }).staff_announcement === "string"
        ? (t as { staff_announcement: string }).staff_announcement
        : null;

    return NextResponse.json({
      tournament: {
        id: t.id,
        slug: t.slug,
        title: t.title,
        targetTeams: t.target_teams,
        officialThreshold: t.official_threshold,
        maxTeams: t.max_teams,
        announcement: staffAnnouncement?.trim() ? staffAnnouncement : null,
      },
      claimedTeams,
      confirmedTeams,
      official,
      full,
    });
  } catch (err) {
    return jsonUnexpectedErrorResponse(ROUTE, "GET", err);
  }
}
