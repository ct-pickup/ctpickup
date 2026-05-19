import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  jsonConfigErrorResponse,
  jsonSupabaseErrorResponse,
  jsonUnexpectedErrorResponse,
} from "@/lib/server/publicApiRouteErrors";
import { getSupabaseAdmin, getSupabaseAnon } from "@/lib/server/runtimeClients";
import {
  isActiveCaptainClaimStatus,
  isPaidOrReadyCaptainStatus,
} from "@/lib/tournament/outdoorTournamentConstants";
import { resolveOutdoorHubRegionForUser } from "@/lib/tournament/resolveOutdoorHubRegionForUser";
import { selectActiveOutdoorTournamentForRegion } from "@/lib/tournament/selectActiveOutdoorTournament";

export const dynamic = "force-dynamic";

const ROUTE = "tournament/public";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

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

export async function GET(req: Request) {
  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (err) {
    return jsonConfigErrorResponse(ROUTE, "getSupabaseAdmin", err);
  }

  try {
    const url = new URL(req.url);
    const regionRaw = String(url.searchParams.get("region") || "").trim().toUpperCase();

    let userId: string | null = null;
    const token = bearer(req);
    if (token) {
      try {
        const anon = getSupabaseAnon();
        const { data: u } = await anon.auth.getUser(token);
        userId = u?.user?.id ?? null;
      } catch {
        userId = null;
      }
    }

    const resolvedRegion = await resolveOutdoorHubRegionForUser(supabase, userId, regionRaw || null);

    const { data: t, error: tErr, matchStep } = await selectActiveOutdoorTournamentForRegion(
      supabase,
      resolvedRegion,
    );

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
        teams: [],
      });
    }

    await expireOverduePaymentHolds(supabase, t.id as string);

    const { data: captains, error: cErr } = await supabase
      .from("tournament_captains")
      .select("id,status,team_name,captain_name")
      .eq("tournament_id", t.id as string);

    if (cErr) {
      return jsonSupabaseErrorResponse(ROUTE, "tournament_captains", cErr);
    }

    const claimedTeams = (captains || []).filter((c) => isActiveCaptainClaimStatus(c.status)).length;
    const paidOrReadyTeams = (captains || []).filter((c) => isPaidOrReadyCaptainStatus(c.status)).length;
    const finalConfirmedTeams = (captains || []).filter((c) => c.status === "confirmed").length;

    const officialThreshold = Number(t.official_threshold ?? 0);
    const maxTeams = Number(t.max_teams ?? 0);
    const official = paidOrReadyTeams >= officialThreshold;
    const full = paidOrReadyTeams >= maxTeams;

    const staffAnnouncement = typeof t.staff_announcement === "string" ? t.staff_announcement : null;

    const teams = (captains || [])
      .filter((c) => isPaidOrReadyCaptainStatus(c.status))
      .map((c) => ({
        id: c.id,
        team_name: String((c as { team_name?: unknown }).team_name ?? ""),
        captain_name: String((c as { captain_name?: unknown }).captain_name ?? ""),
      }))
      .sort((a, b) => a.team_name.localeCompare(b.team_name));

    const entryFee = typeof t.entry_fee_cents === "number" ? t.entry_fee_cents : 25000;

    return NextResponse.json({
      tournament: {
        id: t.id,
        slug: t.slug,
        title: t.title,
        targetTeams: t.target_teams,
        officialThreshold: t.official_threshold,
        maxTeams,
        announcement: staffAnnouncement?.trim() ? staffAnnouncement : null,
        start_at: typeof t.start_at === "string" ? t.start_at : null,
        venue: typeof t.venue === "string" && t.venue.trim() ? t.venue.trim() : null,
        service_region:
          t.service_region != null && String(t.service_region).trim()
            ? String(t.service_region).trim().toUpperCase()
            : null,
        format_summary: typeof t.format_summary === "string" ? String(t.format_summary).trim() || null : null,
        entry_fee_cents: entryFee,
      },
      claimedTeams,
      /** Paid captains (Stripe captured) through final confirmation — used for official / full thresholds. */
      confirmedTeams: paidOrReadyTeams,
      finalConfirmedTeams,
      official,
      full,
      teams,
    });
  } catch (err) {
    return jsonUnexpectedErrorResponse(ROUTE, "GET", err);
  }
}
