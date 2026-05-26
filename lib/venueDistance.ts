import { venueAddress } from "@/lib/pickup/venueServiceRegion";
import { stateFromUsZipFive } from "@/lib/usZipState";
import { normalizeUsZipDigits } from "@/lib/zipRegion";
import {
  defaultAdminVenueForServiceRegion,
  matchAdminVenueFromLocationText,
  serviceRegionForAdminVenueName,
} from "@/lib/venues/adminCtPickupVenues";
import { CT_PICKUP_VENUES } from "@/lib/venues/ctPickupVenues";
import zipcodes from "zipcodes";

export const PROXIMITY_INVITE_MAX_MINUTES = 60;

export type VenueDestination = {
  venue: string;
  address: string;
  lat: number;
  lng: number;
};

export function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
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
  return normalizeUsZipDigits(zip);
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
    return enrichVenueDestination({
      venue: fromVenueCol.name,
      address: fromVenueCol.address,
      lat: fromVenueCol.lat,
      lng: fromVenueCol.lng,
    });
  }

  const fromLoc = matchAdminVenueFromLocationText(args.locationPrivate);
  if (fromLoc) {
    return enrichVenueDestination({
      venue: fromLoc.name,
      address: fromLoc.address,
      lat: fromLoc.lat,
      lng: fromLoc.lng,
    });
  }

  const locText = args.locationPrivate != null ? String(args.locationPrivate).trim() : "";
  if (locText) {
    const first = locText.split(/\r?\n/)[0]?.trim() ?? "";
    const ct = first ? findCtPickupVenueByName(first) : null;
    if (ct) {
      const admin = matchAdminVenueFromLocationText(ct.venue);
      if (admin) {
        return enrichVenueDestination({
          venue: admin.name,
          address: admin.address,
          lat: admin.lat,
          lng: admin.lng,
        });
      }
    }
  }

  const fallback = defaultAdminVenueForServiceRegion(args.serviceRegion);
  if (fallback) {
    return enrichVenueDestination({
      venue: fallback.name,
      address: fallback.address,
      lat: fallback.lat,
      lng: fallback.lng,
    });
  }

  return null;
}

function haversineMinutesFromZipToDestination(zip5: string, dest: VenueDestination): number | null {
  const lat2 = dest.lat;
  const lng2 = dest.lng;
  if (!Number.isFinite(lat2) || !Number.isFinite(lng2)) return null;

  const loc = zipcodes.lookup(zip5) as { latitude?: number; longitude?: number } | undefined;
  const lat1 = loc?.latitude;
  const lng1 = loc?.longitude;
  if (!Number.isFinite(lat1) || !Number.isFinite(lng1)) return null;

  const mi = haversineMiles(lat1!, lng1!, lat2, lng2);
  return driveMinutesFromStraightLineMiles(mi);
}

/** Prefer canonical street address from `venueServiceRegion` when available. */
export function enrichVenueDestination(dest: VenueDestination): VenueDestination {
  const better = venueAddress(dest.venue);
  if (!better) return dest;
  return { ...dest, address: better };
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

export type DriveMinutesCache = Map<string, number>;

/** In-memory cache for ZIP → destination drive minutes within one server request. */
export function createDriveMinutesCache(): DriveMinutesCache {
  return new Map();
}

export function driveMinutesCacheKey(zip5: string, dest: VenueDestination): string {
  return `${zip5}|${dest.venue}|${dest.lat ?? ""}|${dest.lng ?? ""}|${dest.address}`;
}

/** Google Distance Matrix only (chunks of 25 origins). No haversine fallback. */
export async function googleDriveMinutesFromZipsToDestination(
  zips: string[],
  dest: VenueDestination,
  cache?: DriveMinutesCache,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const unique = Array.from(new Set(zips.map(normalizeZip).filter((z): z is string => !!z)));
  if (!unique.length) return out;

  const uncached: string[] = [];
  for (const zip5 of unique) {
    const hit = cache?.get(driveMinutesCacheKey(zip5, dest));
    if (hit != null) out.set(zip5, hit);
    else uncached.push(zip5);
  }

  if (!uncached.length) return out;

  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) return out;

  for (let i = 0; i < uncached.length; i += MATRIX_ORIGIN_BATCH) {
    const batch = uncached.slice(i, i + MATRIX_ORIGIN_BATCH);
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
        const minutes = Math.max(1, Math.round(sec / 60));
        out.set(zip5, minutes);
        cache?.set(driveMinutesCacheKey(zip5, dest), minutes);
      }
    } catch {
      /* skip batch */
    }
  }

  return out;
}

/** Batch many ZIPs → one destination via Distance Matrix (chunks of 25). */
export async function driveMinutesFromZipsToDestination(
  zips: string[],
  dest: VenueDestination,
  cache?: DriveMinutesCache,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const unique = Array.from(new Set(zips.map(normalizeZip).filter((z): z is string => !!z)));
  if (!unique.length) return out;

  const google = await googleDriveMinutesFromZipsToDestination(unique, dest, cache);
  for (const [zip5, minutes] of google) {
    out.set(zip5, minutes);
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
  cache?: DriveMinutesCache,
): Promise<ProximityPlayerRow[]> {
  const zip5ByProfile = profiles.map((p) => ({ p, zip5: normalizeZip(p.zip_code) }));
  const zips = zip5ByProfile.map((r) => r.zip5).filter((z): z is string => !!z);
  const minutesByZip = await driveMinutesFromZipsToDestination(zips, dest, cache);

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

/** @internal exported for tests — hub region code (CT, NY, …) from a 5-digit ZIP. */
export function zipStateForProximity(zip5: string): string | null {
  const code = stateFromUsZipFive(zip5);
  if (code === "CT" || code === "NY" || code === "NJ" || code === "MD") return code;
  return null;
}

/** Whether a player's ZIP falls in the same hub region as the venue (when drive time is unknown). */
export function zipMatchesVenueHubRegion(zip5: string, venueName: string): boolean {
  const zipRegion = zipStateForProximity(zip5);
  const venueRegion = serviceRegionForAdminVenueName(venueName);
  if (!zipRegion || !venueRegion) return false;
  return zipRegion === venueRegion;
}
