import { useAuth } from "@/context/AuthContext";
import { siteOrigin } from "@/lib/env";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRouter } from "expo-router";
import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
const MUTED = "rgba(255,255,255,0.45)";

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

  const load = useCallback(
    async (isRefresh: boolean) => {
      const origin = siteOrigin();
      if (!origin) {
        setErr("App configuration error.");
        setPayload(null);
        setLoading(false);
        setRefreshing(false);
        return;
      }
      const token = session?.access_token ?? null;
      if (!token) {
        setErr("Sign in to view leaderboards.");
        setPayload(null);
        setLoading(false);
        setRefreshing(false);
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
          headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const json = (await r.json().catch(() => null)) as unknown;
        if (!r.ok) {
          if (r.status === 401) {
            setErr("Sign in to view leaderboards.");
          } else {
            setErr("Something went wrong. Please try again.");
          }
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
      } catch {
        setErr("Network error. Try again.");
        setPayload(null);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [region, session?.access_token],
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

  const onRefresh = useCallback(() => {
    void load(true);
  }, [load]);

  const showInitialSpinner = loading && !refreshing;
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
        <Text style={styles.emptyStatsText}>No stats yet. Play some runs!</Text>
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
              onPress={() => setTab(t.id)}
              style={({ pressed }) => [styles.tabPill, on && styles.tabPillOn, pressed && { opacity: 0.9 }]}
            >
              <Text style={[styles.tabPillText, on && styles.tabPillTextOn]} numberOfLines={1}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.listWrap}>
        {showInitialSpinner ? (
          <View style={styles.centerFill}>
            <ActivityIndicator color={LIME} size="large" />
          </View>
        ) : (
          <FlatList
            style={styles.listFlex}
            data={err ? [] : rowsForTab}
            keyExtractor={(item) => item.id}
            ItemSeparatorComponent={() => <View style={styles.rowSep} />}
            contentContainerStyle={err || rowsForTab.length === 0 ? styles.listContentGrow : styles.listContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={LIME} />}
            ListEmptyComponent={err || listEmpty ? listEmptyBody : null}
            renderItem={({ item, index }) => {
              const rank = index + 1;
              const mine = myUserId != null && item.id === myUserId;
              const medal = medalForRank(rank);
              const userLine = displayUsernameLine(item);
              return (
                <Pressable
                  onPress={() => router.push(`/player/${encodeURIComponent(item.id)}`)}
                  style={({ pressed }) => [styles.rowCard, mine && styles.rowCardMine, pressed && { opacity: 0.94 }]}
                >
                  <View style={styles.rankCell}>
                    <Text style={styles.rankCellText} numberOfLines={1}>
                      {medal || String(rank)}
                    </Text>
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
                </Pressable>
              );
            }}
          />
        )}
      </View>

      <Modal visible={filterOpen} transparent animationType="fade" onRequestClose={() => setFilterOpen(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setFilterOpen(false)} accessibilityLabel="Close region filter" />
          <View style={styles.modalInner} pointerEvents="box-none">
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Hub region</Text>
              <View style={styles.modalChips}>
                {REGIONS.map((r) => {
                  const on = region === r;
                  return (
                    <Pressable
                      key={r}
                      onPress={() => {
                        setRegion(r);
                        setFilterOpen(false);
                      }}
                      style={({ pressed }) => [styles.modalChip, on && styles.modalChipOn, pressed && { opacity: 0.88 }]}
                    >
                      <Text style={[styles.modalChipText, on && styles.modalChipTextOn]}>{r === "ALL" ? "All hubs" : r}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
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
    maxHeight: 40,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  tabRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    gap: 6,
  },
  tabPill: {
    flexShrink: 0,
    paddingVertical: 5,
    paddingHorizontal: 11,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  tabPillOn: {
    borderColor: "rgba(163,230,53,0.5)",
    backgroundColor: "rgba(163,230,53,0.1)",
  },
  tabPillText: { color: MUTED, fontWeight: "700", fontSize: 12 },
  tabPillTextOn: { color: LIME },

  listWrap: { flex: 1, minHeight: 0 },
  listFlex: { flex: 1 },
  listContentGrow: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  listContent: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 28 },

  centerFill: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 14 },
  emptyStateBlock: { alignItems: "center", justifyContent: "center", gap: 14, paddingVertical: 24 },
  emptyStatsWrap: { alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 32 },
  emptyEmoji: { fontSize: 40 },
  emptyStatsText: { color: MUTED, fontSize: 16, textAlign: "center", lineHeight: 22 },
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

  rowSep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.07)",
    marginVertical: 6,
  },

  rowCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.08)",
  },
  rowCardMine: {
    borderLeftWidth: 3,
    borderLeftColor: "rgba(163,230,53,0.55)",
    paddingLeft: 9,
  },

  rankCell: {
    width: 36,
    alignItems: "flex-start",
    justifyContent: "center",
  },
  rankCellText: {
    color: "rgba(255,255,255,0.88)",
    fontWeight: "800",
    fontSize: 15,
  },

  nameBlock: {
    flex: 1,
    minWidth: 0,
    marginRight: 10,
    gap: 2,
  },
  nameTitle: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 15,
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
    fontSize: 16,
    minWidth: 40,
    textAlign: "right",
    flexShrink: 0,
  },

  modalRoot: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  modalInner: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 72,
    paddingHorizontal: 20,
    alignItems: "stretch",
  },
  modalCard: {
    backgroundColor: "#141414",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    padding: 16,
  },
  modalTitle: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 16,
    marginBottom: 12,
  },
  modalChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  modalChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  modalChipOn: {
    borderColor: "rgba(163,230,53,0.55)",
    backgroundColor: "rgba(163,230,53,0.14)",
  },
  modalChipText: { color: "rgba(255,255,255,0.75)", fontWeight: "700", fontSize: 13 },
  modalChipTextOn: { color: LIME },
});
