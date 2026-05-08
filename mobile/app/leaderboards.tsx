import { useAuth } from "@/context/AuthContext";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useNavigation, useRouter } from "expo-router";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

const BG = "#0a0a0a";
const LIME = "#a3e635";

type Team = "A" | "B" | "C";
type Region = "ALL" | "CT" | "NY" | "NJ" | "MD";

type Category =
  | "most_wins"
  | "highest_win_rate"
  | "most_games"
  | "most_reliable"
  | "potd"
  | "def"
  | "mid"
  | "att";

type ProfileRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  nearest_venue: string | null;
  attended_count: number | null;
  confirmed_count: number | null;
  strike_count: number | null;
};

type BoardRow = {
  userId: string;
  name: string;
  username: string | null;
  valueLabel: string;
  valueSort: number;
};

const CATEGORY_OPTIONS: Array<{ id: Category; label: string }> = [
  { id: "most_wins", label: "Most Wins" },
  { id: "highest_win_rate", label: "Highest Win Rate" },
  { id: "most_games", label: "Most Games" },
  { id: "most_reliable", label: "Most Reliable" },
  { id: "potd", label: "Player of the Day" },
  { id: "def", label: "Defender of the Day" },
  { id: "mid", label: "Midfielder of the Day" },
  { id: "att", label: "Attacker of the Day" },
];

const REGION_OPTIONS: Region[] = ["ALL", "CT", "NY", "NJ", "MD"];

const VENUE_TO_REGION: Record<string, Exclude<Region, "ALL">> = {
  // NJ
  "Sofive Meadowlands": "NJ",
  "Sofive Cherry Hill": "NJ",
  // NY
  "Sofive Brooklyn": "NY",
  "Hudson Sports Complex": "NY",
  "New Rochelle SoccerRoof": "NY",
  // MD
  "Sofive Rockville": "MD",
  "SoccerDome Jessup": "MD",
  "SoccerDome Harmans": "MD",
  // CT
  "New Haven SoccerRoof": "CT",
};

function s(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function displayName(p: ProfileRow): string {
  const fn = (p.first_name ?? "").trim();
  const ln = (p.last_name ?? "").trim();
  const full = `${fn} ${ln}`.trim();
  if (full) return full;
  const u = (p.username ?? "").trim();
  return u ? `@${u}` : "Player";
}

function regionFromVenue(venue: string | null): Exclude<Region, "ALL"> | null {
  const v = (venue ?? "").trim();
  if (!v) return null;
  return VENUE_TO_REGION[v] ?? null;
}

function pct(n: number): string {
  return `${Math.round(n)}%`;
}

export default function LeaderboardsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { supabase, isReady } = useAuth();

  const [region, setRegion] = useState<Region>("ALL");
  const [category, setCategory] = useState<Category>("most_wins");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<BoardRow[]>([]);

  const loadSeq = useRef(0);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: "Leaderboards",
      headerStyle: { backgroundColor: BG },
      headerTintColor: "#fff",
      headerShadowVisible: false,
    });
  }, [navigation]);

  const venueAllowList = useMemo(() => {
    if (region === "ALL") return null;
    const venues = Object.keys(VENUE_TO_REGION).filter((v) => VENUE_TO_REGION[v] === region);
    return venues.length ? venues : null;
  }, [region]);

  useEffect(() => {
    if (!isReady || !supabase) return;
    const seq = ++loadSeq.current;
    setLoading(true);
    setErr(null);

    void (async () => {
      // Start from profiles so we can label rows.
      let profQuery = supabase
        .from("profiles")
        .select("id,first_name,last_name,username,nearest_venue,attended_count,confirmed_count,strike_count")
        .eq("approved", true)
        .order("attended_count", { ascending: false })
        .limit(400);

      if (venueAllowList) profQuery = profQuery.in("nearest_venue", venueAllowList);

      const profRes = await profQuery;
      if (loadSeq.current !== seq) return;
      if (profRes.error || !profRes.data) {
        setRows([]);
        setErr(profRes.error?.message ?? "Couldn’t load leaderboards.");
        setLoading(false);
        return;
      }

      const profiles = (profRes.data as ProfileRow[]).filter((p) => !!p.id);
      const ids = profiles.map((p) => p.id);

      // Simple categories that can be derived from profiles alone.
      if (category === "most_games") {
        const out = profiles
          .map((p) => ({
            userId: p.id,
            name: displayName(p),
            username: (p.username ?? "").trim() || null,
            valueSort: Math.max(0, Number(p.attended_count ?? 0) || 0),
            valueLabel: String(Math.max(0, Number(p.attended_count ?? 0) || 0)),
          }))
          .sort((a, b) => b.valueSort - a.valueSort)
          .slice(0, 10);
        setRows(out);
        setLoading(false);
        return;
      }

      if (category === "most_reliable") {
        const out = profiles
          .map((p) => {
            const confirmed = Math.max(0, Number(p.confirmed_count ?? 0) || 0);
            const attended = Math.max(0, Number(p.attended_count ?? 0) || 0);
            const score = confirmed > 0 ? (attended / confirmed) * 100 : 0;
            return {
              userId: p.id,
              name: displayName(p),
              username: (p.username ?? "").trim() || null,
              valueSort: score,
              valueLabel: confirmed >= 5 ? pct(score) : "—",
              confirmed,
            };
          })
          .filter((r) => r.confirmed >= 5)
          .sort((a, b) => b.valueSort - a.valueSort)
          .slice(0, 10)
          .map(({ confirmed, ...rest }) => rest);
        setRows(out);
        setLoading(false);
        return;
      }

      // For win/award leaderboards, compute from assignments + results.
      const { data: assignments, error: assignmentsError } = await supabase
        .from("pickup_run_team_assignments")
        .select("user_id,team,run_id")
        .in("user_id", ids)
        .limit(8000);

      if (loadSeq.current !== seq) return;
      if (assignmentsError || !assignments) {
        setRows([]);
        setErr(assignmentsError?.message ?? "Couldn’t load stats.");
        setLoading(false);
        return;
      }

      const base = new Map<string, { played: number; wins: number; potd: number; def: number; mid: number; att: number }>();
      for (const p of profiles) {
        base.set(p.id, { played: 0, wins: 0, potd: 0, def: 0, mid: 0, att: 0 });
      }

      const assignmentRows = assignments as unknown as Array<{ user_id: string; team: Team; run_id: string }>;
      const runIds = Array.from(new Set(assignmentRows.map((r) => r.run_id).filter(Boolean)));

      const CHUNK = 250;
      const resultsByRunId = new Map<
        string,
        {
          winning_team: Team | null;
          player_of_day: string | null;
          defender_of_day: string | null;
          midfielder_of_day: string | null;
          attacker_of_day: string | null;
        }
      >();

      for (let i = 0; i < runIds.length; i += CHUNK) {
        const chunk = runIds.slice(i, i + CHUNK);
        const { data: resRows, error: resErr } = await supabase
          .from("pickup_run_results")
          .select("run_id,winning_team,player_of_day,defender_of_day,midfielder_of_day,attacker_of_day")
          .in("run_id", chunk);
        if (loadSeq.current !== seq) return;
        if (resErr || !resRows) continue;
        for (const r of resRows as unknown as Array<{
          run_id: string;
          winning_team: Team | null;
          player_of_day: string | null;
          defender_of_day: string | null;
          midfielder_of_day: string | null;
          attacker_of_day: string | null;
        }>) {
          if (!r?.run_id) continue;
          resultsByRunId.set(r.run_id, {
            winning_team: r.winning_team ?? null,
            player_of_day: r.player_of_day ?? null,
            defender_of_day: r.defender_of_day ?? null,
            midfielder_of_day: r.midfielder_of_day ?? null,
            attacker_of_day: r.attacker_of_day ?? null,
          });
        }
      }

      for (const row of assignmentRows) {
        const uid = row.user_id;
        const agg = base.get(uid);
        if (!agg) continue;
        const res = resultsByRunId.get(row.run_id) ?? null;
        if (!res?.winning_team) continue;
        agg.played += 1;
        if (row.team === res.winning_team) agg.wins += 1;
        if (res.player_of_day === uid) agg.potd += 1;
        if (res.defender_of_day === uid) agg.def += 1;
        if (res.midfielder_of_day === uid) agg.mid += 1;
        if (res.attacker_of_day === uid) agg.att += 1;
      }

      const profById = new Map(profiles.map((p) => [p.id, p]));

      const out: BoardRow[] = [];
      for (const [uid, agg] of base.entries()) {
        const p = profById.get(uid);
        if (!p) continue;
        if (category === "most_wins") {
          out.push({
            userId: uid,
            name: displayName(p),
            username: (p.username ?? "").trim() || null,
            valueSort: agg.wins,
            valueLabel: String(agg.wins),
          });
        } else if (category === "highest_win_rate") {
          if (agg.played < 5) continue;
          const wr = (agg.wins / agg.played) * 100;
          out.push({
            userId: uid,
            name: displayName(p),
            username: (p.username ?? "").trim() || null,
            valueSort: wr,
            valueLabel: pct(wr),
          });
        } else if (category === "potd") {
          out.push({ userId: uid, name: displayName(p), username: (p.username ?? "").trim() || null, valueSort: agg.potd, valueLabel: String(agg.potd) });
        } else if (category === "def") {
          out.push({ userId: uid, name: displayName(p), username: (p.username ?? "").trim() || null, valueSort: agg.def, valueLabel: String(agg.def) });
        } else if (category === "mid") {
          out.push({ userId: uid, name: displayName(p), username: (p.username ?? "").trim() || null, valueSort: agg.mid, valueLabel: String(agg.mid) });
        } else if (category === "att") {
          out.push({ userId: uid, name: displayName(p), username: (p.username ?? "").trim() || null, valueSort: agg.att, valueLabel: String(agg.att) });
        }
      }

      out.sort((a, b) => b.valueSort - a.valueSort);
      setRows(out.slice(0, 10));
      setLoading(false);
    })();
  }, [isReady, supabase, venueAllowList, category]);

  const regionLabel = useMemo(() => (region === "ALL" ? "All" : region), [region]);
  const categoryLabel = useMemo(() => CATEGORY_OPTIONS.find((c) => c.id === category)?.label ?? "Leaderboards", [category]);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Text style={styles.h1}>Leaderboards</Text>
      <Text style={styles.sub}>Top 10 — win rate requires at least 5 games.</Text>

      <Text style={styles.filterLabel}>Region</Text>
      <View style={styles.chipRow}>
        {REGION_OPTIONS.map((r) => {
          const on = region === r;
          return (
            <Pressable key={r} onPress={() => setRegion(r)} style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && { opacity: 0.9 }]}>
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{r === "ALL" ? "All" : r}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.filterLabel}>Category</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRow}>
        {CATEGORY_OPTIONS.map((c) => {
          const on = category === c.id;
          return (
            <Pressable
              key={c.id}
              onPress={() => setCategory(c.id)}
              style={({ pressed }) => [styles.tab, on && styles.tabOn, pressed && { opacity: 0.9 }]}
            >
              <Text style={[styles.tabText, on && styles.tabTextOn]}>{c.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>{categoryLabel}</Text>
        <Text style={styles.headerSub}>{regionLabel}</Text>
      </View>

      {loading ? (
        <View style={styles.centerRow}>
          <ActivityIndicator color={LIME} />
          <Text style={styles.centerText}>Loading…</Text>
        </View>
      ) : err ? (
        <Text style={styles.errText}>{err}</Text>
      ) : rows.length === 0 ? (
        <Text style={styles.emptyText}>No data yet.</Text>
      ) : (
        <View style={styles.list}>
          {rows.map((r, idx) => (
            <Pressable
              key={r.userId}
              onPress={() => router.push(`/player/${encodeURIComponent(r.userId)}`)}
              style={({ pressed }) => [styles.rowCard, pressed && { opacity: 0.92 }]}
            >
              <View style={styles.rankWrap}>
                <Text style={styles.rank}>{idx + 1}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {r.name}
                </Text>
                <Text style={styles.username} numberOfLines={1}>
                  {r.username ? `@${r.username}` : "—"}
                </Text>
              </View>
              <View style={styles.valueWrap}>
                <Text style={styles.value}>{r.valueLabel}</Text>
                <FontAwesome name="chevron-right" size={14} color="rgba(255,255,255,0.35)" />
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: BG },
  content: { padding: 20, paddingBottom: 40 },
  h1: { fontSize: 26, fontWeight: "900", color: "#fff" },
  sub: { marginTop: 10, color: "rgba(255,255,255,0.55)", fontSize: 14, lineHeight: 20 },

  filterLabel: {
    marginTop: 18,
    marginBottom: 10,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.1,
    textTransform: "uppercase",
    color: "rgba(255,255,255,0.45)",
  },

  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  chip: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  chipOn: { borderColor: "rgba(163,230,53,0.55)", backgroundColor: "rgba(163,230,53,0.10)" },
  chipText: { color: "rgba(255,255,255,0.7)", fontWeight: "700", fontSize: 13 },
  chipTextOn: { color: LIME },

  tabRow: { gap: 10, paddingRight: 6 },
  tab: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  tabOn: { borderColor: "rgba(163,230,53,0.55)", backgroundColor: "rgba(163,230,53,0.12)" },
  tabText: { color: "rgba(255,255,255,0.65)", fontWeight: "800", fontSize: 13 },
  tabTextOn: { color: LIME },

  headerRow: { marginTop: 18, flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 10 },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "900" },
  headerSub: { color: "rgba(255,255,255,0.45)", fontWeight: "800" },

  centerRow: { marginTop: 18, flexDirection: "row", alignItems: "center", gap: 10 },
  centerText: { color: "rgba(255,255,255,0.55)", fontSize: 14 },
  errText: { marginTop: 18, color: "#fca5a5", fontSize: 14, lineHeight: 20 },
  emptyText: { marginTop: 18, color: "rgba(255,255,255,0.55)", fontSize: 14, lineHeight: 20 },

  list: { marginTop: 16, gap: 10 },
  rowCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  rankWrap: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
    backgroundColor: "rgba(163,230,53,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  rank: { color: LIME, fontWeight: "900" },
  name: { color: "#fff", fontWeight: "900", fontSize: 15 },
  username: { marginTop: 4, color: "rgba(255,255,255,0.55)", fontWeight: "700" },
  valueWrap: { flexDirection: "row", alignItems: "center", gap: 10 },
  value: { color: "#fff", fontWeight: "900", fontSize: 16 },
});

