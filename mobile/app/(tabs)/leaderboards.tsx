import { useAuth } from "@/context/AuthContext";
import { siteOrigin } from "@/lib/env";
import { hapticTap } from "@/lib/haptics";
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

import { ChalkDivider, ChalkEmptyState } from "@/components/chalk";
import { radius, themeColor, useThemedStyles } from "@/theme";
function TIER_COLORS(): Record<string, string> {
  return {
  diamond: themeColor().muted,
  platinum: themeColor().muted,
  gold: themeColor().muted,
  silver: themeColor().muted,
  bronze: themeColor().muted,
};
}

function tierColor(tier: string | null | undefined): string {
  return tier ? (TIER_COLORS()[tier.toLowerCase()] ?? themeColor().pitch) : themeColor().pitch;
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
  points: number;
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

function TierGem({ size }: { tier: string; size: number; gid?: string }) {
  useThemedStyles(publish_styles);

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        backgroundColor: themeColor().overlay,
        borderWidth: 1,
        borderColor: themeColor().line,
      }}
    />
  );
}

/* --------------------------------------------------------------- screen */

export default function LeaderboardsScreen() {
  useThemedStyles(publish_styles);

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

  // ── Tier data via /api/leaderboards (admin). Client RLS on player_ratings
  // only allows auth.uid() = user_id, so a direct supabase select returns ~1 row.
  const loadTier = useCallback(async () => {
    const origin = siteOrigin();
    if (!origin) return;
    setTierLoading(true);
    try {
      const u = new URL(`${origin}/api/leaderboards`);
      if (region !== "ALL") u.searchParams.set("region", region);
      const r = await fetch(u.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const json = (await r.json().catch(() => null)) as unknown;
      const tiersRaw =
        isRecord(json) && Array.isArray(json.tiers) ? (json.tiers as unknown[]) : [];

      // Debug: API returns full player_ratings list (bypasses RLS).
      console.log("player_ratings count:", tiersRaw.length);
      console.log("profiles count:", tiersRaw.length);

      const TIER_PTS: Record<string, number> = {
        diamond: 8,
        platinum: 6,
        gold: 4,
        silver: 2,
        bronze: 0,
      };

      const merged: Omit<TierPlayer, "points">[] = [];
      for (const item of tiersRaw) {
        if (!isRecord(item)) continue;
        const userId = typeof item.user_id === "string" ? item.user_id : null;
        if (!userId) continue;
        const first = typeof item.first_name === "string" ? item.first_name : null;
        const last = typeof item.last_name === "string" ? item.last_name : null;
        const username = typeof item.username === "string" ? item.username : null;
        const name = [first, last].filter(Boolean).join(" ").trim() || username || "Player";
        const tier = (typeof item.tier === "string" ? item.tier : "bronze").toLowerCase();
        merged.push({
          user_id: userId,
          tier,
          score: typeof item.score === "number" && Number.isFinite(item.score) ? item.score : 50,
          sessions: typeof item.sessions === "number" && Number.isFinite(item.sessions) ? item.sessions : 0,
          reliability:
            typeof item.reliability === "number" && Number.isFinite(item.reliability)
              ? item.reliability
              : 0,
          name,
          username,
          avatar_url: typeof item.avatar_url === "string" ? item.avatar_url.trim() || null : null,
          nearest_venue: typeof item.nearest_venue === "string" ? item.nearest_venue : null,
        });
      }

      // Points = sessions × tierPtsPerSession × 10; rank by points (not raw score).
      const sorted = merged
        .map((r) => ({
          ...r,
          points: (r.sessions ?? 0) * (TIER_PTS[r.tier] ?? 0) * 10,
        }))
        .sort((a, b) => b.points - a.points || b.score - a.score);

      setTierPlayers(sorted);

      // My tier + percentile (own row is readable under RLS).
      if (myUserId && supabase) {
        const { data: mine } = await supabase
          .from("player_ratings")
          .select("tier,score,sessions")
          .eq("user_id", myUserId)
          .maybeSingle();
        if (mine) {
          const myRow = mine as { tier: string | null; score: number | null; sessions: number | null };
          const myScore = myRow.score ?? 0;
          const myTier = (myRow.tier ?? "bronze").toLowerCase();
          const myPoints = (myRow.sessions ?? 0) * (TIER_PTS[myTier] ?? 0) * 10;
          const total = sorted.length;
          const better = sorted.filter((p) => p.points > myPoints).length;
          const percentile =
            total > 0 ? Math.min(100, Math.max(1, Math.round((better / total) * 100))) : null;
          const resolved: MyTier = {
            tier: myTier,
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
    } catch (e) {
      console.error("[leaderboards] loadTier failed:", e);
      setTierPlayers([]);
    } finally {
      setTierLoading(false);
    }
  }, [myUserId, region, supabase]);

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
          <Ionicons name="options-outline" size={22} color={themeColor().text} />
        </Pressable>
      ),
    });
  }, [navigation]);

  const onRefresh = useCallback(() => void load(true), [load]);

  const regionLabel = region === "ALL" ? "All Regions" : region;

  // Region filtering is applied server-side in /api/leaderboards?region=.
  const filteredTierPlayers = tierPlayers;

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
    if (myTier === null && tierLoading) {
      return <View style={[styles.hero, styles.heroSkeleton]} />;
    }

    const t = myTier?.tier ?? "bronze";
    const color = tierColor(t);

    const subtitle = !myTier
      ? "Play a session to earn your tier"
      : myTier.percentile != null
        ? `Top ${myTier.percentile}% of players`
        : `${myTier.sessions} sessions played`;

    return (
      <View style={[styles.hero, { borderColor: `${color}55` }]}>

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
    const pts = item.points ?? 0;
    return (
      <Pressable
        key={item.user_id}
        onPress={() => router.push(`/player/${item.user_id}`)}
        style={({ pressed }) => [styles.playerRow, mine && styles.playerRowMine, pressed && { opacity: 0.85 }]}
      >
        <View style={[styles.rankCell, top3 && styles.rankCircleTop3]}>
          <Text style={[styles.rankText, top3 && styles.rankTextTop3, mine && styles.onPanelText]}>{rank}</Text>
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
            <Text style={[styles.playerName, mine && styles.onPanelText]} numberOfLines={1}>
              {item.name}
            </Text>
            <TierGem tier={item.tier} size={15} gid={`gem-${item.user_id}`} />
          </View>
          <Text style={[styles.playerTier, { color }, mine && styles.onPanelText]} numberOfLines={1}>
            {tierLabel(item.tier)}
          </Text>
          <Text style={[styles.playerStats, mine && styles.onPanelText]} numberOfLines={1}>
            {item.sessions} sessions · {Math.round(item.reliability)}% reliable
          </Text>
        </View>

        <View style={styles.ptsBlock}>
          <Text style={styles.ptsValue}>{pts.toLocaleString()}</Text>
          <Text style={[styles.ptsLabel, mine && styles.onPanelText]}>PTS</Text>
        </View>
        <FontAwesome name="chevron-right" size={13} color={themeColor().muted} style={{ marginLeft: 4 }} />
      </Pressable>
    );
  }

  function renderTierTab() {
    return (
      <ScrollView
        style={styles.listFlex}
        contentContainerStyle={styles.tierContent}
        refreshControl={<RefreshControl refreshing={tierLoading} onRefresh={() => void loadTier()} tintColor={themeColor().pitchText} />}
      >
        {renderHero()}

        <View style={styles.sectionHeaderRow}>
          <View style={styles.sectionHeaderLeft}>
            <Ionicons name="people" size={16} color={themeColor().pitchText} />
            <Text style={styles.sectionTitle}>Top Players</Text>
          </View>
          <Pressable onPress={() => setFilterOpen(true)} hitSlop={8} style={styles.regionDropdown}>
            <Text style={styles.regionDropdownText}>{regionLabel}</Text>
            <FontAwesome name="caret-down" size={13} color={themeColor().muted} />
          </Pressable>
        </View>

        {tierLoading && tierPlayers.length === 0 ? (
          <ActivityIndicator color={themeColor().pitchText} style={{ marginTop: 32 }} />
        ) : filteredTierPlayers.length === 0 ? (
          <ChalkEmptyState
            graphic="circle"
            title="No rated players yet"
            body="Complete a session to earn a tier."
            style={styles.emptyStatsWrap}
          />
        ) : (
          <View style={{ gap: 8 }}>{filteredTierPlayers.map((p, i) => renderTierRow(p, i))}</View>
        )}

        <ChalkDivider style={styles.sectionDivider} />

        {/* Climb the ranks */}
        <View style={styles.climbCard}>
          <View style={styles.climbIcon}>
            <FontAwesome name="line-chart" size={18} color={themeColor().pitchText} />
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
              title="No stats yet"
              body="Play some runs to appear here!"
              style={styles.emptyStatsWrap}
            />
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
                <Text style={[styles.rankText, top3 && styles.rankTextTop3, mine && styles.onPanelText]}>{rank}</Text>
              </View>
              <View style={[styles.avatarRing, { borderColor: themeColor().line }]}>
                <View style={[styles.avatarImg, styles.avatarFallback]}>
                  <Text style={[styles.avatarFallbackText, { color: themeColor().text }]}>{initials(name)}</Text>
                </View>
              </View>
              <View style={styles.playerInfo}>
                <Text style={styles.playerName} numberOfLines={1}>
                  {name}
                </Text>
                {item.username ? (
                  <Text style={[styles.playerStats, mine && styles.onPanelText]} numberOfLines={1}>
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
              Points = sessions × tier points × 10. Higher tiers earn more points per rated session.
            </Text>
            <View style={styles.howCard}>
              {([
                { tier: "diamond", label: "Diamond", pts: 80, color: themeColor().muted, dot: "◆" },
                { tier: "platinum", label: "Platinum", pts: 60, color: themeColor().text, dot: "●" },
                { tier: "gold", label: "Gold", pts: 40, color: themeColor().muted, dot: "●" },
                { tier: "silver", label: "Silver", pts: 20, color: themeColor().muted, dot: "●" },
                { tier: "bronze", label: "Bronze", pts: 0, color: themeColor().muted, dot: "●" },
              ] as const).map(({ tier, label, pts, color, dot }) => (
                <View key={tier} style={styles.howRow}>
                  <Text style={[styles.howDot, { color }]}>{dot}</Text>
                  <Text style={styles.howRowLabel}>{label}</Text>
                  <Text style={styles.howRowValue}>{pts} pts / session</Text>
                </View>
              ))}
            </View>

            {/* Tiers */}
            <Text style={[styles.howSectionHeader, { marginTop: 16 }]}>TIER SYSTEM</Text>
            <Text style={styles.howBody}>
              Your tier is determined by your rating score, earned through peer votes and organizer ratings after each session.
            </Text>
            <View style={styles.howCard}>
              {([
                { label: "Bronze", desc: "Score 0–39 · Self-declared players", color: themeColor().muted, dot: "●" },
                { label: "Silver", desc: "Score 40–59 · Consistent rec level", color: themeColor().muted, dot: "●" },
                { label: "Gold", desc: "Score 60–77 · Club / competitive level", color: themeColor().muted, dot: "●" },
                { label: "Platinum", desc: "Score 78–89 · College / semi-pro · Verification required", color: themeColor().text, dot: "●" },
                { label: "Diamond", desc: "Score 90+ · Elite level · Verification required · You earn $8/session", color: themeColor().muted, dot: "◆" },
              ] as const).map(({ label, desc, color, dot }) => (
                <View key={label} style={[styles.howRow, { alignItems: "flex-start" }]}>
                  <Text style={[styles.howDot, { color, marginTop: 4 }]}>{dot}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.howRowLabel, { color }]}>{label}</Text>
                    <Text style={styles.howRowDesc}>{desc}</Text>
                  </View>
                </View>
              ))}
            </View>

            {/* Verification */}
            <Text style={[styles.howSectionHeader, { marginTop: 16 }]}>VERIFICATION</Text>
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

  listWrap: { flex: 1, minHeight: 0 },
  listFlex: { flex: 1 },
  listContentGrow: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 16, paddingVertical: 24 },
  listContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 },
  tierContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 40 },

  /* hero */
  hero: {
    borderRadius: radius.card,
    borderWidth: 1,
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
  heroTier: { color: themeColor().text, fontSize: 32, fontFamily: "InstrumentSerif_400Regular", fontWeight: "900", marginTop: 4 },
  heroSub: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4 },
  heroBtn: {
    alignSelf: "flex-start",
    marginTop: 12,
    borderWidth: 1,
    borderColor: themeColor().pitch,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  heroBtnText: { color: themeColor().pitchText, fontWeight: "800", fontSize: 13, fontFamily: "Inter_700Bold" },
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
  sectionTitle: { color: themeColor().text, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "800",},
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
  avatarRing: { width: 46, height: 46, borderRadius: 999, borderWidth: 2, padding: 4 },
  avatarImg: { width: "100%", height: "100%", borderRadius: 999 },
  avatarFallback: { backgroundColor: themeColor().overlaySubtle, alignItems: "center", justifyContent: "center" },
  avatarFallbackText: { fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "800" },
  playerInfo: { flex: 1, minWidth: 0 },
  playerNameRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  playerName: { color: themeColor().text, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700", flexShrink: 1 },
  playerTier: { fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700", marginTop: 4 },
  playerStats: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4 },
  ptsBlock: { alignItems: "flex-end", minWidth: 52 },
  ptsValue: { color: themeColor().text, fontSize: 24, fontFamily: "InstrumentSerif_400Regular", fontWeight: "900",},
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
  climbBtn: { borderWidth: 1, borderColor: themeColor().pitch, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12 },
  climbBtnText: { color: themeColor().pitchText, fontWeight: "800", fontSize: 13, fontFamily: "Inter_700Bold" },

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

  /* region modal */
  modalRoot: { flex: 1, justifyContent: "flex-end", backgroundColor: themeColor().scrim },
  modalBackdrop: { ...StyleSheet.absoluteFillObject },
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
  modalTitle: { color: themeColor().text, fontWeight: "800", fontSize: 20, fontFamily: "InstrumentSerif_400Regular", marginBottom: 16, textAlign: "center" },
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

  /* how it works sheet */
  howSheet: { maxHeight: "88%" },
  howSectionHeader: {
    color: themeColor().muted,
    fontSize: 13, fontFamily: "Inter_700Bold",
    fontWeight: "500",
    marginBottom: 8,
  },
  howBody: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20, marginBottom: 12 },
  howCard: {
    backgroundColor: themeColor().card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().overlay,
    paddingVertical: 4,
    paddingHorizontal: 12,
    gap: 0,
  },
  howRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: themeColor().line,
  },
  howDot: { fontSize: 13, fontFamily: "Inter_400Regular", width: 16, textAlign: "center" },
  howRowLabel: { color: themeColor().text, fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "700", flex: 1 },
  howRowValue: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  howRowDesc: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 17, marginTop: 1 },
  howCloseBtn: {
    marginTop: 20,
    backgroundColor: themeColor().pitch,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  howCloseBtnText: { color: themeColor().onPitch, fontWeight: "900", fontSize: 16, fontFamily: "Inter_700Bold" },

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

