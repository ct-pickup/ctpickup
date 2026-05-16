/** Keep in sync with `lib/venues/adminCtPickupVenues.ts` (repo root). */

import type { ServiceRegionCode } from "@/lib/serviceRegions";

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
