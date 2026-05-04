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

const HUB_REGIONS = new Set(["NY", "CT", "NJ", "MD"]);

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
    const region = regionRaw && HUB_REGIONS.has(regionRaw) ? regionRaw : null;

    let t: Record<string, unknown> | null = null;
    let tErr: { message: string } | null = null;

    if (region) {
      const r1 = await supabase
        .from("tournaments")
        .select("*")
        .eq("is_active", true)
        .eq("service_region", region)
        .maybeSingle();
      if (r1.error) {
        tErr = r1.error;
      } else if (r1.data) {
        t = r1.data as Record<string, unknown>;
      } else {
        const r2 = await supabase
          .from("tournaments")
          .select("*")
          .eq("is_active", true)
          .is("service_region", null)
          .maybeSingle();
        if (r2.error) {
          tErr = r2.error;
        } else {
          t = (r2.data as Record<string, unknown> | null) ?? null;
        }
      }
    } else {
      const r0 = await supabase
        .from("tournaments")
        .select("*")
        .eq("is_active", true)
        .is("service_region", null)
        .maybeSingle();
      if (r0.error) {
        tErr = r0.error;
      } else if (r0.data) {
        t = r0.data as Record<string, unknown>;
      } else {
        const rAny = await supabase.from("tournaments").select("*").eq("is_active", true).limit(1).maybeSingle();
        if (rAny.error) {
          tErr = rAny.error;
        } else {
          t = (rAny.data as Record<string, unknown> | null) ?? null;
        }
      }
    }

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

    await expireOverduePaymentHolds(supabase, t.id as string);

    const { data: captains, error: cErr } = await supabase
      .from("tournament_captains")
      .select("status")
      .eq("tournament_id", t.id as string);

    if (cErr) {
      return jsonSupabaseErrorResponse(ROUTE, "tournament_captains", cErr);
    }

    const claimedTeams = (captains || []).filter((c) => ACTIVE_CLAIM_STATUSES.includes(c.status)).length;
    const confirmedTeams = (captains || []).filter((c) => c.status === "confirmed").length;

    const officialThreshold = Number(t.official_threshold ?? 0);
    const maxTeams = Number(t.max_teams ?? 0);
    const official = confirmedTeams >= officialThreshold;
    const full = confirmedTeams >= maxTeams;

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
        maxTeams,
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
