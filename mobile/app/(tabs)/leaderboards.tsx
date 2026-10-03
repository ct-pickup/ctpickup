import { useAuth } from "@/context/AuthContext";
import { siteOrigin } from "@/lib/env";
import { hapticTap } from "@/lib/haptics";
import { Ionicons } from "@expo/vector-icons";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useNavigation, useRouter } from "expo-router";
import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { ChalkDivider, ChalkEmptyState } from "@/components/chalk";
import DiscoverPanel from "@/components/discover/DiscoverPanel";
import { DiscoverRequestError, fetchWeeklyPicks, searchPlayers as searchDiscover } from "@/lib/discoverApi";
import type { DiscoverPlayer } from "@shared/discover";
import CtPlusPaywall from "@/components/ctplus/CtPlusPaywall";
import { StarLevelsLink } from "@/components/StarLevels";
import { CTPLUS_ENABLED } from "@/lib/ctplus/config";
import { StarRating } from "@/components/StarRating";
import { fetchPlayerCards, topPercentLabel, type PlayerCard } from "@/lib/starRatings";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";

type RegionFilter = "ALL" | "CT" | "NY" | "NJ" | "MD";
type TabId =
  | "stars"
  | "points"
  | "wins"
  | "sessions"
  | "win_rate"
  | "potd"
  | "goalie"
  | "defender"
  | "midfielder"
  | "attacker";

type ApiRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  instagram: string | null;
  nearest_venue: string | null;
  value: number;
  win_rate?: number;
  games_played?: number;
  /** True position in the full category, from the server. */
  rank?: number;
};

type LeaderboardsPayload = {
  ok?: boolean;
  region: string;
  wins: unknown[];
  sessions: unknown[];
  win_rate: unknown[];
  potd: unknown[];
  goalie: unknown[];
  defender: unknown[];
  midfielder: unknown[];
  attacker: unknown[];
  /** Current-season and all-time points from the points ledger; season is e.g. "Fall 2026". */
  points: unknown[];
  points_all_time: unknown[];
  season: string | null;
  /** Rows returned per category before the player's own and played-with rows. */
  top_n: number;
  /** Size of each full category, for "Showing top 25 of 58". */
  totals: Record<string, number>;
};

type PointsScope = "season" | "all";

type RankedPlayer = {
  user_id: string;
  /** True position in the full Stars ranking, from the server. */
  rank: number;
  games: number;
  points: number;
  name: string;
  username: string | null;
  avatar_url: string | null;
  nearest_venue: string | null;
  card: PlayerCard | null;
};

// Module-level cache — survives tab switches and back-navigation re-mounts.
let _cachedMyCard: PlayerCard | null = null;

const PRIMARY_TABS: Array<{ id: TabId; label: string; icon?: React.ComponentProps<typeof FontAwesome>["name"] }> = [
  { id: "stars", label: "Stars", icon: "star" },
  { id: "points", label: "Points" },
  { id: "wins", label: "Wins" },
  { id: "sessions", label: "Games" },
  { id: "potd", label: "POTD" },
];

const MORE_TABS: Array<{ id: TabId; label: string }> = [
  { id: "win_rate", label: "Win %" },
  { id: "goalie", label: "Goalie" },
  { id: "defender", label: "Defender" },
  { id: "midfielder", label: "Midfielder" },
  { id: "attacker", label: "Attacker" },
];

type PlayersMode = "leaderboard" | "discover";

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object";
}

function asRowArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function parsePayload(json: unknown): LeaderboardsPayload | null {
  if (!isRecord(json)) return null;
  if (json.ok === false) return null;
  const region = typeof json.region === "string" ? json.region : "ALL";
  const ok = json.ok === true;
  return {
    ok,
    region,
    wins: asRowArray(json.wins),
    sessions: asRowArray(json.sessions),
    win_rate: asRowArray(json.win_rate),
    potd: asRowArray(json.potd),
    goalie: asRowArray(json.goalie),
    defender: asRowArray(json.defender),
    midfielder: asRowArray(json.midfielder),
    attacker: asRowArray(json.attacker),
    points: asRowArray(json.points),
    points_all_time: asRowArray(json.points_all_time),
    season: typeof json.season === "string" && json.season ? json.season : null,
    top_n: typeof json.top_n === "number" && json.top_n > 0 ? json.top_n : 25,
    totals: isRecord(json.totals)
      ? Object.fromEntries(Object.entries(json.totals).filter((e): e is [string, number] => typeof e[1] === "number"))
      : {},
  };
}

function parseRow(v: unknown): ApiRow | null {
  if (!isRecord(v)) return null;
  const id = typeof v.id === "string" ? v.id : null;
  if (!id) return null;
  const value = typeof v.value === "number" && Number.isFinite(v.value) ? v.value : Number(v.value);
  if (!Number.isFinite(value)) return null;
  return {
    id,
    first_name: typeof v.first_name === "string" ? v.first_name : null,
    last_name: typeof v.last_name === "string" ? v.last_name : null,
    username: typeof v.username === "string" ? v.username : null,
    instagram: typeof v.instagram === "string" ? v.instagram : null,
    nearest_venue: typeof v.nearest_venue === "string" ? v.nearest_venue : null,
    value,
    win_rate: typeof v.win_rate === "number" ? v.win_rate : undefined,
    games_played: typeof v.games_played === "number" ? v.games_played : undefined,
    rank: typeof v.rank === "number" ? v.rank : undefined,
  };
}

function displayPlayerName(r: ApiRow): string {
  const full = `${(r.first_name ?? "").trim()} ${(r.last_name ?? "").trim()}`.trim();
  if (full) return full;
  const u = (r.username ?? "").trim();
  return u ? `@${u}` : "Player";
}

function formatStat(tab: TabId, row: ApiRow): string {
  if (tab === "win_rate") {
    const pct = row.value;
    const rounded = Math.abs(pct - Math.round(pct)) < 1e-6 ? String(Math.round(pct)) : pct.toFixed(1);
    return `${rounded}%`;
  }
  if (tab === "points") return Math.round(row.value).toLocaleString();
  return String(Math.round(row.value));
}

function statLabel(tab: TabId): string {
  if (tab === "win_rate") return "WIN%";
  if (tab === "points") return "PTS";
  if (tab === "sessions") return "GAMES";
  return tab.toUpperCase();
}

function initials(name: string): string {
  const parts = name.replace(/^@/, "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/* --------------------------------------------------------------- screen */

export default function LeaderboardsScreen() {
  useThemedStyles(publish_styles);

  const router = useRouter();
  const navigation = useNavigation();
  const { session, supabase } = useAuth();
  const myUserId = session?.user?.id ?? null;
  const token = session?.access_token ?? null;

  const [tab, setTab] = useState<TabId>("stars");
  // Region filtering is hidden until the location work lands; queries stay unscoped.
  const [region] = useState<RegionFilter>("ALL");
  const [mode, setMode] = useState<PlayersMode>("leaderboard");

  const [picks, setPicks] = useState<DiscoverPlayer[]>([]);
  const [picksLoading, setPicksLoading] = useState(false);
  const [picksLoaded, setPicksLoaded] = useState(false);
  const [picksError, setPicksError] = useState<string | null>(null);
  const [picksRefreshing, setPicksRefreshing] = useState(false);
  const [searchResults, setSearchResults] = useState<DiscoverPlayer[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [pointsScope, setPointsScope] = useState<PointsScope>("season");

  // API-backed tabs (wins/sessions/etc.)
  const [payload, setPayload] = useState<LeaderboardsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Stars tab: points from /api/leaderboards, stars and percentile from player_cards.
  const [rankedPlayers, setRankedPlayers] = useState<RankedPlayer[]>([]);
  /** Size of the Stars ranking when the app had to rank it itself (older server); null when the server sent totals. */
  const [starsTotal, setStarsTotal] = useState<number | null>(null);
  const [myCard, setMyCard] = useState<PlayerCard | null>(_cachedMyCard);
  const [starsLoading, setStarsLoading] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);

  const rowsForTab = useMemo(() => {
    if (!payload) return [];
    const raw =
      tab === "points"
        ? pointsScope === "season"
          ? payload.points
          : payload.points_all_time
        : tab === "wins"
        ? payload.wins
        : tab === "sessions"
          ? payload.sessions
          : tab === "win_rate"
            ? payload.win_rate
            : tab === "potd"
              ? payload.potd
              : tab === "goalie"
                ? payload.goalie
                : tab === "defender"
                  ? payload.defender
                  : tab === "midfielder"
                    ? payload.midfielder
                    : payload.attacker;
    const out: ApiRow[] = [];
    for (const item of raw) {
      const r = parseRow(item);
      if (r) out.push(r);
    }
    return out;
  }, [payload, tab, pointsScope]);

  /**
   * Builds the Stars list from the `tiers` rows of /api/leaderboards.
   *   - Capped server (rows carry a true `rank`): the rows are used as sent, in rank order.
   *   - Anything else (an older deployment that sends the whole list, or rows without ranks): the list is ranked here the
   *     same way the server does it (half-star rating, then season points), then cut to the top STARS_CAP plus the
   *     viewer's own row, each with its true rank. Stars come from the row's `star`, or from player_cards when the row
   *     has none. Played-with rows cannot be known here and are not added.
   * Either way the screen never renders more than STARS_CAP top rows.
   */
  const applyTiers = useCallback(
    async (rowsRaw: unknown[], cap: number) => {
      setStarsLoading(true);
      try {
        type Row = Omit<RankedPlayer, "card"> & { star: number | null };
        const rows: Row[] = [];
        let serverRanked = true;
        for (const item of rowsRaw) {
          if (!isRecord(item)) continue;
          const userId = typeof item.user_id === "string" ? item.user_id : null;
          if (!userId) continue;
          const first = typeof item.first_name === "string" ? item.first_name : null;
          const last = typeof item.last_name === "string" ? item.last_name : null;
          const username = typeof item.username === "string" ? item.username : null;
          if (typeof item.rank !== "number") serverRanked = false;
          const starNum = typeof item.star === "number" && Number.isFinite(item.star) ? item.star : null;
          rows.push({
            user_id: userId,
            rank: typeof item.rank === "number" ? item.rank : rows.length + 1,
            star: starNum,
            games: typeof item.games === "number" && Number.isFinite(item.games) ? item.games : 0,
            points: typeof item.points === "number" && Number.isFinite(item.points) ? item.points : 0,
            name: [first, last].filter(Boolean).join(" ").trim() || username || "Player",
            username,
            avatar_url: typeof item.avatar_url === "string" ? item.avatar_url.trim() || null : null,
            nearest_venue: typeof item.nearest_venue === "string" ? item.nearest_venue : null,
          });
        }

        let shown: Row[];
        let total: number | null = null;
        let cards = new Map<string, PlayerCard>();
        if (serverRanked) {
          // A server that sends ranks is the capped one: top rows plus the viewer's and played-with rows.
          shown = [...rows].sort((a, b) => a.rank - b.rank);
          const ids = [...shown.map((p) => p.user_id), ...(myUserId ? [myUserId] : [])];
          if (supabase) cards = await fetchPlayerCards(supabase, ids);
        } else {
          // Fallback ranking. Needs every row's stars: the row's own, else player_cards for the whole list.
          if (supabase && rows.some((r) => r.star == null)) {
            cards = await fetchPlayerCards(supabase, [...rows.map((p) => p.user_id), ...(myUserId ? [myUserId] : [])]);
          }
          const starOf = (r: Row) => r.star ?? cards.get(r.user_id)?.star ?? -1;
          const ranked = [...rows]
            .sort((a, b) => starOf(b) - starOf(a) || b.points - a.points)
            .map((r, i) => ({ ...r, rank: i + 1 }));
          total = ranked.length;
          shown = ranked.filter((r) => r.rank <= cap || r.user_id === myUserId);
          // Percentile and the hero card need player_cards for the rows we actually show.
          if (supabase && rows.every((r) => r.star != null)) {
            cards = await fetchPlayerCards(supabase, [...shown.map((p) => p.user_id), ...(myUserId ? [myUserId] : [])]);
          }
        }
        setStarsTotal(total);

        setRankedPlayers(
          shown
            .map(({ star, ...p }) => ({ ...p, card: cards.get(p.user_id) ?? (star != null ? { star, provisional: false, percentile: null } : null) }))
            .sort((a, b) => a.rank - b.rank),
        );

        const mine = myUserId ? (cards.get(myUserId) ?? null) : null;
        _cachedMyCard = mine;
        setMyCard(mine);
      } catch (e) {
        console.error("[leaderboards] applyTiers failed:", e);
        setRankedPlayers([]);
      } finally {
        setStarsLoading(false);
      }
    },
    [myUserId, supabase],
  );

  const load = useCallback(
    async (isRefresh: boolean) => {
      const origin = siteOrigin();
      if (!origin) {
        setErr("App configuration error. Please restart.");
        setLoading(false);
        return;
      }
      if (isRefresh) setRefreshing(true);
      else {
        setLoading(true);
        setErr(null);
      }
      try {
        const u = new URL(`${origin}/api/leaderboards`);
        if (region !== "ALL") u.searchParams.set("region", region);
        const r = await fetch(u.toString(), {
          method: "GET",
          headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          cache: "no-store",
        });
        const json = (await r.json().catch(() => null)) as unknown;
        if (!r.ok) {
          setErr("Something went wrong. Please try again.");
          setPayload(null);
          return;
        }
        const parsed = parsePayload(json);
        if (!parsed) {
          setErr("Unexpected response from server.");
          setPayload(null);
          return;
        }
        console.log(
          "leaderboards payload:",
          JSON.stringify(parsed?.wins?.length),
          JSON.stringify(parsed?.sessions?.length),
        );
        setErr(null);
        setPayload(parsed);
        void applyTiers(isRecord(json) && Array.isArray(json.tiers) ? (json.tiers as unknown[]) : [], parsed.top_n);
      } catch (e) {
        console.error("[leaderboards] failed:", e);
        setErr("Something went wrong. Please try again.");
        setPayload(null);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [region, token, applyTiers],
  );

  useLayoutEffect(() => {
    void load(false);
  }, [load]);

  useLayoutEffect(() => {
    navigation.setOptions({ headerRight: undefined });
  }, [navigation]);

  const loadPicks = useCallback(
    async (refresh: boolean) => {
      if (!token) return;
      if (refresh) setPicksRefreshing(true);
      else setPicksLoading(true);
      setPicksError(null);
      try {
        const res = await fetchWeeklyPicks(token);
        setPicks(Array.isArray(res.players) ? res.players : []);
        setPicksLoaded(true);
      } catch (e) {
        setPicksError(e instanceof DiscoverRequestError ? e.message : "We could not load your picks right now.");
      } finally {
        setPicksLoading(false);
        setPicksRefreshing(false);
      }
    },
    [token],
  );

  const onDiscoverSearch = useCallback(
    (q: string) => {
      if (!q) {
        setSearchResults(null);
        setSearchError(null);
        return;
      }
      if (!token) return;
      setSearching(true);
      setSearchError(null);
      void (async () => {
        try {
          setSearchResults(await searchDiscover(token, q));
        } catch (e) {
          setSearchError(e instanceof DiscoverRequestError ? e.message : "We could not run that search right now.");
          setSearchResults(null);
        } finally {
          setSearching(false);
        }
      })();
    },
    [token],
  );

  const onRefresh = useCallback(() => void load(true), [load]);

  const moreActive = MORE_TABS.some((m) => m.id === tab);
  const moreLabel = moreActive ? (MORE_TABS.find((m) => m.id === tab)?.label ?? "More") : "More";

  /* --------------------------------------------------------- renderers */

  function renderTabBar() {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabScroll}
        contentContainerStyle={styles.tabRow}
        keyboardShouldPersistTaps="handled"
      >
        {PRIMARY_TABS.map((t) => {
          const on = tab === t.id;
          return (
            <Pressable
              key={t.id}
              onPress={() => {
                void hapticTap();
                setTab(t.id);
              }}
              style={[styles.tabPill, on ? styles.tabPillOn : styles.tabPillOff]}
            >
              {t.icon ? (
                <FontAwesome name={t.icon} size={13} color={on ? themeColor().onPitch : themeColor().text} style={{ marginRight: 4 }} />
              ) : null}
              <Text style={[styles.tabPillText, on && styles.tabPillTextOn]} numberOfLines={1}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          onPress={() => {
            void hapticTap();
            setMoreOpen(true);
          }}
          style={[styles.tabPill, moreActive ? styles.tabPillOn : styles.tabPillOff]}
        >
          <Text style={[styles.tabPillText, moreActive && styles.tabPillTextOn]} numberOfLines={1}>
            {moreLabel}
          </Text>
          <FontAwesome
            name="caret-down"
            size={13}
            color={moreActive ? themeColor().onPitch : themeColor().text}
            style={{ marginLeft: 4 }}
          />
        </Pressable>
      </ScrollView>
    );
  }

  function renderHero() {
    if (myCard === null && starsLoading) {
      return <View style={[styles.hero, styles.heroSkeleton]} />;
    }
    const topPct = topPercentLabel(myCard);

    return (
      <View style={styles.hero}>
        <View style={styles.heroLeft}>
          <Text style={styles.heroLabel}>Your rating</Text>
          {myCard ? (
            <StarRating value={myCard.star} provisional={myCard.provisional} size="lg" style={styles.heroStars} />
          ) : (
            <Text style={styles.heroSub}>Your rating shows here after your first rated games.</Text>
          )}
          {topPct ? <Text style={styles.heroTop}>{topPct}</Text> : null}
          <Text style={styles.heroSub}>Play more verified games to move up.</Text>
          <StarLevelsLink style={styles.heroLink} />
        </View>
      </View>
    );
  }

  const topN = payload?.top_n ?? 25;

  /** "Showing top 25 of 58" and, when CT+ is on, the full-leaderboard prompt. */
  function renderCapFooter(total: number | undefined) {
    const shown = total != null && total > topN ? `Showing top ${topN} of ${total}` : null;
    if (!shown && !CTPLUS_ENABLED) return null;
    return (
      <View style={styles.capFooter}>
        {shown ? <Text style={styles.capFooterText}>{shown}</Text> : null}
        {CTPLUS_ENABLED ? (
          <Pressable onPress={() => setPaywallOpen(true)} hitSlop={8} accessibilityRole="button">
            <Text style={styles.capFooterLink}>See the full leaderboard with CT+</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  function renderRankedRow(item: RankedPlayer, index: number) {
    const rank = item.rank;
    const mine = myUserId != null && item.user_id === myUserId;
    const top3 = rank <= 3;
    const gapBefore = rank > topN && index > 0 && (rankedPlayers[index - 1]?.rank ?? 0) <= topN;
    return (
      <Pressable
        key={item.user_id}
        onPress={() => router.push(`/player/${item.user_id}`)}
        style={({ pressed }) => [styles.playerRow, mine && styles.playerRowMine, gapBefore && styles.gapBefore, pressed && { opacity: 0.85 }]}
      >
        <View style={[styles.rankCell, top3 && styles.rankCircleTop3]}>
          <Text style={[styles.rankText, top3 && styles.rankTextTop3, mine && styles.onPanelText]}>{rank}</Text>
        </View>

        <View style={[styles.avatarRing, { borderColor: themeColor().line }]}>
          {item.avatar_url ? (
            <Image source={{ uri: item.avatar_url }} style={styles.avatarImg} />
          ) : (
            <View style={[styles.avatarImg, styles.avatarFallback]}>
              <Text style={[styles.avatarFallbackText, { color: themeColor().text }]}>{initials(item.name)}</Text>
            </View>
          )}
        </View>

        <View style={styles.playerInfo}>
          <View style={styles.nameLine}>
            <Text style={[styles.playerName, styles.nameFlex, mine && styles.onPanelText]} numberOfLines={1}>
              {item.name}
            </Text>
            {mine ? (
              <View style={styles.youTag}>
                <Text style={styles.youTagText}>You</Text>
              </View>
            ) : null}
          </View>
          {item.card ? (
            <StarRating value={item.card.star} provisional={item.card.provisional} size="sm" style={styles.playerStars} />
          ) : null}
          <Text style={[styles.playerStats, mine && styles.onPanelText]} numberOfLines={1}>
            {item.games} game{item.games === 1 ? "" : "s"}
          </Text>
        </View>

        <View style={styles.ptsBlock}>
          <Text style={styles.ptsValue}>{item.points.toLocaleString()}</Text>
          <Text style={[styles.ptsLabel, mine && styles.onPanelText]}>PTS</Text>
        </View>
        <FontAwesome name="chevron-right" size={13} color={themeColor().muted} style={{ marginLeft: 4 }} />
      </Pressable>
    );
  }

  function renderStarsTab() {
    return (
      <ScrollView
        style={styles.listFlex}
        contentContainerStyle={styles.tierContent}
        refreshControl={<RefreshControl refreshing={refreshing || starsLoading} onRefresh={onRefresh} tintColor={themeColor().pitchText} />}
      >
        {renderHero()}

        <View style={styles.sectionHeaderRow}>
          <View style={styles.sectionHeaderLeft}>
            <Ionicons name="people" size={16} color={themeColor().pitchText} />
            <Text style={styles.sectionTitle}>Top Players</Text>
          </View>
        </View>

        {starsLoading && rankedPlayers.length === 0 ? (
          <ActivityIndicator color={themeColor().pitchText} style={{ marginTop: 32 }} />
        ) : rankedPlayers.length === 0 ? (
          <ChalkEmptyState
            graphic="circle"
            title="No rated players yet"
            body="Complete a session to earn your rating."
            style={styles.emptyStatsWrap}
          />
        ) : (
          <View style={{ gap: 8 }}>{rankedPlayers.map((p, i) => renderRankedRow(p, i))}</View>
        )}
        {renderCapFooter(starsTotal ?? payload?.totals.tiers)}

        <ChalkDivider style={styles.sectionDivider} />

        <View style={styles.climbCard}>
          <View style={styles.climbIcon}>
            <FontAwesome name="line-chart" size={18} color={themeColor().pitchText} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.climbTitle}>Climb the ranks</Text>
            <Text style={styles.climbSub}>Play more verified games to move up.</Text>
          </View>
        </View>
      </ScrollView>
    );
  }

  function renderPointsHeader() {
    const seasonLabel = payload?.season ?? "This season";
    const scopes: Array<{ id: PointsScope; label: string }> = [
      { id: "season", label: seasonLabel },
      { id: "all", label: "All time" },
    ];
    return (
      <View style={styles.scopeRow}>
        {scopes.map((sc) => {
          const on = pointsScope === sc.id;
          return (
            <Pressable
              key={sc.id}
              onPress={() => {
                void hapticTap();
                setPointsScope(sc.id);
              }}
              style={[styles.scopePill, on ? styles.tabPillOn : styles.tabPillOff]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.tabPillText, on && styles.tabPillTextOn]} numberOfLines={1}>
                {sc.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  }

  function renderApiTab() {
    const listEmpty = !loading && !err && payload != null && rowsForTab.length === 0;
    return (
      <FlatList
        style={styles.listFlex}
        ListHeaderComponent={tab === "points" && !err ? renderPointsHeader() : null}
        data={err ? [] : rowsForTab}
        keyExtractor={(item) => item.id}
        contentContainerStyle={err || rowsForTab.length === 0 ? styles.listContentGrow : styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={themeColor().pitchText} />}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={themeColor().pitchText} style={{ marginTop: 32 }} />
          ) : err ? (
            <View style={styles.emptyStateBlock}>
              <Text style={styles.errText}>{err}</Text>
              <Pressable onPress={() => void load(false)} style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.9 }]}>
                <Text style={styles.retryBtnText}>Retry</Text>
              </Pressable>
            </View>
          ) : listEmpty ? (
            <ChalkEmptyState
              graphic="circle"
              title={tab === "points" && pointsScope === "season" ? "No points yet this season" : "No stats yet"}
              body="Play some runs to appear here!"
              style={styles.emptyStatsWrap}
            />
          ) : null
        }
        ListFooterComponent={err || rowsForTab.length === 0 ? null : renderCapFooter(payload?.totals[tab === "points" ? (pointsScope === "season" ? "points" : "points_all_time") : tab === "sessions" ? "sessions" : tab])}
        renderItem={({ item, index }) => {
          const rank = item.rank ?? index + 1;
          const mine = myUserId != null && item.id === myUserId;
          const top3 = rank <= 3;
          const gapBefore = rank > topN && index > 0 && (rowsForTab[index - 1]?.rank ?? 0) <= topN;
          const name = displayPlayerName(item);
          return (
            <Pressable
              onPress={() => router.push(`/player/${encodeURIComponent(item.id)}`)}
              style={({ pressed }) => [styles.playerRow, mine && styles.playerRowMine, gapBefore && styles.gapBefore, pressed && { opacity: 0.85 }]}
            >
              <View style={[styles.rankCell, top3 && styles.rankCircleTop3]}>
                <Text style={[styles.rankText, top3 && styles.rankTextTop3, mine && styles.onPanelText]}>{rank}</Text>
              </View>
              <View style={[styles.avatarRing, { borderColor: themeColor().line }]}>
                <View style={[styles.avatarImg, styles.avatarFallback]}>
                  <Text style={[styles.avatarFallbackText, { color: themeColor().text }]}>{initials(name)}</Text>
                </View>
              </View>
              <View style={styles.playerInfo}>
                <View style={styles.nameLine}>
                  <Text style={[styles.playerName, styles.nameFlex, mine && styles.onPanelText]} numberOfLines={1}>
                    {name}
                  </Text>
                  {mine ? (
                    <View style={styles.youTag}>
                      <Text style={styles.youTagText}>You</Text>
                    </View>
                  ) : null}
                </View>
                {item.username ? (
                  <Text style={[styles.playerStats, mine && styles.onPanelText]} numberOfLines={1}>
                    @{item.username}
                  </Text>
                ) : null}
              </View>
              <View style={styles.ptsBlock}>
                <Text style={styles.ptsValue}>{formatStat(tab, item)}</Text>
                <Text style={styles.ptsLabel}>{statLabel(tab)}</Text>
              </View>
            </Pressable>
          );
        }}
      />
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.segment} accessibilityRole="tablist">
        {(["leaderboard", "discover"] as PlayersMode[]).map((m) => {
          const on = mode === m;
          return (
            <Pressable
              key={m}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              onPress={() => {
                void hapticTap();
                setMode(m);
                if (m === "discover" && !picksLoaded && !picksLoading) void loadPicks(false);
              }}
              style={[styles.segmentItem, on && styles.segmentItemOn]}
            >
              <Text style={[styles.segmentText, on && styles.segmentTextOn]}>
                {m === "leaderboard" ? "Leaderboard" : "Discover"}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {mode === "discover" ? (
        <DiscoverPanel
          loading={picksLoading}
          error={picksError}
          players={picks}
          onRefresh={() => void loadPicks(true)}
          refreshing={picksRefreshing}
          searching={searching}
          searchError={searchError}
          searchResults={searchResults}
          onSearch={onDiscoverSearch}
        />
      ) : (
        <>
          {renderTabBar()}
          <View style={styles.listWrap}>{tab === "stars" ? renderStarsTab() : renderApiTab()}</View>
        </>
      )}

      {CTPLUS_ENABLED ? (
        <CtPlusPaywall
          visible={paywallOpen}
          design={null}
          data={null}
          lead="See the full leaderboard"
          onClose={() => setPaywallOpen(false)}
          onPurchased={() => setPaywallOpen(false)}
        />
      ) : null}

      {/* More tabs dropdown */}
      <Modal visible={moreOpen} transparent animationType="fade" onRequestClose={() => setMoreOpen(false)}>
        <Pressable style={styles.moreBackdrop} onPress={() => setMoreOpen(false)}>
          <View style={styles.moreSheet}>
            <Text style={styles.moreTitle}>More rankings</Text>
            {MORE_TABS.map((m) => {
              const on = tab === m.id;
              return (
                <Pressable
                  key={m.id}
                  onPress={() => {
                    void hapticTap();
                    setTab(m.id);
                    setMoreOpen(false);
                  }}
                  style={({ pressed }) => [styles.moreRow, pressed && { backgroundColor: themeColor().overlaySubtle }]}
                >
                  <Text style={[styles.moreRowText, on && { color: themeColor().pitchText, fontWeight: "800" }]}>{m.label}</Text>
                  {on ? <FontAwesome name="check" size={14} color={themeColor().pitchText} /> : null}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function make_styles() {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: themeColor().bg },
  headerFilterBtn: { marginRight: 4, padding: 4, justifyContent: "center", alignItems: "center" },

  /* tab bar */
  tabScroll: {
    flexGrow: 0,
    flexShrink: 0,
    maxHeight: 54,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: themeColor().line,
  },
  tabRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  tabPill: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 999,
  },
  tabPillOff: { borderWidth: 1, borderColor: themeColor().line, backgroundColor: "transparent" },
  tabPillOn: { backgroundColor: themeColor().pitch, borderWidth: 0 },
  tabPillText: { color: themeColor().text, fontWeight: "600", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  tabPillTextOn: { color: themeColor().onPitch, fontWeight: "800" },
  scopeRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  scopePill: { flexShrink: 1, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 999 },

  listWrap: { flex: 1, minHeight: 0 },
  listFlex: { flex: 1 },
  listContentGrow: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 16, paddingVertical: 24 },
  listContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 },
  tierContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 40 },

  /* hero */
  hero: {
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: themeColor().line,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
    minHeight: 148,
  },
  heroSkeleton: {
    backgroundColor: themeColor().overlaySubtle,
    borderColor: themeColor().overlay,
  },
  heroLeft: { flex: 1, minWidth: 0 },
  heroLabel: { color: themeColor().pitchText, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "800",},
  heroStars: { marginTop: 8 },
  heroTop: { color: themeColor().text, fontSize: 24, ...headline, marginTop: 8 },
  heroSub: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 8 },

  /* section header */
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 24,
    marginBottom: 12,
  },
  sectionHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionTitle: { color: themeColor().text, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "800",},
  segment: {
    flexDirection: "row",
    margin: 12,
    padding: 3,
    borderRadius: radius.pill,
    backgroundColor: themeColor().overlaySubtle,
  },
  segmentItem: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: radius.pill },
  segmentItemOn: { backgroundColor: themeColor().bg },
  segmentText: { fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: themeColor().muted },
  segmentTextOn: { color: themeColor().text },
  regionDropdown: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: themeColor().overlay,
    backgroundColor: themeColor().overlaySubtle,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  regionDropdownText: { color: themeColor().text, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700" },

  /* player row */
  playerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: themeColor().card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().overlay,
    padding: 12,
  },
  playerRowMine: { borderColor: themeColor().pitch, backgroundColor: themeColor().pitchPanel },
  rankCell: { width: 30, alignItems: "center", justifyContent: "center" },
  rankCircleTop3: {
    width: 30,
    height: 30,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: themeColor().pitch,
    backgroundColor: themeColor().pitchPanel,
  },
  rankText: { color: themeColor().muted, fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "800" },
  rankTextTop3: { color: themeColor().onPitchPanel },
  onPanelText: { color: themeColor().onPitchPanel },
  gapBefore: { marginTop: 16 },
  nameLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  nameFlex: { flexShrink: 1 },
  youTag: { paddingHorizontal: 8, paddingVertical: 1, borderRadius: 999, backgroundColor: themeColor().pitch },
  youTagText: { color: themeColor().onPitch, fontSize: 11, fontFamily: "Inter_700Bold", fontWeight: "700" },
  capFooter: { alignItems: "center", gap: 6, paddingVertical: 16 },
  capFooterText: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_500Medium" },
  capFooterLink: { color: themeColor().accent, fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  avatarRing: { width: 46, height: 46, borderRadius: 999, borderWidth: 2, padding: 4 },
  avatarImg: { width: "100%", height: "100%", borderRadius: 999 },
  avatarFallback: { backgroundColor: themeColor().overlaySubtle, alignItems: "center", justifyContent: "center" },
  avatarFallbackText: { fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "800" },
  playerInfo: { flex: 1, minWidth: 0 },
  playerName: { color: themeColor().text, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700", flexShrink: 1 },
  playerStars: { marginTop: 4 },
  playerStats: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4 },
  ptsBlock: { alignItems: "flex-end", minWidth: 52 },
  ptsValue: { color: themeColor().text, fontSize: 24, ...headline, },
  ptsLabel: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700",},

  /* climb card */
  sectionDivider: { marginTop: 24, marginBottom: 16 },
  climbCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: themeColor().card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().overlay,
    padding: 16,
  },
  climbIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: themeColor().pitchPanel,
    alignItems: "center",
    justifyContent: "center",
  },
  climbTitle: { color: themeColor().text, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "800" },
  climbSub: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4, lineHeight: 16 },

  /* empty / error */
  emptyStateBlock: { alignItems: "center", justifyContent: "center", gap: 16, paddingVertical: 24 },
  emptyStatsWrap: { paddingVertical: 48 },
  errText: { color: themeColor().coralText, fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  retryBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: themeColor().pitch,
    backgroundColor: themeColor().pitchPanel,
  },
  retryBtnText: { color: themeColor().onPitchPanel, fontWeight: "800", fontSize: 14, fontFamily: "Inter_700Bold" },

  heroLink: { marginTop: 12 },

  /* region modal */
  modalRoot: { flex: 1, justifyContent: "flex-end", backgroundColor: themeColor().scrim },
  modalBackdrop: { ...StyleSheet.absoluteFill },
  modalSheet: {
    backgroundColor: themeColor().bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: themeColor().overlay,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 28,
  },
  modalHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 10, backgroundColor: themeColor().overlay, marginBottom: 16 },
  modalTitle: { color: themeColor().text, fontSize: 20, ...headline, marginBottom: 16, textAlign: "center" },
  modalChips: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center", marginBottom: 20 },
  modalChip: {
    minWidth: 72,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().overlaySubtle,
    alignItems: "center",
  },
  modalChipOn: { borderColor: themeColor().pitch, backgroundColor: themeColor().pitch },
  modalChipText: { color: themeColor().text, fontWeight: "800", fontSize: 16, fontFamily: "Inter_700Bold" },
  modalChipTextOn: { color: themeColor().onPitch },
  modalCloseBtn: {
    marginTop: 4,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().overlay,
    backgroundColor: themeColor().overlaySubtle,
    alignItems: "center",
  },
  modalCloseBtnText: { color: themeColor().text, fontWeight: "700", fontSize: 16, fontFamily: "Inter_700Bold" },

  /* more dropdown */
  moreBackdrop: { flex: 1, backgroundColor: themeColor().scrim, paddingTop: 96, paddingHorizontal: 16 },
  moreSheet: {
    alignSelf: "flex-end",
    minWidth: 200,
    backgroundColor: themeColor().card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().overlay,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  moreTitle: {
    color: themeColor().muted,
    fontSize: 13, fontFamily: "Inter_700Bold",
    fontWeight: "700",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  moreRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  moreRowText: { color: themeColor().text, fontSize: 16, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}

