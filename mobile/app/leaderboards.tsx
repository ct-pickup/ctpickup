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
  { id: "potd", label: "POTD" },
  { id: "goalie", label: "Goalie of Day 🧤" },
  { id: "defender", label: "Defender of Day 🛡️" },
  { id: "midfielder", label: "Midfielder of Day 🎯" },
  { id: "attacker", label: "Attacker of Day ⚡" },
  { id: "goals", label: "Goals" },
];

const REGIONS: RegionFilter[] = ["ALL", "CT", "NY", "NJ", "MD"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object";
}

function parsePayload(json: unknown): LeaderboardsPayload | null {
  if (!isRecord(json)) return null;
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
  return { region, wins, sessions, win_rate, potd, goalie, defender, midfielder, attacker, goals };
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
  if (rank === 1) return "🥇 ";
  if (rank === 2) return "🥈 ";
  if (rank === 3) return "🥉 ";
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

  const listEmpty = !loading && !err && rowsForTab.length === 0;

  return (
    <View style={styles.root}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRow}>
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

      {loading && !refreshing ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={LIME} size="large" />
        </View>
      ) : err ? (
        <View style={styles.centerFill}>
          <Text style={styles.errText}>{err}</Text>
          <Pressable onPress={() => void load(false)} style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.9 }]}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={rowsForTab}
          keyExtractor={(item) => item.id}
          contentContainerStyle={listEmpty ? styles.listEmptyContainer : styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={LIME} />}
          ListEmptyComponent={
            listEmpty ? (
              <Text style={styles.emptyText}>No stats yet</Text>
            ) : null
          }
          renderItem={({ item, index }) => {
            const rank = index + 1;
            const ig = formatInstagram(item.instagram);
            const mine = myUserId != null && item.id === myUserId;
            return (
              <Pressable
                onPress={() => router.push(`/player/${encodeURIComponent(item.id)}`)}
                style={({ pressed }) => [
                  styles.row,
                  mine && styles.rowMine,
                  pressed && { opacity: 0.92 },
                ]}
              >
                <View style={styles.rankCol}>
                  <Text style={styles.rankText}>
                    {medalForRank(rank)}
                    {rank}
                  </Text>
                </View>
                <View style={styles.nameCol}>
                  <Text style={styles.nameText} numberOfLines={1}>
                    {displayPlayerName(item)}
                  </Text>
                  {ig ? (
                    <Text style={styles.igText} numberOfLines={1}>
                      {ig}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.statText}>{formatStat(tab, item)}</Text>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  tabRow: {
    flexGrow: 0,
    flexDirection: "row",
    flexWrap: "nowrap",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    paddingRight: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.12)",
  },
  tab: {
    flexShrink: 0,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  tabOn: { borderColor: "rgba(163,230,53,0.55)", backgroundColor: "rgba(163,230,53,0.12)" },
  tabText: { color: "rgba(255,255,255,0.65)", fontWeight: "800", fontSize: 13 },
  tabTextOn: { color: LIME },

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

  listContent: { paddingHorizontal: 12, paddingBottom: 28, paddingTop: 8 },
  listEmptyContainer: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 20, minHeight: 280 },
  emptyText: { color: "rgba(255,255,255,0.5)", fontSize: 15, textAlign: "center" },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  rowMine: {
    borderLeftWidth: 3,
    borderLeftColor: "rgba(163,230,53,0.42)",
    paddingLeft: 9,
  },
  rankCol: { width: 44, alignItems: "flex-start" },
  rankText: { color: "rgba(255,255,255,0.85)", fontWeight: "900", fontSize: 15 },
  nameCol: { flex: 1, minWidth: 0 },
  nameText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  igText: { marginTop: 3, color: "rgba(255,255,255,0.42)", fontSize: 13, fontWeight: "600" },
  statText: { color: LIME, fontWeight: "900", fontSize: 16, minWidth: 52, textAlign: "right" },
});
