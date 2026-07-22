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
 * Order matters when ranges overlap — list specific cities before state catch-alls.
 * ZIP coverage: CT 060xx–069xx, NJ 070xx–089xx, NY 100xx–149xx, MD 206xx–219xx.
 * Numeric ranges drop leading zeros (e.g. 07072 → 7072).
 */
export const COMMUNITY_COUNTIES: CommunityCountyDef[] = [
  // ── Connecticut (060xx–069xx) ──────────────────────────────────────────────
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
    id: "ct-other",
    name: "Connecticut",
    shortName: "CT",
    lat: 41.6032,
    lon: -73.0877,
    ranges: [{ min: 6000, max: 6999 }],
  },

  // ── New York (100xx–149xx) ─────────────────────────────────────────────────
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
    name: "Manhattan",
    shortName: "Manhattan",
    lat: 40.7831,
    lon: -73.9712,
    ranges: [
      { min: 10000, max: 10299 },
      { min: 10300, max: 10399 },
    ],
  },
  {
    id: "ny-brooklyn",
    name: "Brooklyn",
    shortName: "Brooklyn",
    lat: 40.6782,
    lon: -73.9442,
    ranges: [{ min: 11200, max: 11299 }],
  },
  {
    id: "ny-queens",
    name: "Queens",
    shortName: "Queens",
    lat: 40.7282,
    lon: -73.7949,
    ranges: [
      { min: 11000, max: 11199 },
      { min: 11300, max: 11499 },
      { min: 11600, max: 11699 },
    ],
  },
  {
    id: "ny-westchester",
    name: "Westchester",
    shortName: "Westchester",
    lat: 41.122,
    lon: -73.7949,
    ranges: [
      { min: 10500, max: 10699 },
      { min: 10700, max: 10899 },
    ],
  },
  {
    id: "ny-rockland-orange",
    name: "Rockland / Orange",
    shortName: "Rockland",
    lat: 41.2809,
    lon: -74.0121,
    ranges: [{ min: 10900, max: 10999 }],
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
    id: "ny-other",
    name: "New York",
    shortName: "NY",
    lat: 41.7003,
    lon: -73.9209,
    ranges: [{ min: 10000, max: 14999 }],
  },

  // ── New Jersey (070xx–089xx) ───────────────────────────────────────────────
  {
    id: "nj-meadowlands",
    name: "Meadowlands",
    shortName: "Meadowlands",
    lat: 40.8123,
    lon: -74.0765,
    ranges: [
      { min: 7071, max: 7073 },
      { min: 7094, max: 7094 },
      { min: 7031, max: 7032 },
    ],
  },
  {
    id: "nj-newark",
    name: "Newark",
    shortName: "Newark",
    lat: 40.7357,
    lon: -74.1724,
    ranges: [{ min: 7100, max: 7199 }],
  },
  {
    id: "nj-jersey-city",
    name: "Jersey City",
    shortName: "Jersey City",
    lat: 40.7178,
    lon: -74.0431,
    ranges: [{ min: 7300, max: 7399 }],
  },
  {
    id: "nj-princeton",
    name: "Princeton",
    shortName: "Princeton",
    lat: 40.3573,
    lon: -74.6672,
    ranges: [
      { min: 8540, max: 8544 },
      { min: 8536, max: 8536 },
      { min: 8500, max: 8599 },
    ],
  },
  {
    id: "nj-cherry-hill",
    name: "Cherry Hill",
    shortName: "Cherry Hill",
    lat: 39.9376,
    lon: -75.0296,
    ranges: [
      { min: 8002, max: 8003 },
      { min: 8034, max: 8034 },
      { min: 8000, max: 8499 },
    ],
  },
  {
    id: "nj-north",
    name: "North Jersey",
    shortName: "N. Jersey",
    lat: 40.9,
    lon: -74.15,
    ranges: [
      { min: 7000, max: 7099 },
      { min: 7200, max: 7299 },
      { min: 7400, max: 7999 },
    ],
  },
  {
    id: "nj-other",
    name: "New Jersey",
    shortName: "NJ",
    lat: 40.0583,
    lon: -74.4057,
    ranges: [{ min: 7000, max: 8999 }],
  },

  // ── Maryland (206xx–219xx) ─────────────────────────────────────────────────
  {
    id: "md-bethesda",
    name: "Bethesda",
    shortName: "Bethesda",
    lat: 38.9896,
    lon: -77.0989,
    ranges: [{ min: 20814, max: 20817 }],
  },
  {
    id: "md-rockville",
    name: "Rockville",
    shortName: "Rockville",
    lat: 39.084,
    lon: -77.1528,
    ranges: [
      { min: 20850, max: 20857 },
      { min: 20847, max: 20849 },
      { min: 20800, max: 20899 },
    ],
  },
  {
    id: "md-silver-spring",
    name: "Silver Spring",
    shortName: "Silver Sp.",
    lat: 39.0034,
    lon: -77.0199,
    ranges: [{ min: 20900, max: 20999 }],
  },
  {
    id: "md-annapolis",
    name: "Annapolis",
    shortName: "Annapolis",
    lat: 38.9784,
    lon: -76.4922,
    ranges: [{ min: 21400, max: 21499 }],
  },
  {
    id: "md-baltimore",
    name: "Baltimore",
    shortName: "Baltimore",
    lat: 39.2904,
    lon: -76.6122,
    ranges: [
      { min: 21200, max: 21299 },
      { min: 21000, max: 21199 },
      { min: 21300, max: 21399 },
    ],
  },
  {
    id: "md-other",
    name: "Maryland",
    shortName: "MD",
    lat: 39.0458,
    lon: -76.6413,
    ranges: [{ min: 20600, max: 21999 }],
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
