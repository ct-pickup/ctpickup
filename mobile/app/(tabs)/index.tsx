import { useAuth } from "@/context/AuthContext";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { format, isToday, isTomorrow } from "date-fns";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, type Region } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Line, Rect } from "react-native-svg";

import type { Session } from "../session-map";

const LIME = "#a3e635";
const CARD_BG = "rgba(255,255,255,0.04)";
const CARD_BORDER = "rgba(255,255,255,0.08)";

const DARK_MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#0a0f0a" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#4a5e4e" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0a0f0a" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#1a2b1e" }] },
  { featureType: "administrative.country", elementType: "labels.text.fill", stylers: [{ color: "#4a5e4e" }] },
  { featureType: "administrative.land_parcel", stylers: [{ visibility: "off" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#6b8f71" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#0d1a10" }] },
  { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#1a2b1e" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#141f14" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#0a0f0a" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#2a3a2e" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#1a2b1e" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#1e3020" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#0d1a10" }] },
  { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#3a5a3e" }] },
  { featureType: "road.local", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#060d08" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#1a2b1e" }] },
];

/* ----------------------------------------------------------------- tiers */

type TierMeta = { label: string; color: string; diamond?: boolean };
const TIER_META: Record<string, TierMeta> = {
  diamond: { label: "Diamond", color: "#9B59B6", diamond: true },
  platinum: { label: "Platinum", color: "#E8E8E8" },
  gold: { label: "Gold", color: "#E3B23C" },
  silver: { label: "Silver", color: "#A8B0B5" },
  bronze: { label: "Bronze", color: "#B87333" },
};

function tierMeta(raw: string | null | undefined): TierMeta | null {
  const key = (raw ?? "").toLowerCase().trim();
  return TIER_META[key] ?? null;
}

/* --------------------------------------------------------------- helpers */

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function firstNameFromEmail(email: string | undefined): string {
  if (!email) return "there";
  const local = email.split("@")[0]?.trim() ?? "";
  const word = local.replace(/[._-]+/g, " ").trim().split(" ")[0] ?? "";
  if (!word) return "there";
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function whenLabel(iso: string): string {
  const d = new Date(iso);
  const t = format(d, "h:mm a");
  if (isToday(d)) return `Today · ${t}`;
  if (isTomorrow(d)) return `Tomorrow · ${t}`;
  return `${format(d, "EEE MMM d")} · ${t}`;
}

/* --------------------------------------------------------------- types */

type MapRun = Session & { min_tier: string | null; location_text: string | null };

type FriendPlaying = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  tier: string | null;
  start_at: string;
};

type NextMatch = {
  id: string;
  title: string | null;
  start_at: string;
  location_text: string | null;
  capacity: number;
  spots_taken: number;
  fee_cents: number;
  min_tier: string | null;
};

const FAIRFIELD: Region = {
  latitude: 40.8,
  longitude: -73.8,
  latitudeDelta: 3.5,
  longitudeDelta: 3.5,
};

const ACTIVE_STATUSES = ["planning", "likely_on", "active", "in_progress"];

function pinColor(left: number, minTier: string | null): string {
  if (left >= 1 && left <= 2) return "#ef4444"; // almost full
  const t = (minTier ?? "").toLowerCase();
  if (t === "gold" || t === "diamond" || t === "platinum") return "#9B59B6"; // Gold+
  return LIME; // open
}

/* --------------------------------------------------------------- data */

function useHomeData() {
  const { session, supabase } = useAuth();
  const myUserId = session?.user?.id ?? null;

  const [firstName, setFirstName] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [verificationLevel, setVerificationLevel] = useState<string>("self");
  const [tier, setTier] = useState<string | null>(null);
  const [nextMatch, setNextMatch] = useState<NextMatch | null>(null);
  const [mapRuns, setMapRuns] = useState<MapRun[]>([]);
  const [friendsPlaying, setFriendsPlaying] = useState<FriendPlaying[]>([]);

  const load = useCallback(async () => {
    if (!supabase || !myUserId) return;
    const nowIso = new Date().toISOString();

    // Profile (name, avatar, verification) + tier — independent, run together.
    const [profileRes, tierRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("first_name,avatar_url,verification_level")
        .eq("id", myUserId)
        .maybeSingle(),
      supabase.from("player_ratings").select("tier").eq("user_id", myUserId).maybeSingle(),
    ]);
    if (profileRes.data) {
      const p = profileRes.data as {
        first_name?: string | null;
        avatar_url?: string | null;
        verification_level?: string | null;
      };
      setFirstName(p.first_name?.trim() || null);
      setAvatarUrl(p.avatar_url?.trim() || null);
      if (p.verification_level) setVerificationLevel(p.verification_level);
    }
    if (tierRes.data) setTier((tierRes.data as { tier?: string | null }).tier ?? null);

    // Next confirmed match — get my confirmed run ids, then the soonest upcoming run.
    const { data: myRsvps } = await supabase
      .from("pickup_run_rsvps")
      .select("run_id")
      .eq("user_id", myUserId)
      .eq("status", "confirmed")
      .limit(200);
    const myRunIds = Array.from(
      new Set(
        ((myRsvps ?? []) as Array<{ run_id: string | null }>)
          .map((r) => r.run_id)
          .filter((v): v is string => Boolean(v)),
      ),
    );
    if (myRunIds.length > 0) {
      const { data: nextRows } = await supabase
        .from("pickup_runs")
        .select("id,title,start_at,location_text,capacity,spots_taken,fee_cents,min_tier")
        .in("id", myRunIds)
        .gte("start_at", nowIso)
        .order("start_at", { ascending: true })
        .limit(1);
      setNextMatch((nextRows?.[0] as NextMatch) ?? null);
    } else {
      setNextMatch(null);
    }

    // Map runs (nearby, geocoded, upcoming) — same shape as the session map.
    const { data: mapData } = await supabase
      .from("pickup_runs")
      .select(
        "id,title,location_private,location_text,latitude,longitude,start_at,run_type,level,capacity,spots_taken,fee_cents,min_tier",
      )
      .in("status", ACTIVE_STATUSES)
      .gte("start_at", nowIso)
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .order("start_at", { ascending: true })
      .limit(40);
    setMapRuns((mapData as MapRun[]) ?? []);

    // Friends playing tonight — people I follow with a confirmed RSVP today.
    const { data: follows } = await supabase
      .from("player_follows")
      .select("following_id")
      .eq("follower_id", myUserId);
    const followingIds = ((follows ?? []) as Array<{ following_id: string | null }>)
      .map((f) => f.following_id)
      .filter((v): v is string => Boolean(v));

    if (!followingIds.length) {
      setFriendsPlaying([]);
      return;
    }

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const { data: rsvpRows } = await supabase
      .from("pickup_run_rsvps")
      .select("user_id, pickup_runs!inner(start_at)")
      .in("user_id", followingIds)
      .eq("status", "confirmed");

    // Filter to today's range client-side
    const todayRsvps = ((rsvpRows ?? []) as Array<{ user_id: string; pickup_runs: { start_at: string } }>).filter(
      (r) => {
        const s = r.pickup_runs?.start_at;
        if (!s) return false;
        const d = new Date(s);
        return d >= new Date(nowIso) && d <= todayEnd;
      },
    );

    // Keep the earliest start_at per user
    const userStartMap = new Map<string, string>();
    for (const r of todayRsvps) {
      const uid = r.user_id;
      const s = r.pickup_runs?.start_at;
      if (!uid || !s) continue;
      if (!userStartMap.has(uid) || s < userStartMap.get(uid)!) userStartMap.set(uid, s);
    }
    const friendIds = Array.from(userStartMap.keys());

    if (!friendIds.length) {
      setFriendsPlaying([]);
      return;
    }

    const [profRes, ratRes] = await Promise.all([
      supabase.from("profiles").select("id,first_name,last_name,avatar_url").in("id", friendIds),
      supabase.from("player_ratings").select("user_id,tier").in("user_id", friendIds),
    ]);
    const profMap = new Map(
      ((profRes.data ?? []) as Array<{ id: string; first_name?: string | null; last_name?: string | null; avatar_url?: string | null }>).map((p) => [p.id, p]),
    );
    const ratMap = new Map(
      ((ratRes.data ?? []) as Array<{ user_id: string; tier?: string | null }>).map((r) => [r.user_id, r.tier ?? null]),
    );

    setFriendsPlaying(
      friendIds.map((uid) => {
        const p = profMap.get(uid);
        return {
          user_id: uid,
          first_name: p?.first_name ?? null,
          last_name: p?.last_name ?? null,
          avatar_url: p?.avatar_url ?? null,
          tier: ratMap.get(uid) ?? null,
          start_at: userStartMap.get(uid)!,
        };
      }),
    );
  }, [supabase, myUserId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { myUserId, firstName, avatarUrl, verificationLevel, tier, nextMatch, mapRuns, friendsPlaying };
}

/* --------------------------------------------------------------- pieces */

function SectionLabel({ children, style }: { children: React.ReactNode; style?: object }) {
  return <Text style={[styles.sectionLabel, style]}>{children}</Text>;
}

function SectionHeader({
  label,
  actionLabel,
  onAction,
}: {
  label: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.sectionHeaderRow}>
      <SectionLabel style={{ marginTop: 0, marginBottom: 0 }}>{label}</SectionLabel>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text style={styles.sectionAction}>{actionLabel} →</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Faded top-down pitch outline for the next-match card. */
function PitchGraphic() {
  const W = 120;
  const H = 74;
  const stroke = "rgba(255,255,255,0.05)";
  return (
    <Svg width={W} height={H} style={styles.pitch}>
      <Rect x={2} y={2} width={W - 4} height={H - 4} rx={4} stroke={stroke} strokeWidth={2} fill="none" />
      <Line x1={W / 2} y1={2} x2={W / 2} y2={H - 2} stroke={stroke} strokeWidth={2} />
      <Circle cx={W / 2} cy={H / 2} r={12} stroke={stroke} strokeWidth={2} fill="none" />
      <Rect x={2} y={H / 2 - 15} width={16} height={30} stroke={stroke} strokeWidth={2} fill="none" />
      <Rect x={W - 18} y={H / 2 - 15} width={16} height={30} stroke={stroke} strokeWidth={2} fill="none" />
    </Svg>
  );
}

function TierBadge({ tier, size = "sm" }: { tier: string | null; size?: "sm" | "md" }) {
  const meta = tierMeta(tier);
  if (!meta) return null;
  return (
    <View
      style={[
        styles.tierBadge,
        { borderColor: meta.color, backgroundColor: `${meta.color}22` },
        size === "md" && { paddingVertical: 5, paddingHorizontal: 12 },
      ]}
    >
      {meta.diamond ? <Text style={[styles.tierDiamond, { color: meta.color }]}>◆ </Text> : null}
      <Text style={[styles.tierBadgeText, { color: meta.color }]}>{meta.label.toUpperCase()}</Text>
    </View>
  );
}

function MapDot({ run }: { run: MapRun }) {
  const [track, setTrack] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setTrack(false), 500);
    return () => clearTimeout(t);
  }, []);
  const left = run.capacity - run.spots_taken;
  const color = pinColor(left, run.min_tier);
  const area = (run.location_text ?? "").split(",")[0]?.trim() || "";
  return (
    <Marker
      coordinate={{ latitude: run.latitude!, longitude: run.longitude! }}
      tracksViewChanges={track}
      anchor={{ x: 0.5, y: 0.5 }}
    >
      <View style={styles.markerWrap}>
        <View style={[styles.markerDot, { backgroundColor: color }]} />
        {area ? (
          <View style={styles.markerLabel}>
            <Text style={styles.markerLabelText} numberOfLines={1}>
              {area}
            </Text>
          </View>
        ) : null}
      </View>
    </Marker>
  );
}

function friendDotStatus(startAt: string): "playing" | "soon" | null {
  const now = Date.now();
  const start = new Date(startAt).getTime();
  const twoHrs = 2 * 60 * 60 * 1000;
  const threeHrs = 3 * 60 * 60 * 1000;
  if (now >= start && now < start + twoHrs) return "playing";
  if (now >= start - threeHrs && now < start) return "soon";
  return null;
}

function FriendAvatar({ friend, onPress }: { friend: FriendPlaying; onPress: () => void }) {
  const meta = tierMeta(friend.tier);
  const borderColor = meta?.color ?? "rgba(255,255,255,0.15)";
  const initials = [friend.first_name, friend.last_name]
    .filter(Boolean)
    .map((n) => n!.charAt(0).toUpperCase())
    .join("");
  const displayInitials = initials || "?";
  const dot = friendDotStatus(friend.start_at);
  const shortName =
    friend.first_name
      ? `${friend.first_name}${friend.last_name ? ` ${friend.last_name.charAt(0)}.` : ""}`
      : "Player";
  const statusLabel = dot === "playing" ? "Playing" : "On the way";
  const statusColor = dot === "playing" ? LIME : "rgba(255,255,255,0.45)";

  return (
    <Pressable onPress={onPress} style={styles.friendItem} hitSlop={4}>
      <View style={[styles.friendAvatarWrap, { borderColor }]}>
        {friend.avatar_url ? (
          <Image source={{ uri: friend.avatar_url }} style={styles.friendAvatarImg} />
        ) : (
          <View style={[styles.friendAvatarImg, styles.friendAvatarFallback]}>
            <Text style={styles.friendInitials}>{displayInitials}</Text>
          </View>
        )}
        {dot ? (
          <View style={[styles.friendDot, { backgroundColor: dot === "playing" ? "#22c55e" : "#6b7280" }]} />
        ) : null}
      </View>
      <Text style={styles.friendName} numberOfLines={1}>{shortName}</Text>
      <Text style={[styles.friendStatus, { color: statusColor }]} numberOfLines={1}>{statusLabel}</Text>
    </Pressable>
  );
}

function FriendsPlayingSection({
  friends,
  onSeeAll,
  onFriendPress,
}: {
  friends: FriendPlaying[];
  onSeeAll: () => void;
  onFriendPress: (id: string) => void;
}) {
  return (
    <View style={{ marginTop: 10 }}>
      <SectionHeader label="Friends Playing Tonight" actionLabel="See all" onAction={onSeeAll} />
      {friends.length === 0 ? (
        <Text style={styles.friendsEmpty}>No friends playing tonight</Text>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.friendsRow}
        >
          {friends.map((f) => (
            <FriendAvatar key={f.user_id} friend={f} onPress={() => onFriendPress(f.user_id)} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const QUICK_ACTIONS = [
  { label: "Host a Session", icon: "plus" as const, href: "/session-create" },
  { label: "Start Training", icon: "futbol-o" as const, href: "/training-post" },
] as const;

function QuickActions({ onPress }: { onPress: (href: string) => void }) {
  return (
    <View style={styles.quickActionsRow}>
      {QUICK_ACTIONS.map((a) => (
        <Pressable
          key={a.href}
          onPress={() => onPress(a.href)}
          style={({ pressed }) => [styles.quickActionBtn, pressed && { opacity: 0.75 }]}
          accessibilityRole="button"
          accessibilityLabel={a.label}
        >
          <FontAwesome name={a.icon} size={18} color={LIME} />
          <Text style={styles.quickActionLabel}>{a.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/* --------------------------------------------------------------- screen */

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const push = router.push as (href: string) => void;
  const { myUserId, firstName, avatarUrl, verificationLevel, tier, nextMatch, mapRuns, friendsPlaying } = useHomeData();
  const { session } = useAuth();

  const name = firstName || firstNameFromEmail(session?.user?.email ?? undefined);
  const notVerified = verificationLevel === "self";
  const myTierMeta = tierMeta(tier);
  const avatarBorderColor = notVerified ? "#ef4444" : (myTierMeta?.color ?? LIME);

  const nextTierMeta = tierMeta(nextMatch?.min_tier);
  const isDiamondRun = nextTierMeta?.diamond === true;

  const mapRegion: Region = mapRuns[0]?.latitude
    ? {
        latitude: mapRuns[0].latitude!,
        longitude: mapRuns[0].longitude!,
        latitudeDelta: 0.6,
        longitudeDelta: 0.6,
      }
    : FAIRFIELD;

  return (
    <View style={[styles.root, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
      {/* 1. HEADER */}
      <View style={styles.header}>
        <TierBadge tier={tier} size="md" />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open profile"
          onPress={() => (myUserId ? push(`/player/${myUserId}`) : push("/(tabs)/account"))}
          hitSlop={6}
        >
          {avatarUrl ? (
            <Image
              source={{ uri: avatarUrl }}
              style={[styles.headerAvatar, { borderWidth: 2, borderColor: avatarBorderColor }]}
            />
          ) : (
            <View
              style={[
                styles.headerAvatar,
                styles.headerAvatarFallback,
                { borderWidth: 2, borderColor: avatarBorderColor },
              ]}
            >
              <FontAwesome name="user" size={16} color={notVerified ? "#ef4444" : LIME} />
            </View>
          )}
        </Pressable>
      </View>

      <Text style={styles.greeting} numberOfLines={1}>
        {greeting()}, <Text style={styles.greetingName}>{name}</Text> 👋
      </Text>

      {/* 2. YOUR NEXT MATCH */}
      <SectionLabel>Your Next Match</SectionLabel>
      {nextMatch ? (
        <View style={[styles.matchCard, { borderLeftColor: isDiamondRun ? "#9B59B6" : LIME }]}>
          <PitchGraphic />
          <TierBadge tier={nextMatch.min_tier} />
          <Text style={styles.matchTitle} numberOfLines={1}>
            {nextMatch.title || "Pickup run"}
          </Text>
          <View style={styles.matchMetaRow}>
            <FontAwesome name="clock-o" size={12} color="rgba(255,255,255,0.55)" />
            <Text style={styles.matchMeta}>{whenLabel(nextMatch.start_at)}</Text>
          </View>
          <View style={styles.matchMetaRow}>
            <FontAwesome name="map-marker" size={12} color="rgba(255,255,255,0.55)" />
            <Text style={styles.matchMeta} numberOfLines={1}>
              {nextMatch.location_text || "Location TBD"}
            </Text>
          </View>

          <View style={styles.matchBottom}>
            <Text style={styles.matchSpots}>
              {Math.max(nextMatch.capacity - nextMatch.spots_taken, 0)} of {nextMatch.capacity} spots left
            </Text>
            <View style={styles.priceBox}>
              <Text style={styles.priceText}>${(nextMatch.fee_cents / 100).toFixed(0)}</Text>
              <Text style={styles.priceTier}>{nextTierMeta?.label ?? "Open"}</Text>
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Join match"
            onPress={() => push(`/session/${encodeURIComponent(nextMatch.id)}`)}
            style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.9 }]}
          >
            <Text style={styles.primaryBtnText}>JOIN MATCH →</Text>
          </Pressable>
        </View>
      ) : (
        <View style={[styles.matchCard, styles.matchEmpty, { borderLeftColor: LIME }]}>
          <Text style={styles.matchEmptyTitle}>NO UPCOMING SESSIONS</Text>
          <Text style={styles.matchEmptySub}>You have no confirmed matches coming up.</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => push("/session-map")}
            style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.9 }]}
          >
            <Text style={styles.primaryBtnText}>Find a Run →</Text>
          </Pressable>
        </View>
      )}

      {/* 3. LIVE MAP */}
      <View style={{ marginTop: 12 }} pointerEvents="box-none">
        <SectionHeader label="Live Map" actionLabel="View full map" onAction={() => push("/session-map")} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open session map"
          onPress={() => push("/session-map")}
          style={styles.mapWrap}
        >
          <MapView
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
            initialRegion={mapRegion}
            customMapStyle={DARK_MAP_STYLE}
            scrollEnabled={false}
            zoomEnabled={false}
            pitchEnabled={false}
            rotateEnabled={false}
            showsPointsOfInterest={false}
            showsMyLocationButton={false}
          >
            {mapRuns.map((run) => (
              <MapDot key={run.id} run={run} />
            ))}
          </MapView>
          <View style={styles.mapLegend} pointerEvents="none">
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: LIME }]} />
              <Text style={styles.legendText}>Open</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: "#9B59B6" }]} />
              <Text style={styles.legendText}>Gold+</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: "#ef4444" }]} />
              <Text style={styles.legendText}>Almost Full</Text>
            </View>
          </View>
        </Pressable>
      </View>

      {/* 4. FRIENDS PLAYING TONIGHT */}
      <FriendsPlayingSection
        friends={friendsPlaying}
        onSeeAll={() => push("/following")}
        onFriendPress={(id) => push(`/player/${id}`)}
      />

      {/* 5. QUICK ACTIONS */}
      <QuickActions onPress={push} />
    </View>
  );
}

/* --------------------------------------------------------------- styles */

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0a0a0a", paddingHorizontal: 20 },

  /* header */
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
  },
  headerAvatar: { width: 36, height: 36, borderRadius: 999, backgroundColor: "#1a1a1a" },
  headerAvatarFallback: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.5)",
    backgroundColor: "rgba(163,230,53,0.08)",
  },
  avatarUnverified: { borderWidth: 2, borderColor: "#ef4444" },

  greeting: { marginTop: 10, fontSize: 20, fontWeight: "800", color: "#fff", letterSpacing: -0.3 },
  greetingName: { color: LIME },

  /* section labels */
  sectionLabel: {
    marginTop: 12,
    marginBottom: 8,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.5,
    color: LIME,
    textTransform: "uppercase",
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  sectionAction: { fontSize: 12, fontWeight: "700", color: "rgba(255,255,255,0.6)" },

  /* tier badge */
  tierBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: 999,
    borderWidth: 1,
  },
  tierBadgeText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.8 },
  tierDiamond: { fontSize: 10, fontWeight: "800" },

  /* next match card — compact */
  matchCard: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderLeftWidth: 4,
    borderRadius: 16,
    padding: 10,
    overflow: "hidden",
  },
  pitch: { position: "absolute", top: 6, right: 6 },
  matchTitle: { marginTop: 5, fontSize: 17, fontWeight: "800", color: "#fff", letterSpacing: -0.3 },
  matchMetaRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 3 },
  matchMeta: { fontSize: 12, color: "rgba(255,255,255,0.7)", flexShrink: 1 },
  matchBottom: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginTop: 7,
  },
  matchSpots: { fontSize: 12, fontWeight: "600", color: "rgba(255,255,255,0.85)", flexShrink: 1 },
  priceBox: { alignItems: "flex-end" },
  priceText: { fontSize: 20, fontWeight: "800", color: "#fff", letterSpacing: -0.5 },
  priceTier: { fontSize: 10, fontWeight: "600", color: "rgba(255,255,255,0.5)" },
  primaryBtn: {
    marginTop: 8,
    backgroundColor: LIME,
    borderRadius: 12,
    paddingVertical: 9,
    alignItems: "center",
  },
  primaryBtnText: { color: "#0a0a0a", fontSize: 15, fontWeight: "800", letterSpacing: 0.5 },
  matchEmpty: { alignItems: "flex-start" },
  matchEmptyTitle: { fontSize: 16, fontWeight: "800", color: "#fff", letterSpacing: 0.5 },
  matchEmptySub: { marginTop: 5, fontSize: 13, color: "rgba(255,255,255,0.55)" },

  /* map */
  mapWrap: {
    height: 200,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: CARD_BORDER,
    backgroundColor: "#111",
  },
  mapLegend: {
    position: "absolute",
    bottom: 10,
    left: 10,
    flexDirection: "row",
    gap: 12,
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, fontWeight: "600", color: "#fff" },
  markerWrap: { alignItems: "center" },
  markerDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#0a0a0a",
  },
  markerLabel: {
    marginTop: 2,
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    maxWidth: 90,
  },
  markerLabelText: { fontSize: 9, fontWeight: "700", color: "#fff" },

  /* friends playing tonight */
  friendsEmpty: {
    fontSize: 13,
    color: "rgba(255,255,255,0.3)",
    fontStyle: "italic",
    marginTop: 2,
    marginBottom: 8,
  },
  friendsRow: { paddingBottom: 4, gap: 16 },
  friendItem: { alignItems: "center", width: 68 },
  friendAvatarWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    overflow: "visible",
  },
  friendAvatarImg: { width: 56, height: 56, borderRadius: 28, margin: 0 },
  friendAvatarFallback: {
    backgroundColor: "#1e1e1e",
    alignItems: "center",
    justifyContent: "center",
  },
  friendInitials: { fontSize: 18, fontWeight: "700", color: "#fff" },
  friendDot: {
    position: "absolute",
    bottom: -1,
    right: -1,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: "#0a0a0a",
  },
  friendName: {
    marginTop: 6,
    fontSize: 11,
    fontWeight: "600",
    color: "#fff",
    textAlign: "center",
    width: 68,
  },
  friendStatus: { marginTop: 2, fontSize: 10, fontWeight: "500", textAlign: "center" },

  /* quick actions */
  quickActionsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
  },
  quickActionBtn: {
    flex: 1,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 14,
    height: 68,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  quickActionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "rgba(255,255,255,0.65)",
    letterSpacing: 0.2,
  },
});
