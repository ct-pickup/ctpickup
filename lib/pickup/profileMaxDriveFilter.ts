import { profileMatchesRunServiceRegion } from "@/lib/pickup/venueServiceRegion";
import {
  createDriveMinutesCache,
  googleDriveMinutesFromZipsToDestination,
  resolveDriveTimeDestination,
  type DriveMinutesCache,
  type VenueDestination,
} from "@/lib/venueDistance";

export { createDriveMinutesCache, type DriveMinutesCache };

export const DEFAULT_MAX_DRIVE_MINUTES = 50;
export const MIN_MAX_DRIVE_MINUTES = 30;
export const MAX_MAX_DRIVE_MINUTES = 90;

export function effectiveMaxDriveMinutes(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return DEFAULT_MAX_DRIVE_MINUTES;
  return Math.min(MAX_MAX_DRIVE_MINUTES, Math.max(MIN_MAX_DRIVE_MINUTES, Math.round(value)));
}

export type ProfileDriveProximityRow = {
  id: string;
  zip_code?: string | null;
  nearest_venue?: string | null;
  max_drive_minutes?: number | null;
};

export type RunLocationForProximity = {
  locationPrivate?: string | null;
  serviceRegion?: string | null;
  venue?: string | null;
  venueZipCode?: string | null;
};

function normalizeZip(zip: string | null | undefined): string | null {
  if (zip == null) return null;
  const digits = String(zip).replace(/\D/g, "").slice(0, 5);
  return digits.length === 5 ? digits : null;
}

function passesRegionFallback(
  profile: ProfileDriveProximityRow,
  serviceRegion: string | null | undefined,
): boolean {
  return profileMatchesRunServiceRegion(profile.nearest_venue, serviceRegion);
}

/**
 * Keep profiles within each player's `max_drive_minutes` of the run venue (Google Distance Matrix with traffic).
 * Falls back to `nearest_venue` service-region match when ZIP is missing or drive time cannot be estimated.
 */
export async function filterProfilesByMaxDriveTime<T extends ProfileDriveProximityRow>(
  profiles: T[],
  runLocation: RunLocationForProximity,
  cache?: DriveMinutesCache,
): Promise<T[]> {
  const serviceRegion = runLocation.serviceRegion;
  const dest: VenueDestination | null = resolveDriveTimeDestination({
    venueZipCode: runLocation.venueZipCode,
    locationPrivate: runLocation.locationPrivate,
    serviceRegion: runLocation.serviceRegion,
    venueName: runLocation.venue,
  });

  if (!dest) {
    return profiles.filter((p) => passesRegionFallback(p, serviceRegion));
  }

  const withZip: { profile: T; zip5: string }[] = [];
  const withoutZip: T[] = [];

  for (const profile of profiles) {
    const zip5 = normalizeZip(profile.zip_code);
    if (zip5) withZip.push({ profile, zip5 });
    else withoutZip.push(profile);
  }

  const minutesByZip = await googleDriveMinutesFromZipsToDestination(
    withZip.map((row) => row.zip5),
    dest,
    cache,
  );

  const kept: T[] = [];

  for (const { profile, zip5 } of withZip) {
    const maxMinutes = effectiveMaxDriveMinutes(profile.max_drive_minutes);
    const driveMinutes = minutesByZip.get(zip5);
    if (driveMinutes != null) {
      if (maxMinutes >= MAX_MAX_DRIVE_MINUTES || driveMinutes <= maxMinutes) kept.push(profile);
      continue;
    }
    if (passesRegionFallback(profile, serviceRegion)) kept.push(profile);
  }

  for (const profile of withoutZip) {
    if (passesRegionFallback(profile, serviceRegion)) kept.push(profile);
  }

  return kept;
}
