import { NORTHEAST_ZIP_CENTROIDS } from "./northeastZipCentroids";

const EARTH_RADIUS_KM = 6371;
const ROAD_FACTOR = 1.4;
const AVG_SPEED_KMH = 50;
/** Minutes threshold: drop venues at or above this unless every venue qualifies. */
const FAR_MINUTES = 45;

export type VenueDefinition = {
  venue: string;
  address: string;
  lat: number;
  lng: number;
};

/** Nine CT Pickup–relevant indoor / regional venues with coordinates. */
export const VENUES: readonly VenueDefinition[] = [
  {
    venue: "Sofive Meadowlands",
    address: "2 Palmer Terrace, Carlstadt, NJ 07072",
    lat: 40.8368,
    lng: -74.0735,
  },
  {
    venue: "Sofive Cherry Hill",
    address: "650 Kresson Rd, Cherry Hill, NJ 08034",
    lat: 39.9229,
    lng: -74.9996,
  },
  {
    venue: "Sofive Brooklyn",
    address: "2015 Pitkin Ave, Brooklyn, NY 11207",
    lat: 40.6648,
    lng: -73.8943,
  },
  {
    venue: "Hudson Sports Complex",
    address: "Warwick, NY",
    lat: 41.2584,
    lng: -74.3618,
  },
  {
    venue: "Sofive Rockville",
    address: "1008 Westmore Ave, Rockville, MD 20850",
    lat: 39.084,
    lng: -77.1528,
  },
  {
    venue: "SoccerDome Jessup",
    address: "7330 Montevideo Road, Jessup, MD 20794",
    lat: 39.1543,
    lng: -76.7766,
  },
  {
    venue: "SoccerDome Harmans",
    address: "7447 Shipley Avenue, Harmans, MD 21077",
    lat: 39.1654,
    lng: -76.7438,
  },
  {
    venue: "New Haven SoccerRoof",
    address: "1018 Sherman Ave, Hamden, CT",
    lat: 41.3367,
    lng: -72.9271,
  },
  {
    venue: "New Rochelle SoccerRoof",
    address: "29 LeCount Pl, New Rochelle, NY",
    lat: 40.9115,
    lng: -73.7824,
  },
];

/** Great-circle distance between two WGS84 points, in kilometers. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

function estimatedDriveMinutes(km: number): number {
  return Math.round((km * ROAD_FACTOR * 60) / AVG_SPEED_KMH);
}

/** Representative point when the zip is missing from the centroid table (NYC metro). */
const FALLBACK_ORIGIN: readonly [number, number] = [40.85, -73.95];

export function getNearestVenues(zipCode: string): { venue: string; address: string; estimatedMinutes: number }[] {
  const digits = zipCode.replace(/\D/g, "").slice(0, 5);
  if (digits.length !== 5) return [];

  const coord = NORTHEAST_ZIP_CENTROIDS[digits] ?? FALLBACK_ORIGIN;
  const [lat, lng] = coord;

  const rows = VENUES.map((v) => {
    const km = haversineKm(lat, lng, v.lat, v.lng);
    return {
      venue: v.venue,
      address: v.address,
      estimatedMinutes: estimatedDriveMinutes(km),
      km,
    };
  });

  rows.sort((a, b) => a.km - b.km);

  const allFar = rows.length > 0 && rows.every((r) => r.estimatedMinutes >= FAR_MINUTES);
  const picked = allFar ? rows : rows.filter((r) => r.estimatedMinutes < FAR_MINUTES);

  return picked.slice(0, 9).map(({ venue, address, estimatedMinutes }) => ({
    venue,
    address,
    estimatedMinutes,
  }));
}
