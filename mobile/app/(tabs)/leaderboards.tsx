import { useAuth } from "@/context/AuthContext";
import { siteOrigin } from "@/lib/env";
import { hapticTap } from "@/lib/haptics";
import { serviceRegionForVenueName } from "@/lib/venueServiceRegion";
import { Ionicons } from "@expo/vector-icons";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
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
import Svg, { Circle, Defs, Ellipse, Polygon, RadialGradient, Rect, Stop } from "react-native-svg";

const BG = "#0a0a0a";
const LIME = "#a3e635";
const CARD = "rgba(255,255,255,0.04)";
const CARD_BORDER = "rgba(255,255,255,0.08)";
const MUTED = "rgba(255,255,255,0.45)";

const TIER_COLORS: Record<string, string> = {
  diamond: "#9B59B6",
  platinum: "#E8E8E8",
  gold: "#E3B23C",
  silver: "#A8B0B5",
  bronze: "#B87333",
};

function tierColor(tier: string | null | undefined): string {
  return tier ? (TIER_COLORS[tier.toLowerCase()] ?? LIME) : LIME;
}

function tierLabel(tier: string | null | undefined): string {
  if (!tier) return "Unranked";
  return tier.charAt(0).toUpperCase() + tier.slice(1).toLowerCase();
}

type RegionFilter = "ALL" | "CT" | "NY" | "NJ" | "MD";
type TabId =
  | "tier"
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
};

type TierPlayer = {
  user_id: string;
  tier: string;
  score: number;
  sessions: number;
  reliability: number;
  name: string;
  username: string | null;
  avatar_url: string | null;
  nearest_venue: string | null;
};

type MyTier = { tier: string; score: number; sessions: number; percentile: number | null } | null;

// Module-level cache — survives tab switches and back-navigation re-mounts.
let _cachedMyTier: MyTier = null;

const PRIMARY_TABS: Array<{ id: TabId; label: string; icon?: React.ComponentProps<typeof FontAwesome>["name"] }> = [
  { id: "tier", label: "Tier", icon: "trophy" },
  { id: "wins", label: "Wins" },
  { id: "sessions", label: "Sessions" },
  { id: "win_rate", label: "Win %" },
  { id: "potd", label: "POTD" },
];

const MORE_TABS: Array<{ id: TabId; label: string }> = [
  { id: "goalie", label: "Goalie" },
  { id: "defender", label: "Defender" },
  { id: "midfielder", label: "Midfielder" },
  { id: "attacker", label: "Attacker" },
];

const REGIONS: RegionFilter[] = ["ALL", "CT", "NY", "NJ", "MD"];

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
  return String(Math.round(row.value));
}

function initials(name: string): string {
  const parts = name.replace(/^@/, "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/* ----------------------------------------------------------- tier gems */

function DiamondGem({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {/* crown */}
      <Polygon points="32,14 68,14 60,36 40,36" fill="#C89BE0" />
      <Polygon points="32,14 18,36 40,36" fill="#A56FC9" />
      <Polygon points="68,14 82,36 60,36" fill="#8E57B8" />
      {/* pavilion */}
      <Polygon points="18,36 50,36 50,92" fill="#8E57B8" />
      <Polygon points="50,36 82,36 50,92" fill="#6B3E86" />
      <Polygon points="40,36 60,36 50,92" fill="#A56FC9" />
      {/* table highlight */}
      <Polygon points="38,17 62,17 57,33 43,33" fill="#D9B8EC" opacity={0.55} />
    </Svg>
  );
}

function CircleGem({ color, size, gid }: { color: string; size: number; gid: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <RadialGradient id={gid} cx="38%" cy="32%" r="80%">
          <Stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
          <Stop offset="0.4" stopColor={color} stopOpacity="1" />
          <Stop offset="1" stopColor={color} stopOpacity="1" />
        </RadialGradient>
      </Defs>
      <Circle cx="50" cy="50" r="46" fill={`url(#${gid})`} />
      <Ellipse cx="37" cy="33" rx="17" ry="11" fill="#ffffff" opacity={0.28} />
    </Svg>
  );
}

function TierGem({ tier, size, gid }: { tier: string; size: number; gid: string }) {
  const t = (tier ?? "").toLowerCase();
  if (t === "diamond") return <DiamondGem size={size} />;
  return <CircleGem color={TIER_COLORS[t] ?? "#A8B0B5"} size={size} gid={gid} />;
}

/* --------------------------------------------------------------- screen */

export default function LeaderboardsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { session, supabase } = useAuth();
  const myUserId = session?.user?.id ?? null;

  const [tab, setTab] = useState<TabId>("tier");
  const [region, setRegion] = useState<RegionFilter>("ALL");
  const [filterOpen, setFilterOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [howOpen, setHowOpen] = useState(false);

  // API-backed tabs (wins/sessions/etc.)
  const [payload, setPayload] = useState<LeaderboardsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Tier tab (player_ratings)
  const [tierPlayers, setTierPlayers] = useState<TierPlayer[]>([]);
  const [myTier, setMyTier] = useState<MyTier>(_cachedMyTier);
  const [tierLoading, setTierLoading] = useState(false);

  const rowsForTab = useMemo(() => {
    if (!payload) return [];
    const raw =
      tab === "wins"
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
  }, [payload, tab]);

  // ── Tier data: two separate queries merged in JS (no relational joins). ──
  const loadTier = useCallback(async () => {
    if (!supabase) return;
    setTierLoading(true);
    try {
      // Show every player_ratings row (no sessions > 0 filter) so newly
      // backfilled tiers still appear even with 0 sessions played.
      const { data: ratings } = await supabase
        .from("player_ratings")
        .select("user_id,tier,score,sessions,reliability")
        .order("score", { ascending: false })
        .limit(100);
      const ratingRows = (ratings ?? []) as Array<{
        user_id: string;
        tier: string | null;
        score: number | null;
        sessions: number | null;
        reliability: number | null;
      }>;

      const ids = ratingRows.map((r) => r.user_id);
      const profileById = new Map<
        string,
        { first_name: string | null; last_name: string | null; username: string | null; avatar_url: string | null; nearest_venue: string | null }
      >();
      if (ids.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id,first_name,last_name,username,avatar_url,nearest_venue")
          .in("id", ids);
        for (const p of (profiles ?? []) as Array<{
          id: string;
          first_name: string | null;
          last_name: string | null;
          username: string | null;
          avatar_url: string | null;
          nearest_venue: string | null;
        }>) {
          profileById.set(p.id, p);
        }
      }

      setTierPlayers(
        ratingRows.map((r) => {
          const p = profileById.get(r.user_id);
          const name =
            [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim() || p?.username || "Player";
          return {
            user_id: r.user_id,
            tier: (r.tier ?? "bronze").toLowerCase(),
            score: r.score ?? 50,
            sessions: r.sessions ?? 0,
            reliability: r.reliability ?? 0,
            name,
            username: p?.username ?? null,
            avatar_url: p?.avatar_url?.trim() || null,
            nearest_venue: p?.nearest_venue ?? null,
          };
        }),
      );

      // My tier + percentile.
      if (myUserId) {
        const { data: mine } = await supabase
          .from("player_ratings")
          .select("tier,score,sessions")
          .eq("user_id", myUserId)
          .maybeSingle();
        if (mine) {
          const myRow = mine as { tier: string | null; score: number | null; sessions: number | null };
          const myScore = myRow.score ?? 0;
          const [{ count: total }, { count: better }] = await Promise.all([
            supabase.from("player_ratings").select("*", { count: "exact", head: true }),
            supabase.from("player_ratings").select("*", { count: "exact", head: true }).gt("score", myScore),
          ]);
          const percentile =
            total && total > 0 ? Math.min(100, Math.max(1, Math.round(((better ?? 0) / total) * 100))) : null;
          const resolved: MyTier = {
            tier: (myRow.tier ?? "bronze").toLowerCase(),
            score: myScore,
            sessions: myRow.sessions ?? 0,
            percentile,
          };
          _cachedMyTier = resolved;
          setMyTier(resolved);
        } else {
          _cachedMyTier = null;
          setMyTier(null);
        }
      }
    } finally {
      setTierLoading(false);
    }
  }, [supabase, myUserId]);

  useEffect(() => {
    if (tab === "tier") void loadTier();
  }, [tab, loadTier]);

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
        const r = await fetch(u.toString(), { method: "GET", headers: { Accept: "application/json" }, cache: "no-store" });
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
      } catch (e) {
        console.error("[leaderboards] failed:", e);
        setErr("Something went wrong. Please try again.");
        setPayload(null);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [region],
  );

  useLayoutEffect(() => {
    void load(false);
  }, [load]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => setFilterOpen(true)}
          hitSlop={12}
          style={({ pressed }) => [styles.headerFilterBtn, pressed && { opacity: 0.75 }]}
          accessibilityLabel="Filter by region"
        >
          <Ionicons name="options-outline" size={22} color="#fff" />
        </Pressable>
      ),
    });
  }, [navigation]);

  const onRefresh = useCallback(() => void load(true), [load]);

  const regionLabel = region === "ALL" ? "All Regions" : region;

  const filteredTierPlayers = useMemo(() => {
    if (region === "ALL") return tierPlayers;
    return tierPlayers.filter((p) => serviceRegionForVenueName(p.nearest_venue) === region);
  }, [tierPlayers, region]);

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
                <FontAwesome name={t.icon} size={13} color={on ? "#0a0a0a" : "#fff"} style={{ marginRight: 6 }} />
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
            color={moreActive ? "#0a0a0a" : "#fff"}
            style={{ marginLeft: 6 }}
          />
        </Pressable>
      </ScrollView>
    );
  }

  function renderHero() {
    if (myTier === null && tierLoading) {
      return <View style={[styles.hero, styles.heroSkeleton]} />;
    }

    const t = myTier?.tier ?? "bronze";
    const color = tierColor(t);
    const isDiamond = t === "diamond";
    const gInner = isDiamond ? "#5B2A82" : `${color}`;
    const gOuter = isDiamond ? "#160a24" : "#0d0d0d";
    const subtitle = !myTier
      ? "Play a session to earn your tier"
      : myTier.percentile != null
        ? `Top ${myTier.percentile}% of players`
        : `${myTier.sessions} sessions played`;

    return (
      <View style={[styles.hero, { borderColor: `${color}55` }]}>
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
          <Defs>
            <RadialGradient id="heroGrad" cx="72%" cy="30%" r="95%">
              <Stop offset="0" stopColor={gInner} stopOpacity={isDiamond ? 0.9 : 0.35} />
              <Stop offset="1" stopColor={gOuter} stopOpacity="1" />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#heroGrad)" />
        </Svg>

        <View style={styles.heroLeft}>
          <Text style={styles.heroLabel}>YOUR TIER</Text>
          <Text style={styles.heroTier}>{tierLabel(myTier?.tier)}</Text>
          <Text style={styles.heroSub}>{subtitle}</Text>
          <Pressable
            onPress={() => myUserId && router.push(`/player/${myUserId}`)}
            style={({ pressed }) => [styles.heroBtn, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.heroBtnText}>View my progress →</Text>
          </Pressable>
        </View>
        <View style={styles.heroGem}>
          <TierGem tier={t} size={96} gid="heroGem" />
        </View>
      </View>
    );
  }

  function renderTierRow(item: TierPlayer, index: number) {
    const rank = index + 1;
    const mine = myUserId != null && item.user_id === myUserId;
    const color = tierColor(item.tier);
    const top3 = rank <= 3;
    const TIER_PTS: Record<string, number> = { diamond: 8, platinum: 6, gold: 4, silver: 2, bronze: 0 };
    const tierPtsPerSession = TIER_PTS[(item.tier ?? "bronze").toLowerCase()] ?? 0;
    const pts = (item.sessions ?? 0) * tierPtsPerSession * 10;
    return (
      <Pressable
        key={item.user_id}
        onPress={() => router.push(`/player/${item.user_id}`)}
        style={({ pressed }) => [styles.playerRow, mine && styles.playerRowMine, pressed && { opacity: 0.85 }]}
      >
        <View style={[styles.rankCell, top3 && styles.rankCircleTop3]}>
          <Text style={[styles.rankText, top3 && styles.rankTextTop3]}>{rank}</Text>
        </View>

        <View style={[styles.avatarRing, { borderColor: color }]}>
          {item.avatar_url ? (
            <Image source={{ uri: item.avatar_url }} style={styles.avatarImg} />
          ) : (
            <View style={[styles.avatarImg, styles.avatarFallback]}>
              <Text style={[styles.avatarFallbackText, { color }]}>{initials(item.name)}</Text>
            </View>
          )}
        </View>

        <View style={styles.playerInfo}>
          <View style={styles.playerNameRow}>
            <Text style={[styles.playerName, mine && { color: LIME }]} numberOfLines={1}>
              {item.name}
            </Text>
            <TierGem tier={item.tier} size={15} gid={`gem-${item.user_id}`} />
          </View>
          <Text style={[styles.playerTier, { color }]} numberOfLines={1}>
            {tierLabel(item.tier)}
          </Text>
          <Text style={styles.playerStats} numberOfLines={1}>
            {item.sessions} sessions · {Math.round(item.reliability)}% reliable
          </Text>
        </View>

        <View style={styles.ptsBlock}>
          <Text style={styles.ptsValue}>{pts.toLocaleString()}</Text>
          <Text style={styles.ptsLabel}>PTS</Text>
        </View>
        <FontAwesome name="chevron-right" size={13} color="rgba(255,255,255,0.3)" style={{ marginLeft: 4 }} />
      </Pressable>
    );
  }

  function renderTierTab() {
    return (
      <ScrollView
        style={styles.listFlex}
        contentContainerStyle={styles.tierContent}
        refreshControl={<RefreshControl refreshing={tierLoading} onRefresh={() => void loadTier()} tintColor={LIME} />}
      >
        {renderHero()}

        <View style={styles.sectionHeaderRow}>
          <View style={styles.sectionHeaderLeft}>
            <Ionicons name="people" size={16} color={LIME} />
            <Text style={styles.sectionTitle}>Top Players</Text>
          </View>
          <Pressable onPress={() => setFilterOpen(true)} hitSlop={8} style={styles.regionDropdown}>
            <Text style={styles.regionDropdownText}>{regionLabel}</Text>
            <FontAwesome name="caret-down" size={13} color="rgba(255,255,255,0.55)" />
          </Pressable>
        </View>

        {tierLoading && tierPlayers.length === 0 ? (
          <ActivityIndicator color={LIME} style={{ marginTop: 32 }} />
        ) : filteredTierPlayers.length === 0 ? (
          <View style={styles.emptyStatsWrap}>
            <Text style={styles.emptyEmoji}>🏆</Text>
            <Text style={styles.emptyTitle}>No rated players yet</Text>
            <Text style={styles.emptySubtitle}>Complete a session to earn a tier.</Text>
          </View>
        ) : (
          <View style={{ gap: 10 }}>{filteredTierPlayers.map((p, i) => renderTierRow(p, i))}</View>
        )}

        {/* Climb the ranks */}
        <View style={styles.climbCard}>
          <View style={styles.climbIcon}>
            <FontAwesome name="line-chart" size={18} color={LIME} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.climbTitle}>Climb the ranks</Text>
            <Text style={styles.climbSub}>Play more sessions to earn points and increase your tier.</Text>
          </View>
          <Pressable
            onPress={() => { void hapticTap(); setHowOpen(true); }}
            style={({ pressed }) => [styles.climbBtn, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.climbBtnText}>How it works →</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  function renderApiTab() {
    const listEmpty = !loading && !err && payload != null && rowsForTab.length === 0;
    return (
      <FlatList
        style={styles.listFlex}
        data={err ? [] : rowsForTab}
        keyExtractor={(item) => item.id}
        contentContainerStyle={err || rowsForTab.length === 0 ? styles.listContentGrow : styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={LIME} />}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={LIME} style={{ marginTop: 32 }} />
          ) : err ? (
            <View style={styles.emptyStateBlock}>
              <Text style={styles.errText}>{err}</Text>
              <Pressable onPress={() => void load(false)} style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.9 }]}>
                <Text style={styles.retryBtnText}>Retry</Text>
              </Pressable>
            </View>
          ) : listEmpty ? (
            <View style={styles.emptyStatsWrap}>
              <Text style={styles.emptyEmoji}>⚽</Text>
              <Text style={styles.emptyTitle}>No stats yet</Text>
              <Text style={styles.emptySubtitle}>Play some runs to appear here!</Text>
            </View>
          ) : null
        }
        renderItem={({ item, index }) => {
          const rank = index + 1;
          const mine = myUserId != null && item.id === myUserId;
          const top3 = rank <= 3;
          const name = displayPlayerName(item);
          return (
            <Pressable
              onPress={() => router.push(`/player/${encodeURIComponent(item.id)}`)}
              style={({ pressed }) => [styles.playerRow, mine && styles.playerRowMine, pressed && { opacity: 0.85 }]}
            >
              <View style={[styles.rankCell, top3 && styles.rankCircleTop3]}>
                <Text style={[styles.rankText, top3 && styles.rankTextTop3]}>{rank}</Text>
              </View>
              <View style={[styles.avatarRing, { borderColor: "rgba(255,255,255,0.15)" }]}>
                <View style={[styles.avatarImg, styles.avatarFallback]}>
                  <Text style={[styles.avatarFallbackText, { color: "#fff" }]}>{initials(name)}</Text>
                </View>
              </View>
              <View style={styles.playerInfo}>
                <Text style={styles.playerName} numberOfLines={1}>
                  {name}
                </Text>
                {item.username ? (
                  <Text style={styles.playerStats} numberOfLines={1}>
                    @{item.username}
                  </Text>
                ) : null}
              </View>
              <View style={styles.ptsBlock}>
                <Text style={styles.ptsValue}>{formatStat(tab, item)}</Text>
                <Text style={styles.ptsLabel}>{tab === "win_rate" ? "WIN%" : tab.toUpperCase()}</Text>
              </View>
            </Pressable>
          );
        }}
      />
    );
  }

  return (
    <View style={styles.root}>
      {renderTabBar()}
      <View style={styles.listWrap}>{tab === "tier" ? renderTierTab() : renderApiTab()}</View>

      {/* Region filter */}
      <Modal visible={filterOpen} transparent animationType="slide" onRequestClose={() => setFilterOpen(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setFilterOpen(false)} accessibilityLabel="Dismiss filter" />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Filter by Region</Text>
            <View style={styles.modalChips}>
              {REGIONS.map((reg) => {
                const on = region === reg;
                return (
                  <Pressable
                    key={reg}
                    onPress={() => {
                      void hapticTap();
                      setRegion(reg);
                      setFilterOpen(false);
                    }}
                    style={({ pressed }) => [styles.modalChip, on && styles.modalChipOn, pressed && { opacity: 0.9 }]}
                  >
                    <Text style={[styles.modalChipText, on && styles.modalChipTextOn]}>{reg === "ALL" ? "All" : reg}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable onPress={() => setFilterOpen(false)} style={({ pressed }) => [styles.modalCloseBtn, pressed && { opacity: 0.88 }]}>
              <Text style={styles.modalCloseBtnText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* How Rankings Work */}
      <Modal visible={howOpen} transparent animationType="slide" onRequestClose={() => setHowOpen(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setHowOpen(false)} accessibilityLabel="Dismiss" />
          <View style={[styles.modalSheet, styles.howSheet]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>How Rankings Work</Text>

            {/* Points */}
            <Text style={styles.howSectionHeader}>EARNING POINTS</Text>
            <Text style={styles.howBody}>
              Points are earned every time you play a rated session. The higher your tier, the more points you earn per session.
            </Text>
            <View style={styles.howCard}>
              {([
                { tier: "diamond", label: "Diamond", pts: 8, color: "#9B59B6", dot: "◆" },
                { tier: "platinum", label: "Platinum", pts: 6, color: "#E8E8E8", dot: "●" },
                { tier: "gold", label: "Gold", pts: 4, color: "#E3B23C", dot: "●" },
                { tier: "silver", label: "Silver", pts: 2, color: "#A8B0B5", dot: "●" },
                { tier: "bronze", label: "Bronze", pts: 0, color: "#B87333", dot: "●" },
              ] as const).map(({ tier, label, pts, color, dot }) => (
                <View key={tier} style={styles.howRow}>
                  <Text style={[styles.howDot, { color }]}>{dot}</Text>
                  <Text style={styles.howRowLabel}>{label}</Text>
                  <Text style={styles.howRowValue}>{pts} pts / session</Text>
                </View>
              ))}
            </View>

            {/* Tiers */}
            <Text style={[styles.howSectionHeader, { marginTop: 18 }]}>TIER SYSTEM</Text>
            <Text style={styles.howBody}>
              Your tier is determined by your rating score, earned through peer votes and organizer ratings after each session.
            </Text>
            <View style={styles.howCard}>
              {([
                { label: "Bronze", desc: "Score 0–39 · Self-declared players", color: "#B87333", dot: "●" },
                { label: "Silver", desc: "Score 40–59 · Consistent rec level", color: "#A8B0B5", dot: "●" },
                { label: "Gold", desc: "Score 60–77 · Club / competitive level", color: "#E3B23C", dot: "●" },
                { label: "Platinum", desc: "Score 78–89 · College / semi-pro · Verification required", color: "#E8E8E8", dot: "●" },
                { label: "Diamond", desc: "Score 90+ · Elite level · Verification required · You earn $8/session", color: "#9B59B6", dot: "◆" },
              ] as const).map(({ label, desc, color, dot }) => (
                <View key={label} style={[styles.howRow, { alignItems: "flex-start" }]}>
                  <Text style={[styles.howDot, { color, marginTop: 2 }]}>{dot}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.howRowLabel, { color }]}>{label}</Text>
                    <Text style={styles.howRowDesc}>{desc}</Text>
                  </View>
                </View>
              ))}
            </View>

            {/* Verification */}
            <Text style={[styles.howSectionHeader, { marginTop: 18 }]}>VERIFICATION</Text>
            <Text style={styles.howBody}>
              Self-declared players are capped at Gold. Submit for verification in your Profile to unlock Platinum and Diamond.
            </Text>

            <Pressable
              onPress={() => setHowOpen(false)}
              style={({ pressed }) => [styles.howCloseBtn, pressed && { opacity: 0.88 }]}
            >
              <Text style={styles.howCloseBtnText}>Got it</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* More tabs dropdown */}
      <Modal visible={moreOpen} transparent animationType="fade" onRequestClose={() => setMoreOpen(false)}>
        <Pressable style={styles.moreBackdrop} onPress={() => setMoreOpen(false)}>
          <View style={styles.moreSheet}>
            <Text style={styles.moreTitle}>Award leaders</Text>
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
                  style={({ pressed }) => [styles.moreRow, pressed && { backgroundColor: "rgba(255,255,255,0.05)" }]}
                >
                  <Text style={[styles.moreRowText, on && { color: LIME, fontWeight: "800" }]}>{m.label}</Text>
                  {on ? <FontAwesome name="check" size={14} color={LIME} /> : null}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  headerFilterBtn: { marginRight: 4, padding: 6, justifyContent: "center", alignItems: "center" },

  /* tab bar */
  tabScroll: {
    flexGrow: 0,
    flexShrink: 0,
    maxHeight: 54,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
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
  tabPillOff: { borderWidth: 1, borderColor: "#262626", backgroundColor: "transparent" },
  tabPillOn: { backgroundColor: LIME, borderWidth: 0 },
  tabPillText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  tabPillTextOn: { color: "#0a0a0a", fontWeight: "800" },

  listWrap: { flex: 1, minHeight: 0 },
  listFlex: { flex: 1 },
  listContentGrow: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 16, paddingVertical: 24 },
  listContent: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 32 },
  tierContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 40 },

  /* hero */
  hero: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
    minHeight: 148,
  },
  heroSkeleton: {
    backgroundColor: CARD,
    borderColor: CARD_BORDER,
  },
  heroLeft: { flex: 1, minWidth: 0 },
  heroLabel: { color: LIME, fontSize: 11, fontWeight: "800", letterSpacing: 1.5 },
  heroTier: { color: "#fff", fontSize: 34, fontWeight: "900", letterSpacing: -0.5, marginTop: 4 },
  heroSub: { color: "rgba(255,255,255,0.7)", fontSize: 13, marginTop: 4 },
  heroBtn: {
    alignSelf: "flex-start",
    marginTop: 14,
    borderWidth: 1,
    borderColor: LIME,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  heroBtnText: { color: LIME, fontWeight: "800", fontSize: 13 },
  heroGem: { width: 100, alignItems: "center", justifyContent: "center" },

  /* section header */
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 24,
    marginBottom: 12,
  },
  sectionHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionTitle: { color: "#fff", fontSize: 17, fontWeight: "800", letterSpacing: -0.2 },
  regionDropdown: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    backgroundColor: CARD,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  regionDropdownText: { color: "rgba(255,255,255,0.75)", fontSize: 13, fontWeight: "700" },

  /* player row */
  playerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: CARD,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 12,
  },
  playerRowMine: { borderColor: LIME, backgroundColor: "rgba(163,230,53,0.06)" },
  rankCell: { width: 30, alignItems: "center", justifyContent: "center" },
  rankCircleTop3: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: LIME,
    backgroundColor: "rgba(163,230,53,0.08)",
  },
  rankText: { color: "rgba(255,255,255,0.4)", fontSize: 14, fontWeight: "800" },
  rankTextTop3: { color: LIME },
  avatarRing: { width: 46, height: 46, borderRadius: 23, borderWidth: 2, padding: 2 },
  avatarImg: { width: "100%", height: "100%", borderRadius: 20 },
  avatarFallback: { backgroundColor: "rgba(255,255,255,0.06)", alignItems: "center", justifyContent: "center" },
  avatarFallbackText: { fontSize: 15, fontWeight: "800" },
  playerInfo: { flex: 1, minWidth: 0 },
  playerNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  playerName: { color: "#fff", fontSize: 15, fontWeight: "700", flexShrink: 1 },
  playerTier: { fontSize: 12, fontWeight: "700", marginTop: 2 },
  playerStats: { color: "rgba(255,255,255,0.4)", fontSize: 11, marginTop: 2 },
  ptsBlock: { alignItems: "flex-end", minWidth: 52 },
  ptsValue: { color: "#fff", fontSize: 24, fontWeight: "900", letterSpacing: -0.5 },
  ptsLabel: { color: "rgba(255,255,255,0.4)", fontSize: 10, fontWeight: "700", letterSpacing: 0.8 },

  /* climb card */
  climbCard: {
    marginTop: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: CARD,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 16,
  },
  climbIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "rgba(163,230,53,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  climbTitle: { color: "#fff", fontSize: 15, fontWeight: "800" },
  climbSub: { color: "rgba(255,255,255,0.5)", fontSize: 12, marginTop: 3, lineHeight: 16 },
  climbBtn: { borderWidth: 1, borderColor: LIME, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12 },
  climbBtnText: { color: LIME, fontWeight: "800", fontSize: 12 },

  /* empty / error */
  emptyStateBlock: { alignItems: "center", justifyContent: "center", gap: 16, paddingVertical: 24 },
  emptyStatsWrap: { alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 48 },
  emptyEmoji: { fontSize: 48, lineHeight: 56 },
  emptyTitle: { color: "#fff", fontSize: 18, fontWeight: "800" },
  emptySubtitle: { color: MUTED, fontSize: 15, textAlign: "center", lineHeight: 22, paddingHorizontal: 24 },
  errText: { color: "#fca5a5", fontSize: 14, textAlign: "center", lineHeight: 20 },
  retryBtn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.45)",
    backgroundColor: "rgba(163,230,53,0.12)",
  },
  retryBtnText: { color: LIME, fontWeight: "800", fontSize: 14 },

  /* region modal */
  modalRoot: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.6)" },
  modalBackdrop: { ...StyleSheet.absoluteFillObject },
  modalSheet: {
    backgroundColor: "#121212",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: CARD_BORDER,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 28,
  },
  modalHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.15)", marginBottom: 16 },
  modalTitle: { color: "#fff", fontWeight: "800", fontSize: 18, marginBottom: 18, textAlign: "center" },
  modalChips: { flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "center", marginBottom: 22 },
  modalChip: {
    minWidth: 72,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#3f3f3f",
    backgroundColor: CARD,
    alignItems: "center",
  },
  modalChipOn: { borderColor: LIME, backgroundColor: LIME },
  modalChipText: { color: "rgba(255,255,255,0.85)", fontWeight: "800", fontSize: 16 },
  modalChipTextOn: { color: "#0a0a0a" },
  modalCloseBtn: {
    marginTop: 4,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    backgroundColor: CARD,
    alignItems: "center",
  },
  modalCloseBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },

  /* how it works sheet */
  howSheet: { maxHeight: "88%" },
  howSectionHeader: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  howBody: { color: "rgba(255,255,255,0.6)", fontSize: 13, lineHeight: 20, marginBottom: 12 },
  howCard: {
    backgroundColor: CARD,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    paddingVertical: 4,
    paddingHorizontal: 14,
    gap: 0,
  },
  howRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  howDot: { fontSize: 13, width: 16, textAlign: "center" },
  howRowLabel: { color: "#fff", fontSize: 14, fontWeight: "700", flex: 1 },
  howRowValue: { color: "rgba(255,255,255,0.5)", fontSize: 13, fontWeight: "600" },
  howRowDesc: { color: "rgba(255,255,255,0.45)", fontSize: 12, lineHeight: 17, marginTop: 1 },
  howCloseBtn: {
    marginTop: 20,
    backgroundColor: LIME,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  howCloseBtnText: { color: "#0a0a0a", fontWeight: "900", fontSize: 16 },

  /* more dropdown */
  moreBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", paddingTop: 96, paddingHorizontal: 16 },
  moreSheet: {
    alignSelf: "flex-end",
    minWidth: 200,
    backgroundColor: "#161616",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  moreTitle: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
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
  moreRowText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
