import { FieldTournamentCard } from "@/components/FieldTournamentCard";
import { useAuth } from "@/context/AuthContext";
import { useFieldTournament } from "@/hooks/useFieldTournament";
import { hapticTap } from "@/lib/haptics";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { format, isToday, isTomorrow } from "date-fns";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import MapView, { Marker, type Region } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Line, Rect } from "react-native-svg";

import type { Session } from "../session-map";

const LIME = "#a3e635";
const CARD_BG = "rgba(255,255,255,0.04)";
const CARD_BORDER = "rgba(255,255,255,0.08)";

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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/** Live-updating elapsed-time string, refreshed every 60 seconds. */
function useElapsedTime(startedAt: string | null): string {
  const [elapsed, setElapsed] = useState("");
  useEffect(() => {
    if (!startedAt) return;
    const update = () => {
      const mins = Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000);
      if (mins < 1) setElapsed("Just started");
      else if (mins < 60) setElapsed(mins + " min in");
      else {
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        setElapsed(h + "h " + (m > 0 ? m + "min " : "") + "in");
      }
    };
    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, [startedAt]);
  return elapsed;
}

/* --------------------------------------------------------------- types */

type MapRun = Session & { min_tier: string | null; location_text: string | null };

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

type Friend = {
  user_id: string;
  name: string;
  avatar_url: string | null;
  status: "playing" | "on_the_way" | "later";
};

type TrainingNearby = {
  id: string;
  field_name: string;
  started_at: string;
  what_im_working_on: string | null;
  spots_available: number;
  host_name: string;
  host_tier: string | null;
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
  const [friends, setFriends] = useState<Friend[]>([]);
  const [training, setTraining] = useState<TrainingNearby[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!supabase || !myUserId) {
      setLoading(false);
      return;
    }
    const nowIso = new Date().toISOString();
    const midnight = new Date();
    midnight.setHours(23, 59, 59, 999);
    const midnightIso = midnight.toISOString();

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

    // Friends playing tonight.
    const { data: followRows } = await supabase
      .from("player_follows")
      .select("following_id")
      .eq("follower_id", myUserId);
    const followingIds = Array.from(
      new Set(
        ((followRows ?? []) as Array<{ following_id: string | null }>)
          .map((r) => r.following_id)
          .filter((v): v is string => Boolean(v)),
      ),
    );
    if (followingIds.length > 0) {
      const { data: friendRsvps } = await supabase
        .from("pickup_run_rsvps")
        .select("user_id,pickup_runs!inner(start_at)")
        .in("user_id", followingIds)
        .eq("status", "confirmed")
        .gte("pickup_runs.start_at", nowIso)
        .lte("pickup_runs.start_at", midnightIso);

      // Keep the soonest session per friend.
      const soonest = new Map<string, string>();
      for (const row of (friendRsvps ?? []) as Array<{
        user_id: string | null;
        pickup_runs?: { start_at?: string | null } | { start_at?: string | null }[] | null;
      }>) {
        if (!row.user_id) continue;
        const runField = Array.isArray(row.pickup_runs) ? row.pickup_runs[0] : row.pickup_runs;
        const startAt = runField?.start_at;
        if (!startAt) continue;
        const prev = soonest.get(row.user_id);
        if (!prev || Date.parse(startAt) < Date.parse(prev)) soonest.set(row.user_id, startAt);
      }

      const friendIds = Array.from(soonest.keys());
      if (friendIds.length > 0) {
        const { data: friendProfiles } = await supabase
          .from("profiles")
          .select("id,first_name,last_name,avatar_url")
          .in("id", friendIds);
        const now = Date.now();
        const built: Friend[] = friendIds.map((id) => {
          const p = ((friendProfiles ?? []) as Array<{
            id: string;
            first_name?: string | null;
            last_name?: string | null;
            avatar_url?: string | null;
          }>).find((row) => row.id === id);
          const fn = p?.first_name?.trim() || "";
          const ln = p?.last_name?.trim() || "";
          const name = `${fn}${ln ? ` ${ln.charAt(0)}.` : ""}`.trim() || "Player";
          const startMs = Date.parse(soonest.get(id)!);
          let status: Friend["status"] = "later";
          if (startMs < now && now < startMs + 2 * 60 * 60 * 1000) status = "playing";
          else if (startMs > now && startMs - now <= 3 * 60 * 60 * 1000) status = "on_the_way";
          return {
            user_id: id,
            name,
            avatar_url: p?.avatar_url?.trim() || null,
            status,
          };
        });
        // Playing first, then on the way, then later.
        const order = { playing: 0, on_the_way: 1, later: 2 };
        built.sort((a, b) => order[a.status] - order[b.status]);
        setFriends(built);
      } else {
        setFriends([]);
      }
    } else {
      setFriends([]);
    }

    // Training nearby — active posts with host name + tier.
    const { data: trainingRows } = await supabase
      .from("training_posts")
      .select("id,user_id,field_name,started_at,what_im_working_on,spots_available")
      .eq("status", "active")
      .order("started_at", { ascending: false })
      .limit(3);
    const tRows = (trainingRows ?? []) as Array<{
      id: string;
      user_id: string;
      field_name: string;
      started_at: string;
      what_im_working_on: string | null;
      spots_available: number;
    }>;
    if (tRows.length > 0) {
      const hostIds = Array.from(new Set(tRows.map((r) => r.user_id)));
      const [hostProfilesRes, hostTiersRes] = await Promise.all([
        supabase.from("profiles").select("id,first_name,last_name,username").in("id", hostIds),
        supabase.from("player_ratings").select("user_id,tier").in("user_id", hostIds),
      ]);
      const nameById = new Map<string, string>();
      for (const row of (hostProfilesRes.data ?? []) as Array<{
        id: string;
        first_name?: string | null;
        last_name?: string | null;
        username?: string | null;
      }>) {
        nameById.set(
          row.id,
          [row.first_name, row.last_name].filter(Boolean).join(" ") || row.username || "Player",
        );
      }
      const tierByHost = new Map<string, string | null>();
      for (const row of (hostTiersRes.data ?? []) as Array<{ user_id: string; tier: string | null }>) {
        tierByHost.set(row.user_id, row.tier);
      }
      setTraining(
        tRows.map((r) => ({
          id: r.id,
          field_name: r.field_name,
          started_at: r.started_at,
          what_im_working_on: r.what_im_working_on,
          spots_available: r.spots_available,
          host_name: nameById.get(r.user_id) ?? "Player",
          host_tier: tierByHost.get(r.user_id) ?? null,
        })),
      );
    } else {
      setTraining([]);
    }

    setLoading(false);
  }, [supabase, myUserId]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    myUserId,
    firstName,
    avatarUrl,
    verificationLevel,
    tier,
    nextMatch,
    mapRuns,
    friends,
    training,
    loading,
    reload: load,
  };
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
  const W = 150;
  const H = 100;
  const stroke = "rgba(255,255,255,0.05)";
  return (
    <Svg width={W} height={H} style={styles.pitch}>
      <Rect x={2} y={2} width={W - 4} height={H - 4} rx={4} stroke={stroke} strokeWidth={2} fill="none" />
      <Line x1={W / 2} y1={2} x2={W / 2} y2={H - 2} stroke={stroke} strokeWidth={2} />
      <Circle cx={W / 2} cy={H / 2} r={16} stroke={stroke} strokeWidth={2} fill="none" />
      <Rect x={2} y={H / 2 - 22} width={22} height={44} stroke={stroke} strokeWidth={2} fill="none" />
      <Rect x={W - 24} y={H / 2 - 22} width={22} height={44} stroke={stroke} strokeWidth={2} fill="none" />
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

function FriendAvatar({ friend }: { friend: Friend }) {
  const dotColor = friend.status === "playing" ? LIME : friend.status === "on_the_way" ? "#9aa0a6" : null;
  const statusText = friend.status === "playing" ? "Playing" : friend.status === "on_the_way" ? "On the way" : "Later";
  const statusColor = friend.status === "playing" ? LIME : "rgba(255,255,255,0.5)";
  return (
    <View style={styles.friendCol}>
      <View>
        {friend.avatar_url ? (
          <Image source={{ uri: friend.avatar_url }} style={styles.friendAvatar} />
        ) : (
          <View style={[styles.friendAvatar, styles.friendAvatarFallback]}>
            <Text style={styles.friendInitials}>{initials(friend.name)}</Text>
          </View>
        )}
        {dotColor ? <View style={[styles.friendDot, { backgroundColor: dotColor }]} /> : null}
      </View>
      <Text style={styles.friendName} numberOfLines={1}>
        {friend.name}
      </Text>
      <Text style={[styles.friendStatus, { color: statusColor }]} numberOfLines={1}>
        {statusText}
      </Text>
    </View>
  );
}

function TrainingCard({ item, onPress }: { item: TrainingNearby; onPress: () => void }) {
  const elapsed = useElapsedTime(item.started_at);
  const isFull = item.spots_available <= 0;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.trainingCard, pressed && { opacity: 0.85 }]}>
      <View style={styles.trainingCardTop}>
        <Text style={styles.trainingHost} numberOfLines={1}>
          {item.host_name}
        </Text>
        <TierBadge tier={item.host_tier} />
      </View>
      <Text style={styles.trainingField} numberOfLines={1}>
        {item.field_name}
      </Text>
      <View style={styles.trainingLiveRow}>
        <View style={styles.trainingLiveDot} />
        <Text style={styles.trainingLiveText}>{elapsed || "Live"}</Text>
      </View>
      {item.what_im_working_on ? (
        <Text style={styles.trainingWorking} numberOfLines={2}>
          {item.what_im_working_on}
        </Text>
      ) : null}
      <Text style={[styles.trainingSpots, isFull && { color: "#ef4444" }]}>
        {isFull ? "Full" : `${item.spots_available} spot${item.spots_available === 1 ? "" : "s"} open`}
      </Text>
    </Pressable>
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

/* --------------------------------------------------------------- screen */

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const push = router.push as (href: string) => void;
  const {
    myUserId,
    firstName,
    avatarUrl,
    verificationLevel,
    tier,
    nextMatch,
    mapRuns,
    friends,
    training,
    reload,
  } = useHomeData();
  const { session } = useAuth();
  const {
    loading: tournamentLoading,
    error: tournamentError,
    payload: tournamentPayload,
    reload: reloadTournament,
  } = useFieldTournament();

  const [tournamentsOpen, setTournamentsOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    void hapticTap();
    setRefreshing(true);
    try {
      await Promise.all([reload(), reloadTournament({ background: true })]);
    } finally {
      setRefreshing(false);
    }
  }, [reload, reloadTournament]);

  const name = firstName || firstNameFromEmail(session?.user?.email ?? undefined);
  const notVerified = verificationLevel === "self";

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
    <View style={styles.root}>
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.content,
        { paddingTop: Math.max(insets.top, 12) + 8, paddingBottom: 120 + insets.bottom },
      ]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={LIME} />
      }
    >
      {/* 1. HEADER */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Help"
            onPress={() => push("/help")}
            style={styles.iconBtn}
            hitSlop={6}
          >
            <FontAwesome name="question" size={15} color={LIME} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Search players"
            onPress={() => push("/players")}
            style={styles.iconBtn}
            hitSlop={6}
          >
            <FontAwesome name="search" size={15} color={LIME} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Messages"
            onPress={() => push("/(tabs)/messages")}
            style={styles.iconBtn}
            hitSlop={6}
          >
            <FontAwesome name="comment-o" size={15} color={LIME} />
          </Pressable>
        </View>

        <View style={styles.headerRight}>
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
                style={[styles.headerAvatar, notVerified && styles.avatarUnverified]}
              />
            ) : (
              <View
                style={[
                  styles.headerAvatar,
                  styles.headerAvatarFallback,
                  notVerified && styles.avatarUnverified,
                ]}
              >
                <FontAwesome name="user" size={16} color={notVerified ? "#ef4444" : LIME} />
              </View>
            )}
          </Pressable>
        </View>
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
          <Text style={styles.matchTitle} numberOfLines={2}>
            {nextMatch.title || "Pickup run"}
          </Text>
          <View style={styles.matchMetaRow}>
            <FontAwesome name="clock-o" size={13} color="rgba(255,255,255,0.55)" />
            <Text style={styles.matchMeta}>{whenLabel(nextMatch.start_at)}</Text>
          </View>
          <View style={styles.matchMetaRow}>
            <FontAwesome name="map-marker" size={13} color="rgba(255,255,255,0.55)" />
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
      <View style={{ marginTop: 28 }}>
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
            userInterfaceStyle="dark"
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
      <View style={{ marginTop: 28 }}>
        <SectionHeader
          label="Friends Playing Tonight"
          actionLabel="See all"
          onAction={() => push("/following")}
        />
        {friends.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.friendsRow}>
            {friends.map((f) => (
              <Pressable key={f.user_id} onPress={() => push(`/player/${f.user_id}`)}>
                <FriendAvatar friend={f} />
              </Pressable>
            ))}
          </ScrollView>
        ) : (
          <View style={styles.friendsEmpty}>
            <Text style={styles.friendsEmptyText}>No friends playing tonight</Text>
          </View>
        )}
      </View>

      {/* TRAINING NEARBY */}
      <View style={{ marginTop: 28 }}>
        <View style={styles.sectionHeaderRow}>
          <SectionLabel style={{ marginTop: 0, marginBottom: 0 }}>Training Nearby</SectionLabel>
          <Pressable onPress={() => push("/training-post")} hitSlop={8} style={styles.startTrainingBtn}>
            <FontAwesome name="plus" size={11} color="#0a0a0a" />
            <Text style={styles.startTrainingText}>Start Training</Text>
          </Pressable>
        </View>
        {training.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.trainingRow}>
            {training.map((t) => (
              <TrainingCard key={t.id} item={t} onPress={() => push(`/training/${t.id}`)} />
            ))}
          </ScrollView>
        ) : (
          <View style={styles.friendsEmpty}>
            <Text style={styles.friendsEmptyText}>No one training nearby</Text>
          </View>
        )}
      </View>

    </ScrollView>

      {/* Floating Tournaments button */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open tournaments"
        onPress={() => {
          void hapticTap();
          setTournamentsOpen(true);
        }}
        style={({ pressed }) => [
          styles.fab,
          { bottom: 74 + insets.bottom },
          pressed && { transform: [{ scale: 0.95 }] },
        ]}
      >
        <FontAwesome name="trophy" size={16} color="#0a0a0a" />
        <Text style={styles.fabText}>Tournaments</Text>
      </Pressable>

      {/* Tournaments slide-up drawer */}
      <Modal
        visible={tournamentsOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setTournamentsOpen(false)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setTournamentsOpen(false)}>
          <Pressable
            style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}
            onPress={() => {}}
          >
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeaderRow}>
              <Text style={styles.sheetTitle}>Tournaments</Text>
              <Pressable
                onPress={() => {
                  setTournamentsOpen(false);
                  push("/(tabs)/tournaments");
                }}
                hitSlop={8}
              >
                <Text style={styles.sectionAction}>View all →</Text>
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 460 }}>
              <FieldTournamentCard
                loading={tournamentLoading}
                error={tournamentError}
                payload={tournamentPayload}
                onPress={() => {
                  setTournamentsOpen(false);
                  push("/field-tournament");
                }}
              />
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

/* --------------------------------------------------------------- styles */

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0a0a0a" },
  scroll: { flex: 1, backgroundColor: "#0a0a0a" },
  content: { paddingHorizontal: 20 },

  /* header */
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.5)",
    backgroundColor: "rgba(163,230,53,0.08)",
    alignItems: "center",
    justifyContent: "center",
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

  greeting: { marginTop: 18, fontSize: 22, fontWeight: "800", color: "#fff", letterSpacing: -0.3 },
  greetingName: { color: LIME },

  /* section labels */
  sectionLabel: {
    marginTop: 24,
    marginBottom: 12,
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
    marginBottom: 12,
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

  /* next match card */
  matchCard: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderLeftWidth: 4,
    borderRadius: 16,
    padding: 18,
    overflow: "hidden",
  },
  pitch: { position: "absolute", top: 8, right: 8 },
  matchTitle: { marginTop: 12, fontSize: 22, fontWeight: "800", color: "#fff", letterSpacing: -0.4 },
  matchMetaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  matchMeta: { fontSize: 14, color: "rgba(255,255,255,0.7)", flexShrink: 1 },
  matchBottom: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginTop: 16,
  },
  matchSpots: { fontSize: 13, fontWeight: "600", color: "rgba(255,255,255,0.85)", flexShrink: 1 },
  priceBox: { alignItems: "flex-end" },
  priceText: { fontSize: 26, fontWeight: "800", color: "#fff", letterSpacing: -0.5 },
  priceTier: { fontSize: 11, fontWeight: "600", color: "rgba(255,255,255,0.5)" },
  primaryBtn: {
    marginTop: 18,
    backgroundColor: LIME,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
  },
  primaryBtnText: { color: "#0a0a0a", fontSize: 15, fontWeight: "800", letterSpacing: 0.5 },
  matchEmpty: { alignItems: "flex-start" },
  matchEmptyTitle: { fontSize: 16, fontWeight: "800", color: "#fff", letterSpacing: 0.5 },
  matchEmptySub: { marginTop: 6, fontSize: 14, color: "rgba(255,255,255,0.55)" },

  /* map */
  mapWrap: {
    height: 220,
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

  /* friends */
  friendsRow: { gap: 16, paddingRight: 8 },
  friendCol: { alignItems: "center", width: 64 },
  friendAvatar: { width: 56, height: 56, borderRadius: 999, backgroundColor: "#1a1a1a" },
  friendAvatarFallback: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  friendInitials: { fontSize: 18, fontWeight: "800", color: "#fff" },
  friendDot: {
    position: "absolute",
    bottom: 2,
    right: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: "#0a0a0a",
  },
  friendName: { marginTop: 6, fontSize: 12, fontWeight: "600", color: "#fff", maxWidth: 64 },
  friendStatus: { fontSize: 11, fontWeight: "600" },
  friendsEmpty: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 16,
    paddingVertical: 20,
    alignItems: "center",
  },
  friendsEmptyText: { fontSize: 13, color: "rgba(255,255,255,0.4)" },

  /* training nearby */
  startTrainingBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: LIME,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  startTrainingText: { color: "#0a0a0a", fontSize: 12, fontWeight: "800" },
  trainingRow: { gap: 12, paddingRight: 8 },
  trainingCard: {
    width: 200,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 16,
    padding: 14,
  },
  trainingCardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  trainingHost: { flex: 1, color: "#fff", fontSize: 15, fontWeight: "700" },
  trainingField: { marginTop: 8, color: "rgba(255,255,255,0.7)", fontSize: 13 },
  trainingLiveRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  trainingLiveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#4ADE80" },
  trainingLiveText: { color: "#4ADE80", fontSize: 12, fontWeight: "700" },
  trainingWorking: { marginTop: 8, color: "#fff", fontSize: 13, fontWeight: "500", lineHeight: 18 },
  trainingSpots: { marginTop: 10, color: LIME, fontSize: 12, fontWeight: "700" },

  /* floating tournaments button */
  fab: {
    position: "absolute",
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 999,
    backgroundColor: LIME,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  fabText: { color: "#0a0a0a", fontSize: 14, fontWeight: "800", letterSpacing: 0.2 },

  /* tournaments drawer */
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#111311",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: CARD_BORDER,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.25)",
    marginBottom: 14,
  },
  sheetHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  sheetTitle: { fontSize: 20, fontWeight: "800", color: "#fff", letterSpacing: -0.3 },
});
