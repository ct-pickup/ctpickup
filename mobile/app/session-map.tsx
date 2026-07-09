import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import MapView, { Marker, Region } from "react-native-maps";
import Svg, { Circle } from "react-native-svg";
import * as Location from "expo-location";
import { format, isToday, isTomorrow } from "date-fns";
import { useRouter } from "expo-router";
import { useAuth } from "@/context/AuthContext";

/* ---------------------------------------------------------------- tokens */

const C = {
  bg: "#0B0F0D",
  surface: "#151B18",
  surfaceLift: "#1E2723",
  hairline: "#2A342E",
  chalk: "#F2F4F1",
  muted: "#8A968F",
  casual: "#6B8F71",
  competitive: "#E8B62C",
  elite: "#E24E32",
  live: "#4ADE80",
};

type Level = "casual" | "competitive" | "elite";
const LEVEL_COLOR: Record<Level, string> = {
  casual: C.casual,
  competitive: C.competitive,
  elite: C.elite,
};

const { width: SCREEN_W } = Dimensions.get("window");
const CARD_W = SCREEN_W * 0.82;
const CARD_GAP = 12;

/* ----------------------------------------------------------------- types */

export type Session = {
  id: string;
  title: string;
  venue_name: string;
  latitude: number;
  longitude: number;
  starts_at: string;
  format: string;
  level: Level;
  capacity: number;
  spots_taken: number;
  price_cents: number;
};

/* ------------------------------------------------------------------ data */

const FAIRFIELD: Region = {
  latitude: 41.1412,
  longitude: -73.3579,
  latitudeDelta: 0.42,
  longitudeDelta: 0.42,
};

function useSessions(level: Level | "all") {
  const { supabase } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    let q = supabase
      .from("sessions")
      .select(
        "id,title,venue_name,latitude,longitude,starts_at,format,level,capacity,spots_taken,price_cents",
      )
      .eq("status", "published")
      .gte("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true })
      .limit(60);

    if (level !== "all") q = q.eq("level", level);

    const { data, error } = await q;
    if (error) setError("Could not load sessions. Pull to retry.");
    else {
      setSessions(data as Session[]);
      setError(null);
    }
    setLoading(false);
  }, [supabase, level]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live seat counts — a pin showing "2 left" that's stale is worse than no pin.
  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel("sessions-seats")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "sessions" },
        (payload) => {
          const next = payload.new as Session;
          setSessions((prev) =>
            prev.map((s) => (s.id === next.id ? { ...s, spots_taken: next.spots_taken } : s)),
          );
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase]);

  return { sessions, loading, error, reload: load };
}

/* ------------------------------------------------------------- fill pin */

function FillPin({
  level,
  taken,
  capacity,
  selected,
}: {
  level: Level;
  taken: number;
  capacity: number;
  selected: boolean;
}) {
  const size = selected ? 52 : 44;
  const r = size / 2 - 4;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(taken / capacity, 1);
  const left = capacity - taken;
  const full = left <= 0;
  const color = full ? C.muted : LEVEL_COLOR[level];

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} fill={C.surface} />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={C.hairline} strokeWidth={3} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={3}
          fill="none"
          strokeDasharray={`${circ * pct} ${circ}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={styles.pinLabel}>
        <Text style={[styles.pinNum, { color: full ? C.muted : C.chalk }]} allowFontScaling={false}>
          {full ? "—" : left}
        </Text>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------ session card */

function whenLabel(iso: string) {
  const d = new Date(iso);
  const t = format(d, "h:mm a");
  if (isToday(d)) return `Today · ${t}`;
  if (isTomorrow(d)) return `Tomorrow · ${t}`;
  return `${format(d, "EEE MMM d")} · ${t}`;
}

function SessionCard({ session, onPress }: { session: Session; onPress: (s: Session) => void }) {
  const left = session.capacity - session.spots_taken;
  const full = left <= 0;

  return (
    <Pressable
      onPress={() => onPress(session)}
      accessibilityRole="button"
      accessibilityLabel={`${session.title} at ${session.venue_name}, ${full ? "full" : `${left} spots left`}`}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.88 }]}
    >
      <View style={styles.cardTopRow}>
        <View style={[styles.levelDot, { backgroundColor: LEVEL_COLOR[session.level] }]} />
        <Text style={styles.cardLevel}>
          {session.level.toUpperCase()} · {session.format}
        </Text>
        <Text style={styles.cardPrice}>${(session.price_cents / 100).toFixed(0)}</Text>
      </View>

      <Text style={styles.cardVenue} numberOfLines={1}>
        {session.venue_name}
      </Text>
      <Text style={styles.cardWhen}>{whenLabel(session.starts_at)}</Text>

      <View style={styles.cardBottomRow}>
        <Text style={[styles.cardSpots, full && { color: C.muted }]}>
          {full ? "Full — join waitlist" : `${left} of ${session.capacity} spots left`}
        </Text>
        <View style={[styles.cta, full && { backgroundColor: C.surfaceLift }]}>
          <Text style={[styles.ctaText, full && { color: C.muted }]}>
            {full ? "Waitlist" : "Reserve"}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

/* ----------------------------------------------------------------- screen */

const FILTERS: Array<Level | "all"> = ["all", "casual", "competitive", "elite"];

export default function SessionMapScreen() {
  const router = useRouter();
  const [filter, setFilter] = useState<Level | "all">("all");
  const { sessions, loading, error, reload } = useSessions(filter);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const mapRef = useRef<MapView>(null);
  const listRef = useRef<FlatList<Session>>(null);

  useEffect(() => {
    void (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const pos = await Location.getCurrentPositionAsync({});
      mapRef.current?.animateToRegion({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        latitudeDelta: 0.18,
        longitudeDelta: 0.18,
      });
    })();
  }, []);

  const focus = useCallback((s: Session, index: number) => {
    setSelectedId(s.id);
    mapRef.current?.animateCamera(
      { center: { latitude: s.latitude, longitude: s.longitude }, zoom: 13 },
      { duration: 320 },
    );
    listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
  }, []);

  const onCardScroll = useCallback(
    (e: { nativeEvent: { contentOffset: { x: number } } }) => {
      const i = Math.round(e.nativeEvent.contentOffset.x / (CARD_W + CARD_GAP));
      const s = sessions[i];
      if (s && s.id !== selectedId) {
        setSelectedId(s.id);
        mapRef.current?.animateCamera(
          { center: { latitude: s.latitude, longitude: s.longitude } },
          { duration: 260 },
        );
      }
    },
    [sessions, selectedId],
  );

  const empty = !loading && sessions.length === 0;

  const header = useMemo(
    () => (
      <View style={styles.filterRow}>
        {FILTERS.map((f) => {
          const on = filter === f;
          return (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[styles.chip, on && styles.chipOn]}
            >
              {f !== "all" && (
                <View style={[styles.levelDot, { backgroundColor: LEVEL_COLOR[f as Level] }]} />
              )}
              <Text style={[styles.chipText, on && styles.chipTextOn]}>
                {f === "all" ? "All levels" : f[0].toUpperCase() + f.slice(1)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    ),
    [filter],
  );

  return (
    <View style={styles.root}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={FAIRFIELD}
        showsUserLocation
        showsMyLocationButton={false}
        showsPointsOfInterest={false}
        userInterfaceStyle="dark"
        onPress={() => setSelectedId(null)}
      >
        {sessions.map((s, i) => (
          <Marker
            key={s.id}
            coordinate={{ latitude: s.latitude, longitude: s.longitude }}
            onPress={() => focus(s, i)}
            tracksViewChanges={Platform.OS === "android"}
            zIndex={s.id === selectedId ? 99 : 1}
          >
            <FillPin
              level={s.level}
              taken={s.spots_taken}
              capacity={s.capacity}
              selected={s.id === selectedId}
            />
          </Marker>
        ))}
      </MapView>

      <View style={styles.topBar} pointerEvents="box-none">
        {header}
      </View>

      {loading && (
        <View style={styles.center} pointerEvents="none">
          <ActivityIndicator color={C.chalk} />
        </View>
      )}

      {error && (
        <Pressable style={styles.banner} onPress={() => void reload()}>
          <Text style={styles.bannerText}>{error}</Text>
        </Pressable>
      )}

      {empty && (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>No sessions here yet</Text>
          <Text style={styles.emptyBody}>
            Host one and we'll fill it. Sessions in Fairfield County average 11 players within 48
            hours of posting.
          </Text>
          <Pressable style={styles.emptyCta} onPress={() => router.push("/session-create")}>
            <Text style={styles.emptyCtaText}>Host a session</Text>
          </Pressable>
        </View>
      )}

      {!empty && (
        <FlatList
          ref={listRef}
          data={sessions}
          keyExtractor={(s) => s.id}
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={CARD_W + CARD_GAP}
          decelerationRate="fast"
          contentContainerStyle={styles.carousel}
          onMomentumScrollEnd={onCardScroll}
          onScrollToIndexFailed={() => {}}
          style={styles.carouselWrap}
          renderItem={({ item }) => (
            <SessionCard
              session={item}
              onPress={(s) => router.push(`/session/${encodeURIComponent(s.id)}`)}
            />
          )}
        />
      )}
    </View>
  );
}

/* ----------------------------------------------------------------- styles */

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },

  topBar: { position: "absolute", top: 60, left: 0, right: 0 },
  filterRow: { flexDirection: "row", paddingHorizontal: 16, gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.hairline,
  },
  chipOn: { backgroundColor: C.chalk, borderColor: C.chalk },
  chipText: { color: C.muted, fontSize: 13, fontWeight: "600" },
  chipTextOn: { color: C.bg },

  pinLabel: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  pinNum: { fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"] },

  carouselWrap: { position: "absolute", bottom: 34, left: 0, right: 0 },
  carousel: { paddingHorizontal: (SCREEN_W - CARD_W) / 2, gap: CARD_GAP },

  card: {
    width: CARD_W,
    backgroundColor: C.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.hairline,
    padding: 16,
  },
  cardTopRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  levelDot: { width: 7, height: 7, borderRadius: 4 },
  cardLevel: { color: C.muted, fontSize: 11, fontWeight: "700", letterSpacing: 0.8, flex: 1 },
  cardPrice: { color: C.chalk, fontSize: 13, fontWeight: "700" },
  cardVenue: { color: C.chalk, fontSize: 19, fontWeight: "700", marginTop: 10 },
  cardWhen: { color: C.muted, fontSize: 13, marginTop: 3 },
  cardBottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 16,
  },
  cardSpots: { color: C.chalk, fontSize: 13, fontWeight: "600", flexShrink: 1 },
  cta: { backgroundColor: C.chalk, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999 },
  ctaText: { color: C.bg, fontSize: 13, fontWeight: "700" },

  banner: {
    position: "absolute",
    bottom: 200,
    alignSelf: "center",
    backgroundColor: C.surfaceLift,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
  },
  bannerText: { color: C.chalk, fontSize: 13 },

  emptyWrap: {
    position: "absolute",
    bottom: 40,
    left: 20,
    right: 20,
    backgroundColor: C.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.hairline,
    padding: 20,
  },
  emptyTitle: { color: C.chalk, fontSize: 18, fontWeight: "700" },
  emptyBody: { color: C.muted, fontSize: 14, lineHeight: 20, marginTop: 6 },
  emptyCta: {
    marginTop: 16,
    backgroundColor: C.chalk,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: "center",
  },
  emptyCtaText: { color: C.bg, fontSize: 14, fontWeight: "700" },
});
