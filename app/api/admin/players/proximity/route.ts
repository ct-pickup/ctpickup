import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { profileMatchesRunServiceRegion } from "@/lib/pickup/venueServiceRegion";
import { createDriveMinutesCache } from "@/lib/pickup/profileMaxDriveFilter";
import {
  driveMinutesFromZipsToDestination,
  enrichVenueDestination,
  resolveRunVenueDestination,
  zipMatchesVenueHubRegion,
} from "@/lib/venueDistance";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";
import { serviceRegionForAdminVenueName } from "@/lib/venues/adminCtPickupVenues";
import { normalizeUsZipDigits } from "@/lib/zipRegion";

export const runtime = "nodejs";

const MIN_MAX_MINUTES = 15;
const MAX_MAX_MINUTES = 90;

function clampMaxMinutes(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 60;
  return Math.min(MAX_MAX_MINUTES, Math.max(MIN_MAX_MINUTES, Math.round(n)));
}

export type ProximityPlayerResult = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  instagram: string | null;
  tier: string | null;
  tier_rank: number | null;
  zip_code: string;
  drive_minutes: number;
  /** True when drive time came from hub ZIP/venue region match (Google + haversine unavailable). */
  region_fallback?: boolean;
};

/** GET — approved players within `max_minutes` drive of a venue (Google Distance Matrix + fallbacks). */
export async function GET(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  try {
    const url = new URL(req.url);
    const venue = String(url.searchParams.get("venue") || "").trim();
    const max_minutes = clampMaxMinutes(url.searchParams.get("max_minutes"));

    if (!venue) {
      return NextResponse.json({ error: "Missing venue" }, { status: 400 });
    }

    const resolved = resolveRunVenueDestination({ locationPrivate: null, serviceRegion: null, venueName: venue });
    if (!resolved) {
      return NextResponse.json(
        { error: "Unknown venue. Pick a CT Pickup venue name or paste a known venue label." },
        { status: 400 },
      );
    }
    const dest = enrichVenueDestination(resolved);
    const venueHubRegion = serviceRegionForAdminVenueName(dest.venue);

    const mapsKeyPresent = Boolean(process.env.GOOGLE_MAPS_API_KEY?.trim());

    const admin = getSupabaseAdmin();
    const profRes = await admin
      .from("profiles")
      .select("id,first_name,last_name,instagram,tier,tier_rank,zip_code,nearest_venue")
      .eq("approved", true)
      .not("zip_code", "is", null)
      .order("first_name", { ascending: true });

    if (profRes.error) {
      return NextResponse.json({ error: profRes.error.message }, { status: 500 });
    }

    const withZip: {
      id: string;
      first_name: string | null;
      last_name: string | null;
      instagram: string | null;
      tier: string | null;
      tier_rank: number | null;
      zip_code: string;
      zip5: string;
      nearest_venue: string | null;
    }[] = [];

    for (const row of profRes.data || []) {
      const zip5 = normalizeUsZipDigits(row.zip_code);
      if (!zip5) continue;
      withZip.push({
        id: row.id as string,
        first_name: row.first_name ?? null,
        last_name: row.last_name ?? null,
        instagram: row.instagram ?? null,
        tier: row.tier ?? null,
        tier_rank: row.tier_rank != null ? Number(row.tier_rank) : null,
        zip_code: zip5,
        zip5,
        nearest_venue: row.nearest_venue ?? null,
      });
    }

    console.log("[admin/players/proximity]", {
      venueParam: venue,
      destVenue: dest.venue,
      destAddress: dest.address,
      venueHubRegion,
      mapsKeyPresent,
      approvedWithZip: withZip.length,
    });

    const cache = createDriveMinutesCache();
    const minutesByZip = await driveMinutesFromZipsToDestination(
      withZip.map((p) => p.zip5),
      dest,
      cache,
    );

    const googleHits = withZip.filter((p) => minutesByZip.has(p.zip5)).length;
    console.log("[admin/players/proximity] drive times", {
      resolvedCount: minutesByZip.size,
      googleOrHaversineHits: googleHits,
      sampleZips: withZip.slice(0, 5).map((p) => ({ zip: p.zip5, minutes: minutesByZip.get(p.zip5) ?? null })),
    });

    const players: ProximityPlayerResult[] = [];
    let regionFallbackCount = 0;

    for (const p of withZip) {
      let drive_minutes = minutesByZip.get(p.zip5) ?? null;
      let region_fallback = false;

      if (drive_minutes == null) {
        const venueRegionMatch = profileMatchesRunServiceRegion(p.nearest_venue, venueHubRegion);
        const zipRegionMatch = zipMatchesVenueHubRegion(p.zip5, dest.venue);
        if (venueRegionMatch || zipRegionMatch) {
          drive_minutes = max_minutes;
          region_fallback = true;
          regionFallbackCount += 1;
        }
      }

      if (drive_minutes == null) continue;
      if (drive_minutes > max_minutes) continue;

      players.push({
        id: p.id,
        first_name: p.first_name,
        last_name: p.last_name,
        instagram: p.instagram,
        tier: p.tier,
        tier_rank: p.tier_rank,
        zip_code: p.zip_code,
        drive_minutes,
        ...(region_fallback ? { region_fallback: true } : {}),
      });
    }

    players.sort((a, b) => a.drive_minutes - b.drive_minutes);

    console.log("[admin/players/proximity] result", {
      max_minutes,
      matched: players.length,
      regionFallbackCount,
    });

    return NextResponse.json({
      venue: dest.venue,
      max_minutes,
      count: players.length,
      players,
    });
  } catch (err: unknown) {
    Sentry.captureException(err);
    console.error("[admin/players/proximity GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
