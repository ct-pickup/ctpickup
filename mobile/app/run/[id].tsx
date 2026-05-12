import { useAuth } from "@/context/AuthContext";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

const BG = "#0a0a0a";
const LIME = "#a3e635";

type Team = "A" | "B" | "C";

function s(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function fmtLong(iso: string | null): string {
  const t = (iso ?? "").trim();
  if (!t) return "—";
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return t;
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function venueLine(locationPrivate: string | null): string {
  const t = s(locationPrivate).replace(/\s+/g, " ").trim();
  return t || "—";
}

export default function RunDetailScreen() {
  const { id: raw } = useLocalSearchParams<{ id: string | string[] }>();
  const runId = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : "";
  const navigation = useNavigation();
  const { session, supabase, isReady } = useAuth();

  const userId = session?.user?.id ?? null;

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [startAt, setStartAt] = useState<string | null>(null);
  const [locationPrivate, setLocationPrivate] = useState<string | null>(null);
  const [serviceRegion, setServiceRegion] = useState<string | null>(null);

  const [myTeam, setMyTeam] = useState<Team | null>(null);
  const [winningTeam, setWinningTeam] = useState<Team | null>(null);
  const [awards, setAwards] = useState<string[]>([]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: "Run",
      headerStyle: { backgroundColor: BG },
      headerTintColor: "#fff",
      headerShadowVisible: false,
    });
  }, [navigation]);

  useEffect(() => {
    if (!isReady || !supabase || !userId || !runId) {
      setLoading(false);
      setErr(!userId ? "Sign in to view runs." : "Missing run.");
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setErr(null);

      const [runRes, myRes, resRes] = await Promise.all([
        supabase.from("pickup_runs").select("id,start_at,location_private,service_region").eq("id", runId).maybeSingle(),
        supabase
          .from("pickup_run_team_assignments")
          .select("team")
          .eq("run_id", runId)
          .eq("user_id", userId)
          .maybeSingle(),
        supabase
          .from("pickup_run_results")
          .select("winning_team,player_of_day,goalie_of_the_day,defender_of_day,midfielder_of_day,attacker_of_day")
          .eq("run_id", runId)
          .maybeSingle(),
      ]);

      if (cancelled) return;
      if (runRes.error) {
        setErr(runRes.error.message ?? "Couldn’t load run.");
        setLoading(false);
        return;
      }

      const run = runRes.data as null | { start_at: string | null; location_private: string | null; service_region: string | null };
      setStartAt(run?.start_at ?? null);
      setLocationPrivate(run?.location_private ?? null);
      setServiceRegion(run?.service_region ?? null);

      const mt = myRes.data ? ((myRes.data as { team?: unknown }).team as Team) : null;
      setMyTeam(mt ?? null);

      const rr = resRes.data as
        | null
        | {
            winning_team: Team | null;
            player_of_day: string | null;
            goalie_of_the_day: string | null;
            defender_of_day: string | null;
            midfielder_of_day: string | null;
            attacker_of_day: string | null;
          };

      const wt = rr?.winning_team ?? null;
      setWinningTeam(wt);

      const earned: string[] = [];
      if (rr?.player_of_day === userId) earned.push("Player of the Day");
      if (rr?.goalie_of_the_day === userId) earned.push("Goalie of the Day 🧤");
      if (rr?.defender_of_day === userId) earned.push("Defender of the Day");
      if (rr?.midfielder_of_day === userId) earned.push("Midfielder of the Day");
      if (rr?.attacker_of_day === userId) earned.push("Attacker of the Day");
      setAwards(earned);

      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [isReady, supabase, userId, runId]);

  const outcome = useMemo(() => {
    if (!myTeam || !winningTeam) return null;
    return myTeam === winningTeam ? "Won" : "Lost";
  }, [myTeam, winningTeam]);

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
      <Text style={styles.h1}>Run details</Text>
      <Text style={styles.sub}>
        {fmtLong(startAt)}
        {"\n"}
        {serviceRegion ? `Region: ${serviceRegion}` : "Region: —"}
      </Text>

      <View style={styles.card}>
        <Text style={styles.label}>Venue</Text>
        <Text style={styles.value}>{venueLine(locationPrivate)}</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Your team</Text>
            <Text style={styles.value}>{myTeam ?? "—"}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Winning team</Text>
            <Text style={styles.value}>{winningTeam ?? "—"}</Text>
          </View>
        </View>
        {outcome ? (
          <View style={[styles.pill, outcome === "Won" ? styles.pillWin : styles.pillLoss]}>
            <FontAwesome name={outcome === "Won" ? "trophy" : "flag"} size={14} color={outcome === "Won" ? "#111" : "#fff"} />
            <Text style={[styles.pillText, outcome === "Won" ? styles.pillTextWin : styles.pillTextLoss]}>
              {outcome}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Awards</Text>
        {awards.length === 0 ? <Text style={styles.valueMuted}>—</Text> : awards.map((a) => <Text key={a} style={styles.value}>{a}</Text>)}
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

  card: {
    marginTop: 14,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  row: { flexDirection: "row", gap: 12 },
  label: { fontSize: 11, fontWeight: "800", letterSpacing: 1.1, color: "rgba(255,255,255,0.45)", textTransform: "uppercase" },
  value: { marginTop: 8, color: "#fff", fontSize: 16, fontWeight: "800" },
  valueMuted: { marginTop: 8, color: "rgba(255,255,255,0.55)", fontSize: 16, fontWeight: "700" },

  pill: { marginTop: 14, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
  pillWin: { borderColor: "rgba(163,230,53,0.55)", backgroundColor: LIME },
  pillLoss: { borderColor: "rgba(248,113,113,0.45)", backgroundColor: "rgba(248,113,113,0.10)" },
  pillText: { fontWeight: "900", fontSize: 13 },
  pillTextWin: { color: "#111" },
  pillTextLoss: { color: "#fff" },
});

