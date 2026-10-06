import { goBack } from "@/lib/goBack";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import MapView, { Marker, type Region } from "react-native-maps";
import Svg, { Circle } from "react-native-svg";
import { Stack, useRouter } from "expo-router";
import { fmtPickupWhenEt, runTimeTbd } from "@/lib/pickup/runStartAtDisplay";
import { withRunTimeTbd } from "@/lib/pickup/runTimeTbd";
import * as Location from "expo-location";
import { requestLocationWithExplainer } from "@/lib/locationPrompt";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useAuth } from "@/context/AuthContext";
import { siteOrigin } from "@/lib/env";
import { fetchPlayerCards, type PlayerCard } from "@/lib/starRatings";
import { StarRating } from "@/components/StarRating";

import { PhotoHeader, useFieldPhotos } from "@/components/photo";
import { headline, radius, themeColor, themeNow, useThemedStyles } from "@/theme";
// ─── design tokens ──────────────────────────────────────────────────────────

/** Northeast service area: CT, NY, NJ, and MD. */
const SERVICE_REGION: Region = {
  latitude: 39.5,
  longitude: -75.5,
  latitudeDelta: 8.0,
  longitudeDelta: 8.0,
};

/** Wider framing when members exist outside the Northeast corridor. */
const WIDE_REGION: Region = {
  latitude: 39.5,
  longitude: -95.0,
  latitudeDelta: 25.0,
  longitudeDelta: 25.0,
};

const NE_COUNTY_PREFIXES = ["ct-", "ny-", "nj-", "md-"] as const;

function isNortheastCountyId(id: string): boolean {
  return NE_COUNTY_PREFIXES.some((p) => id.startsWith(p));
}

/** Show every non-empty cluster so circle counts sum to all grouped members. */
const MIN_MEMBERS_FOR_CIRCLE = 1;

// ─── region definitions (ZIP ranges → fixed centroids) ───────────────────────

type CountyDef = {
  id: string;
  name: string;
  /** Short label for the circle (fits at 9px). */
  shortName: string;
  lat: number;
  lon: number;
  /** Inclusive ZIP ranges. More-specific ranges must be listed first in COUNTY_DEFS. */
  ranges: Array<{ min: number; max: number }>;
};

/**
 * Order matters when ranges overlap — list specific cities before state catch-alls.
 * ZIP coverage: CT / NJ / NY / MD plus MA, PA, FL, CA, VA, SC, AZ, CO, ME hubs.
 * Numeric ranges drop leading zeros (e.g. 07072 → 7072).
 */
const COUNTY_DEFS: CountyDef[] = [
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

  // ── New York (100xx–149xx) — cities first, then LI / catch-all ─────────────
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
      { min: 10300, max: 10399 }, // Staten Island → Manhattan hub
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
      { min: 7071, max: 7073 }, // Lyndhurst / Carlstadt / E. Rutherford
      { min: 7094, max: 7094 }, // Secaucus
      { min: 7031, max: 7032 }, // Kearny / E. Rutherford corridor
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
      { min: 8000, max: 8499 }, // South / Central Jersey catch → Cherry Hill
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
      { min: 20800, max: 20899 }, // remaining Montgomery → Rockville
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

  // ── Massachusetts (010xx–027xx) ────────────────────────────────────────────
  {
    id: "ma-boston",
    name: "Boston",
    shortName: "Boston",
    lat: 42.3601,
    lon: -71.0589,
    ranges: [
      { min: 2100, max: 2299 },
      { min: 2400, max: 2499 },
    ],
  },
  {
    id: "ma-western",
    name: "Western MA",
    shortName: "W. MA",
    lat: 42.1015,
    lon: -72.5898,
    ranges: [{ min: 1000, max: 1099 }],
  },
  {
    id: "ma-other",
    name: "Massachusetts",
    shortName: "MA",
    lat: 42.2373,
    lon: -71.5314,
    ranges: [{ min: 1000, max: 2799 }],
  },

  // ── Virginia (22xxx–23xxx) ─────────────────────────────────────────────────
  {
    id: "va-northern",
    name: "Northern Virginia",
    shortName: "NoVA",
    lat: 38.8816,
    lon: -77.091,
    ranges: [{ min: 22100, max: 22299 }],
  },
  {
    id: "va-richmond",
    name: "Richmond",
    shortName: "Richmond",
    lat: 37.5407,
    lon: -77.436,
    ranges: [{ min: 23200, max: 23299 }],
  },
  {
    id: "va-other",
    name: "Virginia",
    shortName: "VA",
    lat: 37.4316,
    lon: -78.6569,
    ranges: [
      { min: 22000, max: 22999 },
      { min: 23000, max: 23999 },
    ],
  },

  // ── Pennsylvania (150xx–196xx) ──────────────────────────────────────────────
  {
    id: "pa-philadelphia",
    name: "Philadelphia",
    shortName: "Philly",
    lat: 39.9526,
    lon: -75.1652,
    ranges: [{ min: 19100, max: 19199 }],
  },
  {
    id: "pa-pittsburgh",
    name: "Pittsburgh",
    shortName: "Pittsburgh",
    lat: 40.4406,
    lon: -79.9959,
    ranges: [{ min: 15200, max: 15299 }],
  },
  {
    id: "pa-other",
    name: "Pennsylvania",
    shortName: "PA",
    lat: 40.9698,
    lon: -77.7278,
    ranges: [{ min: 15000, max: 19699 }],
  },

  // ── Florida (320xx–349xx) ──────────────────────────────────────────────────
  {
    id: "fl-miami",
    name: "Miami",
    shortName: "Miami",
    lat: 25.7617,
    lon: -80.1918,
    ranges: [{ min: 33100, max: 33199 }],
  },
  {
    id: "fl-orlando",
    name: "Orlando",
    shortName: "Orlando",
    lat: 28.5383,
    lon: -81.3792,
    ranges: [{ min: 32800, max: 32899 }],
  },
  {
    id: "fl-other",
    name: "Florida",
    shortName: "FL",
    lat: 27.6648,
    lon: -81.5158,
    ranges: [{ min: 32000, max: 34999 }],
  },

  // ── California (900xx–961xx) ───────────────────────────────────────────────
  {
    id: "ca-los-angeles",
    name: "Los Angeles",
    shortName: "LA",
    lat: 34.0522,
    lon: -118.2437,
    ranges: [{ min: 90000, max: 90099 }],
  },
  {
    id: "ca-orange",
    name: "Orange County",
    shortName: "OC",
    lat: 33.6695,
    lon: -117.823,
    ranges: [{ min: 92600, max: 92699 }],
  },
  {
    id: "ca-other",
    name: "California",
    shortName: "CA",
    lat: 36.7783,
    lon: -119.4179,
    ranges: [{ min: 90000, max: 96199 }],
  },

  // ── South Carolina (29xxx) ─────────────────────────────────────────────────
  {
    id: "sc-columbia",
    name: "Columbia",
    shortName: "Columbia",
    lat: 33.9999,
    lon: -81.0456,
    ranges: [{ min: 29200, max: 29299 }],
  },

  // ── Arizona (85xxx) ────────────────────────────────────────────────────────
  {
    id: "az-phoenix",
    name: "Phoenix",
    shortName: "Phoenix",
    lat: 33.4484,
    lon: -112.074,
    ranges: [{ min: 85000, max: 85099 }],
  },

  // ── Colorado (80xxx) ───────────────────────────────────────────────────────
  {
    id: "co-denver",
    name: "Denver",
    shortName: "Denver",
    lat: 39.7392,
    lon: -104.9903,
    ranges: [{ min: 80200, max: 80299 }],
  },

  // ── Maine (04xxx) ──────────────────────────────────────────────────────────
  {
    id: "me-maine",
    name: "Maine",
    shortName: "Maine",
    lat: 44.3106,
    lon: -69.7795,
    ranges: [{ min: 4600, max: 4699 }],
  },
];

const COUNTY_BY_ID = Object.fromEntries(COUNTY_DEFS.map((c) => [c.id, c])) as Record<
  string,
  CountyDef
>;

function normalizeZipDigits(zip: string | null | undefined): string | null {
  if (zip == null) return null;
  const digits = String(zip).replace(/\D/g, "");
  if (!digits) return null;
  const padded = digits.length <= 5 ? digits.padStart(5, "0") : digits.slice(0, 5);
  return /^\d{5}$/.test(padded) ? padded : null;
}

function countyForZip(zip: string | null | undefined): CountyDef | null {
  const clean = normalizeZipDigits(zip);
  if (!clean) return null;
  const n = Number.parseInt(clean, 10);
  if (!Number.isFinite(n)) return null;
  for (const county of COUNTY_DEFS) {
    for (const r of county.ranges) {
      if (n >= r.min && n <= r.max) return county;
    }
  }
  return null;
}

/** Map profiles.nearest_venue → a representative ZIP so members without zip_code still cluster. */
const VENUE_TO_ZIP: Record<string, string> = {
  "Sofive Meadowlands": "07072",
  "Sofive Meadowlands 5v5": "07072",
  "Sofive Meadowlands 7v7": "07072",
  "Sofive Cherry Hill": "08034",
  "Sofive Cherry Hill 5v5": "08034",
  "Sofive Cherry Hill 7v7": "08034",
  "Sofive Brooklyn": "11201",
  "Hudson Sports Complex": "10990",
  "Hudson Sports": "10990",
  "New Rochelle SoccerRoof": "10801",
  "New Rochelle": "10801",
  "Sofive Rockville": "20850",
  "Sofive Columbia": "20901",
  "SoccerDome Jessup": "20794",
  "SoccerDome Harmans": "21201",
  "Baltimore SoccerRoof": "21201",
  "DC SoccerRoof": "20910",
  "New Haven SoccerRoof": "06510",
};

function countyForVenue(venue: string | null | undefined): CountyDef | null {
  if (venue == null) return null;
  const key = String(venue).trim();
  if (!key) return null;
  const zip = VENUE_TO_ZIP[key];
  return zip ? countyForZip(zip) : null;
}

function resolveMemberCounty(
  zipCode: string | null | undefined,
  nearestVenue: string | null | undefined,
): CountyDef | null {
  return countyForZip(zipCode) ?? countyForVenue(nearestVenue);
}

const COS_REF = Math.cos((39.5 * Math.PI) / 180);

function distSq(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = aLat - bLat;
  const dLon = (aLon - bLon) * COS_REF;
  return dLat * dLat + dLon * dLon;
}

// ─── sizing & color ──────────────────────────────────────────────────────────

function circleSize(count: number): number {
  if (count >= 61) return 96;
  if (count >= 31) return 76;
  if (count >= 16) return 60;
  if (count >= 6) return 48;
  return 36;
}

function circleBg(count: number): string {
  if (count >= 61) return themeColor().pitch;
  if (count >= 31) return themeColor().pitch;
  if (count >= 16) return themeColor().muted;
  if (count >= 6) return themeColor().muted;
  return themeColor().muted;
}

function circleNameColor(count: number): string {
  return count >= 31 ? themeColor().bg : themeColor().text;
}

function circleCountColor(count: number): string {
  return count >= 61 ? themeColor().bg : themeColor().pitch;
}

// ─── types ───────────────────────────────────────────────────────────────────

type Layer = "members" | "sessions" | "activity";

type CountyCell = {
  id: string;
  name: string;
  shortName: string;
  lat: number;
  lon: number;
  count: number;
  topRatedCount: number;
  upcomingSessions: number;
};

type TopRatedPlayer = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  playing_position: string | null;
};

type StarBucket = "5" | "4" | "3" | "2" | "1";
type StarCounts = Record<StarBucket, number>;

type SessionPin = {
  id: string;
  latitude: number;
  longitude: number;
  level: string | null;
  spots_taken: number;
  capacity: number;
  start_at: string;
  time_tbd?: boolean;
  location_private: string | null;
  fee_cents: number;
};

type ActivityStats = {
  recentlyActiveCount: number;
  soonCount: number;
  totalApproved: number;
};

// ─── data hooks ──────────────────────────────────────────────────────────────

function useCommunityData() {
  useThemedStyles(publish_s);

  const { supabase, session } = useAuth();
  const [counties, setCounties] = useState<CountyCell[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);

    const now = Date.now();
    const weekNext = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
    const token = session?.access_token ?? null;
    const origin = siteOrigin();

    // Fetch ALL approved profiles — no geographic filter. Group every row by area.
    const [{ data: profiles, error: profilesError }, { data: sessionRuns }, overviewRes] =
      await Promise.all([
        supabase.from("profiles").select("id, zip_code, nearest_venue").eq("approved", true),
        supabase
          .from("pickup_runs")
          .select("latitude,longitude,start_at")
          .or(
            `status.in.(planning,likely_on,active,in_progress),and(status.eq.completed,start_at.gte."${new Date(now - 2 * 60 * 60 * 1000).toISOString()}")")`,
          )
          .gte("start_at", new Date(now - 2 * 60 * 60 * 1000).toISOString())
          .lte("start_at", weekNext)
          .not("latitude", "is", null)
          .not("longitude", "is", null)
          .limit(200),
        token && origin
          ? fetch(`${origin}/api/community-map/county?overview=1`, {
              headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
            })
              .then((r) => r.json().catch(() => null))
              .catch(() => null)
          : Promise.resolve(null),
      ]);

    if (profilesError) {
      console.warn("[community-map] profiles query failed", profilesError.message);
    }
    if (__DEV__ && profiles) {
      console.log(`[community-map] approved profiles fetched: ${profiles.length}`);
    }

    const topRatedByCounty: Record<string, number> = {};
    if (
      overviewRes &&
      typeof overviewRes === "object" &&
      overviewRes.ok &&
      overviewRes.topRatedByCounty &&
      typeof overviewRes.topRatedByCounty === "object"
    ) {
      for (const [id, n] of Object.entries(
        overviewRes.topRatedByCounty as Record<string, unknown>,
      )) {
        if (typeof n === "number" && n > 0) topRatedByCounty[id] = n;
      }
    }

    type Agg = { count: number; upcomingSessions: number };
    const countyMap = new Map<string, Agg>();
    let groupedCount = 0;

    for (const p of profiles ?? []) {
      const county = resolveMemberCounty(
        p.zip_code as string | null,
        p.nearest_venue as string | null,
      );
      if (!county) continue;

      if (!countyMap.has(county.id)) {
        countyMap.set(county.id, { count: 0, upcomingSessions: 0 });
      }
      const agg = countyMap.get(county.id)!;
      agg.count++;
      groupedCount++;
    }

    if (__DEV__) {
      console.log(
        `[community-map] grouped ${groupedCount}/${profiles?.length ?? 0} members into ${countyMap.size} areas`,
      );
    }

    // Assign upcoming sessions to nearest county centroid (~25 mi / ~0.36°)
    const SESSION_RADIUS_SQ = 0.36 * 0.36;
    for (const run of sessionRuns ?? []) {
      const lat = run.latitude as number;
      const lon = run.longitude as number;
      let bestId: string | null = null;
      let bestD = SESSION_RADIUS_SQ;
      for (const def of COUNTY_DEFS) {
        if (!countyMap.has(def.id)) continue;
        const d = distSq(lat, lon, def.lat, def.lon);
        if (d < bestD) {
          bestD = d;
          bestId = def.id;
        }
      }
      if (bestId) countyMap.get(bestId)!.upcomingSessions++;
    }

    const result: CountyCell[] = [];
    for (const [id, agg] of countyMap.entries()) {
      if (agg.count < MIN_MEMBERS_FOR_CIRCLE) continue;
      const def = COUNTY_BY_ID[id];
      if (!def) continue;
      result.push({
        id: def.id,
        name: def.name,
        shortName: def.shortName,
        lat: def.lat,
        lon: def.lon,
        count: agg.count,
        topRatedCount: topRatedByCounty[id] ?? 0,
        upcomingSessions: agg.upcomingSessions,
      });
    }

    setCounties(result);
    setLoading(false);
  }, [supabase, session?.access_token]);

  useEffect(() => {
    void load();
  }, [load]);

  return { counties, loading, reload: load };
}

function useSessionPins() {
  useThemedStyles(publish_s);

  const { supabase } = useAuth();
  const [sessions, setSessions] = useState<SessionPin[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) return;
    setLoading(true);
    void (async () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("pickup_runs")
        .select("id,latitude,longitude,level,spots_taken,capacity,start_at,location_private,fee_cents")
        .or(
          `status.in.(planning,likely_on,active,in_progress),and(status.eq.completed,start_at.gte."${twoHoursAgo}")`,
        )
        .gte("start_at", twoHoursAgo)
        .not("latitude", "is", null)
        .not("longitude", "is", null)
        .order("start_at", { ascending: true })
        .limit(60);
      if (data) setSessions(await withRunTimeTbd(supabase, data as SessionPin[]));
      setLoading(false);
    })();
  }, [supabase]);

  return { sessions, loading };
}

function useActivityStats() {
  useThemedStyles(publish_s);

  const { supabase } = useAuth();
  const [stats, setStats] = useState<ActivityStats | null>(null);

  useEffect(() => {
    if (!supabase) return;
    void (async () => {
      const now = new Date();
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const sixHrs = new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString();

      const [{ count: recentlyActiveCount }, { count: soonCount }, { count: totalApproved }] =
        await Promise.all([
          supabase
            .from("profiles")
            .select("id", { count: "exact", head: true })
            .eq("approved", true)
            .gte("updated_at", dayAgo),
          supabase
            .from("pickup_runs")
            .select("id", { count: "exact", head: true })
            .in("status", ["planning", "likely_on", "active"])
            .gte("start_at", now.toISOString())
            .lte("start_at", sixHrs),
          supabase.from("profiles").select("id", { count: "exact", head: true }).eq("approved", true),
        ]);

      setStats({
        recentlyActiveCount: recentlyActiveCount ?? 0,
        soonCount: soonCount ?? 0,
        totalApproved: totalApproved ?? 0,
      });
    })();
  }, [supabase]);

  return stats;
}

// ─── county circle marker ────────────────────────────────────────────────────

function CountyCircleMarker({
  cell,
  onPress,
}: {
  cell: CountyCell;
  onPress: () => void;
}) {
  useThemedStyles(publish_s);

  const hasTopRated = cell.topRatedCount > 0;
  const base = circleSize(cell.count);
  const sz = hasTopRated ? Math.max(base, base + 12) : base;
  const bg = circleBg(cell.count);
  const nameCol = circleNameColor(cell.count);
  const countCol = circleCountColor(cell.count);
  const [tracking, setTracking] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setTracking(false), 400);
    return () => clearTimeout(t);
  }, []);

  return (
    <Marker
      coordinate={{ latitude: cell.lat, longitude: cell.lon }}
      onPress={onPress}
      tracksViewChanges={tracking}
      anchor={{ x: 0.5, y: 0.5 }}
      zIndex={cell.count}
    >
      <View
        style={{
          width: sz,
          height: sz,
          borderRadius: sz / 2,
          backgroundColor: bg,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1.5,
          borderColor: themeColor().line,
          paddingHorizontal: 4,
        }}
      >
        <Text
          style={{
            color: nameCol,
            fontSize: 13, fontFamily: "Inter_600SemiBold",
            fontWeight: "600",
            lineHeight: 11,
            textAlign: "center",
          }}
          allowFontScaling={false}
          numberOfLines={1}
        >
          {cell.shortName}
        </Text>
        <Text
          style={{
            color: countCol,
            fontSize: 14, fontFamily: "Inter_700Bold",
            fontWeight: "800",
            lineHeight: 16,
          }}
          allowFontScaling={false}
        >
          {cell.count}
        </Text>
        {hasTopRated ? (
          <Text
            style={{
              color: themeColor().muted,
              fontSize: 13, fontFamily: "Inter_700Bold",
              fontWeight: "800",
              lineHeight: 12,
              marginTop: 1,
            }}
            allowFontScaling={false}
          >
            ★{cell.topRatedCount}
          </Text>
        ) : null}
      </View>
    </Marker>
  );
}

// ─── session marker ──────────────────────────────────────────────────────────

function SessionMarker({
  session,
  selected,
  onPress,
}: {
  session: SessionPin;
  selected: boolean;
  onPress: () => void;
}) {
  useThemedStyles(publish_s);

  const left = session.capacity - session.spots_taken;
  const full = left <= 0;
  const sz = selected ? 52 : 44;
  const r = sz / 2 - 4;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(session.spots_taken / session.capacity, 1);
  const color = full ? themeColor().muted : themeColor().onPitchPanel;

  const [tracking, setTracking] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setTracking(false), 400);
    return () => clearTimeout(t);
  }, []);

  return (
    <Marker
      coordinate={{ latitude: session.latitude, longitude: session.longitude }}
      onPress={onPress}
      tracksViewChanges={tracking}
      anchor={{ x: 0.5, y: 0.5 }}
      zIndex={selected ? 99 : 1}
    >
      <View style={{ width: sz, height: sz }}>
        <Svg width={sz} height={sz} style={StyleSheet.absoluteFill}>
          <Circle cx={sz / 2} cy={sz / 2} r={r} fill={themeColor().card} />
          <Circle cx={sz / 2} cy={sz / 2} r={r} stroke={themeColor().overlay} strokeWidth={2} fill="none" />
          <Circle
            cx={sz / 2}
            cy={sz / 2}
            r={r}
            stroke={color}
            strokeWidth={3}
            fill="none"
            strokeDasharray={`${circ * pct} ${circ}`}
            strokeLinecap="round"
            transform={`rotate(-90 ${sz / 2} ${sz / 2})`}
          />
        </Svg>
        <View style={s.pinCenter}>
          <Text style={[s.pinNum, { color: full ? themeColor().muted : themeColor().text }]} allowFontScaling={false}>
            {full ? "—" : left}
          </Text>
        </View>
      </View>
    </Marker>
  );
}

// ─── county popup ────────────────────────────────────────────────────────────

function displayShortName(first: string | null, last: string | null): string {
  const f = (first ?? "").trim() || "Player";
  const l = (last ?? "").trim();
  if (!l) return f;
  return `${f} ${l.charAt(0).toUpperCase()}.`;
}

function initialsFromName(first: string | null, last: string | null): string {
  const a = (first ?? "").trim().charAt(0);
  const b = (last ?? "").trim().charAt(0);
  const s = `${a}${b}`.toUpperCase();
  return s || "?";
}

function CountyPopupModal({
  cell,
  visible,
  onClose,
  onOpenPlayer,
}: {
  cell: CountyCell;
  visible: boolean;
  onClose: () => void;
  onOpenPlayer: (userId: string) => void;
}) {
  useThemedStyles(publish_s);

  const { supabase, session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [starCounts, setStarCounts] = useState<StarCounts | null>(null);
  const [topRated, setTopRated] = useState<TopRatedPlayer[]>([]);
  const [cards, setCards] = useState<Map<string, PlayerCard>>(new Map());
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    setExpanded(false);
    setStarCounts(null);
    setTopRated([]);
    setCards(new Map());

    const token = session?.access_token;
    const origin = siteOrigin();
    if (!token || !origin) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(
          `${origin}/api/community-map/county?county_id=${encodeURIComponent(cell.id)}`,
          {
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          },
        );
        const json = (await r.json().catch(() => null)) as {
          ok?: boolean;
          starCounts?: StarCounts;
          topRatedPlayers?: TopRatedPlayer[];
        } | null;
        if (cancelled) return;
        if (json?.ok) {
          if (json.starCounts) setStarCounts(json.starCounts);
          if (Array.isArray(json.topRatedPlayers)) {
            setTopRated(json.topRatedPlayers);
            if (supabase && json.topRatedPlayers.length > 0) {
              const next = await fetchPlayerCards(
                supabase,
                json.topRatedPlayers.map((p) => p.id),
              );
              if (!cancelled) setCards(next);
            }
          }
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, cell.id, supabase, session?.access_token]);

  const shown = expanded ? topRated : topRated.slice(0, 5);
  const moreCount = topRated.length > 5 ? topRated.length - 5 : 0;

  const starBuckets: StarBucket[] = ["5", "4", "3", "2", "1"];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.modalRoot}>
        <Pressable style={s.modalBackdrop} onPress={onClose} accessibilityLabel="Dismiss" />
        <View style={s.modalCard}>
          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={s.modalScroll}
          >
            <Text style={s.popupCity}>{cell.name}</Text>
            <Text style={s.popupMembersMuted}>
              <FontAwesome name="users" size={14} color={themeColor().muted} /> {cell.count} total members
            </Text>

            {starCounts ? (
              <Text style={s.starBreakdownRow}>
                {starBuckets
                  .filter((b) => (starCounts[b] ?? 0) > 0)
                  .map((b) => (
                    <Text key={b} style={s.starBreakdownPart}>
                      {b}★ {starCounts[b]}
                    </Text>
                  ))
                  .reduce<React.ReactNode[]>((acc, node, i) => {
                    if (i > 0) acc.push(<Text key={`sep-${i}`} style={{ color: themeColor().muted }}> · </Text>);
                    acc.push(node);
                    return acc;
                  }, [])}
              </Text>
            ) : null}

            <View style={s.popupDivider} />

            <Text style={s.topRatedLabel}>TOP-RATED PLAYERS</Text>

            {loading ? (
              <ActivityIndicator color={themeColor().pitchText} style={{ marginVertical: 16 }} />
            ) : topRated.length === 0 ? (
              <Text style={s.topRatedEmpty}>No top-rated players in this county yet.</Text>
            ) : (
              <View style={s.topRatedList}>
                {shown.map((p) => {
                  const pos = (p.playing_position ?? "").trim();
                  const card = cards.get(p.id);
                  return (
                    <Pressable
                      key={p.id}
                      style={s.topRatedRow}
                      onPress={() => onOpenPlayer(p.id)}
                      accessibilityRole="button"
                    >
                      <View style={s.topRatedAvatarRing}>
                        {p.avatar_url ? (
                          <Image source={{ uri: p.avatar_url }} style={s.topRatedAvatarImg} />
                        ) : (
                          <View style={s.topRatedAvatarFallback}>
                            <Text style={s.topRatedInitials}>
                              {initialsFromName(p.first_name, p.last_name)}
                            </Text>
                          </View>
                        )}
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.topRatedName} numberOfLines={1}>
                          {displayShortName(p.first_name, p.last_name)}
                        </Text>
                        {card || pos ? (
                          <View style={s.topRatedMetaRow}>
                            {card ? (
                              <StarRating value={card.star} provisional={card.provisional} size="sm" />
                            ) : null}
                            {pos ? <Text style={s.topRatedPos}>{pos}</Text> : null}
                          </View>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
                {!expanded && moreCount > 0 ? (
                  <Pressable onPress={() => setExpanded(true)} hitSlop={8}>
                    <Text style={s.topRatedMore}>+ {moreCount} more</Text>
                  </Pressable>
                ) : null}
              </View>
            )}

            <Text style={s.sessionsLine}>
              <FontAwesome name="futbol-o" size={14} color={themeColor().muted} /> {cell.upcomingSessions} upcoming sessions in this area
            </Text>

            <Pressable style={s.popupCloseBtn} onPress={onClose} accessibilityRole="button">
              <Text style={s.popupCloseBtnText}>Close</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function PopupRow({
  icon,
  label,
  accent,
}: {
  icon: React.ComponentProps<typeof FontAwesome>["name"];
  label: string;
  accent?: string;
}) {
  useThemedStyles(publish_s);

  return (
    <View style={s.popupRow}>
      <View style={s.popupRowIcon}>
        <FontAwesome name={icon} size={14} color={accent ?? themeColor().muted} />
      </View>
      <Text style={[s.popupRowText, accent ? { color: accent } : null]}>{label}</Text>
    </View>
  );
}

// ─── session detail card ─────────────────────────────────────────────────────

function SessionDetailCard({
  session,
  onClose,
  onNavigate,
}: {
  session: SessionPin;
  onClose: () => void;
  onNavigate: () => void;
}) {
  useThemedStyles(publish_s);
  const fieldPhotos = useFieldPhotos([session.id]);

  const left = session.capacity - session.spots_taken;
  const full = left <= 0;
  const when = fmtPickupWhenEt(session.start_at, runTimeTbd(session));

  return (
    <View style={s.popupCard}>
      {fieldPhotos[session.id] ? <PhotoHeader uri={fieldPhotos[session.id]} style={s.popupPhoto} /> : null}
      <View style={s.popupHeader}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text style={s.popupCity} numberOfLines={1}>
            {session.location_private?.trim() || "Location TBD"}
          </Text>
          <Text style={s.popupSub}>{when}</Text>
        </View>
        <Pressable onPress={onClose} hitSlop={12} style={s.popupClose}>
          <Text style={s.popupCloseText}>✕</Text>
        </Pressable>
      </View>

      <View style={s.popupRows}>
        <PopupRow icon="users" label={`${session.capacity} capacity`} />
        <PopupRow
          icon="ticket"
          label={full ? "Full — join waitlist" : `${left} spots left`}
          accent={full ? themeColor().muted : themeColor().pitch}
        />
        <PopupRow icon="money" label={`$${(session.fee_cents / 100).toFixed(0)} entry`} />
      </View>

      <Pressable style={s.popupCta} onPress={onNavigate}>
        <Text style={s.popupCtaText}>{full ? "View Waitlist →" : "Reserve Spot →"}</Text>
      </Pressable>
    </View>
  );
}

// ─── activity overlay ────────────────────────────────────────────────────────

function ActivityOverlay({ stats }: { stats: ActivityStats | null }) {
  useThemedStyles(publish_s);

  if (!stats) {
    return (
      <View style={s.activityOverlay}>
        <ActivityIndicator color={themeColor().pitchText} />
      </View>
    );
  }

  return (
    <View style={s.activityOverlay}>
      <Text style={s.actKicker}>LIVE COMMUNITY</Text>
      <Text style={s.actHeadline}>Region Activity</Text>

      <View style={s.actCards}>
        <ActCard
          value={stats.recentlyActiveCount}
          label="Active today"
          sub="Updated profile in last 24h"
          dot={themeColor().pitch}
        />
        <ActCard
          value={stats.soonCount}
          label="Sessions soon"
          sub="Starting in next 6 hours"
          dot={themeColor().pitch}
        />
        <ActCard
          value={stats.totalApproved}
          label="Total members"
          sub="Approved Competitive Together players"
          dot={themeColor().muted}
        />
      </View>

      <Text style={s.actNote}>Aggregated data only — individual locations are never shown.</Text>
    </View>
  );
}

function ActCard({
  value,
  label,
  sub,
  dot,
}: {
  value: number;
  label: string;
  sub: string;
  dot: string;
}) {
  useThemedStyles(publish_s);

  return (
    <View style={s.actCard}>
      <View style={[s.actDot, { backgroundColor: dot }]} />
      <View style={{ flex: 1 }}>
        <Text style={s.actLabel}>{label}</Text>
        <Text style={s.actSub}>{sub}</Text>
      </View>
      <Text style={[s.actValue, { color: dot }]}>{value}</Text>
    </View>
  );
}

// ─── your area card ──────────────────────────────────────────────────────────

function YourAreaCard({
  counties,
  userLat,
  userLon,
  onPress,
}: {
  counties: CountyCell[];
  userLat: number;
  userLon: number;
  onPress: (cell: CountyCell) => void;
}) {
  useThemedStyles(publish_s);

  const nearest = useMemo(() => {
    if (counties.length === 0) return null;
    let best: CountyCell | null = null;
    let bestD = Infinity;
    for (const c of counties) {
      const d = distSq(userLat, userLon, c.lat, c.lon);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }, [counties, userLat, userLon]);

  if (!nearest) return null;

  return (
    <Pressable style={s.yourArea} onPress={() => onPress(nearest)}>
      <Text style={s.yourAreaKicker}>Your area</Text>
      <Text style={s.yourAreaCity}>{nearest.shortName}</Text>
      <Text style={s.yourAreaStat}>
        {nearest.count} members · {nearest.upcomingSessions} upcoming sessions
      </Text>
    </Pressable>
  );
}

// ─── main screen ─────────────────────────────────────────────────────────────

const LAYERS: Array<{ id: Layer; label: string }> = [
  { id: "members", label: "Members" },
  { id: "sessions", label: "Sessions" },
  { id: "activity", label: "Activity" },
];

export default function CommunityMapScreen() {
  useThemedStyles(publish_s);

  const router = useRouter();
  const [layer, setLayer] = useState<Layer>("members");
  const [selectedCounty, setSelectedCounty] = useState<CountyCell | null>(null);
  const [selectedSession, setSelectedSession] = useState<SessionPin | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);
  const mapRef = useRef<MapView>(null);

  const { counties, loading: countyLoading } = useCommunityData();
  const { sessions, loading: sessionsLoading } = useSessionPins();
  const activityStats = useActivityStats();

  const hasOutsideNortheast = useMemo(
    () => counties.some((c) => !isNortheastCountyId(c.id)),
    [counties],
  );
  const [wideView, setWideView] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        if ((await requestLocationWithExplainer({ auto: true })) !== "granted") return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setUserLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      } catch {
        /* ignore */
      }
    })();
  }, []);

  // Zoom out when members exist outside CT/NY/NJ/MD so distant clusters are visible.
  useEffect(() => {
    if (countyLoading || counties.length === 0) return;
    if (!hasOutsideNortheast) {
      setWideView(false);
      return;
    }
    setWideView(true);
    mapRef.current?.animateToRegion(WIDE_REGION, 450);
  }, [countyLoading, counties.length, hasOutsideNortheast]);

  const focusNortheast = useCallback(() => {
    setWideView(false);
    mapRef.current?.animateToRegion(SERVICE_REGION, 400);
  }, []);

  const showFullUs = useCallback(() => {
    setWideView(true);
    mapRef.current?.animateToRegion(WIDE_REGION, 400);
  }, []);

  const dismiss = useCallback(() => {
    setSelectedCounty(null);
    setSelectedSession(null);
  }, []);

  const handleCountyPress = useCallback(
    (cell: CountyCell) => {
      dismiss();
      setSelectedCounty(cell);
      mapRef.current?.animateToRegion(
        {
          latitude: cell.lat,
          longitude: cell.lon,
          latitudeDelta: 0.55,
          longitudeDelta: 0.55,
        },
        300,
      );
    },
    [dismiss],
  );

  const handleSessionPress = useCallback(
    (session: SessionPin) => {
      dismiss();
      setSelectedSession(session);
    },
    [dismiss],
  );

  const loading = layer === "members" ? countyLoading : layer === "sessions" ? sessionsLoading : false;
  const hasSessionPopup = !!selectedSession;
  const hasCountyPopup = !!selectedCounty;

  const mapOverlays = useMemo(() => {
    if (layer === "members") {
      return counties.map((c) => (
        <CountyCircleMarker key={c.id} cell={c} onPress={() => handleCountyPress(c)} />
      ));
    }
    if (layer === "sessions") {
      return sessions.map((sess) => (
        <SessionMarker
          key={sess.id}
          session={sess}
          selected={sess.id === selectedSession?.id}
          onPress={() => handleSessionPress(sess)}
        />
      ));
    }
    return [];
  }, [layer, counties, sessions, selectedSession, handleCountyPress, handleSessionPress]);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.root}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          initialRegion={hasOutsideNortheast ? WIDE_REGION : SERVICE_REGION}
          userInterfaceStyle={themeNow().mode}
          backgroundColor={themeColor().card}
          loadingBackgroundColor={themeColor().card}
          showsUserLocation
          showsMyLocationButton={false}
          showsPointsOfInterest={false}
        >
          {mapOverlays}
        </MapView>

        {hasSessionPopup ? (
          <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} pointerEvents="box-only" />
        ) : null}

        <View style={s.topBar} pointerEvents="box-none">
          <Pressable onPress={() => goBack(router, "/session-map")} hitSlop={10} style={s.backBtn}>
            <Text style={s.backBtnText}>‹ Back</Text>
          </Pressable>
          <View style={s.layerToggle} pointerEvents="auto">
            {LAYERS.map(({ id, label }) => {
              const active = layer === id;
              return (
                <Pressable
                  key={id}
                  onPress={() => {
                    setLayer(id);
                    dismiss();
                  }}
                  style={[s.layerBtn, active && s.layerBtnActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[s.layerBtnText, active && s.layerBtnTextActive]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {hasOutsideNortheast ? (
          <Pressable
            style={s.zoomBtn}
            onPress={wideView ? focusNortheast : showFullUs}
            accessibilityRole="button"
            accessibilityLabel={wideView ? "Zoom to Northeast" : "Show full US"}
          >
            <Text style={s.zoomBtnText}>{wideView ? "Northeast" : "Full US"}</Text>
          </Pressable>
        ) : null}

        {layer === "activity" ? <ActivityOverlay stats={activityStats} /> : null}

        {loading ? (
          <View style={s.loadingCenter} pointerEvents="none">
            <ActivityIndicator color={themeColor().pitchText} />
          </View>
        ) : null}

        {layer === "members" && !hasCountyPopup && !hasSessionPopup && userLocation ? (
          <YourAreaCard
            counties={counties}
            userLat={userLocation.lat}
            userLon={userLocation.lon}
            onPress={handleCountyPress}
          />
        ) : null}

        {hasSessionPopup && selectedSession ? (
          <View style={s.popupWrap}>
            <SessionDetailCard
              session={selectedSession}
              onClose={dismiss}
              onNavigate={() =>
                router.push(`/session/${encodeURIComponent(selectedSession.id)}`)
              }
            />
          </View>
        ) : null}

        {selectedCounty ? (
          <CountyPopupModal
            cell={selectedCounty}
            visible={hasCountyPopup}
            onClose={dismiss}
            onOpenPlayer={(userId) => {
              dismiss();
              router.push(`/player/${encodeURIComponent(userId)}`);
            }}
          />
        ) : null}
      </View>
    </>
  );
}

// ─── styles ──────────────────────────────────────────────────────────────────

function make_s() {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: themeColor().bg },

  topBar: {
    position: "absolute",
    top: 60,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    gap: 8,
  },
  backBtn: {
    alignSelf: "flex-start",
    backgroundColor: themeColor().card,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  backBtnText: { color: themeColor().text, fontWeight: "600", fontSize: 16, fontFamily: "Inter_600SemiBold" },

  layerToggle: {
    flexDirection: "row",
    alignSelf: "center",
    backgroundColor: themeColor().card,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: themeColor().overlay,
    padding: 4,
    gap: 4,
  },
  layerBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999 },
  layerBtnActive: { backgroundColor: themeColor().pitch },
  layerBtnText: { color: themeColor().muted, fontWeight: "700", fontSize: 13, fontFamily: "Inter_700Bold" },
  layerBtnTextActive: { color: themeColor().onPitch },

  zoomBtn: {
    position: "absolute",
    top: 120,
    right: 14,
    backgroundColor: themeColor().card,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: themeColor().overlay,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  zoomBtnText: { color: themeColor().text, fontWeight: "700", fontSize: 13, fontFamily: "Inter_700Bold" },

  pinCenter: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  pinNum: { fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },

  loadingCenter: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },

  yourArea: {
    position: "absolute",
    bottom: 34,
    left: 14,
    backgroundColor: themeColor().card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().overlay,
    padding: 12,
    maxWidth: 180,
  },
  yourAreaKicker: {
    color: themeColor().muted,
    fontSize: 13, fontFamily: "Inter_700Bold",
    fontWeight: "700",
    marginBottom: 4,
  },
  yourAreaCity: { color: themeColor().text, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "800" },
  yourAreaStat: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4, lineHeight: 15 },

  popupWrap: { position: "absolute", bottom: 34, left: 14, right: 14 },
  popupCard: {
    backgroundColor: themeColor().card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().overlay,
    padding: 16,
    overflow: "hidden",
  },
  popupPhoto: { marginTop: -16, marginHorizontal: -16, marginBottom: 12 },
  popupHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  popupCity: { color: themeColor().text, fontSize: 20, ...headline },
  popupMembersMuted: { color: themeColor().muted, fontSize: 14, fontFamily: "Inter_500Medium", marginTop: 4, fontWeight: "500" },
  popupSub: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4 },
  popupClose: {
    width: 28,
    height: 28,
    borderRadius: 12,
    backgroundColor: themeColor().card,
    alignItems: "center",
    justifyContent: "center",
  },
  popupCloseText: { color: themeColor().muted, fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "700" },

  popupRows: { gap: 8 },
  popupRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  popupRowIcon: { width: 22, alignItems: "center" },
  popupRowText: { color: themeColor().text, fontSize: 14, fontFamily: "Inter_500Medium", fontWeight: "500", flex: 1 },

  popupCta: {
    marginTop: 12,
    backgroundColor: themeColor().pitch,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: "center",
  },
  popupCtaText: { color: themeColor().onPitch, fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "700" },

  modalRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: themeColor().scrim,
  },
  modalCard: {
    marginHorizontal: 12,
    marginBottom: 32,
    maxHeight: "78%",
    backgroundColor: themeColor().card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().overlay,
    overflow: "hidden",
  },
  modalScroll: {
    padding: 16,
    paddingBottom: 20,
  },
  starBreakdownRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 8,
    fontSize: 13, fontFamily: "Inter_400Regular",
  },
  starBreakdownPart: {
    color: themeColor().text,
    fontSize: 13, fontFamily: "Inter_700Bold",
    fontWeight: "700",
  },
  popupDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: themeColor().overlay,
    marginVertical: 12,
  },
  topRatedLabel: {
    color: themeColor().pitchText,
    fontSize: 13, fontFamily: "Inter_700Bold",
    fontWeight: "800",
    marginBottom: 8,
  },
  topRatedEmpty: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 8 },
  topRatedList: { gap: 8 },
  topRatedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  topRatedAvatarRing: {
    width: 40,
    height: 40,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: themeColor().line,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  topRatedAvatarImg: { width: 36, height: 36, borderRadius: 12 },
  topRatedAvatarFallback: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: themeColor().overlay,
    alignItems: "center",
    justifyContent: "center",
  },
  topRatedInitials: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "800" },
  topRatedName: { color: themeColor().text, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
  topRatedMetaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  topRatedPos: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_500Medium", fontWeight: "500" },
  topRatedMore: { color: themeColor().pitchText, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700", marginTop: 4 },
  sessionsLine: { color: themeColor().muted, fontSize: 14, fontFamily: "Inter_500Medium", marginTop: 16, fontWeight: "500" },
  popupCloseBtn: {
    marginTop: 16,
    backgroundColor: themeColor().card,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: themeColor().overlay,
    paddingVertical: 12,
    alignItems: "center",
  },
  popupCloseBtnText: { color: themeColor().text, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },

  activityOverlay: {
    position: "absolute",
    bottom: 34,
    left: 14,
    right: 14,
    backgroundColor: themeColor().bg,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: themeColor().overlay,
    padding: 20,
  },
  actKicker: { color: themeColor().pitchText, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "800", marginBottom: 4 },
  actHeadline: { color: themeColor().text, fontSize: 24, ...headline, marginBottom: 16 },
  actCards: { gap: 8 },
  actCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: themeColor().card,
    borderRadius: 12,
    padding: 12,
    gap: 12,
  },
  actDot: { width: 10, height: 10, borderRadius: 10 },
  actLabel: { color: themeColor().text, fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "700" },
  actSub: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 1 },
  actValue: { fontSize: 24, ...headline, minWidth: 40, textAlign: "right" },
  actNote: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 12 },
});
}
let s = make_s();
function publish_s() {
  s = make_s();
}

