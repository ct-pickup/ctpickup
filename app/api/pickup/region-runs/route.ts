import { NextResponse } from "next/server";
import type { PublicPickupRunRow } from "@/lib/pickup/publicUpcomingRuns";
import { HUB_REGIONS, parseHubRegion } from "@/lib/pickup/hubRegions";
import {
  effectiveMaxDriveMinutes,
  MAX_MAX_DRIVE_MINUTES,
} from "@/lib/pickup/profileMaxDriveFilter";
import { milesFromZipToRunLocation } from "@/lib/pickup/runVenueDistance";
import {
  driveMinutesFromZipToDestination,
  resolveRunVenueDestination,
} from "@/lib/venueDistance";
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

function normalizeRegionCode(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const u = String(raw).trim().toUpperCase();
  return HUB_REGIONS.has(u) ? u : raw.trim() ? String(raw).trim().toUpperCase() : null;
}

type RunRow = Pick<
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
> & { location_private?: string | null };

type RowOut = {
  id: string;
  title: string | null;
  status: string;
  start_at: string | null;
  run_type: string | null;
  capacity: number;
  fee_cents: number;
  service_region: string | null;
  confirmed_count: number;
  final_slot_id: string | null;
  distance_miles: number | null;
  drive_minutes: number | null;
};

/**
 * GET ?region=CT — primary hub runs for the selected state.
 * With auth + ZIP + max_drive_minutes (under 90): also include other hubs within drive time, sorted by distance.
 */
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
    let maxDriveMinutes: number | null = null;

    const token = bearer(req);
    if (token) {
      const u = await admin.auth.getUser(token);
      const userId = u.data.user?.id;
      if (userId) {
        const prof = await admin
          .from("profiles")
          .select("zip_code,max_drive_minutes")
          .eq("id", userId)
          .maybeSingle();
        if (!prof.error && prof.data) {
          const zipRaw = prof.data.zip_code != null ? String(prof.data.zip_code).trim() : "";
          const digits = zipRaw.replace(/\D/g, "").slice(0, 5);
          if (digits.length === 5) {
            playerZip = digits;
            maxDriveMinutes = effectiveMaxDriveMinutes(prof.data.max_drive_minutes);
          }
        }
      }
    }

    const includeNearbyRegions =
      playerZip != null && maxDriveMinutes != null && maxDriveMinutes < MAX_MAX_DRIVE_MINUTES;

    let runQuery = admin
      .from("pickup_runs")
      .select(
        "id,title,status,start_at,run_type,capacity,fee_cents,service_region,final_slot_id,location_private",
      )
      .in("status", [...LIST_STATUSES]);

    if (!includeNearbyRegions) {
      runQuery = runQuery.eq("service_region", hubRegion);
    }

    const runRes = await runQuery.order("start_at", { ascending: true, nullsFirst: false });

    if (runRes.error) {
      console.error(`[api/${ROUTE}] pickup_runs:`, runRes.error.message, runRes.error);
      return NextResponse.json({ error: "Could not load runs." }, { status: 500 });
    }

    const runs = (runRes.data || []) as RunRow[];

    const filterPayload = {
      zip: playerZip,
      max_drive_minutes: maxDriveMinutes,
      region: hubRegion,
      include_nearby_regions: includeNearbyRegions,
    };

    if (!runs.length) {
      return NextResponse.json({ runs: [], filter: filterPayload });
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

    let payload: RowOut[] = await Promise.all(
      runs.map(async (r) => {
        const regionCode = normalizeRegionCode(r.service_region);
        const dest = resolveRunVenueDestination({
          locationPrivate: r.location_private,
          serviceRegion: regionCode,
        });
        const drive_minutes =
          playerZip && dest ? await driveMinutesFromZipToDestination(playerZip, dest) : null;
        const distance_miles = playerZip
          ? milesFromZipToRunLocation(playerZip, r.location_private ?? null, regionCode)
          : null;
        return {
          id: r.id,
          title: r.title,
          status: r.status,
          start_at: r.start_at,
          run_type: r.run_type,
          capacity: Number(r.capacity ?? 0),
          fee_cents: Number(r.fee_cents ?? 0),
          service_region: regionCode,
          confirmed_count: confirmedByRun.get(String(r.id)) ?? 0,
          final_slot_id: r.final_slot_id ?? null,
          distance_miles,
          drive_minutes,
        };
      }),
    );

    if (includeNearbyRegions && maxDriveMinutes != null) {
      payload = payload.filter((r) => {
        const inSelectedHub = r.service_region === hubRegion;
        if (inSelectedHub) return true;
        return r.drive_minutes != null && r.drive_minutes <= maxDriveMinutes;
      });
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
      filter: filterPayload,
    });
  } catch (err) {
    return jsonUnexpectedErrorResponse(ROUTE, "GET", err);
  }
}
