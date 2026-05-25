import { NextResponse } from "next/server";
import type { PublicPickupRunRow } from "@/lib/pickup/publicUpcomingRuns";
import { parseHubRegion } from "@/lib/pickup/hubRegions";
import { milesFromZipToRunLocation } from "@/lib/pickup/runVenueDistance";
import { clampMaxRunDistanceMiles } from "@/lib/pickup/runRadiusPreference";
import {
  jsonConfigErrorResponse,
  jsonUnexpectedErrorResponse,
} from "@/lib/server/publicApiRouteErrors";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "pickup/region-runs";
const LIST_STATUSES = ["planning", "likely_on", "active"] as const;

function bearer(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

/** GET ?region=MD — runs for one hub; optional auth filters/sorts by ZIP + max_run_distance_miles. */
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

    let playerZip: string | null = null;
    let maxRadiusMiles: number | null = null;

    const token = bearer(req);
    if (token) {
      const u = await admin.auth.getUser(token);
      const userId = u.data.user?.id;
      if (userId) {
        const prof = await admin
          .from("profiles")
          .select("zip_code,max_run_distance_miles")
          .eq("id", userId)
          .maybeSingle();
        if (!prof.error && prof.data) {
          const zipRaw = prof.data.zip_code != null ? String(prof.data.zip_code).trim() : "";
          const digits = zipRaw.replace(/\D/g, "").slice(0, 5);
          if (digits.length === 5) {
            playerZip = digits;
            maxRadiusMiles = clampMaxRunDistanceMiles(prof.data.max_run_distance_miles);
          }
        }
      }
    }

    const runRes = await admin
      .from("pickup_runs")
      .select(
        "id,title,status,start_at,run_type,capacity,fee_cents,service_region,final_slot_id,location_private",
      )
      .eq("service_region", hubRegion)
      .in("status", [...LIST_STATUSES]);

    if (runRes.error) {
      console.error(`[api/${ROUTE}] pickup_runs:`, runRes.error.message, runRes.error);
      return NextResponse.json({ error: "Could not load runs." }, { status: 500 });
    }

    const runs = (runRes.data || []) as (Pick<
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
    > & { location_private?: string | null })[];

    if (!runs.length) {
      return NextResponse.json({ runs: [], filter: { zip: playerZip, max_miles: maxRadiusMiles } });
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

    type RowOut = {
      id: string;
      title: string | null;
      status: string;
      start_at: string | null;
      run_type: string | null;
      capacity: number;
      fee_cents: number;
      service_region: string;
      confirmed_count: number;
      final_slot_id: string | null;
      distance_miles: number | null;
    };

    let payload: RowOut[] = runs.map((r) => {
      const distance_miles = playerZip
        ? milesFromZipToRunLocation(playerZip, r.location_private ?? null, r.service_region ?? hubRegion)
        : null;
      return {
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
        distance_miles,
      };
    });

    if (playerZip && maxRadiusMiles != null) {
      payload = payload.filter(
        (r) => r.distance_miles != null && r.distance_miles <= maxRadiusMiles!,
      );
      payload.sort((a, b) => {
        const da = a.distance_miles ?? 9999;
        const db = b.distance_miles ?? 9999;
        if (da !== db) return da - db;
        const ta = a.start_at ? Date.parse(a.start_at) : 0;
        const tb = b.start_at ? Date.parse(b.start_at) : 0;
        return ta - tb;
      });
    } else {
      payload.sort((a, b) => {
        const ta = a.start_at ? Date.parse(a.start_at) : 0;
        const tb = b.start_at ? Date.parse(b.start_at) : 0;
        return ta - tb;
      });
    }

    return NextResponse.json({
      runs: payload,
      filter: { zip: playerZip, max_miles: maxRadiusMiles },
    });
  } catch (err) {
    return jsonUnexpectedErrorResponse(ROUTE, "GET", err);
  }
}
