import { haversineMiles, resolveDriveTimeDestination } from "@/lib/venueDistance";
import zipcodes from "zipcodes";

/** Straight-line miles from a 5-digit US ZIP to a run venue (null when unknown). */
export function milesFromZipToRunLocation(
  zip: string | null | undefined,
  locationPrivate: string | null | undefined,
  serviceRegion: string | null | undefined,
  venueZipCode?: string | null | undefined,
): number | null {
  const digits = zip != null ? String(zip).replace(/\D/g, "").slice(0, 5) : "";
  if (digits.length !== 5) return null;

  const dest = resolveDriveTimeDestination({
    venueZipCode,
    locationPrivate,
    serviceRegion,
  });
  if (!dest || !Number.isFinite(dest.lat) || !Number.isFinite(dest.lng)) return null;

  const loc = zipcodes.lookup(digits) as { latitude?: number; longitude?: number } | undefined;
  const lat1 = loc?.latitude;
  const lng1 = loc?.longitude;
  if (!Number.isFinite(lat1) || !Number.isFinite(lng1)) return null;

  const mi = haversineMiles(lat1!, lng1!, dest.lat, dest.lng);
  return Number.isFinite(mi) ? Math.round(mi * 10) / 10 : null;
}
