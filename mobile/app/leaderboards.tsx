import { useAuth } from "@/context/AuthContext";
import { siteOrigin } from "@/lib/env";
import { useNavigation, useRouter } from "expo-router";
import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

const BG = "#0a0a0a";
const LIME = "#a3e635";

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
  wins: ApiRow[];
  sessions: ApiRow[];
  win_rate: ApiRow[];
  potd: ApiRow[];
  goalie: ApiRow[];
  defender: ApiRow[];
  midfielder: ApiRow[];
  attacker: ApiRow[];
  goals: ApiRow[];
};

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "wins", label: "Wins" },
  { id: "sessions", label: "Sessions" },
  { id: "win_rate", label: "Win Rate" },
  { id: "potd", label: "🏆 POTD" },
  { id: "goalie", label: "🧤 Goalie" },
  { id: "defender", label: "🛡️ Defender" },
  { id: "midfielder", label: "🎯 Mid" },
  { id: "attacker", label: "⚡ Attacker" },
  { id: "goals", label: "⚽ Goals" },
];

const REGIONS: RegionFilter[] = ["ALL", "CT", "NY", "NJ", "MD"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object";
}

function parsePayload(json: unknown): LeaderboardsPayload | null {
  if (!isRecord(json)) return null;
  if (json.ok === false) return null;
  const wins = json.wins;
  const sessions = json.sessions;
  const win_rate = json.win_rate;
  const potd = json.potd;
  const goalie = json.goalie;
  const defender = json.defender;
  const midfielder = json.midfielder;
  const attacker = json.attacker;
  const goals = json.goals;
  if (
    !Array.isArray(wins) ||
    !Array.isArray(sessions) ||
    !Array.isArray(win_rate) ||
    !Array.isArray(potd) ||
    !Array.isArray(goalie) ||
    !Array.isArray(defender) ||
    !Array.isArray(midfielder) ||
    !Array.isArray(attacker) ||
    !Array.isArray(goals)
  ) {
    return null;
  }
  const region = typeof json.region === "string" ? json.region : "ALL";
  const ok = json.ok === true;
  return { ok, region, wins, sessions, win_rate, potd, goalie, defender, midfielder, attacker, goals };
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

function formatInstagram(raw: string | null): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  return s.startsWith("@") ? s : `@${s}`;
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
      setErr("App configuration error.");
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
      const r = await fetch(u.toString(), { method: "GET", headers: { Accept: "application/json" }, cache: "no-store" });
      const json = (await r.json().catch(() => null)) as unknown;
      if (!r.ok) {
        const msg =
          json && typeof json === "object" && typeof (json as { error?: unknown }).error === "string"
            ? String((json as { error: string }).error)
            : "Couldn’t load leaderboards.";
        setErr(msg);
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
  }, [region]);

  useLayoutEffect(() => {
    void load(false);
  }, [load]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.headerRegionRow}
        >
          {REGIONS.map((r) => {
            const on = region === r;
            return (
              <Pressable
                key={r}
                onPress={() => setRegion(r)}
                style={({ pressed }) => [styles.headerRegionChip, on && styles.headerRegionChipOn, pressed && { opacity: 0.88 }]}
              >
                <Text style={[styles.headerRegionChipText, on && styles.headerRegionChipTextOn]}>{r === "ALL" ? "All" : r}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ),
    });
  }, [navigation, region]);

  const onRefresh = useCallback(() => {
    void load(true);
  }, [load]);

  const showInitialSpinner = loading && !refreshing;
  const listEmpty = !loading && !err && payload != null && rowsForTab.length === 0;

  const listEmptyBody = err ? (
    <View style={styles.emptyStateBlock}>
      <Text style={styles.errText}>{err}</Text>
      <Pressable onPress={() => void load(false)} style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.9 }]}>
        <Text style={styles.retryBtnText}>Retry</Text>
      </Pressable>
    </View>
  ) : (
    <Text style={styles.emptyText}>No stats yet</Text>
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
              style={({ pressed }) => [styles.tab, on && styles.tabOn, pressed && { opacity: 0.9 }]}
            >
              <Text style={[styles.tabText, on && styles.tabTextOn]}>{t.label}</Text>
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
            contentContainerStyle={
              err || rowsForTab.length === 0 ? styles.listContentGrow : styles.listContent
            }
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={LIME} />}
            ListEmptyComponent={err || listEmpty ? listEmptyBody : null}
            renderItem={({ item, index }) => {
              const rank = index + 1;
              const ig = formatInstagram(item.instagram);
              const mine = myUserId != null && item.id === myUserId;
              const medal = medalForRank(rank);
              const nameIg =
                ig != null ? `${displayPlayerName(item)} · ${ig}` : displayPlayerName(item);
              return (
                <Pressable
                  onPress={() => router.push(`/player/${encodeURIComponent(item.id)}`)}
                  style={({ pressed }) => [
                    styles.row,
                    mine && styles.rowMine,
                    pressed && { opacity: 0.92 },
                  ]}
                >
                  <Text style={styles.rankText} numberOfLines={1}>
                    {medal ? `${medal}${rank}` : String(rank)}
                  </Text>
                  <Text style={styles.nameIgText} numberOfLines={1}>
                    {nameIg}
                  </Text>
                  <Text style={styles.statText} numberOfLines={1}>
                    {formatStat(tab, item)}
                  </Text>
                </Pressable>
              );
            }}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  tabScroll: {
    flexGrow: 0,
    flexShrink: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.12)",
  },
  tabRow: {
    flexDirection: "row",
    flexWrap: "nowrap",
    alignItems: "center",
    paddingLeft: 10,
    paddingRight: 14,
    paddingVertical: 6,
    gap: 6,
  },
  tab: {
    flexShrink: 0,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  tabOn: { borderColor: "rgba(163,230,53,0.55)", backgroundColor: "rgba(163,230,53,0.12)" },
  tabText: { color: "rgba(255,255,255,0.65)", fontWeight: "800", fontSize: 12 },
  tabTextOn: { color: LIME },

  listWrap: { flex: 1, minHeight: 0 },
  listFlex: { flex: 1 },
  listContentGrow: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },

  headerRegionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingRight: 8,
    maxWidth: 220,
  },
  headerRegionChip: {
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  headerRegionChipOn: {
    borderColor: "rgba(163,230,53,0.5)",
    backgroundColor: "rgba(163,230,53,0.12)",
  },
  headerRegionChipText: { color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: "800" },
  headerRegionChipTextOn: { color: LIME },

  centerFill: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 14 },
  emptyStateBlock: { alignItems: "center", justifyContent: "center", gap: 14, paddingVertical: 24 },
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

  listContent: { paddingHorizontal: 10, paddingBottom: 24, paddingTop: 4 },
  emptyText: { color: "rgba(255,255,255,0.5)", fontSize: 15, textAlign: "center" },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  rowMine: {
    borderLeftWidth: 2,
    borderLeftColor: "rgba(163,230,53,0.42)",
    paddingLeft: 6,
  },
  rankText: {
    color: "rgba(255,255,255,0.85)",
    fontWeight: "900",
    fontSize: 13,
    width: 34,
    textAlign: "left",
  },
  nameIgText: { flex: 1, minWidth: 0, color: "#fff", fontWeight: "700", fontSize: 14 },
  statText: { color: LIME, fontWeight: "900", fontSize: 14, minWidth: 44, textAlign: "right", flexShrink: 0 },
});
