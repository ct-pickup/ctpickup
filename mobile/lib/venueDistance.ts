import * as zipcodes from "zipcodes";

import { siteOrigin } from "@/lib/env";

export type VenueDistanceRow = {
  venue: string;
  address: string;
  estimatedMinutes: number;
};

type DistancesApiOk = { venues: VenueDistanceRow[] };

const FAR_MINUTES = 45;

/** Venue coordinates for straight-line fallback when `/api/venue/distances` fails. */
const CT_PICKUP_VENUE_COORDS: readonly { venue: string; address: string; lat: number; lng: number }[] = [
  // NJ
  { venue: "Sofive Meadowlands", address: "2 Palmer Terrace, Carlstadt, NJ 07072", lat: 40.8419, lng: -74.0835 },
  { venue: "Sofive Cherry Hill", address: "650 Kresson Rd, Cherry Hill, NJ 08034", lat: 39.9047, lng: -74.9547 },
  // NY
  { venue: "Sofive Brooklyn", address: "2015 Pitkin Ave, Brooklyn, NY 11207", lat: 40.6747, lng: -73.8948 },
  { venue: "Hudson Sports Complex", address: "Warwick, NY", lat: 41.2565, lng: -74.3596 },
  { venue: "New Rochelle SoccerRoof", address: "29 LeCount Pl, New Rochelle, NY", lat: 40.9115, lng: -73.7824 },
  // MD
  { venue: "Sofive Rockville", address: "1008 Westmore Ave, Rockville, MD 20850", lat: 39.084, lng: -77.1528 },
  { venue: "SoccerDome Jessup", address: "7330 Montevideo Road, Jessup, MD 20794", lat: 39.1499, lng: -76.7927 },
  { venue: "SoccerDome Harmans", address: "7447 Shipley Avenue, Harmans, MD 21077", lat: 39.1619, lng: -76.6978 },
  // CT
  { venue: "New Haven SoccerRoof", address: "1018 Sherman Ave, Hamden, CT", lat: 41.3839, lng: -72.9028 },
];

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

/** Rough drive minutes from crow-flies miles (fallback only). */
function driveMinutesFromStraightLineMiles(mi: number): number {
  const roadFactor = 1.28;
  const mph = 42;
  return Math.max(1, Math.round(((mi * roadFactor) / mph) * 60));
}

function filterAndSortVenues(rows: VenueDistanceRow[]): VenueDistanceRow[] {
  const sorted = [...rows].sort((a, b) => a.estimatedMinutes - b.estimatedMinutes);
  const allFar = sorted.length > 0 && sorted.every((r) => r.estimatedMinutes >= FAR_MINUTES);
  return allFar ? sorted : sorted.filter((r) => r.estimatedMinutes < FAR_MINUTES);
}

export async function getNearestVenuesFromApi(
  zipCode: string,
  siteUrl: string,
  token?: string | null,
  departureTime?: number,
): Promise<VenueDistanceRow[]> {
  const digits = zipCode.replace(/\D/g, "").slice(0, 5);
  if (digits.length !== 5) return [];

  const origin = siteUrl.replace(/\/$/, "");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const t = token?.trim();
  if (t) headers.Authorization = `Bearer ${t}`;

  const payload: { zip_code: string; departure_time?: number } = { zip_code: digits };
  if (departureTime !== undefined && Number.isFinite(departureTime)) {
    payload.departure_time = Math.floor(departureTime);
  }

  try {
    const r = await fetch(`${origin}/api/venue/distances`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const json = (await r.json().catch(() => null)) as unknown;
    if (!r.ok || json === null || typeof json !== "object") return [];
    const venues = (json as DistancesApiOk).venues;
    if (!Array.isArray(venues)) return [];
    return venues.filter(
      (row): row is VenueDistanceRow =>
        row != null &&
        typeof row === "object" &&
        typeof (row as VenueDistanceRow).venue === "string" &&
        typeof (row as VenueDistanceRow).address === "string" &&
        typeof (row as VenueDistanceRow).estimatedMinutes === "number",
    );
  } catch {
    return [];
  }
}

/**
 * Client-side fallback: haversine from ZIP centroid to each venue, rough drive time.
 * Same 45-minute filter rule as the server when any venue is under 45 minutes.
 */
export function getNearestVenues(zipCode: string): VenueDistanceRow[] {
  const digits = zipCode.replace(/\D/g, "").slice(0, 5);
  if (digits.length !== 5) return [];

  const loc = zipcodes.lookup(digits);
  if (!loc) return [];
  const lat = loc.latitude;
  const lng = loc.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];

  const rows: VenueDistanceRow[] = CT_PICKUP_VENUE_COORDS.map((v) => {
    const mi = haversineMiles(lat, lng, v.lat, v.lng);
    return {
      venue: v.venue,
      address: v.address,
      estimatedMinutes: driveMinutesFromStraightLineMiles(mi),
    };
  });

  return filterAndSortVenues(rows);
}

async function resolveNearestVenues(zipDigits: string, accessToken?: string | null): Promise<VenueDistanceRow[]> {
  const origin = siteOrigin();
  if (origin) {
    const apiRows = await getNearestVenuesFromApi(zipDigits, origin, accessToken);
    if (apiRows.length > 0) return apiRows;
  }
  return getNearestVenues(zipDigits);
}

/** Closest venue display name for a 5-digit US ZIP, or null when unknown / no rows. */
export async function nearestVenueNameFromZip(zipCode: string, accessToken?: string | null): Promise<string | null> {
  const digits = zipCode.replace(/\D/g, "").slice(0, 5);
  if (digits.length !== 5) return null;
  const rows = await resolveNearestVenues(digits, accessToken);
  return rows[0]?.venue ?? null;
}
