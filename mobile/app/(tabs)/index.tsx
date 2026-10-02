import { useAuth } from "@/context/AuthContext";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Animated,
  Dimensions,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useColorScheme } from "@/components/useColorScheme";
import MapView, { Marker, type Region } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AvatarStack, type AvatarPerson } from "@/components/PlayerAvatar";
import { PhotoHeader, useFieldPhotos } from "@/components/photo";
import PlayedWithRow, { usePlayedWith } from "@/components/pickup/PlayedWithRow";
import SpotsBadge, { ALMOST_FULL_AT } from "@/components/pickup/SpotsBadge";
import {
  BestGamesCarousel,
  crowdLine,
  EMPTY_CROWD,
  GameCard,
  splitLocation,
  type RunCrowd,
} from "@/components/games/GameCards";
import { useSelectedRegion } from "@/context/SelectedRegionContext";
import { toggleDevPreview, useDevPreview } from "@/lib/devPreview";
import { fetchBestGames, type BestGame, type PlayedWithSummary } from "@/lib/matchApi";
import { effectiveMaxDriveMinutes } from "@/lib/pickup/profileMaxDriveFilter";
import { currentHourEt, fmtPickupSlotChipEt, runTimeTbd } from "@/lib/pickup/runStartAtDisplay";
import { fetchRunTimeTbdIds } from "@/lib/pickup/runTimeTbd";
import { isServiceRegionCode, serviceRegionName } from "@/lib/serviceRegions";
import { averageStars, fetchPlayerCards, type PlayerCard } from "@/lib/starRatings";
import { StarRating } from "@/components/StarRating";
import { driveRadiusMiles, milesFromZip, zipCentroid, zipState } from "@/lib/venueDistance";
import { serviceRegionForVenueName } from "@/lib/venueServiceRegion";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";
import type { DevFixtures } from "../../dev-fixtures";
import { Wordmark } from "@/components/brand/Wordmark";

// eslint-disable-next-line @typescript-eslint/no-require-imports -- must stay a __DEV__ require so release bundles drop dev-fixtures
const devFixtures: DevFixtures | null = __DEV__ ? require("../../dev-fixtures").default : null;

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

/* --------------------------------------------------------------- types */

const RUN_COLUMNS =
  "id,title,start_at,location_text,latitude,longitude,capacity,spots_taken,fee_cents,format,run_type,status";

const OPEN_STATUSES = new Set(["planning", "likely_on", "active"]);
const NEAR_LIMIT = 10;
const REGION_FALLBACK_LIMIT = 3;
const BEST_GAMES_LIMIT = 3;
const MAP_HEIGHT = 160;
const MAP_MAX_WIDTH_MILES = 60;
const MILES_PER_LAT_DEGREE = 69;

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
  time_tbd?: boolean;
};

type RateBanner = { run_id: string; title: string | null };

type ProfileRow = AvatarPerson & { id: string };

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

function pinColor(left: number): string {
  return left <= ALMOST_FULL_AT ? themeColor().coral : themeColor().accent;
}

/**
 * MapKit grows a region to fill the view, so both deltas follow the card's aspect
 * ratio; a square span on this wide card would show roughly twice the intended width.
 */
function cardRegion(
  center: { latitude: number; longitude: number },
  radiusMiles: number,
  width: number,
): Region {
  const widthMiles = Math.min(radiusMiles * 2, MAP_MAX_WIDTH_MILES);
  const cosLat = Math.max(0.2, Math.cos((center.latitude * Math.PI) / 180));
  return {
    latitude: center.latitude,
    longitude: center.longitude,
    latitudeDelta: (widthMiles * (MAP_HEIGHT / Math.max(width, 1))) / MILES_PER_LAT_DEGREE,
    longitudeDelta: widthMiles / (MILES_PER_LAT_DEGREE * cosLat),
  };
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
  const { region: selectedRegion } = useSelectedRegion();
  const myUserId = session?.user?.id ?? null;
  const accessToken = session?.access_token ?? null;

  const [firstName, setFirstName] = useState<string | null>(null);
  const [homeZip, setHomeZip] = useState<string | null>(null);
  const [maxDriveMinutes, setMaxDriveMinutes] = useState<number | null>(null);
  const [nextMatch, setNextMatch] = useState<HomeRun | null>(null);
  const [nearRuns, setNearRuns] = useState<HomeRun[]>([]);
  const [regionRuns, setRegionRuns] = useState<HomeRun[]>([]);
  const [regionName, setRegionName] = useState<string | null>(null);
  const [mapRuns, setMapRuns] = useState<HomeRun[]>([]);
  const [crowds, setCrowds] = useState<Map<string, RunCrowd>>(new Map());
  const [bestGames, setBestGames] = useState<BestGame[]>([]);
  const [loadCount, setLoadCount] = useState(0);
  const [rateBanner, setRateBanner] = useState<RateBanner | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [myCard, setMyCard] = useState<PlayerCard | null>(null);

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

    const [profileRes, myRsvpRes, mapRes, bestRes] = await Promise.all([
      supabase.from("profiles").select("first_name,zip_code,max_drive_minutes,nearest_venue").eq("id", myUserId).maybeSingle(),
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
      accessToken
        ? fetchBestGames(accessToken, BEST_GAMES_LIMIT)
        : Promise.resolve({ ok: false as const, status: 401, error: "Not signed in" }),
    ]);
    note("profile", profileRes.error);
    note("rsvps", myRsvpRes.error);
    note("runs", mapRes.error);
    if (bestRes.ok) setBestGames(bestRes.data);
    else {
      errors.push(`best games: ${bestRes.error}`);
      setBestGames([]);
    }

    const profile = profileRes.data as {
      first_name?: string | null;
      zip_code?: string | null;
      max_drive_minutes?: number | null;
      nearest_venue?: string | null;
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
    const mapRows = (mapRes.data ?? []) as HomeRun[];
    const tbd = await fetchRunTimeTbdIds(supabase, [...(next ? [next.id] : []), ...mapRows.map((r) => r.id)]);
    const withTbd = (r: HomeRun): HomeRun => ({ ...r, time_tbd: tbd.has(r.id) });
    setNextMatch(next ? withTbd(next) : null);

    const runs = mapRows.map(withTbd);
    const radiusMiles = driveRadiusMiles(effectiveMaxDriveMinutes(profile?.max_drive_minutes ?? null));
    const inRange = (r: HomeRun) => {
      const mi = milesFromZip(zip, r.latitude, r.longitude);
      return mi == null || mi <= radiusMiles;
    };
    const isOpen = (r: HomeRun) => OPEN_STATUSES.has(r.status ?? "") && r.capacity - r.spots_taken > 0;
    setMapRuns(runs.filter((r) => isOpen(r) && inRange(r)));

    const mine = new Set(myRunIds);
    const near = runs
      .filter((r) => Date.parse(r.start_at) >= now && isOpen(r) && r.run_type !== "select" && !mine.has(r.id))
      .filter(inRange)
      .slice(0, NEAR_LIMIT);
    setNearRuns(near);

    // Nothing in drive range: next open games anywhere in the player's service region.
    let fallback: HomeRun[] = [];
    let fallbackRegion: string | null = null;
    if (near.length === 0) {
      const zipRegion = zipState(zip);
      fallbackRegion =
        serviceRegionForVenueName(profile?.nearest_venue) ??
        (zipRegion && isServiceRegionCode(zipRegion) ? zipRegion : null) ??
        selectedRegion;
      const { data: regionData, error: regionErr } = await supabase
        .from("pickup_runs")
        .select(RUN_COLUMNS)
        .eq("service_region", fallbackRegion)
        .in("status", Array.from(OPEN_STATUSES))
        .neq("run_type", "select")
        .gte("start_at", nowIso)
        .order("start_at", { ascending: true })
        .limit(REGION_FALLBACK_LIMIT * 4);
      note("region games", regionErr);
      fallback = ((regionData ?? []) as HomeRun[])
        .filter((r) => isOpen(r) && !mine.has(r.id))
        .slice(0, REGION_FALLBACK_LIMIT);
      const fallbackTbd = await fetchRunTimeTbdIds(supabase, fallback.map((r) => r.id));
      fallback = fallback.map((r) => ({ ...r, time_tbd: fallbackTbd.has(r.id) }));
    }
    setRegionRuns(fallback);
    setRegionName(fallbackRegion ? serviceRegionName(fallbackRegion) : null);

    // Crowds: RSVPs, profiles and stars are separate queries merged here.
    const crowdRunIds = [...(next ? [next.id] : []), ...near.map((r) => r.id), ...fallback.map((r) => r.id)];
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

    const [crowdProfiles, cards] = await Promise.all([
      loadProfiles(supabase, crowdUserIds),
      fetchPlayerCards(supabase, [...crowdUserIds, myUserId]),
    ]);
    setMyCard(cards.get(myUserId) ?? null);
    if (crowdProfiles.error) errors.push(`attendee profiles: ${crowdProfiles.error}`);

    const nextCrowds = new Map<string, RunCrowd>();
    for (const runId of crowdRunIds) {
      const ids = crowdRows.filter((r) => r.run_id === runId).map((r) => r.user_id);
      nextCrowds.set(runId, {
        people: ids.map(
          (uid) => crowdProfiles.byId.get(uid) ?? { user_id: uid, first_name: null, last_name: null, avatar_url: null },
        ),
        avgStar: averageStars(ids.map((uid) => cards.get(uid)?.star)),
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


    if (errors.length > 0) {
      console.warn("[home] load errors:", errors.join(" | "));
      setLoadError("Some of Home did not load. Pull down to try again.");
    } else {
      setLoadError(null);
    }
    setLoadCount((n) => n + 1);
  }, [supabase, myUserId, accessToken, selectedRegion]);

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
    regionRuns,
    regionName,
    mapRuns,
    crowds,
    bestGames,
    loadCount,
    rateBanner,
    loadError,
    myCard,
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

function MapDot({ run }: { run: HomeRun }) {
  useThemedStyles(publish_styles);

  const [track, setTrack] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setTrack(false), 500);
    return () => clearTimeout(t);
  }, []);
  const left = run.capacity - run.spots_taken;
  const color = pinColor(left);
  const area = (run.location_text ?? "").split(",")[0]?.trim() || "";
  const live = !runTimeTbd(run) && isSessionLive(run.start_at);
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
  playedWith,
  onPress,
}: {
  run: HomeRun;
  photo: string | undefined;
  crowd: RunCrowd;
  playedWith: PlayedWithSummary | undefined;
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
      accessibilityLabel={`Up next, ${field}, ${fmtPickupSlotChipEt(run.start_at, runTimeTbd(run))}`}
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
            {fmtPickupSlotChipEt(run.start_at, runTimeTbd(run))}
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
        <PlayedWithRow summary={playedWith} style={styles.playedWith} />
      </View>
    </Pressable>
  );
}

/* --------------------------------------------------------------- screen */

export default function HomeScreen() {
  useThemedStyles(publish_styles);

  const insets = useSafeAreaInsets();
  const router = useRouter();
  const push = router.push as (href: string) => void;
  const live = useHomeData();
  const preview = useDevPreview();
  const fixture = useMemo(() => (preview && devFixtures ? devFixtures.home() : null), [preview]);
  const scheme = useColorScheme();
  const { session } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [mapWidth, setMapWidth] = useState(() => Dimensions.get("window").width - 40);

  const firstName = fixture ? fixture.firstName : live.firstName;
  const homeZip = fixture ? fixture.homeZip : live.homeZip;
  const maxDriveMinutes = fixture ? fixture.maxDriveMinutes : live.maxDriveMinutes;
  const nextMatch: HomeRun | null = fixture ? fixture.upNext : live.nextMatch;
  const nearRuns: HomeRun[] = fixture ? fixture.nearby : live.nearRuns;
  const regionRuns: HomeRun[] = fixture ? [] : live.regionRuns;
  const mapRuns: HomeRun[] = fixture ? [fixture.upNext, ...fixture.nearby] : live.mapRuns;
  const bestGames: BestGame[] = fixture ? fixture.bestGames : live.bestGames;
  const rateBanner = fixture ? null : live.rateBanner;
  const myCard: PlayerCard | null = fixture ? fixture.myCard : live.myCard;
  const crowds = useMemo(() => {
    if (!fixture) return live.crowds;
    return new Map<string, RunCrowd>(
      [fixture.upNext, ...fixture.nearby].map((r) => [
        r.id,
        { people: r.going, avgStar: averageStars(r.going.map((p) => p.star)) },
      ]),
    );
  }, [fixture, live.crowds]);

  const name = firstName || firstNameFromEmail(session?.user?.email ?? undefined);
  const cardRunIds = [...(nextMatch ? [nextMatch.id] : []), ...nearRuns.map((r) => r.id), ...regionRuns.map((r) => r.id)];
  const livePhotos = useFieldPhotos(fixture ? [] : [...cardRunIds, ...bestGames.map((g) => g.id)]);
  const fieldPhotos: Record<string, string> = fixture
    ? Object.fromEntries([fixture.upNext, ...fixture.nearby].map((r) => [r.id, r.photo]))
    : livePhotos;
  const livePlayedWith = usePlayedWith(cardRunIds, { skip: Boolean(fixture), reloadKey: live.loadCount });
  const playedWith: Record<string, PlayedWithSummary> = fixture ? fixture.playedWith : livePlayedWith.byRun;
  const loadError = fixture
    ? null
    : (live.loadError ?? (livePlayedWith.error ? "Some of Home did not load. Pull down to try again." : null));
  const openRun = (id: string) => push(`/session/${encodeURIComponent(id)}`);
  const openMap = () => push("/community-map");

  const reload = live.reload;
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  }, [reload]);

  const zipCenter = zipCentroid(homeZip);
  const mapRegion: Region = zipCenter
    ? cardRegion(zipCenter, driveRadiusMiles(effectiveMaxDriveMinutes(maxDriveMinutes)), mapWidth)
    : mapRuns[0]?.latitude != null && mapRuns[0]?.longitude != null
      ? {
          latitude: mapRuns[0].latitude,
          longitude: mapRuns[0].longitude,
          latitudeDelta: 0.6,
          longitudeDelta: 0.6,
        }
      : FAIRFIELD;

  const gamesSection =
    nearRuns.length > 0
      ? { title: "Games near you", runs: nearRuns }
      : regionRuns.length > 0
        ? { title: live.regionName ? `Next games in ${live.regionName}` : "Next games", runs: regionRuns }
        : null;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top, 12) + 8 }]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={themeColor().muted} />
      }
    >
      <View style={styles.header}>
        <Wordmark style={styles.wordmark} onLongPress={__DEV__ ? toggleDevPreview : undefined} />
        <View style={styles.headerRight}>
          {myCard ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Your rating"
              onPress={() => push("/(tabs)/leaderboards")}
              hitSlop={8}
            >
              <StarRating value={myCard.star} provisional={myCard.provisional} size="sm" />
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Notifications"
            onPress={() => push("/(tabs)/messages")}
            hitSlop={10}
          >
            <FontAwesome name="bell-o" size={20} color={themeColor().text} />
          </Pressable>
        </View>
      </View>

      <Text style={styles.greeting} numberOfLines={1}>
        {greeting()}, <Text style={styles.greetingName}>{name}</Text>
      </Text>

      {__DEV__ && fixture ? (
        <Text style={styles.devLine}>Showing preview data. Long-press the wordmark to exit.</Text>
      ) : null}

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
          playedWith={playedWith[nextMatch.id]}
          onPress={() => openRun(nextMatch.id)}
        />
      ) : (
        <View style={[styles.card, styles.emptyCard]}>
          <Text style={styles.emptyTitle} numberOfLines={1}>
            Nothing on your calendar.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={openMap}
            style={({ pressed }) => [styles.accentBtn, pressed && styles.pressed]}
          >
            <Text style={styles.accentBtnText}>Get a game</Text>
          </Pressable>
        </View>
      )}

      {gamesSection ? (
        <>
          <SectionHeader label={gamesSection.title} actionLabel="See all" onAction={() => push("/session-map")} />
          <FlatList
            horizontal
            data={gamesSection.runs}
            keyExtractor={(r) => r.id}
            showsHorizontalScrollIndicator={false}
            style={styles.strip}
            contentContainerStyle={styles.stripContent}
            renderItem={({ item }) => (
              <GameCard
                run={item}
                photo={fieldPhotos[item.id]}
                crowd={crowds.get(item.id) ?? EMPTY_CROWD}
                playedWith={playedWith[item.id]}
                onPress={() => openRun(item.id)}
              />
            )}
          />
        </>
      ) : null}

      <SectionHeader label="Nearby games" actionLabel="View map" onAction={openMap} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open map"
        onPress={openMap}
        onLayout={(e) => setMapWidth(e.nativeEvent.layout.width)}
        style={styles.mapWrap}
      >
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <MapView
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
            region={mapRegion}
            mapType={Platform.OS === "ios" ? "mutedStandard" : "standard"}
            userInterfaceStyle={scheme === "dark" ? "dark" : "light"}
            loadingBackgroundColor={themeColor().card}
            showsBuildings={false}
            pitchEnabled={false}
            rotateEnabled={false}
            scrollEnabled={false}
            zoomEnabled={false}
            toolbarEnabled={false}
            showsPointsOfInterest={false}
            showsMyLocationButton={false}
          >
            {mapRuns.map((run) => (
              <MapDot key={run.id} run={run} />
            ))}
          </MapView>
        </View>
      </Pressable>

      {bestGames.length > 0 ? (
        <>
          <SectionHeader label="Best games for you" />
          <BestGamesCarousel games={bestGames} photos={fieldPhotos} onOpen={openRun} bleed={20} />
        </>
      ) : null}
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
    headerRight: { flexDirection: "row", alignItems: "center", gap: 16 },
    wordmark: { flexShrink: 1, color: themeColor().text },
    greeting: { marginTop: 16, fontSize: 28, ...headline, color: themeColor().text },
    greetingName: { color: themeColor().pitchText },
    devLine: { marginTop: 8, fontSize: 13, fontFamily: "Inter_500Medium", color: themeColor().muted },
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
    sectionTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: themeColor().text },
    sectionAction: { fontSize: 14, fontFamily: "Inter_500Medium", color: themeColor().accent },

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

    emptyCard: {
      minHeight: 72,
      paddingHorizontal: 16,
      paddingVertical: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    },
    emptyTitle: { flexShrink: 1, fontSize: 15, fontFamily: "Inter_600SemiBold", color: themeColor().text },
    accentBtn: {
      backgroundColor: themeColor().accent,
      borderRadius: radius.button,
      paddingVertical: 8,
      paddingHorizontal: 16,
    },
    accentBtnText: { color: themeColor().onAccent, fontSize: 14, fontFamily: "Inter_600SemiBold" },

    /* games strip */
    strip: { marginHorizontal: -20 },
    stripContent: { paddingHorizontal: 20, gap: 12 },

    /* map */
    mapWrap: {
      height: MAP_HEIGHT,
      borderRadius: radius.card,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: themeColor().line,
      backgroundColor: themeColor().card,
    },
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

    playedWith: { marginTop: 8 },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
