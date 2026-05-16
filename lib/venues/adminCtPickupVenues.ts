/** Admin create-run / tournament venue picker list (display names + hub region). */

export type AdminCtPickupVenue = {
  name: string;
  serviceRegion: "CT" | "NY" | "NJ" | "MD";
  address: string;
  lat: number;
  lng: number;
  /** Staff location block (first line = venue name). */
  locationPreset: string;
};

export const ADMIN_CT_PICKUP_VENUES: readonly AdminCtPickupVenue[] = [
  {
    name: "New Haven SoccerRoof",
    serviceRegion: "CT",
    address: "1018 Sherman Ave, Hamden, CT 06514",
    lat: 41.3839,
    lng: -72.9028,
    locationPreset: `New Haven SoccerRoof
1018 Sherman Ave, Hamden, CT 06514

Parking
Parking lot directly outside the building on Sherman Ave (in front of the facility entrance).

Field Number
Leave blank.`,
  },
  {
    name: "Sofive Brooklyn",
    serviceRegion: "NY",
    address: "2015 Pitkin Ave, Brooklyn, NY 11207",
    lat: 40.6747,
    lng: -73.8948,
    locationPreset: `Sofive Brooklyn
2015 Pitkin Ave, Brooklyn, NY 11207`,
  },
  {
    name: "Hudson Sports",
    serviceRegion: "NY",
    address: "Warwick, NY",
    lat: 41.2565,
    lng: -74.3596,
    locationPreset: `Hudson Sports
Warwick, NY`,
  },
  {
    name: "New Rochelle SoccerRoof",
    serviceRegion: "NY",
    address: "29 LeCount Pl, New Rochelle, NY 10801",
    lat: 40.9115,
    lng: -73.7824,
    locationPreset: `New Rochelle SoccerRoof
29 LeCount Pl, 3rd Floor, New Rochelle, NY 10801

Parking
New Roc City Garage - parking garage attached to the New Roc City complex next to the facility.

Field Number
Leave blank.`,
  },
  {
    name: "Sofive Meadowlands 5v5",
    serviceRegion: "NJ",
    address: "2 Palmer Terrace, Carlstadt, NJ 07072",
    lat: 40.8419,
    lng: -74.0835,
    locationPreset: `Sofive Meadowlands 5v5
2 Palmer Terrace, Carlstadt, NJ 07072`,
  },
  {
    name: "Sofive Meadowlands 7v7",
    serviceRegion: "NJ",
    address: "2 Palmer Terrace, Carlstadt, NJ 07072",
    lat: 40.8419,
    lng: -74.0835,
    locationPreset: `Sofive Meadowlands 7v7
2 Palmer Terrace, Carlstadt, NJ 07072`,
  },
  {
    name: "Sofive Cherry Hill 5v5",
    serviceRegion: "NJ",
    address: "650 Kresson Rd, Cherry Hill, NJ 08034",
    lat: 39.9047,
    lng: -74.9547,
    locationPreset: `Sofive Cherry Hill 5v5
650 Kresson Rd, Cherry Hill, NJ 08034`,
  },
  {
    name: "Sofive Cherry Hill 7v7",
    serviceRegion: "NJ",
    address: "650 Kresson Rd, Cherry Hill, NJ 08034",
    lat: 39.9047,
    lng: -74.9547,
    locationPreset: `Sofive Cherry Hill 7v7
650 Kresson Rd, Cherry Hill, NJ 08034`,
  },
  {
    name: "Sofive Rockville",
    serviceRegion: "MD",
    address: "1008 Westmore Ave, Rockville, MD 20850",
    lat: 39.084,
    lng: -77.1528,
    locationPreset: `Sofive Rockville
1008 Westmore Ave, Rockville, MD 20850`,
  },
  {
    name: "SoccerDome Jessup",
    serviceRegion: "MD",
    address: "7330 Montevideo Road, Jessup, MD 20794",
    lat: 39.1499,
    lng: -76.7927,
    locationPreset: `SoccerDome Jessup
7330 Montevideo Road, Jessup, MD 20794`,
  },
  {
    name: "SoccerDome Harmans",
    serviceRegion: "MD",
    address: "7447 Shipley Avenue, Harmans, MD 21077",
    lat: 39.1619,
    lng: -76.6978,
    locationPreset: `SoccerDome Harmans
7447 Shipley Avenue, Harmans, MD 21077`,
  },
] as const;

export const ADMIN_CT_PICKUP_VENUE_NAMES = ADMIN_CT_PICKUP_VENUES.map((v) => v.name);

const NAME_TO_VENUE = new Map(ADMIN_CT_PICKUP_VENUES.map((v) => [v.name.toLowerCase(), v]));

/** Aliases for matching run location text or legacy names. */
const ALIASES: Record<string, string> = {
  "new rochelle": "New Rochelle SoccerRoof",
  "hudson sports complex": "Hudson Sports",
  "sofive meadowlands": "Sofive Meadowlands 5v5",
  "sofive cherry hill": "Sofive Cherry Hill 5v5",
};

export function findAdminVenueByName(name: string | null | undefined): AdminCtPickupVenue | null {
  if (name == null) return null;
  const key = String(name).trim().toLowerCase();
  if (!key) return null;
  const alias = ALIASES[key];
  if (alias) return NAME_TO_VENUE.get(alias.toLowerCase()) ?? null;
  return NAME_TO_VENUE.get(key) ?? null;
}

/** Match venue from staff location block (first line) or fuzzy contains. */
export function matchAdminVenueFromLocationText(text: string | null | undefined): AdminCtPickupVenue | null {
  if (text == null) return null;
  const raw = String(text).trim();
  if (!raw) return null;
  const firstLine = raw.split(/\r?\n/)[0]?.trim() ?? "";
  const byLine = findAdminVenueByName(firstLine);
  if (byLine) return byLine;
  const lower = raw.toLowerCase();
  for (const v of ADMIN_CT_PICKUP_VENUES) {
    if (lower.includes(v.name.toLowerCase())) return v;
  }
  for (const [alias, canonical] of Object.entries(ALIASES)) {
    if (lower.includes(alias)) return findAdminVenueByName(canonical);
  }
  return null;
}

export function serviceRegionForAdminVenueName(name: string | null | undefined): "CT" | "NY" | "NJ" | "MD" | null {
  const v = findAdminVenueByName(name);
  return v?.serviceRegion ?? null;
}

/** When run has region but no recognizable venue in location text. */
export function defaultAdminVenueForServiceRegion(region: string | null | undefined): AdminCtPickupVenue | null {
  const r = region != null ? String(region).trim().toUpperCase() : "";
  if (!r) return null;
  const matches = ADMIN_CT_PICKUP_VENUES.filter((v) => v.serviceRegion === r);
  return matches[0] ?? null;
}
