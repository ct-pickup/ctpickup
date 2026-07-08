import { AnimatedPressScale } from "@/components/AnimatedPressScale";
import { useAuth } from "@/context/AuthContext";
import { siteOrigin } from "@/lib/env";
import { hapticTap } from "@/lib/haptics";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

const BG = "#0a0a0a";
const LIME = "#a3e635";
const CARD = "#141414";
const CARD_BORDER = "#222";
const TAB_INACTIVE_BORDER = "#3f3f3f";
const MUTED = "rgba(255,255,255,0.45)";
const TAB_ACTIVE_TEXT = "#0a0a0a";

const RANK1_BG = "#1a1500";
const RANK2_BG = "#111315";
const RANK3_BG = "#150e00";

type RegionFilter = "ALL" | "CT" | "NY" | "NJ" | "MD";
type TabId =
  | "wins"
  | "sessions"
  | "win_rate"
  | "potd"
  | "goalie"
  | "defender"
  | "midfielder"
  | "attacker"
  | "goals";

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
  goals: unknown[];
};

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "wins", label: "Wins" },
  { id: "sessions", label: "Sessions" },
  { id: "win_rate", label: "Win %" },
  { id: "potd", label: "POTD" },
  { id: "goalie", label: "Goalie" },
  { id: "defender", label: "Def" },
  { id: "midfielder", label: "Mid" },
  { id: "attacker", label: "Atk" },
  { id: "goals", label: "Goals" },
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
    goals: asRowArray(json.goals),
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
  const fn = (r.first_name ?? "").trim();
  const ln = (r.last_name ?? "").trim();
  const full = `${fn} ${ln}`.trim();
  if (full) return full;
  const u = (r.username ?? "").trim();
  return u ? `@${u}` : "Player";
}

function displayUsernameLine(r: ApiRow): string | null {
  const u = (r.username ?? "").trim();
  if (!u) return null;
  return `@${u}`;
}

function formatStat(tab: TabId, row: ApiRow): string {
  if (tab === "win_rate") {
    const pct = row.value;
    const rounded = Math.abs(pct - Math.round(pct)) < 1e-6 ? String(Math.round(pct)) : pct.toFixed(1);
    return `${rounded}%`;
  }
  return String(Math.round(row.value));
}

function medalForRank(rank: number): string {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return "";
}

function LeaderboardSkeleton() {
  const opacity = useRef(new Animated.Value(0.28)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.55, duration: 650, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.28, duration: 650, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <View style={styles.skeletonList}>
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} style={styles.skeletonCard}>
          <Animated.View style={[styles.skeletonCircle, { opacity }]} />
          <View style={styles.skeletonTextCol}>
            <Animated.View style={[styles.skeletonLineLg, { opacity }]} />
            <Animated.View style={[styles.skeletonLineSm, { opacity }]} />
          </View>
          <Animated.View style={[styles.skeletonStat, { opacity }]} />
        </View>
      ))}
    </View>
  );
}

export default function LeaderboardsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { session } = useAuth();
  const myUserId = session?.user?.id ?? null;

  const [tab, setTab] = useState<TabId>("wins");
  const [region, setRegion] = useState<RegionFilter>("ALL");
  const [filterOpen, setFilterOpen] = useState(false);
  const [payload, setPayload] = useState<LeaderboardsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
                    : tab === "attacker"
                      ? payload.attacker
                      : payload.goals;
    const out: ApiRow[] = [];
    for (const item of raw) {
      const r = parseRow(item);
      if (r) out.push(r);
    }
    return out;
  }, [payload, tab]);

  const load = useCallback(async (isRefresh: boolean) => {
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
        headers: { Accept: "application/json" },
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
  }, [region]);

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

  const onRefresh = useCallback(() => {
    void load(true);
  }, [load]);

  const showInitialSkeleton = loading && !refreshing;
  const listEmpty = !loading && !err && payload != null && rowsForTab.length === 0;

  const listEmptyBody =
    err != null ? (
      <View style={styles.emptyStateBlock}>
        <Text style={styles.errText}>{err}</Text>
        <Pressable onPress={() => void load(false)} style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.9 }]}>
          <Text style={styles.retryBtnText}>Retry</Text>
        </Pressable>
      </View>
    ) : (
      <View style={styles.emptyStatsWrap}>
        <Text style={styles.emptyEmoji}>⚽</Text>
        <Text style={styles.emptyTitle}>No stats yet</Text>
        <Text style={styles.emptySubtitle}>Play some runs to appear here!</Text>
      </View>
    );

  return (
    <View style={styles.root}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabScroll}
        contentContainerStyle={styles.tabRow}
        keyboardShouldPersistTaps="handled"
      >
        {TABS.map((t) => {
          const on = tab === t.id;
          return (
            <Pressable
              key={t.id}
              onPress={() => { void hapticTap(); setTab(t.id); }}
              style={({ pressed }) => [styles.tabPill, on ? styles.tabPillOn : styles.tabPillOff, pressed && { opacity: 0.92 }]}
            >
              <Text style={[styles.tabPillText, on && styles.tabPillTextOn]} numberOfLines={1}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.listWrap}>
        {showInitialSkeleton ? (
          <View style={styles.skeletonFill}>
            <LeaderboardSkeleton />
          </View>
        ) : (
          <FlatList
            style={styles.listFlex}
            data={err ? [] : rowsForTab}
            keyExtractor={(item) => item.id}
            contentContainerStyle={
              err || rowsForTab.length === 0 ? styles.listContentGrow : styles.listContent
            }
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={LIME} />}
            ListEmptyComponent={err || listEmpty ? listEmptyBody : null}
            ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
            renderItem={({ item, index }) => {
              const rank = index + 1;
              const mine = myUserId != null && item.id === myUserId;
              const medal = medalForRank(rank);
              const userLine = displayUsernameLine(item);
              const topBg =
                rank === 1 ? styles.rowCardRank1 : rank === 2 ? styles.rowCardRank2 : rank === 3 ? styles.rowCardRank3 : null;

              return (
                <AnimatedPressScale
                  hapticOnPress
                  pressedScale={0.98}
                  onPress={() => router.push(`/player/${encodeURIComponent(item.id)}`)}
                  style={[styles.rowCard, topBg, mine && styles.rowCardMine]}
                >
                  <View style={[styles.rankCell, rank <= 3 && styles.rankCellTop3]}>
                    {medal ? (
                      <Text style={[styles.medalText, rank <= 3 && styles.medalTextTop3]} numberOfLines={1}>
                        {medal}
                      </Text>
                    ) : (
                      <View style={styles.rankCircle}>
                        <Text style={styles.rankCircleText} numberOfLines={1}>
                          {rank}
                        </Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.nameBlock}>
                    <Text style={styles.nameTitle} numberOfLines={1}>
                      {displayPlayerName(item)}
                    </Text>
                    {userLine != null ? (
                      <Text style={styles.usernameSub} numberOfLines={1}>
                        {userLine}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={styles.statValue} numberOfLines={1}>
                    {formatStat(tab, item)}
                  </Text>
                </AnimatedPressScale>
              );
            }}
          />
        )}
      </View>

      <Modal visible={filterOpen} transparent animationType="slide" onRequestClose={() => setFilterOpen(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setFilterOpen(false)} accessibilityLabel="Dismiss filter" />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Filter by Region</Text>
            <View style={styles.modalChips}>
              {REGIONS.map((reg) => {
                const on = region === reg;
                const label = reg === "ALL" ? "All" : reg;
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
                    <Text style={[styles.modalChipText, on && styles.modalChipTextOn]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              onPress={() => setFilterOpen(false)}
              style={({ pressed }) => [styles.modalCloseBtn, pressed && { opacity: 0.88 }]}
            >
              <Text style={styles.modalCloseBtnText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  headerFilterBtn: {
    marginRight: 4,
    padding: 6,
    justifyContent: "center",
    alignItems: "center",
  },

  tabScroll: {
    flexGrow: 0,
    flexShrink: 0,
    maxHeight: 54,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  tabRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  tabPill: {
    flexShrink: 0,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 999,
  },
  tabPillOff: {
    borderWidth: 1,
    borderColor: "#262626",
    backgroundColor: "transparent",
  },
  tabPillOn: {
    backgroundColor: "#a3e635",
    borderWidth: 0,
  },
  tabPillText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  tabPillTextOn: { color: "#0a0a0a", fontWeight: "800" },

  listWrap: { flex: 1, minHeight: 0 },
  listFlex: { flex: 1 },
  listContentGrow: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  listContent: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 32 },

  skeletonFill: { flex: 1, paddingHorizontal: 14, paddingTop: 12 },
  skeletonList: { gap: 10 },
  skeletonCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: CARD,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    gap: 12,
  },
  skeletonCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#2a2a2a",
  },
  skeletonTextCol: { flex: 1, gap: 8 },
  skeletonLineLg: { height: 14, borderRadius: 6, backgroundColor: "#2a2a2a", width: "72%" },
  skeletonLineSm: { height: 11, borderRadius: 5, backgroundColor: "#242424", width: "44%" },
  skeletonStat: { width: 44, height: 18, borderRadius: 6, backgroundColor: "#2a2a2a" },

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

  rowCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: CARD,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  rowCardRank1: { backgroundColor: RANK1_BG },
  rowCardRank2: { backgroundColor: RANK2_BG },
  rowCardRank3: { backgroundColor: RANK3_BG },
  rowCardMine: {
    borderLeftWidth: 3,
    borderLeftColor: LIME,
    paddingLeft: 11,
  },

  rankCell: {
    width: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  rankCellTop3: {
    width: 44,
  },
  medalText: {
    fontSize: 20,
    lineHeight: 26,
  },
  medalTextTop3: {
    fontSize: 28,
    lineHeight: 34,
  },
  rankCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
    justifyContent: "center",
  },
  rankCircleText: {
    color: "rgba(255,255,255,0.85)",
    fontWeight: "800",
    fontSize: 12,
  },

  nameBlock: {
    flex: 1,
    minWidth: 0,
    marginRight: 10,
    gap: 3,
  },
  nameTitle: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 16,
    letterSpacing: -0.2,
  },
  usernameSub: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "500",
  },

  statValue: {
    color: LIME,
    fontWeight: "800",
    fontSize: 18,
    minWidth: 44,
    textAlign: "right",
    flexShrink: 0,
  },

  modalRoot: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
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
  modalHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.15)",
    marginBottom: 16,
  },
  modalTitle: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 18,
    marginBottom: 18,
    textAlign: "center",
  },
  modalChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "center",
    marginBottom: 22,
  },
  modalChip: {
    minWidth: 72,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: TAB_INACTIVE_BORDER,
    backgroundColor: CARD,
    alignItems: "center",
  },
  modalChipOn: {
    borderColor: LIME,
    backgroundColor: LIME,
  },
  modalChipText: { color: "rgba(255,255,255,0.85)", fontWeight: "800", fontSize: 16 },
  modalChipTextOn: { color: TAB_ACTIVE_TEXT },
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
});
