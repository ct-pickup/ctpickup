import { useAuth } from "@/context/AuthContext";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { format, isToday, isTomorrow } from "date-fns";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, type Region } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Session } from "../session-map";

import { ChalkCenterCircle, ChalkDivider, ChalkEmptyState } from "@/components/chalk";
import { themeColor, useThemedStyles } from "@/theme";
/* ----------------------------------------------------------------- tiers */

type TierMeta = { label: string; color: string; diamond?: boolean };
function TIER_META(): Record<string, TierMeta> {
  return {
  diamond: { label: "Diamond", color: themeColor().muted, diamond: true },
  platinum: { label: "Platinum", color: themeColor().muted },
  gold: { label: "Gold", color: themeColor().muted },
  silver: { label: "Silver", color: themeColor().muted },
  bronze: { label: "Bronze", color: themeColor().muted },
};
}

function tierMeta(raw: string | null | undefined): TierMeta | null {
  const key = (raw ?? "").toLowerCase().trim();
  return TIER_META()[key] ?? null;
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
        backgroundColor: themeColor().pitch,
        opacity,
      }}
    />
  );
}

type RateBanner = { run_id: string; title: string | null };

function pinColor(left: number, minTier: string | null): string {
  if (left >= 1 && left <= 2) return themeColor().coral; // almost full
  const t = (minTier ?? "").toLowerCase();
  if (t === "gold" || t === "diamond" || t === "platinum") return themeColor().muted; // Gold+
  return themeColor().pitch; // open
}

/* --------------------------------------------------------------- data */

function useHomeData() {
  useThemedStyles(publish_styles);

  const { session, supabase } = useAuth();
  const myUserId = session?.user?.id ?? null;

  const [firstName, setFirstName] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [verificationLevel, setVerificationLevel] = useState<string>("self");
  const [tier, setTier] = useState<string | null>(null);
  const [nextMatch, setNextMatch] = useState<NextMatch | null>(null);
  const [mapRuns, setMapRuns] = useState<MapRun[]>([]);
  const [friendsPlaying, setFriendsPlaying] = useState<FriendPlaying[]>([]);
  const [rateBanner, setRateBanner] = useState<RateBanner | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !myUserId) return;
    const nowIso = new Date().toISOString();
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

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

    // Map runs — keep visible for 2h after kickoff (including recently completed).
    const { data: mapData } = await supabase
      .from("pickup_runs")
      .select(
        "id,title,location_private,location_text,latitude,longitude,start_at,run_type,level,capacity,spots_taken,fee_cents,min_tier",
      )
      .or(
        `status.in.(planning,likely_on,active,in_progress),and(status.eq.completed,start_at.gte."${twoHoursAgo}")`,
      )
      .gte("start_at", twoHoursAgo)
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .order("start_at", { ascending: true })
      .limit(40);
    setMapRuns((mapData as MapRun[]) ?? []);

    // Unrated recent session banner (started within last 3h, confirmed, not host, no vote yet).
    setRateBanner(null);
    if (myRunIds.length > 0) {
      const { data: recentRuns } = await supabase
        .from("pickup_runs")
        .select("id,title,start_at,created_by,tier_session_id,status")
        .in("id", myRunIds)
        .gt("start_at", threeHoursAgo)
        .lt("start_at", nowIso)
        .in("status", ["planning", "active", "in_progress", "completed"])
        .order("start_at", { ascending: false })
        .limit(8);

      for (const run of (recentRuns ?? []) as Array<{
        id: string;
        title: string | null;
        start_at: string;
        created_by: string | null;
        tier_session_id: string | null;
      }>) {
        if (run.created_by === myUserId) continue;
        let voted = false;
        if (run.tier_session_id) {
          const { data: votes } = await supabase
            .from("peer_votes")
            .select("voter_id")
            .eq("session_id", run.tier_session_id)
            .eq("voter_id", myUserId)
            .limit(1);
          voted = (votes?.length ?? 0) > 0;
        }
        if (!voted) {
          setRateBanner({ run_id: run.id, title: run.title });
          break;
        }
      }
    }

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

  return { myUserId, firstName, avatarUrl, verificationLevel, tier, nextMatch, mapRuns, friendsPlaying, rateBanner };
}

/* --------------------------------------------------------------- pieces */

function SectionLabel({ children, style }: { children: React.ReactNode; style?: object }) {
  useThemedStyles(publish_styles);

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
  useThemedStyles(publish_styles);

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

function TierBadge({ tier, size = "sm" }: { tier: string | null; size?: "sm" | "md" }) {
  useThemedStyles(publish_styles);

  const meta = tierMeta(tier);
  if (!meta) return null;
  return (
    <View
      style={[
        styles.tierBadge,
        { borderColor: meta.color, backgroundColor: `${meta.color}22` },
        size === "md" && { paddingVertical: 4, paddingHorizontal: 12 },
      ]}
    >
      {meta.diamond ? <Text style={[styles.tierDiamond, { color: meta.color }]}>◆ </Text> : null}
      <Text style={[styles.tierBadgeText, { color: meta.color }]}>{meta.label.toUpperCase()}</Text>
    </View>
  );
}

function MapDot({ run }: { run: MapRun }) {
  useThemedStyles(publish_styles);

  const [track, setTrack] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setTrack(false), 500);
    return () => clearTimeout(t);
  }, []);
  const left = run.capacity - run.spots_taken;
  const color = pinColor(left, run.min_tier);
  const area = (run.location_text ?? "").split(",")[0]?.trim() || "";
  const live = isSessionLive(run.start_at);
  return (
    <Marker
      coordinate={{ latitude: run.latitude!, longitude: run.longitude! }}
      tracksViewChanges={track || live}
      anchor={{ x: 0.5, y: 0.5 }}
    >
      <View style={styles.markerWrap}>
        <View style={[styles.markerDot, { backgroundColor: color }]}>
          {live ? (
            <View style={styles.markerLiveDot}>
              <LivePulseDot size={7} />
            </View>
          ) : null}
        </View>
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
  useThemedStyles(publish_styles);

  const meta = tierMeta(friend.tier);
  const borderColor = meta?.color ?? themeColor().line;
  const initials = [friend.first_name, friend.last_name]
    .filter(Boolean)
    .map((n) => n!.charAt(0).toUpperCase())
    .join("");
  const displayInitials = initials || "?";
  const dot = friendDotStatus(friend.start_at);
  const shortName = friend.first_name?.trim() || "Player";
  const statusLabel = dot === "playing" ? "Playing" : "On the way";
  const statusColor = dot === "playing" ? themeColor().pitchText : themeColor().text;

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
          <View style={[styles.friendDot, { backgroundColor: dot === "playing" ? themeColor().pitch : themeColor().muted }]} />
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
  useThemedStyles(publish_styles);

  return (
    <View>
      <SectionHeader label="Friends Playing Tonight" actionLabel="See all" onAction={onSeeAll} />
      {friends.length === 0 ? (
        <ChalkEmptyState graphic="circle" size="sm" title="No friends playing tonight" />
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
  useThemedStyles(publish_styles);

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
          <FontAwesome name={a.icon} size={18} color={themeColor().pitchText} />
          <Text style={styles.quickActionLabel}>{a.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/* --------------------------------------------------------------- screen */

export default function HomeScreen() {
  useThemedStyles(publish_styles);

  const insets = useSafeAreaInsets();
  const router = useRouter();
  const push = router.push as (href: string) => void;
  const { myUserId, firstName, avatarUrl, verificationLevel, tier, nextMatch, mapRuns, friendsPlaying, rateBanner } = useHomeData();
  const { session } = useAuth();

  const name = firstName || firstNameFromEmail(session?.user?.email ?? undefined);
  const notVerified = verificationLevel === "self";
  const myTierMeta = tierMeta(tier);
  const avatarBorderColor = notVerified ? themeColor().line : (myTierMeta?.color ?? themeColor().pitch);

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
              <FontAwesome name="user" size={16} color={notVerified ? themeColor().muted : themeColor().pitchText} />
            </View>
          )}
        </Pressable>
      </View>

      <Text style={styles.greeting} numberOfLines={1}>
        {greeting()}, <Text style={styles.greetingName}>{name}</Text>
      </Text>

      {rateBanner ? (
        <Pressable
          onPress={() => push(`/session/${encodeURIComponent(rateBanner.run_id)}`)}
          style={({ pressed }) => [styles.rateBanner, pressed && { opacity: 0.88 }]}
          accessibilityRole="button"
          accessibilityLabel="Rate your recent session"
        >
          <FontAwesome name="star" size={14} color={themeColor().onPitch} />
          <Text style={styles.rateBannerText}>You have a session to rate →</Text>
        </Pressable>
      ) : null}

      {/* 2. YOUR NEXT MATCH */}
      <SectionLabel>Your Next Match</SectionLabel>
      {nextMatch ? (
        <View style={[styles.matchCard, { borderLeftColor: isDiamondRun ? themeColor().line : themeColor().pitch }]}>
          <View style={styles.matchMark} pointerEvents="none">
            <ChalkCenterCircle size="sm" />
          </View>
          <TierBadge tier={nextMatch.min_tier} />
          <Text style={styles.matchTitle} numberOfLines={1}>
            {nextMatch.title || "Pickup run"}
          </Text>
          <View style={styles.matchMetaRow}>
            <FontAwesome name="clock-o" size={12} color={themeColor().muted} />
            <Text style={styles.matchMeta}>{whenLabel(nextMatch.start_at)}</Text>
          </View>
          <View style={styles.matchMetaRow}>
            <FontAwesome name="map-marker" size={12} color={themeColor().muted} />
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
        <View style={[styles.matchCard, styles.matchEmpty]}>
          <ChalkEmptyState
            graphic="box"
            title="NO UPCOMING SESSIONS"
            body="You have no confirmed matches coming up."
            actionLabel="Find a Run →"
            onAction={() => push("/community-map")}
          />
        </View>
      )}

      <ChalkDivider style={styles.sectionDivider} />

      {/* 3. LIVE MAP */}
      <View pointerEvents="box-none">
        <SectionHeader label="Live Map" actionLabel="View full map" onAction={() => push("/community-map")} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open community map"
          onPress={() => push("/community-map")}
          style={styles.mapWrap}
        >
          <MapView
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
            initialRegion={mapRegion}
            userInterfaceStyle="dark"
            backgroundColor={themeColor().card}
            loadingBackgroundColor={themeColor().card}
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
              <View style={[styles.legendDot, { backgroundColor: themeColor().pitch }]} />
              <Text style={styles.legendText}>Open</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: themeColor().muted }]} />
              <Text style={styles.legendText}>Gold+</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: themeColor().coral }]} />
              <Text style={styles.legendText}>Almost Full</Text>
            </View>
          </View>
        </Pressable>
      </View>

      <ChalkDivider style={styles.sectionDivider} />

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

function make_styles() {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: themeColor().bg, paddingHorizontal: 20 },

  /* header */
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
  },
  headerAvatar: { width: 36, height: 36, borderRadius: 999, backgroundColor: themeColor().card },
  headerAvatarFallback: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: themeColor().pitch,
    backgroundColor: themeColor().pitchPanel,
  },
  avatarUnverified: { borderWidth: 2, borderColor: themeColor().line },

  greeting: { marginTop: 8, fontSize: 20, fontFamily: "InstrumentSerif_400Regular", fontWeight: "800", color: themeColor().text,},
  greetingName: { color: themeColor().pitchText },
  rateBanner: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: themeColor().pitch,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  rateBannerText: { color: themeColor().onPitch, fontWeight: "800", fontSize: 14, fontFamily: "Inter_700Bold", flex: 1 },

  sectionDivider: { marginTop: 16, marginBottom: 4 },

  /* section labels */
  sectionLabel: {
    marginTop: 12,
    marginBottom: 8,
    fontSize: 13, fontFamily: "Inter_700Bold",
    fontWeight: "500",
    color: themeColor().pitchText,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  sectionAction: { fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700", color: themeColor().muted },

  /* tier badge */
  tierBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  tierBadgeText: { fontSize: 11, fontFamily: "Inter_700Bold", fontWeight: "800",},
  tierDiamond: { fontSize: 11, fontFamily: "Inter_700Bold", fontWeight: "800" },

  /* next match card — compact */
  matchCard: {
    backgroundColor: themeColor().card,
    borderWidth: 1,
    borderColor: themeColor().overlay,
    borderLeftWidth: 4,
    borderRadius: 12,
    padding: 8,
    overflow: "hidden",
  },
  matchMark: { position: "absolute", top: 8, right: 8 },
  matchTitle: { marginTop: 4, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "800", color: themeColor().text,},
  matchMetaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  matchMeta: { fontSize: 13, fontFamily: "Inter_400Regular", color: themeColor().muted, flexShrink: 1 },
  matchBottom: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginTop: 8,
  },
  matchSpots: { fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: themeColor().text, flexShrink: 1 },
  priceBox: { alignItems: "flex-end" },
  priceText: { fontSize: 20, fontFamily: "InstrumentSerif_400Regular", fontWeight: "800", color: themeColor().text,},
  priceTier: { fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: themeColor().muted },
  primaryBtn: {
    marginTop: 8,
    backgroundColor: themeColor().pitch,
    borderRadius: 12,
    paddingVertical: 8,
    alignItems: "center",
  },
  primaryBtnText: { color: themeColor().onPitch, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "800",},
  matchEmpty: { borderLeftWidth: 1 },

  /* map */
  mapWrap: {
    height: 200,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: themeColor().overlay,
    backgroundColor: themeColor().bg,
  },
  mapLegend: {
    position: "absolute",
    bottom: 10,
    left: 10,
    flexDirection: "row",
    gap: 12,
    backgroundColor: themeColor().card,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 10 },
  legendText: { fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: themeColor().text },
  markerWrap: { alignItems: "center" },
  markerDot: {
    width: 16,
    height: 16,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: themeColor().line,
    alignItems: "center",
    justifyContent: "center",
  },
  markerLiveDot: {
    position: "absolute",
    top: -4,
    right: -4,
    width: 10,
    height: 10,
    borderRadius: 10,
    backgroundColor: themeColor().bg,
    alignItems: "center",
    justifyContent: "center",
  },
  markerLabel: {
    marginTop: 4,
    backgroundColor: themeColor().card,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 10,
    maxWidth: 90,
  },
  markerLabelText: { fontSize: 11, fontFamily: "Inter_700Bold", fontWeight: "700", color: themeColor().text },

  /* friends playing tonight */
  friendsRow: { paddingBottom: 4, gap: 16 },
  friendItem: { alignItems: "center", width: 72 },
  friendAvatarWrap: {
    width: 60,
    height: 60,
    borderRadius: 999,
    borderWidth: 2,
    overflow: "visible",
  },
  friendAvatarImg: { width: 56, height: 56, borderRadius: 999, margin: 0 },
  friendAvatarFallback: {
    backgroundColor: themeColor().card,
    alignItems: "center",
    justifyContent: "center",
  },
  friendInitials: { fontSize: 20, fontFamily: "InstrumentSerif_400Regular", fontWeight: "700", color: themeColor().text },
  friendDot: {
    position: "absolute",
    bottom: -1,
    right: -1,
    width: 14,
    height: 14,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: themeColor().line,
  },
  friendName: {
    marginTop: 4,
    fontSize: 13, fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
    color: themeColor().text,
    textAlign: "center",
    width: 72,
  },
  friendStatus: { marginTop: 4, fontSize: 13, fontFamily: "Inter_500Medium", fontWeight: "500", textAlign: "center" },

  /* quick actions */
  quickActionsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  quickActionBtn: {
    flex: 1,
    backgroundColor: themeColor().overlaySubtle,
    borderWidth: 1,
    borderColor: themeColor().overlay,
    borderRadius: 12,
    height: 68,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  quickActionLabel: {
    fontSize: 13, fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: themeColor().muted,
  },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}

