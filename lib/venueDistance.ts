import { stateFromUsZipFive } from "@/lib/usZipState";
import {
  defaultAdminVenueForServiceRegion,
  matchAdminVenueFromLocationText,
} from "@/lib/venues/adminCtPickupVenues";
import { CT_PICKUP_VENUES } from "@/lib/venues/ctPickupVenues";

export const PROXIMITY_INVITE_MAX_MINUTES = 60;

export type VenueDestination = {
  venue: string;
  address: string;
  lat: number;
  lng: number;
};

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Rough drive minutes from crow-flies miles (fallback when Distance Matrix unavailable). */
function driveMinutesFromStraightLineMiles(mi: number): number {
  const roadFactor = 1.28;
  const mph = 42;
  return Math.max(1, Math.round(((mi * roadFactor) / mph) * 60));
}

function normalizeZip(zip: string | null | undefined): string | null {
  if (zip == null) return null;
  const digits = String(zip).replace(/\D/g, "").slice(0, 5);
  return digits.length === 5 ? digits : null;
}

function findCtPickupVenueByName(name: string): { venue: string; address: string; lat?: number; lng?: number } | null {
  const key = name.trim().toLowerCase();
  const hit = CT_PICKUP_VENUES.find((v) => v.venue.toLowerCase() === key);
  return hit ? { venue: hit.venue, address: hit.address } : null;
}

/** Resolve run venue from staff location and/or service region. */
export function resolveRunVenueDestination(args: {
  locationPrivate: string | null | undefined;
  serviceRegion: string | null | undefined;
  /** Tournament `venue` column when present. */
  venueName?: string | null | undefined;
}): VenueDestination | null {
  const fromVenueCol = args.venueName != null ? matchAdminVenueFromLocationText(String(args.venueName)) : null;
  if (fromVenueCol) {
    return {
      venue: fromVenueCol.name,
      address: fromVenueCol.address,
      lat: fromVenueCol.lat,
      lng: fromVenueCol.lng,
    };
  }

  const fromLoc = matchAdminVenueFromLocationText(args.locationPrivate);
  if (fromLoc) {
    return {
      venue: fromLoc.name,
      address: fromLoc.address,
      lat: fromLoc.lat,
      lng: fromLoc.lng,
    };
  }

  const locText = args.locationPrivate != null ? String(args.locationPrivate).trim() : "";
  if (locText) {
    const first = locText.split(/\r?\n/)[0]?.trim() ?? "";
    const ct = first ? findCtPickupVenueByName(first) : null;
    if (ct) {
      const admin = matchAdminVenueFromLocationText(ct.venue);
      if (admin) {
        return { venue: admin.name, address: admin.address, lat: admin.lat, lng: admin.lng };
      }
    }
  }

  const fallback = defaultAdminVenueForServiceRegion(args.serviceRegion);
  if (fallback) {
    return {
      venue: fallback.name,
      address: fallback.address,
      lat: fallback.lat,
      lng: fallback.lng,
    };
  }

  return null;
}

import zipcodes from "zipcodes";

function zipCentroid(zip5: string): { lat: number; lng: number } | null {
  try {
    const loc = zipcodes.lookup(zip5);
    const lat = loc?.latitude;
    const lng = loc?.longitude;
    if (typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
  } catch {
    /* lookup failed */
  }
  return null;
}

function haversineMinutesFromZipToDestination(zip5: string, dest: VenueDestination): number | null {
  if (!dest.lat || !dest.lng) return null;
  const centroid = zipCentroid(zip5);
  if (!centroid) return null;
  const mi = haversineMiles(centroid.lat, centroid.lng, dest.lat, dest.lng);
  return driveMinutesFromStraightLineMiles(mi);
}

function destinationQuery(dest: VenueDestination): string {
  return `${dest.venue}, ${dest.address}`;
}

async function googleDriveMinutesFromZipToDestination(
  zip5: string,
  dest: VenueDestination,
): Promise<number | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) return null;

  const origin = `${zip5}, USA`;
  const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
  url.searchParams.set("origins", origin);
  url.searchParams.set("destinations", destinationQuery(dest));
  url.searchParams.set("mode", "driving");
  url.searchParams.set("departure_time", "now");
  url.searchParams.set("traffic_model", "best_guess");
  url.searchParams.set("units", "imperial");
  url.searchParams.set("key", key);

  try {
    const r = await fetch(url.toString(), { cache: "no-store" });
    const dm = (await r.json()) as {
      status?: string;
      rows?: { elements?: { status?: string; duration_in_traffic?: { value?: number }; duration?: { value?: number } }[] }[];
    };
    if (dm.status !== "OK") return null;
    const el = dm.rows?.[0]?.elements?.[0];
    if (!el || el.status !== "OK") return null;
    const sec = el.duration_in_traffic?.value ?? el.duration?.value;
    if (typeof sec !== "number" || !Number.isFinite(sec)) return null;
    return Math.max(1, Math.round(sec / 60));
  } catch {
    return null;
  }
}

/** Drive-time estimate from a 5-digit ZIP to a single venue (Google with haversine fallback). */
export async function driveMinutesFromZipToDestination(
  zip: string | null | undefined,
  dest: VenueDestination,
): Promise<number | null> {
  const zip5 = normalizeZip(zip);
  if (!zip5) return null;

  const google = await googleDriveMinutesFromZipToDestination(zip5, dest);
  if (google != null) return google;

  return haversineMinutesFromZipToDestination(zip5, dest);
}

const MATRIX_ORIGIN_BATCH = 25;

/** Batch many ZIPs → one destination via Distance Matrix (chunks of 25). */
export async function driveMinutesFromZipsToDestination(
  zips: string[],
  dest: VenueDestination,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const unique = Array.from(new Set(zips.map(normalizeZip).filter((z): z is string => !!z)));
  if (!unique.length) return out;

  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (key) {
    for (let i = 0; i < unique.length; i += MATRIX_ORIGIN_BATCH) {
      const batch = unique.slice(i, i + MATRIX_ORIGIN_BATCH);
      const origins = batch.map((z) => `${z}, USA`).join("|");
      const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
      url.searchParams.set("origins", origins);
      url.searchParams.set("destinations", destinationQuery(dest));
      url.searchParams.set("mode", "driving");
      url.searchParams.set("departure_time", "now");
      url.searchParams.set("traffic_model", "best_guess");
      url.searchParams.set("units", "imperial");
      url.searchParams.set("key", key);

      try {
        const r = await fetch(url.toString(), { cache: "no-store" });
        const dm = (await r.json()) as {
          status?: string;
          rows?: { elements?: { status?: string; duration_in_traffic?: { value?: number }; duration?: { value?: number } }[] }[];
        };
        if (dm.status !== "OK" || !Array.isArray(dm.rows)) continue;
        for (let j = 0; j < batch.length; j++) {
          const zip5 = batch[j]!;
          const el = dm.rows[j]?.elements?.[0];
          if (!el || el.status !== "OK") continue;
          const sec = el.duration_in_traffic?.value ?? el.duration?.value;
          if (typeof sec !== "number" || !Number.isFinite(sec)) continue;
          out.set(zip5, Math.max(1, Math.round(sec / 60)));
        }
      } catch {
        /* fall through to per-zip haversine for this batch */
      }
    }
  }

  for (const zip5 of unique) {
    if (out.has(zip5)) continue;
    const est = haversineMinutesFromZipToDestination(zip5, dest);
    if (est != null) out.set(zip5, est);
  }

  return out;
}

export type ProfileWithZip = {
  id: string;
  zip_code: string | null;
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
  instagram?: string | null;
  tier_rank?: number | null;
};

export type ProximityPlayerRow = {
  id: string;
  display_name: string;
  username: string | null;
  instagram: string | null;
  tier_rank: number | null;
  distance_minutes: number | null;
};

function displayName(p: {
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
}): string {
  const n = `${String(p.first_name || "").trim()} ${String(p.last_name || "").trim()}`.trim();
  return n || String(p.username || "").trim() || "Player";
}

/**
 * All approved profiles with drive-time to `dest` from ZIP when available.
 * `distance_minutes` is null when ZIP is missing or distance cannot be estimated.
 */
export async function buildProximityInvitePlayerList(
  profiles: ProfileWithZip[],
  dest: VenueDestination,
): Promise<ProximityPlayerRow[]> {
  const zip5ByProfile = profiles.map((p) => ({ p, zip5: normalizeZip(p.zip_code) }));
  const zips = zip5ByProfile.map((r) => r.zip5).filter((z): z is string => !!z);
  const minutesByZip = await driveMinutesFromZipsToDestination(zips, dest);

  const rows: ProximityPlayerRow[] = [];
  for (const { p, zip5 } of zip5ByProfile) {
    const distance_minutes = zip5 ? (minutesByZip.get(zip5) ?? null) : null;
    rows.push({
      id: p.id,
      display_name: displayName(p),
      username: p.username ?? null,
      instagram: p.instagram ?? null,
      tier_rank: p.tier_rank ?? null,
      distance_minutes,
    });
  }

  rows.sort((a, b) => {
    const da = a.distance_minutes ?? Number.POSITIVE_INFINITY;
    const db = b.distance_minutes ?? Number.POSITIVE_INFINITY;
    return da - db;
  });
  return rows;
}

/** @internal exported for tests — state from ZIP without zipcodes package. */
export function zipStateForProximity(zip5: string): string | null {
  return stateFromUsZipFive(zip5);
}
