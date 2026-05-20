/** Keep in sync with `lib/venues/adminCtPickupVenues.ts` (repo root). */

import { isServiceRegionCode, type ServiceRegionCode } from "@/lib/serviceRegions";

/** Sentinel value when admin picks a venue not in the preset list. */
export const CUSTOM_VENUE_OPTION = "Custom venue";

const STATE_NAME_TO_REGION: Record<string, ServiceRegionCode> = {
  connecticut: "CT",
  "new york": "NY",
  "new jersey": "NJ",
  maryland: "MD",
};

export type CtPickupVenueEntry = {
  name: string;
  region: ServiceRegionCode;
};

/** Canonical admin venue picker list (order preserved for UI). */
export const CT_PICKUP_VENUES: readonly CtPickupVenueEntry[] = [
  { name: "New Haven SoccerRoof", region: "CT" },
  { name: "Sofive Brooklyn", region: "NY" },
  { name: "Hudson Sports", region: "NY" },
  { name: "New Rochelle SoccerRoof", region: "NY" },
  { name: "Sofive Meadowlands 5v5", region: "NJ" },
  { name: "Sofive Meadowlands 7v7", region: "NJ" },
  { name: "Sofive Cherry Hill 5v5", region: "NJ" },
  { name: "Sofive Cherry Hill 7v7", region: "NJ" },
  { name: "Sofive Rockville", region: "MD" },
  { name: "SoccerDome Jessup", region: "MD" },
  { name: "SoccerDome Harmans", region: "MD" },
] as const;

export type AdminCtPickupVenue = {
  name: string;
  serviceRegion: ServiceRegionCode;
  locationPreset: string;
};

const LOCATION_PRESETS: Record<string, string> = {
  "New Haven SoccerRoof": `New Haven SoccerRoof
1018 Sherman Ave, Hamden, CT 06514

Parking
Parking lot directly outside the building on Sherman Ave (in front of the facility entrance).

Field Number
Leave blank.`,
  "Sofive Brooklyn": `Sofive Brooklyn
2015 Pitkin Ave, Brooklyn, NY 11207`,
  "Hudson Sports": `Hudson Sports
Warwick, NY`,
  "New Rochelle SoccerRoof": `New Rochelle SoccerRoof
29 LeCount Pl, 3rd Floor, New Rochelle, NY 10801

Parking
New Roc City Garage - parking garage attached to the New Roc City complex next to the facility.

Field Number
Leave blank.`,
  "Sofive Meadowlands 5v5": `Sofive Meadowlands 5v5
2 Palmer Terrace, Carlstadt, NJ 07072`,
  "Sofive Meadowlands 7v7": `Sofive Meadowlands 7v7
2 Palmer Terrace, Carlstadt, NJ 07072`,
  "Sofive Cherry Hill 5v5": `Sofive Cherry Hill 5v5
650 Kresson Rd, Cherry Hill, NJ 08034`,
  "Sofive Cherry Hill 7v7": `Sofive Cherry Hill 7v7
650 Kresson Rd, Cherry Hill, NJ 08034`,
  "Sofive Rockville": `Sofive Rockville
1008 Westmore Ave, Rockville, MD 20850`,
  "SoccerDome Jessup": `SoccerDome Jessup
7330 Montevideo Road, Jessup, MD 20794`,
  "SoccerDome Harmans": `SoccerDome Harmans
7447 Shipley Avenue, Harmans, MD 21077`,
};

export const ADMIN_CT_PICKUP_VENUES: readonly AdminCtPickupVenue[] = CT_PICKUP_VENUES.map((v) => ({
  name: v.name,
  serviceRegion: v.region,
  locationPreset: LOCATION_PRESETS[v.name] ?? v.name,
}));

export function serviceRegionForAdminVenueName(name: string | null | undefined): ServiceRegionCode | null {
  const key = name != null ? String(name).trim() : "";
  if (!key) return null;
  const hit = CT_PICKUP_VENUES.find((v) => v.name === key);
  return hit?.region ?? null;
}

export function adminVenueLocationPreset(name: string | null | undefined): string | null {
  const key = name != null ? String(name).trim() : "";
  if (!key) return null;
  const hit = ADMIN_CT_PICKUP_VENUES.find((v) => v.name === key);
  return hit?.locationPreset ?? null;
}

/** Infer NY / CT / NJ / MD from a free-form US address string. */
export function serviceRegionFromAddress(address: string | null | undefined): ServiceRegionCode | null {
  const raw = address != null ? String(address).trim() : "";
  if (!raw) return null;

  const uspsEnd = raw.match(/,\s*(CT|NY|NJ|MD)(?:\s+\d{5}(?:-\d{4})?)?\s*$/i);
  if (uspsEnd) {
    const code = uspsEnd[1].toUpperCase();
    return isServiceRegionCode(code) ? code : null;
  }

  const tail = raw.slice(Math.max(0, raw.length - 48));
  const tailMatch = tail.match(/,\s*(CT|NY|NJ|MD)\b/i) ?? tail.match(/\b(CT|NY|NJ|MD)\b/i);
  if (tailMatch) {
    const code = tailMatch[1].toUpperCase();
    return isServiceRegionCode(code) ? code : null;
  }

  const lower = raw.toLowerCase();
  for (const [name, code] of Object.entries(STATE_NAME_TO_REGION)) {
    if (lower.includes(name)) return code;
  }

  return null;
}

export function formatCustomVenueLocationPrivate(name: string, address: string): string {
  return `${name.trim()}\n${address.trim()}`;
}
