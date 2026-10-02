import { useAuth } from "@/context/AuthContext";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  Animated,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import MapView, { Marker, type Region } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import PlayerAvatar, { AvatarStack, type AvatarPerson } from "@/components/PlayerAvatar";
import { PhotoHeader, useFieldPhotos } from "@/components/photo";
import SpotsBadge from "@/components/pickup/SpotsBadge";
import { effectiveMaxDriveMinutes } from "@/lib/pickup/profileMaxDriveFilter";
import { currentHourEt, fmtPickupSlotChipEt } from "@/lib/pickup/runStartAtDisplay";
import { averageStars, fetchPlayerStars, fetchRunMinStars, formatStars } from "@/lib/starRatings";
import { driveRadiusMiles, milesFromZip, regionForZipDrive } from "@/lib/venueDistance";
import { headline, radius, themeColor, useTheme, useThemedStyles } from "@/theme";

/* --------------------------------------------------------------- helpers */

function greeting(): string {
  const h = currentHourEt();
  if (h < 12) return "Morning";
  if (h < 17) return "Afternoon";
  return "Evening";
}

function firstNameFromEmail(email: string | undefined): string {
  if (!email) return "there";
  const local = email.split("@")[0]?.trim() ?? "";
  const word = local.replace(/[._-]+/g, " ").trim().split(" ")[0] ?? "";
  if (!word) return "there";
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function splitLocation(locationText: string | null, title: string | null): { field: string; town: string | null } {
  const parts = (locationText ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  return { field: parts[0] || title?.trim() || "Pickup game", town: parts[1] ?? null };
}

function crowdLine(avgStar: number | null, going: number): string {
  const parts: string[] = [];
  if (avgStar != null) parts.push(`Avg level ${formatStars(avgStar)}`);
  parts.push(`${going} going`);
  return parts.join(" · ");
}

/* --------------------------------------------------------------- types */

const RUN_COLUMNS =
  "id,title,start_at,location_text,latitude,longitude,capacity,spots_taken,fee_cents,format,run_type,status";

const OPEN_STATUSES = new Set(["planning", "likely_on", "active"]);
const NEAR_LIMIT = 10;
const TEAMMATES_SHOWN = 5;

type HomeRun = {
  id: string;
  title: string | null;
  start_at: string;
  location_text: string | null;
  latitude: number | null;
  longitude: number | null;
  capacity: number;
  spots_taken: number;
  fee_cents: number;
  format: string | null;
  run_type: string | null;
  status: string | null;
};

type RunCrowd = { people: AvatarPerson[]; avgStar: number | null };

type Teammate = AvatarPerson & { star: number | null; start_at: string };

type RateBanner = { run_id: string; title: string | null };

type ProfileRow = AvatarPerson & { id: string };

const FAIRFIELD: Region = {
  latitude: 40.8,
  longitude: -73.8,
  latitudeDelta: 3.5,
  longitudeDelta: 3.5,
};

const EMPTY_CROWD: RunCrowd = { people: [], avgStar: null };

function isSessionLive(startAt: string | null | undefined): boolean {
  if (!startAt) return false;
  const start = Date.parse(startAt);
  if (!Number.isFinite(start)) return false;
  const now = Date.now();
  return now >= start && now < start + 2 * 60 * 60 * 1000;
}

function LivePulseDot({ size = 8 }: { size?: number }) {
  useThemedStyles(publish_styles);

  const [opacity] = useState(() => new Animated.Value(1));
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

function pinColor(left: number, minStar: number | undefined): string {
  if (left >= 1 && left <= 2) return themeColor().coral;
  if (minStar != null && minStar >= 3) return themeColor().muted;
  return themeColor().accent;
}

/* --------------------------------------------------------------- data */

async function loadProfiles(
  supabase: NonNullable<ReturnType<typeof useAuth>["supabase"]>,
  ids: string[],
): Promise<{ byId: Map<string, ProfileRow>; error: string | null }> {
  const byId = new Map<string, ProfileRow>();
  if (ids.length === 0) return { byId, error: null };
  const { data, error } = await supabase.from("profiles").select("id,first_name,last_name,avatar_url").in("id", ids);
  for (const p of (data ?? []) as Array<{
    id: string;
    first_name: string | null;
    last_name: string | null;
    avatar_url: string | null;
  }>) {
    byId.set(p.id, {
      id: p.id,
      user_id: p.id,
      first_name: p.first_name,
      last_name: p.last_name,
      avatar_url: p.avatar_url?.trim() || null,
    });
  }
  return { byId, error: error ? error.message : null };
}

function useHomeData() {
  const { session, supabase } = useAuth();
  const myUserId = session?.user?.id ?? null;

  const [firstName, setFirstName] = useState<string | null>(null);
  const [homeZip, setHomeZip] = useState<string | null>(null);
  const [maxDriveMinutes, setMaxDriveMinutes] = useState<number | null>(null);
  const [nextMatch, setNextMatch] = useState<HomeRun | null>(null);
  const [nearRuns, setNearRuns] = useState<HomeRun[]>([]);
  const [mapRuns, setMapRuns] = useState<HomeRun[]>([]);
  const [minStars, setMinStars] = useState<Map<string, number>>(new Map());
  const [crowds, setCrowds] = useState<Map<string, RunCrowd>>(new Map());
  const [teammates, setTeammates] = useState<Teammate[]>([]);
  const [rateBanner, setRateBanner] = useState<RateBanner | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !myUserId) return;
    const errors: string[] = [];
    const note = (label: string, err: { message: string } | null | undefined) => {
      if (err) errors.push(`${label}: ${err.message}`);
    };
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const threeHoursAgo = new Date(now - 3 * 60 * 60 * 1000).toISOString();

    const [profileRes, myRsvpRes, mapRes, followsRes] = await Promise.all([
      supabase.from("profiles").select("first_name,zip_code,max_drive_minutes").eq("id", myUserId).maybeSingle(),
      supabase.from("pickup_run_rsvps").select("run_id").eq("user_id", myUserId).eq("status", "confirmed").limit(200),
      // Map runs stay visible for 2h after kickoff, including recently completed ones.
      supabase
        .from("pickup_runs")
        .select(RUN_COLUMNS)
        .or(`status.in.(planning,likely_on,active,in_progress),and(status.eq.completed,start_at.gte."${twoHoursAgo}")`)
        .gte("start_at", twoHoursAgo)
        .not("latitude", "is", null)
        .not("longitude", "is", null)
        .order("start_at", { ascending: true })
        .limit(40),
      supabase.from("player_follows").select("following_id").eq("follower_id", myUserId),
    ]);
    note("profile", profileRes.error);
    note("rsvps", myRsvpRes.error);
    note("runs", mapRes.error);
    note("follows", followsRes.error);

    const profile = profileRes.data as {
      first_name?: string | null;
      zip_code?: string | null;
      max_drive_minutes?: number | null;
    } | null;
    const zip = profile?.zip_code?.trim() || null;
    setFirstName(profile?.first_name?.trim() || null);
    setHomeZip(zip);
    setMaxDriveMinutes(profile?.max_drive_minutes ?? null);

    const myRunIds = Array.from(
      new Set(
        ((myRsvpRes.data ?? []) as Array<{ run_id: string | null }>)
          .map((r) => r.run_id)
          .filter((v): v is string => Boolean(v)),
      ),
    );

    let next: HomeRun | null = null;
    let recentRuns: Array<{ id: string; title: string | null; created_by: string | null; tier_session_id: string | null }> = [];
    if (myRunIds.length > 0) {
      const [nextRes, recentRes] = await Promise.all([
        supabase
          .from("pickup_runs")
          .select(RUN_COLUMNS)
          .in("id", myRunIds)
          .gte("start_at", nowIso)
          .order("start_at", { ascending: true })
          .limit(1),
        supabase
          .from("pickup_runs")
          .select("id,title,start_at,created_by,tier_session_id,status")
          .in("id", myRunIds)
          .gt("start_at", threeHoursAgo)
          .lt("start_at", nowIso)
          .in("status", ["planning", "active", "in_progress", "completed"])
          .order("start_at", { ascending: false })
          .limit(8),
      ]);
      note("next game", nextRes.error);
      note("recent games", recentRes.error);
      next = ((nextRes.data ?? []) as HomeRun[])[0] ?? null;
      recentRuns = (recentRes.data ?? []) as typeof recentRuns;
    }
    setNextMatch(next);

    const runs = (mapRes.data ?? []) as HomeRun[];
    setMapRuns(runs);

    const radiusMiles = driveRadiusMiles(effectiveMaxDriveMinutes(profile?.max_drive_minutes ?? null));
    const mine = new Set(myRunIds);
    const near = runs
      .filter(
        (r) =>
          Date.parse(r.start_at) >= now &&
          OPEN_STATUSES.has(r.status ?? "") &&
          r.run_type !== "select" &&
          !mine.has(r.id) &&
          r.capacity - r.spots_taken > 0,
      )
      .filter((r) => {
        const mi = milesFromZip(zip, r.latitude, r.longitude);
        return mi == null || mi <= radiusMiles;
      })
      .slice(0, NEAR_LIMIT);
    setNearRuns(near);

    // Crowds: RSVPs, profiles and stars are separate queries merged here.
    const crowdRunIds = [...(next ? [next.id] : []), ...near.map((r) => r.id)];
    const crowdRsvpRes = crowdRunIds.length
      ? await supabase
          .from("pickup_run_rsvps")
          .select("run_id,user_id")
          .in("run_id", crowdRunIds)
          .in("status", ["confirmed", "pending_payment"])
      : { data: [], error: null };
    note("attendees", crowdRsvpRes.error);
    const crowdRows = (crowdRsvpRes.data ?? []) as Array<{ run_id: string; user_id: string }>;
    const crowdUserIds = Array.from(new Set(crowdRows.map((r) => r.user_id).filter(Boolean)));

    const [minStarMap, crowdProfiles, crowdStars] = await Promise.all([
      fetchRunMinStars(supabase, [...runs.map((r) => r.id), ...crowdRunIds]),
      loadProfiles(supabase, crowdUserIds),
      fetchPlayerStars(supabase, crowdUserIds),
    ]);
    if (crowdProfiles.error) errors.push(`attendee profiles: ${crowdProfiles.error}`);
    setMinStars(minStarMap);

    const nextCrowds = new Map<string, RunCrowd>();
    for (const runId of crowdRunIds) {
      const ids = crowdRows.filter((r) => r.run_id === runId).map((r) => r.user_id);
      nextCrowds.set(runId, {
        people: ids.map(
          (uid) => crowdProfiles.byId.get(uid) ?? { user_id: uid, first_name: null, last_name: null, avatar_url: null },
        ),
        avgStar: averageStars(ids.map((uid) => crowdStars.get(uid))),
      });
    }
    setCrowds(nextCrowds);

    // Unrated recent session banner (started within last 3h, confirmed, not host, no vote yet).
    let banner: RateBanner | null = null;
    for (const run of recentRuns) {
      if (run.created_by === myUserId) continue;
      let voted = false;
      if (run.tier_session_id) {
        const { data: votes, error } = await supabase
          .from("peer_votes")
          .select("voter_id")
          .eq("session_id", run.tier_session_id)
          .eq("voter_id", myUserId)
          .limit(1);
        note("votes", error);
        voted = (votes?.length ?? 0) > 0;
      }
      if (!voted) {
        banner = { run_id: run.id, title: run.title };
        break;
      }
    }
    setRateBanner(banner);

    // Teammates out tonight: people I follow with a confirmed RSVP for a game today.
    const followingIds = ((followsRes.data ?? []) as Array<{ following_id: string | null }>)
      .map((f) => f.following_id)
      .filter((v): v is string => Boolean(v));
    let tonight: Teammate[] = [];
    if (followingIds.length > 0) {
      const { data: friendRsvps, error: friendRsvpErr } = await supabase
        .from("pickup_run_rsvps")
        .select("user_id,run_id")
        .in("user_id", followingIds)
        .eq("status", "confirmed");
      note("teammate rsvps", friendRsvpErr);
      const rows = (friendRsvps ?? []) as Array<{ user_id: string; run_id: string }>;
      const friendRunIds = Array.from(new Set(rows.map((r) => r.run_id).filter(Boolean)));
      if (friendRunIds.length > 0) {
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);
        const { data: todayRuns, error: todayErr } = await supabase
          .from("pickup_runs")
          .select("id,start_at")
          .in("id", friendRunIds)
          .gte("start_at", twoHoursAgo)
          .lte("start_at", todayEnd.toISOString());
        note("teammate games", todayErr);
        const startByRun = new Map(
          ((todayRuns ?? []) as Array<{ id: string; start_at: string }>).map((r) => [r.id, r.start_at]),
        );
        const startByUser = new Map<string, string>();
        for (const r of rows) {
          const s = startByRun.get(r.run_id);
          if (!s) continue;
          const prev = startByUser.get(r.user_id);
          if (!prev || s < prev) startByUser.set(r.user_id, s);
        }
        const friendIds = Array.from(startByUser.keys());
        const [friendProfiles, friendStars] = await Promise.all([
          loadProfiles(supabase, friendIds),
          fetchPlayerStars(supabase, friendIds),
        ]);
        if (friendProfiles.error) errors.push(`teammate profiles: ${friendProfiles.error}`);
        tonight = friendIds.map((uid) => {
          const p = friendProfiles.byId.get(uid);
          return {
            user_id: uid,
            first_name: p?.first_name ?? null,
            last_name: p?.last_name ?? null,
            avatar_url: p?.avatar_url ?? null,
            star: friendStars.get(uid) ?? null,
            start_at: startByUser.get(uid)!,
          };
        });
      }
    }
    setTeammates(tonight);

    if (errors.length > 0) {
      console.warn("[home] load errors:", errors.join(" | "));
      setLoadError("Some of Home did not load. Pull down to try again.");
    } else {
      setLoadError(null);
    }
  }, [supabase, myUserId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return {
    myUserId,
    firstName,
    homeZip,
    maxDriveMinutes,
    nextMatch,
    nearRuns,
    mapRuns,
    minStars,
    crowds,
    teammates,
    rateBanner,
    loadError,
    reload: load,
  };
}

/* --------------------------------------------------------------- pieces */

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
      <Text style={styles.sectionTitle}>{label}</Text>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button">
          <Text style={styles.sectionAction}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function MapDot({ run, minStar }: { run: HomeRun; minStar: number | undefined }) {
  useThemedStyles(publish_styles);

  const [track, setTrack] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setTrack(false), 500);
    return () => clearTimeout(t);
  }, []);
  const left = run.capacity - run.spots_taken;
  const color = pinColor(left, minStar);
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

function UpNextCard({
  run,
  photo,
  crowd,
  onPress,
}: {
  run: HomeRun;
  photo: string | undefined;
  crowd: RunCrowd;
  onPress: () => void;
}) {
  useThemedStyles(publish_styles);

  const left = Math.max(run.capacity - run.spots_taken, 0);
  const going = Math.max(run.spots_taken, crowd.people.length);
  const { field, town } = splitLocation(run.location_text, run.title);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Up next, ${field}, ${fmtPickupSlotChipEt(run.start_at)}`}
    >
      {photo ? (
        <View>
          <PhotoHeader uri={photo} accessibilityLabel={`${field} field photo`} />
          <SpotsBadge spotsLeft={left} style={styles.photoBadge} />
        </View>
      ) : null}
      <View style={styles.cardBody}>
        <View style={styles.cardTopRow}>
          <Text style={styles.when} numberOfLines={1}>
            {fmtPickupSlotChipEt(run.start_at)}
          </Text>
          {photo ? null : <SpotsBadge spotsLeft={left} />}
        </View>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {field}
        </Text>
        {town ? (
          <Text style={styles.cardSub} numberOfLines={1}>
            {town}
          </Text>
        ) : null}
        <View style={styles.crowdRow}>
          <AvatarStack people={crowd.people} total={going} />
          <Text style={styles.crowdText} numberOfLines={1}>
            {crowdLine(crowd.avgStar, going)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function GameCard({
  run,
  photo,
  crowd,
  onPress,
}: {
  run: HomeRun;
  photo: string | undefined;
  crowd: RunCrowd;
  onPress: () => void;
}) {
  useThemedStyles(publish_styles);

  const left = Math.max(run.capacity - run.spots_taken, 0);
  const going = Math.max(run.spots_taken, crowd.people.length);
  const { field } = splitLocation(run.location_text, run.title);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, styles.gameCard, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${field}, ${fmtPickupSlotChipEt(run.start_at)}`}
    >
      <View>
        {photo ? (
          <PhotoHeader uri={photo} accessibilityLabel={`${field} field photo`} />
        ) : (
          <View style={styles.thumbFallback} />
        )}
        <SpotsBadge spotsLeft={left} style={styles.photoBadge} />
      </View>
      <View style={styles.gameBody}>
        <Text style={styles.when} numberOfLines={1}>
          {fmtPickupSlotChipEt(run.start_at)}
        </Text>
        <Text style={styles.gameTitle} numberOfLines={1}>
          {field}
        </Text>
        <View style={styles.gameMetaRow}>
          {run.format ? (
            <View style={styles.chip}>
              <Text style={styles.chipText}>{run.format}</Text>
            </View>
          ) : null}
          <Text style={styles.gameMeta} numberOfLines={1}>
            {crowdLine(crowd.avgStar, going)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function TeammatesSection({
  teammates,
  onPlayer,
  onMore,
}: {
  teammates: Teammate[];
  onPlayer: (id: string) => void;
  onMore: () => void;
}) {
  useThemedStyles(publish_styles);

  const shown = teammates.slice(0, TEAMMATES_SHOWN);
  const extra = teammates.length - shown.length;
  return (
    <View>
      <SectionHeader label="Teammates out tonight" />
      {teammates.length === 0 ? (
        <Text style={styles.emptyLine}>None of your teammates are out tonight.</Text>
      ) : (
        <View style={styles.teammateRow}>
          {shown.map((t) => (
            <Pressable
              key={t.user_id}
              onPress={() => onPlayer(t.user_id)}
              style={styles.teammate}
              accessibilityRole="button"
              accessibilityLabel={`Open ${t.first_name?.trim() || "player"}'s profile`}
            >
              <PlayerAvatar person={t} size={48} />
              <Text style={styles.teammateName} numberOfLines={1}>
                {t.first_name?.trim() || "Player"}
              </Text>
              {t.star != null ? <Text style={styles.teammateStar}>{formatStars(t.star)}</Text> : null}
            </Pressable>
          ))}
          {extra > 0 ? (
            <Pressable
              onPress={onMore}
              style={styles.teammate}
              accessibilityRole="button"
              accessibilityLabel={`${extra} more teammates`}
            >
              <View style={styles.moreBubble}>
                <Text style={styles.moreBubbleText}>+{extra}</Text>
              </View>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

/* --------------------------------------------------------------- screen */

export default function HomeScreen() {
  useThemedStyles(publish_styles);

  const insets = useSafeAreaInsets();
  const router = useRouter();
  const push = router.push as (href: string) => void;
  const {
    firstName,
    homeZip,
    maxDriveMinutes,
    nextMatch,
    nearRuns,
    mapRuns,
    minStars,
    crowds,
    teammates,
    rateBanner,
    loadError,
    reload,
  } = useHomeData();
  const theme = useTheme();
  const { session } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  const name = firstName || firstNameFromEmail(session?.user?.email ?? undefined);
  const fieldPhotos = useFieldPhotos([...(nextMatch ? [nextMatch.id] : []), ...nearRuns.map((r) => r.id)]);
  const openRun = (id: string) => push(`/session/${encodeURIComponent(id)}`);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  }, [reload]);

  const mapRegion: Region =
    regionForZipDrive(homeZip, effectiveMaxDriveMinutes(maxDriveMinutes)) ??
    (mapRuns[0]?.latitude != null && mapRuns[0]?.longitude != null
      ? {
          latitude: mapRuns[0].latitude,
          longitude: mapRuns[0].longitude,
          latitudeDelta: 0.6,
          longitudeDelta: 0.6,
        }
      : FAIRFIELD);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top, 12) + 8 }]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={themeColor().muted} />
      }
    >
      <View style={styles.header}>
        <Text style={styles.wordmark}>CT Pickup</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Notifications"
          onPress={() => push("/(tabs)/messages")}
          hitSlop={10}
        >
          <FontAwesome name="bell-o" size={20} color={themeColor().text} />
        </Pressable>
      </View>

      <Text style={styles.greeting} numberOfLines={1}>
        {greeting()}, <Text style={styles.greetingName}>{name}</Text>
      </Text>

      {loadError ? <Text style={styles.errorLine}>{loadError}</Text> : null}

      {rateBanner ? (
        <Pressable
          onPress={() => openRun(rateBanner.run_id)}
          style={({ pressed }) => [styles.rateBanner, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Rate your recent session"
        >
          <FontAwesome name="star" size={14} color={themeColor().onAccent} />
          <Text style={styles.rateBannerText}>You have a session to rate</Text>
        </Pressable>
      ) : null}

      <SectionHeader label="Up next" />
      {nextMatch ? (
        <UpNextCard
          run={nextMatch}
          photo={fieldPhotos[nextMatch.id]}
          crowd={crowds.get(nextMatch.id) ?? EMPTY_CROWD}
          onPress={() => openRun(nextMatch.id)}
        />
      ) : (
        <View style={[styles.card, styles.emptyCard]}>
          <Text style={styles.emptyTitle}>Nothing on your calendar.</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => push("/community-map")}
            style={({ pressed }) => [styles.accentBtn, pressed && styles.pressed]}
          >
            <Text style={styles.accentBtnText}>Get a game</Text>
          </Pressable>
        </View>
      )}

      <SectionHeader label="Games near you" actionLabel="See all" onAction={() => push("/session-map")} />
      {nearRuns.length === 0 ? (
        <Text style={styles.emptyLine}>No open games near you right now.</Text>
      ) : (
        <FlatList
          horizontal
          data={nearRuns}
          keyExtractor={(r) => r.id}
          showsHorizontalScrollIndicator={false}
          style={styles.strip}
          contentContainerStyle={styles.stripContent}
          renderItem={({ item }) => (
            <GameCard
              run={item}
              photo={fieldPhotos[item.id]}
              crowd={crowds.get(item.id) ?? EMPTY_CROWD}
              onPress={() => openRun(item.id)}
            />
          )}
        />
      )}

      <SectionHeader label="Nearby games" actionLabel="View map" onAction={() => push("/community-map")} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open map"
        onPress={() => push("/community-map")}
        style={styles.mapWrap}
      >
        <MapView
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          region={mapRegion}
          mapType={Platform.OS === "ios" ? "mutedStandard" : "standard"}
          userInterfaceStyle={theme.mode}
          loadingBackgroundColor={themeColor().card}
          scrollEnabled={false}
          zoomEnabled={false}
          pitchEnabled={false}
          rotateEnabled={false}
          showsPointsOfInterest={false}
          showsMyLocationButton={false}
        >
          {mapRuns.map((run) => (
            <MapDot key={run.id} run={run} minStar={minStars.get(run.id)} />
          ))}
        </MapView>
        <View style={styles.mapLegend} pointerEvents="none">
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: themeColor().accent }]} />
            <Text style={styles.legendText}>Open</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: themeColor().muted }]} />
            <Text style={styles.legendText}>3.0+</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: themeColor().coral }]} />
            <Text style={styles.legendText}>Almost full</Text>
          </View>
        </View>
      </Pressable>

      <TeammatesSection
        teammates={teammates}
        onPlayer={(id) => push(`/player/${id}`)}
        onMore={() => push("/following")}
      />
    </ScrollView>
  );
}

/* --------------------------------------------------------------- styles */

function make_styles() {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: themeColor().bg },
    content: { paddingHorizontal: 20, paddingBottom: 32 },
    pressed: { opacity: 0.88 },

    /* header */
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    wordmark: { fontSize: 20, ...headline, color: themeColor().text },
    greeting: { marginTop: 16, fontSize: 32, ...headline, color: themeColor().text },
    greetingName: { color: themeColor().pitchText },
    errorLine: { marginTop: 8, fontSize: 14, fontFamily: "Inter_400Regular", color: themeColor().coralText },
    rateBanner: {
      marginTop: 16,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: themeColor().accent,
      borderRadius: radius.card,
      paddingVertical: 12,
      paddingHorizontal: 12,
    },
    rateBannerText: { color: themeColor().onAccent, fontSize: 14, fontFamily: "Inter_700Bold", flex: 1 },

    /* sections */
    sectionHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 24,
      marginBottom: 12,
    },
    sectionTitle: { fontSize: 20, ...headline, color: themeColor().text },
    sectionAction: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: themeColor().accent },
    emptyLine: { fontSize: 14, fontFamily: "Inter_400Regular", color: themeColor().muted, paddingVertical: 8 },

    /* cards */
    card: {
      backgroundColor: themeColor().card,
      borderWidth: 1,
      borderColor: themeColor().line,
      borderRadius: radius.card,
      overflow: "hidden",
    },
    photoBadge: { position: "absolute", top: 12, left: 12 },
    cardBody: { padding: 16, gap: 4 },
    cardTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
    when: { flexShrink: 1, fontSize: 13, fontFamily: "Inter_600SemiBold", color: themeColor().pitchText },
    cardTitle: { fontSize: 20, ...headline, color: themeColor().text },
    cardSub: { fontSize: 14, fontFamily: "Inter_400Regular", color: themeColor().muted },
    crowdRow: { marginTop: 8, flexDirection: "row", alignItems: "center", gap: 8 },
    crowdText: { flexShrink: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: themeColor().muted },

    emptyCard: { padding: 16, minHeight: 120, justifyContent: "center", alignItems: "flex-start", gap: 12 },
    emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: themeColor().text },
    accentBtn: {
      backgroundColor: themeColor().accent,
      borderRadius: radius.button,
      paddingVertical: 12,
      paddingHorizontal: 20,
    },
    accentBtnText: { color: themeColor().onAccent, fontSize: 16, fontFamily: "Inter_700Bold" },

    /* games strip */
    strip: { marginHorizontal: -20 },
    stripContent: { paddingHorizontal: 20, gap: 12 },
    gameCard: { width: 232 },
    thumbFallback: { aspectRatio: 16 / 9, backgroundColor: themeColor().pitchPanel },
    gameBody: { padding: 12, gap: 4 },
    gameTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: themeColor().text },
    gameMetaRow: { marginTop: 4, flexDirection: "row", alignItems: "center", gap: 8 },
    gameMeta: { flexShrink: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: themeColor().muted },
    chip: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: radius.pill,
      backgroundColor: themeColor().pitchPanel,
    },
    chipText: { fontSize: 11, fontFamily: "Inter_700Bold", color: themeColor().onPitchPanel },

    /* map */
    mapWrap: {
      height: 160,
      borderRadius: radius.card,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: themeColor().line,
      backgroundColor: themeColor().card,
    },
    mapLegend: {
      position: "absolute",
      bottom: 8,
      left: 8,
      flexDirection: "row",
      gap: 12,
      backgroundColor: themeColor().card,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radius.pill,
    },
    legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
    legendDot: { width: 8, height: 8, borderRadius: 4 },
    legendText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: themeColor().text },
    markerWrap: { alignItems: "center" },
    markerDot: {
      width: 16,
      height: 16,
      borderRadius: 8,
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
      borderRadius: 5,
      backgroundColor: themeColor().bg,
      alignItems: "center",
      justifyContent: "center",
    },
    markerLabel: {
      marginTop: 4,
      backgroundColor: themeColor().card,
      paddingHorizontal: 4,
      paddingVertical: 1,
      borderRadius: radius.button,
      maxWidth: 90,
    },
    markerLabelText: { fontSize: 11, fontFamily: "Inter_700Bold", color: themeColor().text },

    /* teammates */
    teammateRow: { flexDirection: "row", gap: 12 },
    teammate: { width: 56, alignItems: "center", gap: 4 },
    teammateName: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: themeColor().text, textAlign: "center", width: 56 },
    teammateStar: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: themeColor().muted },
    moreBubble: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: themeColor().line,
      alignItems: "center",
      justifyContent: "center",
    },
    moreBubbleText: { fontSize: 14, fontFamily: "Inter_700Bold", color: themeColor().text },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
