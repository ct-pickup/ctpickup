import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import MapView, { Marker, Polygon, type Region } from "react-native-maps";
import Svg, { Circle } from "react-native-svg";
import { Stack, useRouter } from "expo-router";
import { format, isToday, isTomorrow } from "date-fns";
import { useAuth } from "@/context/AuthContext";

// ─── design tokens ──────────────────────────────────────────────────────────

const LIME = "#a3e635";
const BG = "#0B0F0D";
const SURFACE = "#151B18";
const SURFACE_LIFT = "#1E2723";
const HAIRLINE = "rgba(255,255,255,0.08)";
const CHALK = "#F2F4F1";
const MUTED = "#8A968F";
const GREEN_MED = "#4a7c59";

const CT_REGION: Region = {
  latitude: 41.28,
  longitude: -73.08,
  latitudeDelta: 1.6,
  longitudeDelta: 1.6,
};

// ─── ZIP centroid lookup ─────────────────────────────────────────────────────

type ZipInfo = { lat: number; lon: number; city: string };

const ZIP_INFO: Record<string, ZipInfo> = {
  // Hartford area
  "06101": { lat: 41.7637, lon: -72.6851, city: "Hartford" },
  "06103": { lat: 41.7637, lon: -72.6826, city: "Hartford" },
  "06105": { lat: 41.7708, lon: -72.7010, city: "Hartford" },
  "06106": { lat: 41.7550, lon: -72.6963, city: "Hartford" },
  "06107": { lat: 41.7646, lon: -72.7329, city: "West Hartford" },
  "06108": { lat: 41.7737, lon: -72.6537, city: "East Hartford" },
  "06109": { lat: 41.7319, lon: -72.6480, city: "Wethersfield" },
  "06110": { lat: 41.7477, lon: -72.7113, city: "West Hartford" },
  "06111": { lat: 41.6975, lon: -72.7213, city: "Newington" },
  "06112": { lat: 41.7902, lon: -72.7032, city: "Hartford" },
  "06114": { lat: 41.7524, lon: -72.6695, city: "Hartford" },
  "06118": { lat: 41.7741, lon: -72.6164, city: "East Hartford" },
  "06120": { lat: 41.7902, lon: -72.6882, city: "Hartford" },
  // New Haven area
  "06510": { lat: 41.3083, lon: -72.9279, city: "New Haven" },
  "06511": { lat: 41.3214, lon: -72.9298, city: "New Haven" },
  "06512": { lat: 41.2806, lon: -72.9214, city: "East Haven" },
  "06513": { lat: 41.3014, lon: -72.9094, city: "New Haven" },
  "06514": { lat: 41.3614, lon: -72.9476, city: "Hamden" },
  "06515": { lat: 41.3247, lon: -72.9668, city: "New Haven" },
  "06516": { lat: 41.2870, lon: -72.9796, city: "West Haven" },
  "06517": { lat: 41.3408, lon: -72.9073, city: "Hamden" },
  "06518": { lat: 41.3975, lon: -72.9168, city: "Hamden" },
  "06519": { lat: 41.3014, lon: -72.9396, city: "New Haven" },
  // Bridgeport / Fairfield area
  "06601": { lat: 41.1670, lon: -73.2048, city: "Bridgeport" },
  "06604": { lat: 41.1814, lon: -73.1926, city: "Bridgeport" },
  "06605": { lat: 41.1591, lon: -73.2148, city: "Bridgeport" },
  "06606": { lat: 41.1959, lon: -73.2148, city: "Bridgeport" },
  "06607": { lat: 41.1745, lon: -73.1982, city: "Bridgeport" },
  "06608": { lat: 41.1892, lon: -73.1815, city: "Bridgeport" },
  "06610": { lat: 41.2084, lon: -73.1926, city: "Bridgeport" },
  "06611": { lat: 41.2542, lon: -73.1926, city: "Trumbull" },
  "06612": { lat: 41.2681, lon: -73.2037, city: "Easton" },
  "06614": { lat: 41.2170, lon: -73.1426, city: "Stratford" },
  "06615": { lat: 41.1814, lon: -73.1370, city: "Stratford" },
  // Fairfield / Westport / Norwalk
  "06824": { lat: 41.1459, lon: -73.2587, city: "Fairfield" },
  "06825": { lat: 41.1781, lon: -73.2365, city: "Fairfield" },
  "06850": { lat: 41.1197, lon: -73.4282, city: "Norwalk" },
  "06851": { lat: 41.1226, lon: -73.4643, city: "Norwalk" },
  "06853": { lat: 41.0787, lon: -73.4393, city: "Norwalk" },
  "06854": { lat: 41.1087, lon: -73.4199, city: "Norwalk" },
  "06855": { lat: 41.1198, lon: -73.3893, city: "Norwalk" },
  "06870": { lat: 41.0343, lon: -73.5799, city: "Old Greenwich" },
  "06877": { lat: 41.1031, lon: -73.5965, city: "Ridgefield" },
  "06878": { lat: 41.0670, lon: -73.5671, city: "Riverside" },
  "06880": { lat: 41.1431, lon: -73.3632, city: "Westport" },
  "06883": { lat: 41.1753, lon: -73.3846, city: "Weston" },
  "06890": { lat: 41.1509, lon: -73.3282, city: "Southport" },
  "06896": { lat: 41.2059, lon: -73.3893, city: "Redding" },
  "06897": { lat: 41.2087, lon: -73.3726, city: "Wilton" },
  // Stamford / Greenwich
  "06830": { lat: 41.0217, lon: -73.6282, city: "Greenwich" },
  "06831": { lat: 41.0703, lon: -73.6393, city: "Greenwich" },
  "06840": { lat: 41.0409, lon: -73.7221, city: "New Canaan" },
  "06901": { lat: 41.0534, lon: -73.5387, city: "Stamford" },
  "06902": { lat: 41.0487, lon: -73.5221, city: "Stamford" },
  "06903": { lat: 41.1045, lon: -73.5554, city: "Stamford" },
  "06905": { lat: 41.0762, lon: -73.5499, city: "Stamford" },
  "06906": { lat: 41.0609, lon: -73.5276, city: "Stamford" },
  "06907": { lat: 41.0956, lon: -73.5387, city: "Stamford" },
  // Danbury area
  "06810": { lat: 41.3948, lon: -73.4538, city: "Danbury" },
  "06811": { lat: 41.4226, lon: -73.4760, city: "Danbury" },
  "06812": { lat: 41.4643, lon: -73.4760, city: "Danbury" },
  "06820": { lat: 41.0598, lon: -73.6282, city: "Darien" },
  // Waterbury area
  "06701": { lat: 41.5582, lon: -73.0515, city: "Waterbury" },
  "06702": { lat: 41.5440, lon: -73.0349, city: "Waterbury" },
  "06704": { lat: 41.5809, lon: -73.0349, city: "Waterbury" },
  "06705": { lat: 41.5361, lon: -73.0182, city: "Waterbury" },
  "06706": { lat: 41.5250, lon: -73.0737, city: "Waterbury" },
  "06708": { lat: 41.5470, lon: -73.1237, city: "Watertown" },
  "06710": { lat: 41.5692, lon: -73.0626, city: "Waterbury" },
  // Milford / Orange / Derby
  "06460": { lat: 41.2237, lon: -73.0568, city: "Milford" },
  "06461": { lat: 41.2515, lon: -73.0679, city: "Milford" },
  "06477": { lat: 41.2737, lon: -73.0215, city: "Orange" },
  "06418": { lat: 41.3114, lon: -73.0846, city: "Derby" },
  // Lower Westchester (border area)
  "10601": { lat: 41.0340, lon: -73.7629, city: "White Plains" },
  "10605": { lat: 41.0195, lon: -73.7737, city: "White Plains" },
  "10701": { lat: 40.9312, lon: -73.8960, city: "Yonkers" },
  "10710": { lat: 40.9812, lon: -73.8557, city: "Yonkers" },
};

function resolveZip(zip: string): ZipInfo | null {
  const clean = zip.replace(/\D/g, "").slice(0, 5);
  if (!clean) return null;
  if (ZIP_INFO[clean]) return ZIP_INFO[clean];
  // 3-digit prefix fallback (rough city match)
  const prefix = clean.slice(0, 3);
  for (const [z, info] of Object.entries(ZIP_INFO)) {
    if (z.startsWith(prefix)) return info;
  }
  return null;
}

// ─── hex grid math ───────────────────────────────────────────────────────────

// Flat-top hexagonal grid in lat/lon space.
// We project lon by cos(ref_lat) to approximate equal-area coordinates,
// then apply standard axial hex math, then unproject back.

const REF_LAT_RAD = (41.3 * Math.PI) / 180;
const COS_REF = Math.cos(REF_LAT_RAD); // ≈ 0.748
const SQ3 = Math.sqrt(3);
const HEX_SIZE = 0.055; // in projected-degree units ≈ 6 km radius

function latlonToHex(lat: number, lon: number): [number, number] {
  const x = (lon * COS_REF) / HEX_SIZE;
  const y = lat / HEX_SIZE;
  const q = (2 / 3) * x;
  const r = (-1 / 3) * x + (SQ3 / 3) * y;
  return hexRound(q, r);
}

function hexRound(q: number, r: number): [number, number] {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return [rq, rr];
}

function hexToCenter(q: number, r: number): { latitude: number; longitude: number } {
  const x = HEX_SIZE * (3 / 2) * q;
  const y = HEX_SIZE * ((SQ3 / 2) * q + SQ3 * r);
  return { latitude: y, longitude: x / COS_REF };
}

function hexToCorners(q: number, r: number): Array<{ latitude: number; longitude: number }> {
  const c = hexToCenter(q, r);
  const corners: Array<{ latitude: number; longitude: number }> = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i; // flat-top: starts at 0°
    corners.push({
      latitude: c.latitude + HEX_SIZE * Math.sin(angle),
      longitude: c.longitude + (HEX_SIZE / COS_REF) * Math.cos(angle),
    });
  }
  return corners;
}

// ─── color helpers ───────────────────────────────────────────────────────────

function hexFillColor(count: number): string {
  if (count >= 150) return "rgba(163,230,53,0.68)";
  if (count >= 50) return "rgba(163,230,53,0.42)";
  if (count >= 10) return "rgba(74,124,89,0.52)";
  return "rgba(100,110,100,0.28)";
}

function hexStrokeColor(count: number): string {
  if (count >= 150) return "rgba(163,230,53,0.9)";
  if (count >= 50) return "rgba(163,230,53,0.6)";
  if (count >= 10) return "rgba(74,124,89,0.7)";
  return "rgba(100,110,100,0.4)";
}

function clusterFill(count: number): string {
  if (count >= 150) return LIME;
  if (count >= 50) return "rgba(163,230,53,0.82)";
  return GREEN_MED;
}

function clusterSize(count: number): number {
  if (count >= 150) return 64;
  if (count >= 50) return 52;
  return 40;
}

// ─── types ───────────────────────────────────────────────────────────────────

type Layer = "members" | "sessions" | "activity";

type HexCell = {
  key: string;
  q: number;
  r: number;
  count: number;
  diamondCount: number;
  goldPlusCount: number;
  newThisMonth: number;
  corners: Array<{ latitude: number; longitude: number }>;
  center: { latitude: number; longitude: number };
  cityLabel: string;
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

// ─── hooks ───────────────────────────────────────────────────────────────────

function useCommunityData() {
  const { supabase } = useAuth();
  const [hexCells, setHexCells] = useState<HexCell[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);

    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [{ data: profiles }, { data: ratings }] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, zip_code, created_at")
        .eq("approved", true)
        .not("zip_code", "is", null),
      supabase
        .from("player_ratings")
        .select("user_id, tier"),
    ]);

    const tierByUser = new Map<string, string>();
    for (const r of ratings ?? []) {
      if (r.user_id && r.tier) tierByUser.set(r.user_id, (r.tier as string).toLowerCase());
    }

    type CellAgg = {
      q: number; r: number;
      count: number; diamondCount: number; goldPlusCount: number;
      newThisMonth: number; cities: Set<string>;
    };
    const hexMap = new Map<string, CellAgg>();

    for (const p of profiles ?? []) {
      const info = resolveZip(String(p.zip_code ?? ""));
      if (!info) continue;

      const [q, r] = latlonToHex(info.lat, info.lon);
      const key = `${q},${r}`;

      if (!hexMap.has(key)) {
        hexMap.set(key, { q, r, count: 0, diamondCount: 0, goldPlusCount: 0, newThisMonth: 0, cities: new Set() });
      }
      const cell = hexMap.get(key)!;
      cell.count++;
      cell.cities.add(info.city);

      const tier = tierByUser.get(p.id as string) ?? "";
      if (tier === "diamond") { cell.diamondCount++; cell.goldPlusCount++; }
      else if (tier === "platinum" || tier === "gold") { cell.goldPlusCount++; }

      if (p.created_at && (p.created_at as string) >= monthAgo) cell.newThisMonth++;
    }

    const cells: HexCell[] = [];
    for (const [key, cell] of hexMap.entries()) {
      if (cell.count < 5) continue; // privacy minimum
      cells.push({
        key,
        q: cell.q,
        r: cell.r,
        count: cell.count,
        diamondCount: cell.diamondCount,
        goldPlusCount: cell.goldPlusCount,
        newThisMonth: cell.newThisMonth,
        corners: hexToCorners(cell.q, cell.r),
        center: hexToCenter(cell.q, cell.r),
        cityLabel: [...cell.cities].slice(0, 2).join(" / "),
      });
    }

    setHexCells(cells);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  return { hexCells, loading, reload: load };
}

function useSessionPins() {
  const { supabase } = useAuth();
  const [sessions, setSessions] = useState<SessionPin[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) return;
    setLoading(true);
    void (async () => {
      const { data } = await supabase
        .from("pickup_runs")
        .select("id,latitude,longitude,level,spots_taken,capacity,start_at,location_private,fee_cents")
        .in("status", ["planning", "likely_on", "active", "in_progress"])
        .gte("start_at", new Date().toISOString())
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
      const sixHours = new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString();

      const [
        { count: recentlyActiveCount },
        { count: soonCount },
        { count: totalApproved },
      ] = await Promise.all([
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
          .lte("start_at", sixHours),
        supabase
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("approved", true),
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

// ─── sub-components ──────────────────────────────────────────────────────────

function ClusterMarker({ cell, onPress }: { cell: HexCell; onPress: () => void }) {
  const sz = clusterSize(cell.count);
  const fill = clusterFill(cell.count);
  const [tracking, setTracking] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setTracking(false), 400);
    return () => clearTimeout(t);
  }, []);

  const label = cell.count >= 1000 ? `${(cell.count / 1000).toFixed(1)}k` : String(cell.count);
  const textColor = cell.count >= 50 ? BG : CHALK;
  const fontSize = sz >= 64 ? 16 : sz >= 52 ? 14 : 12;

  return (
    <Marker
      coordinate={cell.center}
      onPress={onPress}
      tracksViewChanges={tracking}
      anchor={{ x: 0.5, y: 0.5 }}
      zIndex={cell.count}
    >
      <View style={{ width: sz, height: sz, alignItems: "center", justifyContent: "center" }}>
        <Svg width={sz} height={sz} style={StyleSheet.absoluteFill}>
          <Circle cx={sz / 2} cy={sz / 2} r={sz / 2 - 2} fill={fill} opacity={0.9} />
          <Circle cx={sz / 2} cy={sz / 2} r={sz / 2 - 2} stroke="rgba(255,255,255,0.25)" strokeWidth={1.5} fill="none" />
        </Svg>
        <Text style={{ color: textColor, fontWeight: "800", fontSize }} allowFontScaling={false}>
          {label}
        </Text>
      </View>
    </Marker>
  );
}

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
            cx={sz / 2} cy={sz / 2} r={r}
            stroke={color} strokeWidth={3} fill="none"
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

function HexPopupCard({ cell, onClose }: { cell: HexCell; onClose: () => void }) {
  return (
    <View style={s.popupCard}>
      <View style={s.popupHeader}>
        <View>
          <Text style={s.popupCity}>{cell.cityLabel || "This area"}</Text>
          <Text style={s.popupSub}>Community snapshot</Text>
        </View>
        <Pressable onPress={onClose} hitSlop={12} style={s.popupClose}>
          <Text style={s.popupCloseText}>✕</Text>
        </Pressable>
      </View>

      <View style={s.popupGrid}>
        <StatBox value={cell.count} label="Members" accent={LIME} />
        <StatBox value={cell.diamondCount} label="Diamond" accent="#9B59B6" />
        <StatBox value={cell.goldPlusCount} label="Gold+" accent="#E3B23C" />
        <StatBox value={cell.newThisMonth} label="New / mo" accent={GREEN_MED} />
      </View>

      {cell.count < 15 && (
        <View style={s.popupPrivacyNote}>
          <Text style={s.popupPrivacyText}>
            Exact breakdowns hidden to protect player privacy.
          </Text>
        </View>
      )}
    </View>
  );
}

function StatBox({ value, label, accent }: { value: number; label: string; accent: string }) {
  return (
    <View style={s.statBox}>
      <Text style={[s.statValue, { color: accent }]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

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
      <Text style={s.activityTitle}>LIVE COMMUNITY</Text>
      <Text style={s.activityHeadline}>Region Activity</Text>

      <View style={s.activityCards}>
        <ActivityCard
          value={stats.recentlyActiveCount}
          label="Active today"
          sub="Players who updated their profile in the last 24 h"
          dot={LIME}
        />
        <ActivityCard
          value={stats.soonCount}
          label="Sessions soon"
          sub="Starting in the next 6 hours"
          dot="#4ADE80"
        />
        <ActivityCard
          value={stats.totalApproved}
          label="Total members"
          sub="Approved CT Pickup players"
          dot={GREEN_MED}
        />
      </View>

      <View style={s.activityNote}>
        <Text style={s.activityNoteText}>
          Data is aggregated and updated in real-time. Individual locations are never shown.
        </Text>
      </View>
    </View>
  );
}

function ActivityCard({
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
        <View style={{ flex: 1, marginRight: 12 }}>
          <Text style={s.popupCity} numberOfLines={1}>
            {session.location_private?.trim() || "Location TBD"}
          </Text>
          <Text style={s.popupSub}>{when}</Text>
        </View>
        <Pressable onPress={onClose} hitSlop={12} style={s.popupClose}>
          <Text style={s.popupCloseText}>✕</Text>
        </Pressable>
      </View>

      <View style={s.popupGrid}>
        <StatBox value={session.capacity} label="Capacity" accent={CHALK} />
        <StatBox value={left >= 0 ? left : 0} label="Spots left" accent={full ? MUTED : LIME} />
        <StatBox value={session.fee_cents / 100} label="Fee ($)" accent={CHALK} />
      </View>

      <Pressable style={s.popupCta} onPress={onNavigate}>
        <Text style={s.popupCtaText}>{full ? "View Waitlist →" : "Reserve Spot →"}</Text>
      </Pressable>
    </View>
  );
}

// ─── main screen ─────────────────────────────────────────────────────────────

const LAYERS: Array<{ id: Layer; label: string }> = [
  { id: "members", label: "Members" },
  { id: "sessions", label: "Sessions" },
  { id: "activity", label: "Activity" },
];

// Zoom thresholds for adaptive rendering
const SHOW_CLUSTERS_DELTA = 0.9;  // zoomed out → show cluster circles
const HIDE_HEX_DELTA = 0.04;       // too zoomed in → hide hex for privacy

export default function CommunityMapScreen() {
  const router = useRouter();
  const [layer, setLayer] = useState<Layer>("members");
  const [region, setRegion] = useState<Region>(CT_REGION);
  const [selectedHex, setSelectedHex] = useState<HexCell | null>(null);
  const [selectedSession, setSelectedSession] = useState<SessionPin | null>(null);
  const mapRef = useRef<MapView>(null);

  const { hexCells, loading: hexLoading } = useCommunityData();
  const { sessions, loading: sessionsLoading } = useSessionPins();
  const activityStats = useActivityStats();

  const latDelta = region.latitudeDelta;
  const showClusters = latDelta > SHOW_CLUSTERS_DELTA;
  const showHex = latDelta <= SHOW_CLUSTERS_DELTA && latDelta > HIDE_HEX_DELTA;

  const handleHexPress = useCallback((cell: HexCell) => {
    setSelectedHex(cell);
    setSelectedSession(null);
    mapRef.current?.animateToRegion(
      {
        latitude: cell.center.latitude,
        longitude: cell.center.longitude,
        latitudeDelta: Math.min(latDelta, 0.5),
        longitudeDelta: Math.min(latDelta, 0.5),
      },
      300,
    );
  }, [latDelta]);

  const handleSessionPress = useCallback((session: SessionPin) => {
    setSelectedSession(session);
    setSelectedHex(null);
  }, []);

  const loading = layer === "members" ? hexLoading : layer === "sessions" ? sessionsLoading : false;

  const popupCard = useMemo(() => {
    if (selectedHex && layer === "members") {
      return <HexPopupCard cell={selectedHex} onClose={() => setSelectedHex(null)} />;
    }
    if (selectedSession && layer === "sessions") {
      return (
        <SessionDetailCard
          session={selectedSession}
          onClose={() => setSelectedSession(null)}
          onNavigate={() => router.push(`/session/${encodeURIComponent(selectedSession.id)}`)}
        />
      );
    }
    return null;
  }, [selectedHex, selectedSession, layer, router]);

  // Flat array of map overlays to avoid children type issues with MapView
  const mapOverlays = useMemo(() => {
    if (layer === "members") {
      if (showClusters) {
        return hexCells.map((cell) => (
          <ClusterMarker key={cell.key} cell={cell} onPress={() => handleHexPress(cell)} />
        ));
      }
      if (showHex) {
        return hexCells.map((cell) => (
          <Polygon
            key={cell.key}
            coordinates={cell.corners}
            fillColor={hexFillColor(cell.count)}
            strokeColor={hexStrokeColor(cell.count)}
            strokeWidth={1}
            onPress={() => handleHexPress(cell)}
            tappable
          />
        ));
      }
      return [];
    }
    if (layer === "sessions") {
      return sessions.map((session) => (
        <SessionMarker
          key={session.id}
          session={session}
          selected={session.id === selectedSession?.id}
          onPress={() => handleSessionPress(session)}
        />
      ));
    }
    return [];
  }, [layer, showClusters, showHex, hexCells, sessions, selectedSession, handleHexPress, handleSessionPress]);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.root}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          initialRegion={CT_REGION}
          userInterfaceStyle="dark"
          backgroundColor="#1a2420"
          loadingBackgroundColor="#1a2420"
          showsUserLocation
          showsMyLocationButton={false}
          showsPointsOfInterest={false}
          onRegionChange={setRegion}
        >
          {mapOverlays}
        </MapView>

        {/* Transparent tap-to-dismiss overlay — sits below all controls */}
        {(selectedHex ?? selectedSession) ? (
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => { setSelectedHex(null); setSelectedSession(null); }}
            pointerEvents="box-only"
          />
        ) : null}

        {/* Top controls */}
        <View style={s.topBar} pointerEvents="box-none">
          <Pressable onPress={() => router.back()} hitSlop={10} style={s.backBtn}>
            <Text style={s.backBtnText}>‹ Back</Text>
          </Pressable>

          {/* Layer toggle */}
          <View style={s.layerToggle} pointerEvents="auto">
            {LAYERS.map(({ id, label }) => {
              const active = layer === id;
              return (
                <Pressable
                  key={id}
                  onPress={() => { setLayer(id); setSelectedHex(null); setSelectedSession(null); }}
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

        {/* Privacy note when too zoomed in on members */}
        {layer === "members" && !showHex && !showClusters && (
          <View style={s.privacyBanner} pointerEvents="none">
            <Text style={s.privacyBannerText}>Zoom out to see community density</Text>
          </View>
        )}

        {/* Legend for members layer */}
        {layer === "members" && (showHex || showClusters) && (
          <View style={s.legend} pointerEvents="none">
            <LegendRow color="rgba(163,230,53,0.7)" label="150+ members" />
            <LegendRow color="rgba(163,230,53,0.42)" label="50–150" />
            <LegendRow color="rgba(74,124,89,0.52)" label="10–50" />
            <LegendRow color="rgba(100,110,100,0.28)" label="Under 10" />
          </View>
        )}

        {/* Activity overlay */}
        {layer === "activity" && <ActivityOverlay stats={activityStats} />}

        {/* Loading indicator */}
        {loading && (
          <View style={s.loadingCenter} pointerEvents="none">
            <ActivityIndicator color={LIME} />
          </View>
        )}

        {/* Popup card (hex detail or session detail) */}
        {popupCard && (
          <View style={s.popupWrap}>{popupCard}</View>
        )}
      </View>
    </>
  );
}

function LegendRow({ color, label }: { color: string; label: string }) {
  return (
    <View style={s.legendRow}>
      <View style={[s.legendSwatch, { backgroundColor: color }]} />
      <Text style={s.legendLabel}>{label}</Text>
    </View>
  );
}

// ─── styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  // Top controls
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
    backgroundColor: "rgba(0,0,0,0.65)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  backBtnText: { color: CHALK, fontWeight: "600", fontSize: 15 },

  layerToggle: {
    flexDirection: "row",
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.72)",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: HAIRLINE,
    padding: 3,
    gap: 2,
  },
  layerBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
  },
  layerBtnActive: { backgroundColor: LIME },
  layerBtnText: { color: MUTED, fontWeight: "700", fontSize: 13 },
  layerBtnTextActive: { color: BG },

  // Map pin helpers
  pinCenter: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  pinNum: { fontSize: 15, fontWeight: "700" },

  // Legend
  legend: {
    position: "absolute",
    bottom: 200,
    right: 14,
    backgroundColor: "rgba(0,0,0,0.72)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: HAIRLINE,
    padding: 10,
    gap: 6,
  },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  legendSwatch: { width: 12, height: 12, borderRadius: 3, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)" },
  legendLabel: { color: CHALK, fontSize: 11, fontWeight: "600" },

  // Privacy notice
  privacyBanner: {
    position: "absolute",
    bottom: 200,
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.72)",
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: HAIRLINE,
  },
  privacyBannerText: { color: MUTED, fontSize: 13 },

  // Loading
  loadingCenter: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },

  // Popup card
  popupWrap: {
    position: "absolute",
    bottom: 34,
    left: 14,
    right: 14,
  },
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
    marginBottom: 14,
  },
  popupCity: { color: CHALK, fontSize: 18, fontWeight: "700" },
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
  popupGrid: {
    flexDirection: "row",
    gap: 8,
  },
  popupCta: {
    marginTop: 14,
    backgroundColor: LIME,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: "center",
  },
  popupCtaText: { color: BG, fontSize: 14, fontWeight: "700" },
  popupPrivacyNote: {
    marginTop: 10,
    padding: 10,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 8,
  },
  popupPrivacyText: { color: MUTED, fontSize: 12 },

  // Stat boxes
  statBox: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 12,
    padding: 10,
    alignItems: "center",
    gap: 4,
  },
  statValue: { fontSize: 22, fontWeight: "800" },
  statLabel: { color: MUTED, fontSize: 11, fontWeight: "600", textAlign: "center" },

  // Activity overlay
  activityOverlay: {
    position: "absolute",
    bottom: 34,
    left: 14,
    right: 14,
    backgroundColor: "rgba(11,15,13,0.92)",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: HAIRLINE,
    padding: 20,
  },
  activityTitle: {
    color: LIME,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 2,
    marginBottom: 4,
  },
  activityHeadline: {
    color: CHALK,
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 16,
  },
  activityCards: { gap: 10 },
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
  activityNote: {
    marginTop: 14,
    padding: 10,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 8,
  },
  activityNoteText: { color: MUTED, fontSize: 11 },
});
