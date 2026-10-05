import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
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
import { requestLocationWithExplainer } from "@/lib/locationPrompt";
import { useRouter } from "expo-router";
import { useAuth } from "@/context/AuthContext";

import FontAwesome from "@expo/vector-icons/FontAwesome";
import { ChalkEmptyState } from "@/components/chalk";
import { FinderFilterBar, FinderFilterSheet } from "@/components/games/FinderFilters";
import { filterRuns, hubRegionDelta, NO_FINDER_FILTERS, type FinderFilters } from "@/lib/finderFilters";
import { finderHubById } from "@/lib/finderHubs";
import { fetchRunMinStars } from "@/lib/starRatings";
import PlayedWithRow, { usePlayedWith } from "@/components/pickup/PlayedWithRow";
import type { PlayedWithSummary } from "@/lib/matchApi";
import { fmtPickupWhenEt, runTimeTbd } from "@/lib/pickup/runStartAtDisplay";
import { withRunTimeTbd } from "@/lib/pickup/runTimeTbd";
import { headline, themeColor, themeNow, useThemedStyles } from "@/theme";
/* ---------------------------------------------------------------- tokens */

function C() {
  return {
  bg: themeColor().bg,
  surface: themeColor().card,
  surfaceLift: themeColor().card,
  hairline: themeColor().line,
  chalk: themeColor().text,
  muted: themeColor().muted,
  casual: themeColor().pitch,
  competitive: themeColor().muted,
  elite: themeColor().text,
  live: themeColor().pitch,
};
}

type Level = "casual" | "competitive" | "elite";
const LEVEL_COLOR: Record<Level, string> = {
  casual: C().casual,
  competitive: C().competitive,
  elite: C().elite,
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
  time_tbd?: boolean;
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

function isSessionLive(startAt: string | null | undefined): boolean {
  if (!startAt) return false;
  const start = Date.parse(startAt);
  if (!Number.isFinite(start)) return false;
  const now = Date.now();
  return now >= start && now < start + 2 * 60 * 60 * 1000;
}

function LivePulseDot({ size = 8 }: { size?: number }) {
  useThemedStyles(publish_styles);

  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.25, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);
  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: C().live,
        opacity,
      }}
    />
  );
}

function useSessions(level: Level | "all") {
  useThemedStyles(publish_styles);

  const { supabase } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    let q = supabase
      .from("pickup_runs")
      .select(
        "id,title,location_private,latitude,longitude,start_at,run_type,level,capacity,spots_taken,fee_cents",
      )
      .or(
        `status.in.(planning,likely_on,active,in_progress),and(status.eq.completed,start_at.gte."${twoHoursAgo}")`,
      )
      .gte("start_at", twoHoursAgo)
      .not("latitude", "is", null) // only show runs that have been geocoded
      .not("longitude", "is", null)
      .order("start_at", { ascending: true })
      .limit(60);

    if (level !== "all") q = q.eq("level", level);

    const { data, error } = await q;
    if (error) setError("Could not load sessions. Pull to retry.");
    else {
      setSessions(await withRunTimeTbd(supabase, data as Session[]));
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
          const active = ["planning", "likely_on", "active", "in_progress", "completed"];
          const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
          if (!active.includes(next.status) || !next.latitude || !next.longitude) return;
          if (Date.parse(next.start_at) < twoHoursAgo) return;
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
  useThemedStyles(publish_styles);

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
  useThemedStyles(publish_styles);

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
  live,
}: {
  level: Level;
  taken: number;
  capacity: number;
  selected: boolean;
  live?: boolean;
}) {
  useThemedStyles(publish_styles);

  const size = selected ? 52 : 44;
  const r = size / 2 - 4;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(taken / capacity, 1);
  const left = capacity - taken;
  const full = left <= 0;
  const color = full ? C().muted : LEVEL_COLOR[level];

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} fill={C().surface} />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={C().hairline} strokeWidth={3} fill="none" />
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
        <Text style={[styles.pinNum, { color: full ? C().muted : C().chalk }]} allowFontScaling={false}>
          {full ? "—" : left}
        </Text>
      </View>
      {live ? (
        <View style={styles.livePinBadge}>
          <LivePulseDot size={8} />
        </View>
      ) : null}
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
  live,
  children,
  ...rest
}: Omit<MapMarkerProps, "tracksViewChanges"> & {
  spots_taken: number;
  selected: boolean;
  live?: boolean;
  children: React.ReactNode;
}) {
  useThemedStyles(publish_styles);

  const [tracking, setTracking] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setTracking(true);
    timer.current = setTimeout(() => setTracking(false), 400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [spots_taken, selected, live]);

  return (
    <Marker {...rest} tracksViewChanges={tracking}>
      {children}
    </Marker>
  );
}

/* ------------------------------------------------------------ session card */


function SessionCard({
  session,
  playedWith,
  onPress,
}: {
  session: Session;
  playedWith: PlayedWithSummary | undefined;
  onPress: (s: Session) => void;
}) {
  useThemedStyles(publish_styles);

  const left = session.capacity - session.spots_taken;
  const full = left <= 0;
  const venue = session.location_private?.trim() || "Location TBD";
  const levelColor = session.level ? LEVEL_COLOR[session.level] : C().muted;
  const live = !runTimeTbd(session) && isSessionLive(session.start_at);

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
        {live ? (
          <View style={styles.liveBadge}>
            <LivePulseDot size={7} />
            <Text style={styles.liveBadgeText}>LIVE</Text>
          </View>
        ) : null}
        <Text style={styles.cardPrice}>${(session.fee_cents / 100).toFixed(0)}</Text>
      </View>

      <Text style={styles.cardVenue} numberOfLines={1}>
        {venue}
      </Text>
      <Text style={styles.cardWhen}>{fmtPickupWhenEt(session.start_at, runTimeTbd(session))}</Text>
      <PlayedWithRow summary={playedWith} style={styles.cardPlayedWith} />

      <View style={styles.cardBottomRow}>
        <Text style={[styles.cardSpots, full && { color: C().muted }]}>
          {full ? "Full — join waitlist" : `${left} of ${session.capacity} spots left`}
        </Text>
        <View style={[styles.cta, full && { backgroundColor: C().surfaceLift }]}>
          <Text style={[styles.ctaText, full && { color: C().muted }]}>
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

  const { sessions: allSessions, loading, error, reload } = useSessions(filter);
  const [filters, setFilters] = useState<FinderFilters>(NO_FINDER_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [minStars, setMinStars] = useState<Map<string, number>>(new Map());
  const sessions = useMemo(() => filterRuns(allSessions, filters, minStars), [allSessions, filters, minStars]);

  // Minimum levels for the star filter. A missing column reads as no minimum (every game open).
  useEffect(() => {
    if (!supabase || allSessions.length === 0) return;
    let live = true;
    void fetchRunMinStars(supabase, allSessions.map((s) => s.id)).then((m) => {
      if (live) setMinStars(m);
    });
    return () => {
      live = false;
    };
  }, [supabase, allSessions]);
  const playedWith = usePlayedWith(sessions.map((s) => s.id)).byRun;
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
        if ((await requestLocationWithExplainer({ auto: true })) !== "granted") return;
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
      const access = await requestLocationWithExplainer();
      if (access !== "granted") {
        if (access === "denied") Alert.alert("Permission denied", "Location access is required to detect your ZIP.");
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

  const empty = !loading && allSessions.length === 0;
  const noMatch = !loading && allSessions.length > 0 && sessions.length === 0;

  /** Hub: center and zoom the map and cut the list to its radius. Nearby: back to the player's location, no cut. */
  const recenter = useCallback(async (hubId: string | null) => {
    const hub = finderHubById(hubId);
    if (hub) {
      const d = hubRegionDelta(hub.radiusMiles);
      mapRef.current?.animateToRegion({ latitude: hub.lat, longitude: hub.lng, latitudeDelta: d, longitudeDelta: d }, 500);
      return;
    }
    try {
      if ((await requestLocationWithExplainer({ auto: true })) !== "granted") return;
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      mapRef.current?.animateToRegion({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, latitudeDelta: 0.18, longitudeDelta: 0.18 }, 500);
    } catch {}
  }, []);
  const changeFilters = useCallback(
    (next: FinderFilters) => {
      setFilters(next);
      if (next.hubId !== filters.hubId) void recenter(next.hubId);
    },
    [filters.hubId, recenter],
  );

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
        userInterfaceStyle={themeNow().mode}
        backgroundColor={themeColor().card}
        loadingBackgroundColor={themeColor().card}
        showsUserLocation
        showsMyLocationButton={false}
        showsPointsOfInterest={false}
        onPress={() => setSelectedId(null)}
      >
        {sessions.map((s, i) => {
          const live = !runTimeTbd(s) && isSessionLive(s.start_at);
          return (
            <TrackingMarker
              key={s.id}
              coordinate={{ latitude: s.latitude!, longitude: s.longitude! }}
              onPress={() => focus(s, i)}
              spots_taken={s.spots_taken}
              selected={s.id === selectedId}
              live={live}
              zIndex={s.id === selectedId ? 99 : 1}
            >
              <FillPin
                level={s.level ?? "casual"}
                taken={s.spots_taken}
                capacity={s.capacity}
                selected={s.id === selectedId}
                live={live}
              />
            </TrackingMarker>
          );
        })}
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
        <FinderFilterBar filters={filters} onOpen={() => setFiltersOpen(true)} onChange={changeFilters} />
      </View>

      {/* ZIP pill — floated independently so it can never be hidden by chips */}
      <Pressable
        onPress={() => { setZipInput(zipCurrent ?? ""); setZipModalOpen(true); }}
        style={styles.zipPill}
      >
        <Text style={styles.zipPillText}>
          <FontAwesome name="map-marker" size={13} color={themeColor().pitchText} />{" "}
          {zipCurrent ? zipCurrent : "My Location"}
        </Text>
      </Pressable>

      {loading && (
        <View style={styles.center} pointerEvents="none">
          <ActivityIndicator color={C().chalk} />
        </View>
      )}

      {error && (
        <Pressable style={styles.banner} onPress={() => void reload()}>
          <Text style={styles.bannerText}>{error}</Text>
        </Pressable>
      )}

      {empty && (
        <View style={styles.emptyWrap}>
          <ChalkEmptyState
            graphic="circle"
            size="sm"
            title="No sessions here yet"
            body="Host one and we'll fill it. Sessions in Fairfield County average 11 players within 48 hours of posting."
            actionLabel="Host a session"
            onAction={() => router.push("/session-create")}
          />
        </View>
      )}

      {noMatch && (
        <View style={styles.emptyWrap}>
          <ChalkEmptyState
            graphic="circle"
            size="sm"
            title="No games match these filters"
            body="Try a different day, time or place."
            actionLabel="Clear filters"
            onAction={() => changeFilters(NO_FINDER_FILTERS)}
          />
          <Pressable onPress={() => router.push("/session-create")} style={styles.noMatchHost} accessibilityRole="button">
            <Text style={styles.noMatchHostText}>Host a game</Text>
          </Pressable>
        </View>
      )}

      {!empty && !noMatch && (
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
              playedWith={playedWith[item.id]}
              onPress={(s) => router.push(`/session/${encodeURIComponent(s.id)}`)}
            />
          )}
        />
      )}

      <FinderFilterSheet visible={filtersOpen} onClose={() => setFiltersOpen(false)} filters={filters} onChange={changeFilters} onPickHub={(id) => changeFilters({ ...filters, hubId: id })} />

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
            placeholderTextColor={themeColor().muted}
            maxLength={5}
            autoFocus
          />

          <Pressable
            onPress={() => void detectGpsZip()}
            disabled={zipGpsLoading}
            style={[styles.zipGpsBtn, zipGpsLoading && { opacity: 0.5 }]}
          >
            {zipGpsLoading
              ? <ActivityIndicator color={themeColor().onPitch} size="small" />
              : <Text style={styles.zipGpsBtnText}>
                  <FontAwesome name="location-arrow" size={16} color={themeColor().text} /> Use my GPS
                </Text>}
          </Pressable>

          <Pressable
            onPress={() => void saveZip()}
            disabled={zipSaving || zipInput.length < 5}
            style={[styles.zipSaveBtn, (zipSaving || zipInput.length < 5) && { opacity: 0.4 }]}
          >
            {zipSaving
              ? <ActivityIndicator color={themeColor().onPitch} />
              : <Text style={styles.zipSaveBtnText}>Save ZIP</Text>}
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

/* ----------------------------------------------------------------- styles */

function make_styles() {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: C().bg },
  center: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },

  topBar: { position: "absolute", top: 60, left: 0, right: 0 },
  backBtn: { marginLeft: 12, marginBottom: 8, backgroundColor: themeColor().card, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, alignSelf: "flex-start" },
  backBtnText: { color: themeColor().text, fontWeight: "600", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  zipPill: { position: "absolute", top: 60, right: 12, zIndex: 999, backgroundColor: themeColor().card, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: themeColor().pitch },
  zipPillText: { color: themeColor().pitchText, fontWeight: "700", fontSize: 13, fontFamily: "Inter_700Bold" },
  filterRow: { flexDirection: "row", paddingHorizontal: 16, gap: 8 },

  zipModal: { flex: 1, backgroundColor: themeColor().bg, padding: 24 },
  zipModalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 28, paddingTop: 8 },
  zipModalTitle: { color: themeColor().text, fontSize: 20, ...headline },
  zipModalClose: { color: themeColor().muted, fontSize: 20, ...headline },
  zipModalLabel: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700", marginBottom: 8 },
  zipInput: { backgroundColor: themeColor().overlay, borderRadius: 12, borderWidth: 1, borderColor: themeColor().line, color: themeColor().text, fontSize: 24, ...headline, paddingHorizontal: 16, paddingVertical: 12, textAlign: "center", marginBottom: 16 },
  zipGpsBtn: { backgroundColor: themeColor().overlay, borderRadius: 12, paddingVertical: 16, alignItems: "center", marginBottom: 12, borderWidth: 1, borderColor: themeColor().line },
  zipGpsBtnText: { color: themeColor().text, fontWeight: "600", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  zipSaveBtn: { backgroundColor: themeColor().pitch, borderRadius: 12, paddingVertical: 16, alignItems: "center" },
  zipSaveBtnText: { color: themeColor().onPitch, fontWeight: "800", fontSize: 16, fontFamily: "Inter_700Bold" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: C().surface,
    borderWidth: 1,
    borderColor: C().hairline,
  },
  chipOn: { backgroundColor: C().chalk, borderColor: C().chalk },
  chipText: { color: C().muted, fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  chipTextOn: { color: C().bg },

  pinLabel: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  pinNum: { fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700", fontVariant: ["tabular-nums"] },
  livePinBadge: {
    position: "absolute",
    top: 2,
    right: 2,
    width: 12,
    height: 12,
    borderRadius: 10,
    backgroundColor: C().bg,
    alignItems: "center",
    justifyContent: "center",
  },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginLeft: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: themeColor().pitchPanel,
  },
  liveBadgeText: {
    color: C().live,
    fontSize: 11, fontFamily: "Inter_700Bold",
    fontWeight: "800",
  },
  trainingPin: {
    width: 26,
    height: 26,
    borderRadius: 12,
    backgroundColor: C().bg,
    borderWidth: 2,
    borderColor: themeColor().pitch,
    alignItems: "center",
    justifyContent: "center",
  },
  trainingPinText: { color: themeColor().pitchText, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "800" },

  noMatchHost: { alignSelf: "center", paddingVertical: 12 },
  noMatchHostText: { color: themeColor().pitchText, fontSize: 15, fontFamily: "Inter_700Bold", fontWeight: "700" },
  carouselWrap: { position: "absolute", bottom: 34, left: 0, right: 0 },
  carousel: { paddingHorizontal: (SCREEN_W - CARD_W) / 2, gap: CARD_GAP },

  card: {
    width: CARD_W,
    backgroundColor: C().surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C().hairline,
    padding: 16,
  },
  cardTopRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  levelDot: { width: 7, height: 7, borderRadius: 10 },
  cardLevel: { color: C().muted, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700", flex: 1 },
  cardPrice: { color: C().chalk, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700" },
  cardVenue: { color: C().chalk, fontSize: 20, ...headline, marginTop: 8 },
  cardWhen: { color: C().muted, fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4 },
  cardPlayedWith: { marginTop: 8 },
  cardBottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 16,
  },
  cardSpots: { color: C().chalk, fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600", flexShrink: 1 },
  cta: { backgroundColor: C().chalk, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999 },
  ctaText: { color: C().bg, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700" },

  banner: {
    position: "absolute",
    bottom: 200,
    alignSelf: "center",
    backgroundColor: C().surfaceLift,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
  },
  bannerText: { color: C().chalk, fontSize: 13, fontFamily: "Inter_400Regular" },

  emptyWrap: {
    position: "absolute",
    bottom: 40,
    left: 20,
    right: 20,
    backgroundColor: C().surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C().hairline,
  },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}

