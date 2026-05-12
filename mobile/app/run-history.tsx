import { useAuth } from "@/context/AuthContext";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useNavigation, useRouter } from "expo-router";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

const BG = "#0a0a0a";
const LIME = "#a3e635";

type Team = "A" | "B" | "C";

type AwardSlot = "player" | "goalie" | "attacker" | "midfielder" | "defender";

type AwardRowData = {
  slot: AwardSlot;
  label: string;
  userId: string | null;
  name: string | null;
};

const AWARD_ORDER: { slot: AwardSlot; label: string }[] = [
  { slot: "player", label: "Player of the Day" },
  { slot: "goalie", label: "Goalie of the Day" },
  { slot: "attacker", label: "Attacker of the Day" },
  { slot: "midfielder", label: "Midfielder of the Day" },
  { slot: "defender", label: "Defender of the Day" },
];

type HistoryRow = {
  run_id: string;
  team: Team;
  start_at: string | null;
  location_private: string | null;
  service_region: string | null;
  winning_team: Team | null;
  is_completed: boolean;
  myAwards: string[];
  awards: AwardRowData[];
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

      // NOTE: Don't use Supabase relational selects from assignments into results.
      // Both tables reference pickup_runs.id via run_id, not each other.
      const { data: assignments, error: assignmentsError } = await supabase
        .from("pickup_run_team_assignments")
        .select("run_id,team")
        .eq("user_id", tokenUserId)
        .order("created_at", { ascending: false })
        .limit(250);

      if (cancelled) return;
      if (assignmentsError || !assignments) {
        setRows([]);
        setErr(assignmentsError?.message ?? "Couldn’t load history.");
        setLoading(false);
        return;
      }

      const assignmentRows = assignments as unknown as Array<{ run_id: string; team: Team }>;
      const runIds = Array.from(new Set(assignmentRows.map((r) => r.run_id).filter(Boolean)));

      const CHUNK = 250;
      const runsById = new Map<
        string,
        {
          start_at: string | null;
          location_private: string | null;
          service_region: string | null;
          status: string | null;
          is_completed: boolean | null;
        }
      >();
      const resultsByRunId = new Map<
        string,
        {
          winning_team: Team | null;
          player_of_day: string | null;
          goalie_of_the_day: string | null;
          defender_of_day: string | null;
          midfielder_of_day: string | null;
          attacker_of_day: string | null;
        }
      >();

      for (let i = 0; i < runIds.length; i += CHUNK) {
        const chunk = runIds.slice(i, i + CHUNK);
        const { data: runRows, error: runsErr } = await supabase
          .from("pickup_runs")
          .select("id,start_at,location_private,service_region,status,is_completed")
          .in("id", chunk);
        if (cancelled) return;
        if (!runsErr && runRows) {
          for (const row of runRows as unknown as Array<{
            id: string;
            start_at: string | null;
            location_private: string | null;
            service_region: string | null;
            status: string | null;
            is_completed: boolean | null;
          }>) {
            if (!row?.id) continue;
            runsById.set(row.id, {
              start_at: row.start_at ?? null,
              location_private: row.location_private ?? null,
              service_region: row.service_region ?? null,
              status: row.status ?? null,
              is_completed: row.is_completed ?? null,
            });
          }
        }
        const { data: resRows, error: resErr } = await supabase
          .from("pickup_run_results")
          .select("run_id,winning_team,player_of_day,goalie_of_the_day,defender_of_day,midfielder_of_day,attacker_of_day")
          .in("run_id", chunk);
        if (cancelled) return;
        if (!resErr && resRows) {
          for (const r of resRows as unknown as Array<{
            run_id: string;
            winning_team: Team | null;
            player_of_day: string | null;
            goalie_of_the_day: string | null;
            defender_of_day: string | null;
            midfielder_of_day: string | null;
            attacker_of_day: string | null;
          }>) {
            if (!r?.run_id) continue;
            resultsByRunId.set(r.run_id, {
              winning_team: r.winning_team ?? null,
              player_of_day: r.player_of_day ?? null,
              goalie_of_the_day: r.goalie_of_the_day ?? null,
              defender_of_day: r.defender_of_day ?? null,
              midfielder_of_day: r.midfielder_of_day ?? null,
              attacker_of_day: r.attacker_of_day ?? null,
            });
          }
        }
      }

      // Collect all award user_ids across runs and resolve names in one batch.
      const allAwardUserIds = new Set<string>();
      for (const r of resultsByRunId.values()) {
        for (const v of [
          r.player_of_day,
          r.goalie_of_the_day,
          r.attacker_of_day,
          r.midfielder_of_day,
          r.defender_of_day,
        ]) {
          if (typeof v === "string" && v.length > 0) allAwardUserIds.add(v);
        }
      }
      const nameById = new Map<string, string>();
      const awardIds = Array.from(allAwardUserIds);
      for (let i = 0; i < awardIds.length; i += CHUNK) {
        const chunk = awardIds.slice(i, i + CHUNK);
        const profs = await supabase.from("profiles").select("id,full_name,username").in("id", chunk);
        if (cancelled) return;
        if (profs.data) {
          for (const p of profs.data as Array<{ id: string; full_name: string | null; username: string | null }>) {
            const nm = (p.full_name ?? "").trim() || (p.username ?? "").trim() || p.id;
            nameById.set(p.id, nm);
          }
        }
      }

      const out: HistoryRow[] = assignmentRows.map((r) => {
        const run = runsById.get(r.run_id) ?? null;
        const res = resultsByRunId.get(r.run_id) ?? null;
        const myAwards: string[] = [];
        if (res?.player_of_day === tokenUserId) myAwards.push("POTD");
        if (res?.goalie_of_the_day === tokenUserId) myAwards.push("GOTD");
        if (res?.defender_of_day === tokenUserId) myAwards.push("DEF");
        if (res?.midfielder_of_day === tokenUserId) myAwards.push("MID");
        if (res?.attacker_of_day === tokenUserId) myAwards.push("ATT");

        const slotToUserId: Record<AwardSlot, string | null> = {
          player: res?.player_of_day ?? null,
          goalie: res?.goalie_of_the_day ?? null,
          attacker: res?.attacker_of_day ?? null,
          midfielder: res?.midfielder_of_day ?? null,
          defender: res?.defender_of_day ?? null,
        };
        const awards: AwardRowData[] = AWARD_ORDER.map(({ slot, label }) => {
          const uid = slotToUserId[slot];
          return {
            slot,
            label,
            userId: uid,
            name: uid ? nameById.get(uid) ?? null : null,
          };
        });

        const is_completed =
          run?.is_completed === true || String(run?.status || "").trim().toLowerCase() === "completed";

        return {
          run_id: r.run_id,
          team: r.team,
          start_at: run?.start_at ?? null,
          location_private: run?.location_private ?? null,
          service_region: run?.service_region ?? null,
          winning_team: (res?.winning_team ?? null) as Team | null,
          is_completed,
          myAwards,
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
          const showResults = r.is_completed && hasResult;
          const hasAnyAwardWinner = r.awards.some((a) => a.userId != null);
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
                {r.myAwards.length ? (
                  <>
                    <Text style={styles.metaSep}>·</Text>
                    <Text style={styles.meta}>
                      <Text style={styles.metaK}>Awards</Text> {r.myAwards.join(", ")}
                    </Text>
                  </>
                ) : null}
              </View>

              {showResults ? (
                <Text style={styles.winningTeamHeadline}>🏆 Team {r.winning_team} won</Text>
              ) : null}

              {showResults && hasAnyAwardWinner ? (
                <View style={styles.awardsBlock}>
                  {r.awards.map((a) => (
                    <View key={a.slot} style={styles.awardRow}>
                      <Text style={styles.awardLabel}>{a.label}:</Text>
                      {a.userId && a.name ? (
                        <Pressable
                          onPress={(e) => {
                            e.stopPropagation();
                            router.push(`/player/${encodeURIComponent(a.userId!)}`);
                          }}
                          accessibilityRole="link"
                          accessibilityLabel={`Open profile for ${a.name}`}
                          style={({ pressed }) => [styles.awardNameWrap, pressed && { opacity: 0.85 }]}
                        >
                          <Text style={styles.awardName} numberOfLines={1}>
                            {a.name}
                          </Text>
                        </Pressable>
                      ) : (
                        <Text style={styles.awardNameMuted}>—</Text>
                      )}
                    </View>
                  ))}
                </View>
              ) : null}
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

  winningTeamHeadline: {
    marginTop: 12,
    color: LIME,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  awardsBlock: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
    gap: 6,
  },
  awardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  awardLabel: { color: "rgba(255,255,255,0.6)", fontWeight: "700", fontSize: 13 },
  awardNameWrap: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
    backgroundColor: "rgba(163,230,53,0.10)",
  },
  awardName: { color: LIME, fontWeight: "900", fontSize: 13 },
  awardNameMuted: { color: "rgba(255,255,255,0.4)", fontWeight: "700", fontSize: 13 },
});
