import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import MapView, { Marker, type MapMarkerProps, Region } from "react-native-maps";
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

// Matches pickup_runs columns — the production table for pickup games.
export type Session = {
  id: string;
  title: string;
  location_private: string | null; // venue name (shown to confirmed players)
  latitude: number | null;
  longitude: number | null;
  start_at: string;               // note: pickup_runs uses start_at, not starts_at
  run_type: string;               // '7v7', '6v6', etc.
  level: Level | null;
  capacity: number;
  spots_taken: number;
  fee_cents: number;              // pickup_runs uses fee_cents, not price_cents
};

/* ------------------------------------------------------------------ data */


const FAIRFIELD: Region = {
  latitude: 40.8,
  longitude: -73.8,
  latitudeDelta: 3.5,
  longitudeDelta: 3.5,
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
      .from("pickup_runs")
      .select(
        "id,title,location_private,latitude,longitude,start_at,run_type,level,capacity,spots_taken,fee_cents",
      )
      .in("status", ["planning", "likely_on", "active", "in_progress"])
      .gte("start_at", new Date().toISOString())
      .not("latitude", "is", null)   // only show runs that have been geocoded
      .not("longitude", "is", null)
      .order("start_at", { ascending: true })
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
      .channel("pickup-runs-map")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "pickup_runs" },
        (payload) => {
          const next = payload.new as Session & { status: string };
          const active = ["planning", "likely_on", "active", "in_progress"];
          if (!active.includes(next.status) || !next.latitude || !next.longitude) return;
          setSessions((prev) =>
            prev.some((s) => s.id === next.id)
              ? prev
              : [...prev, next].sort(
                  (a, b) => Date.parse(a.start_at) - Date.parse(b.start_at),
                ),
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "pickup_runs" },
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

/* ------------------------------------------------------- training posts */

type TrainingPin = {
  id: string;
  field_name: string;
  latitude: number;
  longitude: number;
  status: string;
};

function useTrainingPosts() {
  const { supabase } = useAuth();
  const [posts, setPosts] = useState<TrainingPin[]>([]);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase
      .from("training_posts")
      .select("id,field_name,latitude,longitude,status")
      .eq("status", "active")
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .limit(60);
    if (data) setPosts(data as TrainingPin[]);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  return posts;
}

// Small "T" pin for someone actively training (distinct from session fill pins).
function TrainingMarkerPin({ post, onPress }: { post: TrainingPin; onPress: () => void }) {
  const [tracking, setTracking] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setTracking(false), 400);
    return () => clearTimeout(t);
  }, []);
  return (
    <Marker
      coordinate={{ latitude: post.latitude, longitude: post.longitude }}
      onPress={onPress}
      tracksViewChanges={tracking}
      anchor={{ x: 0.5, y: 0.5 }}
      zIndex={2}
    >
      <View style={styles.trainingPin}>
        <Text style={styles.trainingPinText} allowFontScaling={false}>
          T
        </Text>
      </View>
    </Marker>
  );
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

/* --------------------------------------------------- tracking marker (iOS) */

// react-native-maps snapshots custom markers on iOS — tracksViewChanges must
// be briefly true after spots_taken or selected changes, then false to keep
// map scrolling smooth.
function TrackingMarker({
  spots_taken,
  selected,
  children,
  ...rest
}: Omit<MapMarkerProps, "tracksViewChanges"> & {
  spots_taken: number;
  selected: boolean;
  children: React.ReactNode;
}) {
  const [tracking, setTracking] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setTracking(true);
    timer.current = setTimeout(() => setTracking(false), 400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [spots_taken, selected]);

  return (
    <Marker {...rest} tracksViewChanges={tracking}>
      {children}
    </Marker>
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
  const venue = session.location_private?.trim() || "Location TBD";
  const levelColor = session.level ? LEVEL_COLOR[session.level] : C.muted;

  return (
    <Pressable
      onPress={() => onPress(session)}
      accessibilityRole="button"
      accessibilityLabel={`${session.title} at ${venue}, ${full ? "full" : `${left} spots left`}`}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.88 }]}
    >
      <View style={styles.cardTopRow}>
        <View style={[styles.levelDot, { backgroundColor: levelColor }]} />
        <Text style={styles.cardLevel}>
          {session.level ? session.level.toUpperCase() : "PICKUP"} · {session.run_type}
        </Text>
        <Text style={styles.cardPrice}>${(session.fee_cents / 100).toFixed(0)}</Text>
      </View>

      <Text style={styles.cardVenue} numberOfLines={1}>
        {venue}
      </Text>
      <Text style={styles.cardWhen}>{whenLabel(session.start_at)}</Text>

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
  const { supabase, session: authSession } = useAuth();
  const [filter, setFilter] = useState<Level | "all">("all");

  const { sessions, loading, error, reload } = useSessions(filter);
  const trainingPosts = useTrainingPosts();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const mapRef = useRef<MapView>(null);
  const listRef = useRef<FlatList<Session>>(null);

  // ZIP modal state
  const [zipModalOpen, setZipModalOpen] = useState(false);
  const [zipInput, setZipInput] = useState("");
  const [zipCurrent, setZipCurrent] = useState<string | null>(null);
  const [zipSaving, setZipSaving] = useState(false);
  const [zipGpsLoading, setZipGpsLoading] = useState(false);

  // Load user's current ZIP from profile
  useEffect(() => {
    if (!supabase || !authSession?.user?.id) return;
    void supabase
      .from("profiles")
      .select("zip_code")
      .eq("id", authSession.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.zip_code) setZipCurrent(String(data.zip_code));
      });
  }, [supabase, authSession?.user?.id]);

  // Center map on user's GPS location on mount
  useEffect(() => {
    void (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        // Small delay ensures MapView is fully mounted before animating
        setTimeout(() => {
          mapRef.current?.animateToRegion({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            latitudeDelta: 0.18,
            longitudeDelta: 0.18,
          }, 500);
        }, 350);
      } catch {}
    })();
  }, []);

  async function detectGpsZip() {
    setZipGpsLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission denied", "Location access is required to detect your ZIP.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = pos.coords;
      const r = await fetch(
        `https://photon.komoot.io/reverse?lon=${longitude}&lat=${latitude}`,
        { headers: { "Accept-Language": "en" } },
      );
      const json = await r.json() as { features?: { properties?: { postcode?: string } }[] };
      const zip = json.features?.[0]?.properties?.postcode?.trim();
      if (zip) {
        setZipInput(zip);
      } else {
        Alert.alert("No ZIP found", "Could not determine ZIP code from your location.");
      }
    } catch {
      Alert.alert("Error", "Could not detect location. Please try again.");
    } finally {
      setZipGpsLoading(false);
    }
  }

  async function saveZip() {
    const zip = zipInput.trim();
    if (!zip || zip.length < 5) {
      Alert.alert("Invalid ZIP", "Please enter a valid 5-digit ZIP code.");
      return;
    }
    if (!supabase || !authSession?.user?.id) return;
    setZipSaving(true);
    try {
      const { error: updateErr } = await supabase
        .from("profiles")
        .update({ zip_code: zip })
        .eq("id", authSession.user.id);
      if (updateErr) throw updateErr;

      setZipCurrent(zip);
      setZipModalOpen(false);

      // Forward geocode ZIP to animate map there
      try {
        const r = await fetch(
          `https://photon.komoot.io/api/?q=${encodeURIComponent(zip + " CT USA")}&limit=1`,
          { headers: { "Accept-Language": "en" } },
        );
        const json = await r.json() as { features?: { geometry?: { coordinates?: [number, number] } }[] };
        const coords = json.features?.[0]?.geometry?.coordinates;
        if (coords) {
          mapRef.current?.animateToRegion({
            longitude: coords[0],
            latitude: coords[1],
            latitudeDelta: 0.12,
            longitudeDelta: 0.12,
          }, 500);
        }
      } catch {}
    } catch {
      Alert.alert("Error", "Could not save ZIP code. Please try again.");
    } finally {
      setZipSaving(false);
    }
  }

  const focus = useCallback((s: Session, index: number) => {
    setSelectedId(s.id);
    mapRef.current?.animateCamera(
      { center: { latitude: s.latitude!, longitude: s.longitude! }, zoom: 13 },
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
          { center: { latitude: s.latitude!, longitude: s.longitude! } },
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
        userInterfaceStyle="dark"
        backgroundColor="#1a2420"
        loadingBackgroundColor="#1a2420"
        showsUserLocation
        showsMyLocationButton={false}
        showsPointsOfInterest={false}
        onPress={() => setSelectedId(null)}
      >
        {sessions.map((s, i) => (
          <TrackingMarker
            key={s.id}
            coordinate={{ latitude: s.latitude!, longitude: s.longitude! }}
            onPress={() => focus(s, i)}
            spots_taken={s.spots_taken}
            selected={s.id === selectedId}
            zIndex={s.id === selectedId ? 99 : 1}
          >
            <FillPin
              level={s.level ?? "casual"}
              taken={s.spots_taken}
              capacity={s.capacity}
              selected={s.id === selectedId}
            />
          </TrackingMarker>
        ))}
        {trainingPosts.map((p) => (
          <TrainingMarkerPin
            key={p.id}
            post={p}
            onPress={() => router.push(`/training/${p.id}`)}
          />
        ))}
      </MapView>

      <View style={styles.topBar} pointerEvents="box-none">
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Text style={styles.backBtnText}>{"‹"} Back</Text>
        </Pressable>
        {header}
      </View>

      {/* ZIP pill — floated independently so it can never be hidden by chips */}
      <Pressable
        onPress={() => { setZipInput(zipCurrent ?? ""); setZipModalOpen(true); }}
        style={styles.zipPill}
      >
        <Text style={styles.zipPillText}>
          📍 {zipCurrent ? zipCurrent : "My Location"}
        </Text>
      </Pressable>

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

      {/* ZIP Update Modal */}
      <Modal
        visible={zipModalOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setZipModalOpen(false)}
      >
        <KeyboardAvoidingView
          style={styles.zipModal}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.zipModalHeader}>
            <Text style={styles.zipModalTitle}>Update My Location</Text>
            <Pressable onPress={() => setZipModalOpen(false)} hitSlop={10}>
              <Text style={styles.zipModalClose}>✕</Text>
            </Pressable>
          </View>

          <Text style={styles.zipModalLabel}>ZIP CODE</Text>
          <TextInput
            style={styles.zipInput}
            value={zipInput}
            onChangeText={(v) => setZipInput(v.replace(/[^0-9]/g, "").slice(0, 5))}
            keyboardType="number-pad"
            returnKeyType="done"
            placeholder="e.g. 06880"
            placeholderTextColor="rgba(255,255,255,0.25)"
            maxLength={5}
            autoFocus
          />

          <Pressable
            onPress={() => void detectGpsZip()}
            disabled={zipGpsLoading}
            style={[styles.zipGpsBtn, zipGpsLoading && { opacity: 0.5 }]}
          >
            {zipGpsLoading
              ? <ActivityIndicator color="#0a0a0a" size="small" />
              : <Text style={styles.zipGpsBtnText}>📡 Use my GPS</Text>}
          </Pressable>

          <Pressable
            onPress={() => void saveZip()}
            disabled={zipSaving || zipInput.length < 5}
            style={[styles.zipSaveBtn, (zipSaving || zipInput.length < 5) && { opacity: 0.4 }]}
          >
            {zipSaving
              ? <ActivityIndicator color="#0a0a0a" />
              : <Text style={styles.zipSaveBtnText}>Save ZIP</Text>}
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

/* ----------------------------------------------------------------- styles */

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },

  topBar: { position: "absolute", top: 60, left: 0, right: 0 },
  backBtn: { marginLeft: 12, marginBottom: 8, backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, alignSelf: "flex-start" },
  backBtnText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  zipPill: { position: "absolute", top: 60, right: 12, zIndex: 999, backgroundColor: "rgba(0,0,0,0.75)", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: "rgba(163,230,53,0.5)" },
  zipPillText: { color: "#a3e635", fontWeight: "700", fontSize: 13 },
  filterRow: { flexDirection: "row", paddingHorizontal: 16, gap: 8 },

  zipModal: { flex: 1, backgroundColor: "#0a0a0a", padding: 24 },
  zipModalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 28, paddingTop: 8 },
  zipModalTitle: { color: "#fff", fontSize: 20, fontWeight: "700" },
  zipModalClose: { color: "rgba(255,255,255,0.5)", fontSize: 20 },
  zipModalLabel: { color: "rgba(255,255,255,0.45)", fontSize: 11, fontWeight: "700", letterSpacing: 1.2, marginBottom: 8 },
  zipInput: { backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", color: "#fff", fontSize: 28, fontWeight: "700", paddingHorizontal: 18, paddingVertical: 14, textAlign: "center", letterSpacing: 6, marginBottom: 16 },
  zipGpsBtn: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 14, paddingVertical: 16, alignItems: "center", marginBottom: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" },
  zipGpsBtnText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  zipSaveBtn: { backgroundColor: "#a3e635", borderRadius: 14, paddingVertical: 16, alignItems: "center" },
  zipSaveBtnText: { color: "#0a0a0a", fontWeight: "800", fontSize: 16 },
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
  trainingPin: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: C.bg,
    borderWidth: 2,
    borderColor: "#a3e635",
    alignItems: "center",
    justifyContent: "center",
  },
  trainingPinText: { color: "#a3e635", fontSize: 13, fontWeight: "800" },

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
