/** Maps `profiles.nearest_venue` (venue display names) to pickup hub region codes. */

const VENUE_TO_SERVICE_REGION: Record<string, string> = {
  // NJ
  "Sofive Meadowlands": "NJ",
  "Sofive Cherry Hill": "NJ",
  // NY
  "Sofive Brooklyn": "NY",
  "Hudson Sports Complex": "NY",
  "Hudson Sports": "NY",
  "New Rochelle SoccerRoof": "NY",
  // MD
  "Sofive Rockville": "MD",
  "SoccerDome Jessup": "MD",
  "SoccerDome Harmans": "MD",
  // CT
  "New Haven SoccerRoof": "CT",
};

/**
 * Returns the hub region code for a stored nearest-venue name, or null if unknown.
 */
export function serviceRegionForVenueName(name: string | null | undefined): string | null {
  if (name == null) return null;
  const key = String(name).trim();
  if (!key) return null;
  return VENUE_TO_SERVICE_REGION[key] ?? null;
}

/** Venue display names whose mapped hub region equals `region` (e.g. CT, NY). */
export function venueNamesForServiceRegion(region: string | null | undefined): string[] {
  if (region == null) return [];
  const r = String(region).trim().toUpperCase();
  if (!r) return [];
  return Object.entries(VENUE_TO_SERVICE_REGION)
    .filter(([, v]) => v === r)
    .map(([k]) => k);
}

/**
 * Whether a profile may participate in notifications / tier gates for a run with `service_region`.
 * - Runs with no `service_region` impose no venue-based restriction.
 * - Profiles with no `nearest_venue` are always allowed (fallback).
 * - Known venues must match the run region; unknown venue strings are treated like no venue (fallback).
 */
export function profileMatchesRunServiceRegion(
  nearestVenue: string | null | undefined,
  serviceRegion: string | null | undefined,
): boolean {
  const region = serviceRegion != null ? String(serviceRegion).trim().toUpperCase() : "";
  if (!region) return true;

  const nv = nearestVenue != null ? String(nearestVenue).trim() : "";
  if (!nv) return true;

  const mapped = serviceRegionForVenueName(nv);
  if (!mapped) return true;

  return mapped === region;
}
