import { NextResponse } from "next/server";
import type { PublicPickupRunRow } from "@/lib/pickup/publicUpcomingRuns";
import { parseHubRegion } from "@/lib/pickup/hubRegions";
import {
  jsonConfigErrorResponse,
  jsonUnexpectedErrorResponse,
} from "@/lib/server/publicApiRouteErrors";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "pickup/region-runs";
const LIST_STATUSES = ["planning", "likely_on", "active"] as const;

/** GET ?region=MD — active/planning runs for one hub state, soonest kickoff (start_at) first. No cross-region fallback. */
export async function GET(req: Request) {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch (err) {
    return jsonConfigErrorResponse(ROUTE, "getSupabaseAdmin", err);
  }

  try {
    const url = new URL(req.url);
    const hubRegion = parseHubRegion(url.searchParams.get("region"));
    if (!hubRegion) {
      return NextResponse.json({ error: "region is required (NY, CT, NJ, MD)" }, { status: 400 });
    }

    const runRes = await admin
      .from("pickup_runs")
      .select("id,title,status,start_at,run_type,capacity,fee_cents,service_region,final_slot_id")
      .eq("service_region", hubRegion)
      .in("status", [...LIST_STATUSES])
      .order("start_at", { ascending: true, nullsFirst: false });

    if (runRes.error) {
      console.error(`[api/${ROUTE}] pickup_runs:`, runRes.error.message, runRes.error);
      return NextResponse.json({ error: "Could not load runs." }, { status: 500 });
    }

    const runs = (runRes.data || []) as Pick<
      PublicPickupRunRow,
      | "id"
      | "title"
      | "status"
      | "start_at"
      | "run_type"
      | "capacity"
      | "fee_cents"
      | "service_region"
      | "final_slot_id"
    >[];

    if (!runs.length) {
      return NextResponse.json({ runs: [] });
    }

    const ids = runs.map((r) => r.id);
    const rsvpRes = await admin
      .from("pickup_run_rsvps")
      .select("run_id,status")
      .in("run_id", ids)
      .eq("status", "confirmed");

    if (rsvpRes.error) {
      console.error(`[api/${ROUTE}] pickup_run_rsvps:`, rsvpRes.error.message, rsvpRes.error);
    }

    const confirmedByRun = new Map<string, number>();
    for (const row of rsvpRes.data || []) {
      const rid = String(row.run_id);
      confirmedByRun.set(rid, (confirmedByRun.get(rid) ?? 0) + 1);
    }

    const payload = runs.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      start_at: r.start_at,
      run_type: r.run_type,
      capacity: Number(r.capacity ?? 0),
      fee_cents: Number(r.fee_cents ?? 0),
      service_region: r.service_region ?? hubRegion,
      confirmed_count: confirmedByRun.get(String(r.id)) ?? 0,
      final_slot_id: r.final_slot_id ?? null,
    }));

    return NextResponse.json({ runs: payload });
  } catch (err) {
    return jsonUnexpectedErrorResponse(ROUTE, "GET", err);
  }
}
