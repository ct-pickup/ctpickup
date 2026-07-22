/** Shared county ZIP ranges for the community map. Keep IDs in sync with mobile/app/community-map.tsx. */

export type CountyZipRange = { min: number; max: number };

export type CommunityCountyDef = {
  id: string;
  name: string;
  shortName: string;
  lat: number;
  lon: number;
  ranges: CountyZipRange[];
};

/**
 * Order matters when ranges overlap (e.g. Middlesex CT before New Haven;
 * Bronx before Manhattan; Westchester 107 before Rockland).
 */
export const COMMUNITY_COUNTIES: CommunityCountyDef[] = [
  {
    id: "ct-middlesex",
    name: "Middlesex County",
    shortName: "Middlesex",
    lat: 41.4537,
    lon: -72.5196,
    ranges: [{ min: 6400, max: 6459 }],
  },
  {
    id: "ct-fairfield",
    name: "Fairfield County",
    shortName: "Fairfield",
    lat: 41.1533,
    lon: -73.3832,
    ranges: [
      { min: 6800, max: 6899 },
      { min: 6900, max: 6999 },
    ],
  },
  {
    id: "ct-new-haven",
    name: "New Haven County",
    shortName: "New Haven",
    lat: 41.3082,
    lon: -72.9279,
    ranges: [{ min: 6400, max: 6599 }],
  },
  {
    id: "ct-hartford",
    name: "Hartford County",
    shortName: "Hartford",
    lat: 41.7637,
    lon: -72.6851,
    ranges: [{ min: 6000, max: 6199 }],
  },
  {
    id: "ct-litchfield",
    name: "Litchfield County",
    shortName: "Litchfield",
    lat: 41.7459,
    lon: -73.2373,
    ranges: [{ min: 6700, max: 6799 }],
  },
  {
    id: "ct-tolland-windham",
    name: "Tolland / Windham County",
    shortName: "Tolland",
    lat: 41.8637,
    lon: -72.2001,
    ranges: [{ min: 6200, max: 6399 }],
  },
  {
    id: "ny-bronx",
    name: "Bronx",
    shortName: "Bronx",
    lat: 40.8448,
    lon: -73.8648,
    ranges: [{ min: 10400, max: 10499 }],
  },
  {
    id: "ny-manhattan",
    name: "Manhattan / NYC",
    shortName: "Manhattan",
    lat: 40.7831,
    lon: -73.9712,
    ranges: [{ min: 10000, max: 10499 }],
  },
  {
    id: "ny-westchester",
    name: "Westchester County",
    shortName: "Westchester",
    lat: 41.122,
    lon: -73.7949,
    ranges: [
      { min: 10500, max: 10599 },
      { min: 10700, max: 10799 },
      { min: 10800, max: 10899 },
    ],
  },
  {
    id: "ny-brooklyn-queens",
    name: "Brooklyn / Queens",
    shortName: "Brooklyn",
    lat: 40.6501,
    lon: -73.9496,
    ranges: [
      { min: 11200, max: 11299 },
      { min: 11300, max: 11399 },
      { min: 11400, max: 11499 },
    ],
  },
  {
    id: "ny-nassau",
    name: "Long Island — Nassau",
    shortName: "Nassau",
    lat: 40.7282,
    lon: -73.5673,
    ranges: [{ min: 11500, max: 11599 }],
  },
  {
    id: "ny-suffolk",
    name: "Long Island — Suffolk",
    shortName: "Suffolk",
    lat: 40.9849,
    lon: -72.8674,
    ranges: [{ min: 11700, max: 11999 }],
  },
  {
    id: "ny-rockland-orange",
    name: "Rockland / Orange County",
    shortName: "Rockland",
    lat: 41.2809,
    lon: -74.0121,
    ranges: [
      { min: 10900, max: 10999 },
      { min: 10700, max: 10799 },
    ],
  },
  {
    id: "nj-bergen",
    name: "Bergen County",
    shortName: "Bergen",
    lat: 40.9584,
    lon: -74.0735,
    ranges: [
      { min: 7400, max: 7499 },
      { min: 7600, max: 7699 },
    ],
  },
  {
    id: "nj-essex-hudson",
    name: "Essex / Hudson County",
    shortName: "Essex",
    lat: 40.7357,
    lon: -74.1724,
    ranges: [
      { min: 7000, max: 7099 },
      { min: 7100, max: 7199 },
      { min: 7200, max: 7299 },
    ],
  },
  {
    id: "nj-middlesex-union",
    name: "Middlesex / Union County",
    shortName: "Middlesex NJ",
    lat: 40.5018,
    lon: -74.2643,
    ranges: [
      { min: 7000, max: 7099 },
      { min: 8800, max: 8899 },
      { min: 8900, max: 8999 },
    ],
  },
  {
    id: "nj-monmouth-ocean",
    name: "Monmouth / Ocean County",
    shortName: "Monmouth",
    lat: 40.2171,
    lon: -74.006,
    ranges: [
      { min: 7700, max: 7799 },
      { min: 7800, max: 7899 },
    ],
  },
  {
    id: "md-montgomery",
    name: "Montgomery County",
    shortName: "Montgomery",
    lat: 39.084,
    lon: -77.1528,
    ranges: [{ min: 20800, max: 20899 }],
  },
  {
    id: "md-baltimore",
    name: "Baltimore County / City",
    shortName: "Baltimore",
    lat: 39.2904,
    lon: -76.6122,
    ranges: [{ min: 21200, max: 21299 }],
  },
  {
    id: "md-prince-georges",
    name: "Prince George's County",
    shortName: "Pr. George's",
    lat: 38.8951,
    lon: -76.8722,
    ranges: [{ min: 20700, max: 20799 }],
  },
  {
    id: "md-anne-arundel",
    name: "Anne Arundel County",
    shortName: "Anne Arundel",
    lat: 38.9784,
    lon: -76.4922,
    ranges: [{ min: 21400, max: 21499 }],
  },
];

export const COMMUNITY_COUNTY_BY_ID = Object.fromEntries(
  COMMUNITY_COUNTIES.map((c) => [c.id, c]),
) as Record<string, CommunityCountyDef>;

export function normalizeUsZipFive(zip: string | null | undefined): string | null {
  if (zip == null) return null;
  const digits = String(zip).replace(/\D/g, "");
  if (!digits) return null;
  const padded = digits.length <= 5 ? digits.padStart(5, "0") : digits.slice(0, 5);
  return /^\d{5}$/.test(padded) ? padded : null;
}

export function zipMatchesCountyRanges(
  zip: string | null | undefined,
  ranges: CountyZipRange[],
): boolean {
  const clean = normalizeUsZipFive(zip);
  if (!clean) return false;
  const n = Number.parseInt(clean, 10);
  if (!Number.isFinite(n)) return false;
  return ranges.some((r) => n >= r.min && n <= r.max);
}

export function countyForZip(zip: string | null | undefined): CommunityCountyDef | null {
  const clean = normalizeUsZipFive(zip);
  if (!clean) return null;
  const n = Number.parseInt(clean, 10);
  if (!Number.isFinite(n)) return null;
  for (const county of COMMUNITY_COUNTIES) {
    for (const r of county.ranges) {
      if (n >= r.min && n <= r.max) return county;
    }
  }
  return null;
}
