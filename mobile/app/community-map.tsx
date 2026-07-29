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
import { format, isToday, isTomorrow } from "date-fns";
import * as Location from "expo-location";
import { useAuth } from "@/context/AuthContext";
import { siteOrigin } from "@/lib/env";

// ─── design tokens ──────────────────────────────────────────────────────────

const LIME = "#a3e635";
const BG = "#0B0F0D";
const SURFACE = "#151B18";
const SURFACE_LIFT = "#1E2723";
const HAIRLINE = "rgba(255,255,255,0.08)";
const CHALK = "#F2F4F1";
const MUTED = "#8A968F";
const GREEN_MED = "#4a7c59";
const GREEN_DARK = "#3a6b42";
const GRAY = "#555555";
const DIAMOND_PURPLE = "#9B59B6";

const TIER_COLORS: Record<string, string> = {
  diamond: "#9B59B6",
  platinum: "#E8E8E8",
  gold: "#E3B23C",
  silver: "#A8B0B5",
  bronze: "#B87333",
};

/** Northeast service area: CT, NY, NJ, and MD. */
const SERVICE_REGION: Region = {
  latitude: 39.5,
  longitude: -75.5,
  latitudeDelta: 8.0,
  longitudeDelta: 8.0,
};

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
 * ZIP coverage: CT 060xx–069xx, NJ 070xx–089xx, NY 100xx–149xx, MD 206xx–219xx.
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
  if (count >= 61) return LIME;
  if (count >= 31) return "rgba(163,230,53,0.70)";
  if (count >= 16) return GREEN_MED;
  if (count >= 6) return GREEN_DARK;
  return GRAY;
}

function circleNameColor(count: number): string {
  return count >= 31 ? BG : CHALK;
}

function circleCountColor(count: number): string {
  return count >= 61 ? BG : LIME;
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
  /** All diamond-tier members in the county (best-effort from client ratings). */
  diamondCount: number;
  /** Verified (document/vouched) Diamond players — from API overview. */
  verifiedDiamondCount: number;
  upcomingSessions: number;
};

type ElitePlayer = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  playing_position: string | null;
  tier: "diamond" | "platinum";
};

type TierCounts = {
  diamond: number;
  platinum: number;
  gold: number;
  silver: number;
  bronze: number;
};

type SessionPin = {
  id: string;
  latitude: number;
  longitude: number;
  level: string | null;
  spots_taken: number;
  capacity: number;
  start_at: string;
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
    const [{ data: profiles, error: profilesError }, { data: ratings }, { data: sessionRuns }, overviewRes] =
      await Promise.all([
        supabase.from("profiles").select("id, zip_code, nearest_venue").eq("approved", true),
        supabase.from("player_ratings").select("user_id, tier"),
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

    const verifiedDiamondByCounty: Record<string, number> = {};
    if (
      overviewRes &&
      typeof overviewRes === "object" &&
      overviewRes.ok &&
      overviewRes.verifiedDiamondByCounty &&
      typeof overviewRes.verifiedDiamondByCounty === "object"
    ) {
      for (const [id, n] of Object.entries(
        overviewRes.verifiedDiamondByCounty as Record<string, unknown>,
      )) {
        if (typeof n === "number" && n > 0) verifiedDiamondByCounty[id] = n;
      }
    }

    const tierByUser = new Map<string, string>();
    for (const r of ratings ?? []) {
      if (r.user_id && r.tier) tierByUser.set(r.user_id, (r.tier as string).toLowerCase());
    }

    type Agg = { count: number; diamondCount: number; upcomingSessions: number };
    const countyMap = new Map<string, Agg>();
    let groupedCount = 0;

    for (const p of profiles ?? []) {
      const county = resolveMemberCounty(
        p.zip_code as string | null,
        p.nearest_venue as string | null,
      );
      if (!county) continue;

      if (!countyMap.has(county.id)) {
        countyMap.set(county.id, { count: 0, diamondCount: 0, upcomingSessions: 0 });
      }
      const agg = countyMap.get(county.id)!;
      agg.count++;
      groupedCount++;
      if ((tierByUser.get(p.id as string) ?? "") === "diamond") agg.diamondCount++;
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
        diamondCount: agg.diamondCount,
        verifiedDiamondCount: verifiedDiamondByCounty[id] ?? 0,
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
      if (data) setSessions(data as SessionPin[]);
      setLoading(false);
    })();
  }, [supabase]);

  return { sessions, loading };
}

function useActivityStats() {
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
  const hasDiamonds = cell.verifiedDiamondCount > 0;
  const base = circleSize(cell.count);
  const sz = hasDiamonds ? Math.max(base, base + 12) : base;
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
          borderColor: "rgba(255,255,255,0.22)",
          paddingHorizontal: 3,
        }}
      >
        <Text
          style={{
            color: nameCol,
            fontSize: 9,
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
            fontSize: 14,
            fontWeight: "800",
            lineHeight: 16,
          }}
          allowFontScaling={false}
        >
          {cell.count}
        </Text>
        {hasDiamonds ? (
          <Text
            style={{
              color: DIAMOND_PURPLE,
              fontSize: 10,
              fontWeight: "800",
              lineHeight: 12,
              marginTop: 1,
            }}
            allowFontScaling={false}
          >
            ◆{cell.verifiedDiamondCount}
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
  const left = session.capacity - session.spots_taken;
  const full = left <= 0;
  const sz = selected ? 52 : 44;
  const r = sz / 2 - 4;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(session.spots_taken / session.capacity, 1);
  const color = full ? MUTED : LIME;

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
          <Circle cx={sz / 2} cy={sz / 2} r={r} fill={SURFACE} />
          <Circle cx={sz / 2} cy={sz / 2} r={r} stroke={HAIRLINE} strokeWidth={2} fill="none" />
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
          <Text style={[s.pinNum, { color: full ? MUTED : CHALK }]} allowFontScaling={false}>
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
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [tierCounts, setTierCounts] = useState<TierCounts | null>(null);
  const [elite, setElite] = useState<ElitePlayer[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    setExpanded(false);
    setTierCounts(null);
    setElite([]);

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
          tierCounts?: TierCounts;
          elitePlayers?: ElitePlayer[];
        } | null;
        if (cancelled) return;
        if (json?.ok) {
          if (json.tierCounts) setTierCounts(json.tierCounts);
          if (Array.isArray(json.elitePlayers)) setElite(json.elitePlayers);
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
  }, [visible, cell.id, session?.access_token]);

  const shown = expanded ? elite : elite.slice(0, 5);
  const moreCount = elite.length > 5 ? elite.length - 5 : 0;

  const tierParts: Array<{ key: keyof TierCounts; label: string; glyph: string }> = [
    { key: "diamond", label: "Diamond", glyph: "◆" },
    { key: "platinum", label: "Platinum", glyph: "●" },
    { key: "gold", label: "Gold", glyph: "●" },
    { key: "silver", label: "Silver", glyph: "●" },
    { key: "bronze", label: "Bronze", glyph: "●" },
  ];

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
            <Text style={s.popupMembersMuted}>👥 {cell.count} total members</Text>

            {tierCounts ? (
              <Text style={s.tierBreakdownRow}>
                {tierParts
                  .filter((t) => (tierCounts[t.key] ?? 0) > 0)
                  .map((t) => (
                    <Text key={t.key} style={{ color: TIER_COLORS[t.key], fontWeight: "700" }}>
                      {t.glyph} {tierCounts[t.key]} {t.label}
                    </Text>
                  ))
                  .reduce<React.ReactNode[]>((acc, node, i) => {
                    if (i > 0) acc.push(<Text key={`sep-${i}`} style={{ color: MUTED }}> · </Text>);
                    acc.push(node);
                    return acc;
                  }, [])}
              </Text>
            ) : null}

            <View style={s.popupDivider} />

            <Text style={s.eliteLabel}>ELITE PLAYERS</Text>

            {loading ? (
              <ActivityIndicator color={LIME} style={{ marginVertical: 16 }} />
            ) : elite.length === 0 ? (
              <Text style={s.eliteEmpty}>No verified Diamond or Platinum players in this county yet.</Text>
            ) : (
              <View style={s.eliteList}>
                {shown.map((p) => {
                  const color = TIER_COLORS[p.tier];
                  const pos = (p.playing_position ?? "").trim();
                  return (
                    <Pressable
                      key={p.id}
                      style={s.eliteRow}
                      onPress={() => onOpenPlayer(p.id)}
                      accessibilityRole="button"
                    >
                      <View style={[s.eliteAvatarRing, { borderColor: color }]}>
                        {p.avatar_url ? (
                          <Image source={{ uri: p.avatar_url }} style={s.eliteAvatarImg} />
                        ) : (
                          <View style={[s.eliteAvatarFallback, { backgroundColor: `${color}22` }]}>
                            <Text style={[s.eliteInitials, { color }]}>
                              {initialsFromName(p.first_name, p.last_name)}
                            </Text>
                          </View>
                        )}
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.eliteName} numberOfLines={1}>
                          {displayShortName(p.first_name, p.last_name)}
                        </Text>
                        <View style={s.eliteMetaRow}>
                          <Text style={[s.eliteTierBadge, { color }]}>
                            {p.tier === "diamond" ? "◆ Diamond" : "● Platinum"}
                          </Text>
                          {pos ? <Text style={s.elitePos}>{pos}</Text> : null}
                        </View>
                      </View>
                    </Pressable>
                  );
                })}
                {!expanded && moreCount > 0 ? (
                  <Pressable onPress={() => setExpanded(true)} hitSlop={8}>
                    <Text style={s.eliteMore}>+ {moreCount} more</Text>
                  </Pressable>
                ) : null}
              </View>
            )}

            <Text style={s.sessionsLine}>⚽ {cell.upcomingSessions} upcoming sessions in this area</Text>

            <Pressable style={s.popupCloseBtn} onPress={onClose} accessibilityRole="button">
              <Text style={s.popupCloseBtnText}>Close</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function PopupRow({ icon, label, accent }: { icon: string; label: string; accent?: string }) {
  return (
    <View style={s.popupRow}>
      <Text style={s.popupRowIcon}>{icon}</Text>
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
  const left = session.capacity - session.spots_taken;
  const full = left <= 0;
  const d = new Date(session.start_at);
  const when = isToday(d)
    ? `Today · ${format(d, "h:mm a")}`
    : isTomorrow(d)
      ? `Tomorrow · ${format(d, "h:mm a")}`
      : `${format(d, "EEE MMM d")} · ${format(d, "h:mm a")}`;

  return (
    <View style={s.popupCard}>
      <View style={s.popupHeader}>
        <View style={{ flex: 1, marginRight: 10 }}>
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
        <PopupRow icon="👥" label={`${session.capacity} capacity`} />
        <PopupRow
          icon="🎟"
          label={full ? "Full — join waitlist" : `${left} spots left`}
          accent={full ? MUTED : LIME}
        />
        <PopupRow icon="💵" label={`$${(session.fee_cents / 100).toFixed(0)} entry`} />
      </View>

      <Pressable style={s.popupCta} onPress={onNavigate}>
        <Text style={s.popupCtaText}>{full ? "View Waitlist →" : "Reserve Spot →"}</Text>
      </Pressable>
    </View>
  );
}

// ─── activity overlay ────────────────────────────────────────────────────────

function ActivityOverlay({ stats }: { stats: ActivityStats | null }) {
  if (!stats) {
    return (
      <View style={s.activityOverlay}>
        <ActivityIndicator color={LIME} />
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
          dot={LIME}
        />
        <ActCard
          value={stats.soonCount}
          label="Sessions soon"
          sub="Starting in next 6 hours"
          dot="#4ADE80"
        />
        <ActCard
          value={stats.totalApproved}
          label="Total members"
          sub="Approved CT Pickup players"
          dot={GREEN_MED}
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
      <Text style={s.yourAreaKicker}>📍 Your area</Text>
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
  const router = useRouter();
  const [layer, setLayer] = useState<Layer>("members");
  const [selectedCounty, setSelectedCounty] = useState<CountyCell | null>(null);
  const [selectedSession, setSelectedSession] = useState<SessionPin | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);
  const mapRef = useRef<MapView>(null);

  const { counties, loading: countyLoading } = useCommunityData();
  const { sessions, loading: sessionsLoading } = useSessionPins();
  const activityStats = useActivityStats();

  useEffect(() => {
    void (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setUserLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      } catch {
        /* ignore */
      }
    })();
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
          initialRegion={SERVICE_REGION}
          userInterfaceStyle="dark"
          backgroundColor="#1a2420"
          loadingBackgroundColor="#1a2420"
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
          <Pressable onPress={() => router.back()} hitSlop={10} style={s.backBtn}>
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

        {layer === "activity" ? <ActivityOverlay stats={activityStats} /> : null}

        {loading ? (
          <View style={s.loadingCenter} pointerEvents="none">
            <ActivityIndicator color={LIME} />
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

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  topBar: {
    position: "absolute",
    top: 60,
    left: 0,
    right: 0,
    paddingHorizontal: 14,
    gap: 10,
  },
  backBtn: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(0,0,0,0.68)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  backBtnText: { color: CHALK, fontWeight: "600", fontSize: 15 },

  layerToggle: {
    flexDirection: "row",
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.74)",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: HAIRLINE,
    padding: 3,
    gap: 2,
  },
  layerBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999 },
  layerBtnActive: { backgroundColor: LIME },
  layerBtnText: { color: MUTED, fontWeight: "700", fontSize: 13 },
  layerBtnTextActive: { color: BG },

  pinCenter: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  pinNum: { fontSize: 15, fontWeight: "700" },

  loadingCenter: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },

  yourArea: {
    position: "absolute",
    bottom: 34,
    left: 14,
    backgroundColor: "rgba(11,15,13,0.90)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: HAIRLINE,
    padding: 12,
    maxWidth: 180,
  },
  yourAreaKicker: {
    color: MUTED,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: 3,
  },
  yourAreaCity: { color: CHALK, fontSize: 16, fontWeight: "800" },
  yourAreaStat: { color: MUTED, fontSize: 11, marginTop: 3, lineHeight: 15 },

  popupWrap: { position: "absolute", bottom: 34, left: 14, right: 14 },
  popupCard: {
    backgroundColor: SURFACE,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: HAIRLINE,
    padding: 16,
  },
  popupHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  popupCity: { color: CHALK, fontSize: 20, fontWeight: "800" },
  popupMembersMuted: { color: MUTED, fontSize: 14, marginTop: 6, fontWeight: "500" },
  popupSub: { color: MUTED, fontSize: 13, marginTop: 2 },
  popupClose: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: SURFACE_LIFT,
    alignItems: "center",
    justifyContent: "center",
  },
  popupCloseText: { color: MUTED, fontSize: 14, fontWeight: "700" },

  popupRows: { gap: 8 },
  popupRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  popupRowIcon: { fontSize: 16, width: 22, textAlign: "center" },
  popupRowText: { color: CHALK, fontSize: 14, fontWeight: "500", flex: 1 },

  popupCta: {
    marginTop: 14,
    backgroundColor: LIME,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: "center",
  },
  popupCtaText: { color: BG, fontSize: 14, fontWeight: "700" },

  modalRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.62)",
  },
  modalCard: {
    marginHorizontal: 14,
    marginBottom: 34,
    maxHeight: "78%",
    backgroundColor: SURFACE,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: HAIRLINE,
    overflow: "hidden",
  },
  modalScroll: {
    padding: 18,
    paddingBottom: 20,
  },
  tierBreakdownRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 10,
    fontSize: 13,
  },
  tierBreakdownPart: {
    fontSize: 13,
    fontWeight: "700",
  },
  popupDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: HAIRLINE,
    marginVertical: 14,
  },
  eliteLabel: {
    color: LIME,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.4,
    marginBottom: 10,
  },
  eliteEmpty: { color: MUTED, fontSize: 13, marginBottom: 8 },
  eliteList: { gap: 10 },
  eliteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  eliteAvatarRing: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  eliteAvatarImg: { width: 36, height: 36, borderRadius: 18 },
  eliteAvatarFallback: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  eliteInitials: { fontSize: 12, fontWeight: "800" },
  eliteName: { color: CHALK, fontSize: 15, fontWeight: "700" },
  eliteMetaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
  eliteTierBadge: { fontSize: 12, fontWeight: "700" },
  elitePos: { color: MUTED, fontSize: 12, fontWeight: "500" },
  eliteMore: { color: LIME, fontSize: 13, fontWeight: "700", marginTop: 4 },
  sessionsLine: { color: MUTED, fontSize: 14, marginTop: 16, fontWeight: "500" },
  popupCloseBtn: {
    marginTop: 16,
    backgroundColor: SURFACE_LIFT,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: HAIRLINE,
    paddingVertical: 12,
    alignItems: "center",
  },
  popupCloseBtnText: { color: CHALK, fontSize: 15, fontWeight: "700" },

  activityOverlay: {
    position: "absolute",
    bottom: 34,
    left: 14,
    right: 14,
    backgroundColor: "rgba(11,15,13,0.93)",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: HAIRLINE,
    padding: 20,
  },
  actKicker: { color: LIME, fontSize: 10, fontWeight: "800", letterSpacing: 2, marginBottom: 4 },
  actHeadline: { color: CHALK, fontSize: 22, fontWeight: "800", marginBottom: 16 },
  actCards: { gap: 10 },
  actCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 12,
    padding: 12,
    gap: 12,
  },
  actDot: { width: 10, height: 10, borderRadius: 5 },
  actLabel: { color: CHALK, fontSize: 14, fontWeight: "700" },
  actSub: { color: MUTED, fontSize: 12, marginTop: 1 },
  actValue: { fontSize: 22, fontWeight: "800", minWidth: 40, textAlign: "right" },
  actNote: { color: MUTED, fontSize: 11, marginTop: 14 },
});
