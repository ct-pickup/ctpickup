import { useAuth } from "@/context/AuthContext";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useNavigation, useRouter } from "expo-router";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

const BG = "#0a0a0a";
const LIME = "#a3e635";

type Team = "A" | "B" | "C";

type HistoryRow = {
  run_id: string;
  team: Team;
  start_at: string | null;
  location_private: string | null;
  service_region: string | null;
  winning_team: Team | null;
  awards: string[];
};

function s(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function fmtDate(iso: string | null): string {
  const t = (iso ?? "").trim();
  if (!t) return "—";
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return t;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function venueSnippet(locationPrivate: string | null): string {
  const t = s(locationPrivate).replace(/\s+/g, " ").trim();
  if (!t) return "—";
  return t.length > 52 ? `${t.slice(0, 52)}…` : t;
}

export default function RunHistoryScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { session, supabase, isReady } = useAuth();

  const tokenUserId = session?.user?.id ?? null;

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<HistoryRow[]>([]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: "Run history",
      headerStyle: { backgroundColor: BG },
      headerTintColor: "#fff",
      headerShadowVisible: false,
    });
  }, [navigation]);

  useEffect(() => {
    if (!isReady || !supabase || !tokenUserId) {
      setLoading(false);
      setErr(!tokenUserId ? "Sign in to view run history." : "Missing Supabase client.");
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setErr(null);

      const { data, error } = await supabase
        .from("pickup_run_team_assignments")
        .select(
          "run_id,team,pickup_runs(start_at,location_private,service_region),pickup_run_results(winning_team,player_of_day,defender_of_day,midfielder_of_day,attacker_of_day)",
        )
        .eq("user_id", tokenUserId)
        .order("created_at", { ascending: false })
        .limit(250);

      if (cancelled) return;
      if (error || !data) {
        setRows([]);
        setErr(error?.message ?? "Couldn’t load history.");
        setLoading(false);
        return;
      }

      const out: HistoryRow[] = (data as unknown as Array<{
        run_id: string;
        team: Team;
        pickup_runs?: { start_at: string | null; location_private: string | null; service_region: string | null } | null;
        pickup_run_results?: {
          winning_team: Team | null;
          player_of_day: string | null;
          defender_of_day: string | null;
          midfielder_of_day: string | null;
          attacker_of_day: string | null;
        } | null;
      }>).map((r) => {
        const res = r.pickup_run_results ?? null;
        const awards: string[] = [];
        if (res?.player_of_day === tokenUserId) awards.push("POTD");
        if (res?.defender_of_day === tokenUserId) awards.push("DEF");
        if (res?.midfielder_of_day === tokenUserId) awards.push("MID");
        if (res?.attacker_of_day === tokenUserId) awards.push("ATT");
        return {
          run_id: r.run_id,
          team: r.team,
          start_at: r.pickup_runs?.start_at ?? null,
          location_private: r.pickup_runs?.location_private ?? null,
          service_region: r.pickup_runs?.service_region ?? null,
          winning_team: (res?.winning_team ?? null) as Team | null,
          awards,
        };
      });

      out.sort((a, b) => (s(b.start_at) || "0").localeCompare(s(a.start_at) || "0"));
      setRows(out);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [isReady, supabase, tokenUserId]);

  const empty = useMemo(() => !loading && !err && rows.length === 0, [loading, err, rows.length]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={LIME} />
      </View>
    );
  }

  if (err) {
    return (
      <View style={styles.center}>
        <Text style={styles.errText}>{err}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Text style={styles.h1}>Your runs</Text>
      <Text style={styles.sub}>Tap a run for details, outcome, and awards.</Text>

      {empty ? <Text style={styles.empty}>No completed runs yet.</Text> : null}

      <View style={styles.list}>
        {rows.map((r) => {
          const hasResult = r.winning_team != null;
          const won = hasResult ? r.team === r.winning_team : null;
          return (
            <Pressable
              key={r.run_id}
              onPress={() => router.push(`/run/${encodeURIComponent(r.run_id)}`)}
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.92 }]}
            >
              <View style={styles.cardTop}>
                <Text style={styles.date}>{fmtDate(r.start_at)}</Text>
                <FontAwesome name="chevron-right" size={14} color="rgba(255,255,255,0.35)" />
              </View>
              <Text style={styles.venue} numberOfLines={1}>
                {venueSnippet(r.location_private)}
              </Text>

              <View style={styles.metaRow}>
                <Text style={styles.meta}>
                  <Text style={styles.metaK}>Team</Text> {r.team}
                </Text>
                <Text style={styles.metaSep}>·</Text>
                <Text style={styles.meta}>
                  <Text style={styles.metaK}>Result</Text>{" "}
                  {won == null ? "—" : won ? "Won" : "Lost"}
                </Text>
                {r.awards.length ? (
                  <>
                    <Text style={styles.metaSep}>·</Text>
                    <Text style={styles.meta}>
                      <Text style={styles.metaK}>Awards</Text> {r.awards.join(", ")}
                    </Text>
                  </>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: BG },
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, backgroundColor: BG, justifyContent: "center", alignItems: "center", padding: 24 },
  errText: { color: "#fca5a5", fontSize: 15, textAlign: "center" },

  h1: { fontSize: 26, fontWeight: "900", color: "#fff" },
  sub: { marginTop: 10, color: "rgba(255,255,255,0.55)", fontSize: 14, lineHeight: 20 },

  empty: { marginTop: 18, color: "rgba(255,255,255,0.55)", fontSize: 14, lineHeight: 20 },

  list: { marginTop: 18, gap: 12 },
  card: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  date: { color: "#fff", fontWeight: "900", fontSize: 16 },
  venue: { marginTop: 8, color: "rgba(255,255,255,0.55)", fontWeight: "700" },

  metaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" },
  meta: { color: "rgba(255,255,255,0.72)", fontSize: 13, fontWeight: "600" },
  metaK: { color: "rgba(255,255,255,0.45)", fontWeight: "800" },
  metaSep: { color: "rgba(255,255,255,0.28)", fontWeight: "900" },
});

