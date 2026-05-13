import { useAuth } from "@/context/AuthContext";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useNavigation, useRouter } from "expo-router";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextStyle, View } from "react-native";

const BG = "#0a0a0a";
const LIME = "#a3e635";
const MUTED = "rgba(255,255,255,0.45)";

type Team = "A" | "B" | "C";

type AwardSlot = "player" | "goalie" | "attacker" | "midfielder" | "defender";

const AWARD_META: { slot: AwardSlot; emoji: string; label: string }[] = [
  { slot: "player", emoji: "🏆", label: "Player of the Day" },
  { slot: "goalie", emoji: "🧤", label: "Goalie of the Day" },
  { slot: "attacker", emoji: "⚽", label: "Attacker of the Day" },
  { slot: "midfielder", emoji: "🎯", label: "Midfielder of the Day" },
  { slot: "defender", emoji: "🛡️", label: "Defender of the Day" },
];

type HistoryRow = {
  run_id: string;
  run_title: string | null;
  team: Team | null;
  start_at: string | null;
  venue_label: string | null;
  winning_team: Team | null;
  /** Full lines like "🏆 Player of the Day" for awards the viewer won */
  myAwardLines: string[];
};

function s(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Eastern Time, e.g. "May 11, 2026 · 8:15 PM" */
function fmtEtDateTime(iso: string | null): string {
  const t = (iso ?? "").trim();
  if (!t) return "—";
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return t;
  const datePart = d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timePart = d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${datePart} · ${timePart}`;
}

function venueSnippet(label: string | null): string {
  const t = s(label).replace(/\s+/g, " ").trim();
  if (!t) return "No venue listed";
  return t.length > 52 ? `${t.slice(0, 52)}…` : t;
}

function pickVenueName(run: {
  venue?: unknown;
  nearest_venue?: unknown;
  location_text?: unknown;
  location_private?: unknown;
}): string | null {
  for (const key of ["venue", "nearest_venue", "location_text", "location_private"] as const) {
    const raw = run[key];
    const t = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
    if (t) return t;
  }
  return null;
}

function teamLabel(team: Team | null): string {
  if (team == null) return "Not assigned";
  return `Team ${team}`;
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

      const { data: rsvpRows, error: rsvpErr } = await supabase
        .from("pickup_run_rsvps")
        .select("run_id")
        .eq("user_id", tokenUserId)
        .eq("status", "confirmed")
        .limit(500);

      if (cancelled) return;
      if (rsvpErr || !rsvpRows) {
        setRows([]);
        setErr(rsvpErr?.message ?? "Couldn’t load history.");
        setLoading(false);
        return;
      }

      const runIdsOrdered: string[] = [];
      const seen = new Set<string>();
      for (const row of rsvpRows as unknown as Array<{ run_id: string | null }>) {
        const id = row?.run_id ? String(row.run_id) : "";
        if (!id || seen.has(id)) continue;
        seen.add(id);
        runIdsOrdered.push(id);
      }

      if (runIdsOrdered.length === 0) {
        setRows([]);
        setLoading(false);
        return;
      }

      const CHUNK = 250;
      const runsById = new Map<
        string,
        {
          title: string | null;
          start_at: string | null;
          venue_label: string | null;
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
      const teamByRunId = new Map<string, Team>();

      for (let i = 0; i < runIdsOrdered.length; i += CHUNK) {
        const chunk = runIdsOrdered.slice(i, i + CHUNK);

        const { data: runRows, error: runsErr } = await supabase
          .from("pickup_runs")
          .select("id,title,start_at,venue,nearest_venue,location_text,location_private")
          .in("id", chunk);
        if (cancelled) return;
        if (runsErr) {
          const fallback = await supabase
            .from("pickup_runs")
            .select("id,title,start_at,location_text,location_private")
            .in("id", chunk);
          if (cancelled) return;
          if (fallback.error || !fallback.data) {
            setRows([]);
            setErr(runsErr.message ?? fallback.error?.message ?? "Couldn’t load runs.");
            setLoading(false);
            return;
          }
          for (const row of fallback.data as unknown as Array<{
            id: string;
            title: string | null;
            start_at: string | null;
            location_text: string | null;
            location_private: string | null;
          }>) {
            if (!row?.id) continue;
            runsById.set(row.id, {
              title: row.title ?? null,
              start_at: row.start_at ?? null,
              venue_label: pickVenueName(row),
            });
          }
        } else if (runRows) {
          for (const row of runRows as unknown as Array<{
            id: string;
            title: string | null;
            start_at: string | null;
            venue?: string | null;
            nearest_venue?: string | null;
            location_text: string | null;
            location_private: string | null;
          }>) {
            if (!row?.id) continue;
            runsById.set(row.id, {
              title: row.title ?? null,
              start_at: row.start_at ?? null,
              venue_label: pickVenueName(row),
            });
          }
        }

        const { data: assignRows, error: assignErr } = await supabase
          .from("pickup_run_team_assignments")
          .select("run_id,team")
          .eq("user_id", tokenUserId)
          .in("run_id", chunk);
        if (cancelled) return;
        if (!assignErr && assignRows) {
          for (const a of assignRows as unknown as Array<{ run_id: string; team: Team }>) {
            if (a?.run_id && (a.team === "A" || a.team === "B" || a.team === "C")) {
              teamByRunId.set(a.run_id, a.team);
            }
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

      const out: HistoryRow[] = runIdsOrdered.map((run_id) => {
        const run = runsById.get(run_id) ?? null;
        const res = resultsByRunId.get(run_id) ?? null;
        const team = teamByRunId.get(run_id) ?? null;

        const slotToUserId: Record<AwardSlot, string | null> = {
          player: res?.player_of_day ?? null,
          goalie: res?.goalie_of_the_day ?? null,
          attacker: res?.attacker_of_day ?? null,
          midfielder: res?.midfielder_of_day ?? null,
          defender: res?.defender_of_day ?? null,
        };

        const myAwardLines: string[] = [];
        for (const { slot, emoji, label } of AWARD_META) {
          if (slotToUserId[slot] === tokenUserId) {
            myAwardLines.push(`${emoji} ${label}`);
          }
        }

        return {
          run_id,
          run_title: run?.title ?? null,
          team,
          start_at: run?.start_at ?? null,
          venue_label: run?.venue_label ?? null,
          winning_team: (res?.winning_team ?? null) as Team | null,
          myAwardLines,
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

  const stats = useMemo(() => {
    let wins = 0;
    let losses = 0;
    for (const r of rows) {
      if (r.winning_team == null || r.team == null) continue;
      if (r.team === r.winning_team) wins++;
      else losses++;
    }
    const decided = wins + losses;
    const winRatePct = decided > 0 ? Math.round((wins / decided) * 100) : null;
    return { total: rows.length, wins, losses, winRatePct };
  }, [rows]);

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
      <Text style={styles.h1}>Run history</Text>
      <Text style={styles.sub}>Confirmed pickups, newest first. Times are US Eastern.</Text>

      {!empty ? (
        <View style={styles.statsCard}>
          <Text style={styles.statsTitle}>Summary</Text>
          <View style={styles.statsGrid}>
            <View style={styles.statCell}>
              <Text style={styles.statValue}>{stats.total}</Text>
              <Text style={styles.statLabel}>Games</Text>
            </View>
            <View style={styles.statCell}>
              <Text style={[styles.statValue, { color: LIME }]}>{stats.wins}</Text>
              <Text style={styles.statLabel}>Wins</Text>
            </View>
            <View style={styles.statCell}>
              <Text style={[styles.statValue, { color: MUTED }]}>{stats.losses}</Text>
              <Text style={styles.statLabel}>Losses</Text>
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statValue}>
                {stats.winRatePct != null ? `${stats.winRatePct}%` : "—"}
              </Text>
              <Text style={styles.statLabel}>Win rate</Text>
            </View>
          </View>
          <Text style={styles.statsFoot}>
            Win rate uses games with a posted result and a team assignment for you.
          </Text>
        </View>
      ) : null}

      {empty ? <Text style={styles.empty}>No confirmed runs yet.</Text> : null}

      <View style={styles.list}>
        {rows.map((r) => {
          const hasResult = r.winning_team != null;
          const canScore = hasResult && r.team != null;
          const won = canScore ? r.team === r.winning_team : null;

          let resultLabel: string;
          let resultExtraStyle: TextStyle;
          if (!hasResult) {
            resultLabel = "Result pending";
            resultExtraStyle = styles.resultPending;
          } else if (r.team == null) {
            resultLabel = "—";
            resultExtraStyle = styles.resultLoss;
          } else if (won) {
            resultLabel = "Win 🏆";
            resultExtraStyle = styles.resultWin;
          } else {
            resultLabel = "Loss";
            resultExtraStyle = styles.resultLoss;
          }

          return (
            <Pressable
              key={r.run_id}
              onPress={() => router.push(`/run/${encodeURIComponent(r.run_id)}`)}
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.92 }]}
            >
              <View style={styles.cardTop}>
                <Text style={styles.date}>{fmtEtDateTime(r.start_at)}</Text>
                <FontAwesome name="chevron-right" size={14} color="rgba(255,255,255,0.35)" />
              </View>
              {r.run_title ? (
                <Text style={styles.runTitle} numberOfLines={2}>
                  {r.run_title}
                </Text>
              ) : null}
              <Text style={styles.venue} numberOfLines={1}>
                {venueSnippet(r.venue_label)}
              </Text>

              <View style={styles.resultRow}>
                <Text style={[styles.resultText, resultExtraStyle]}>{resultLabel}</Text>
              </View>

              <Text style={styles.teamLine}>
                <Text style={styles.metaK}>Team: </Text>
                <Text style={styles.teamValue}>{teamLabel(r.team)}</Text>
              </Text>

              {r.myAwardLines.length ? (
                <View style={styles.myAwards}>
                  {r.myAwardLines.map((line) => (
                    <Text key={line} style={styles.awardLine}>
                      {line}
                    </Text>
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

  statsCard: {
    marginTop: 20,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  statsTitle: { color: "#fff", fontWeight: "900", fontSize: 15, marginBottom: 12 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  statCell: { flexGrow: 1, minWidth: "42%", paddingVertical: 4 },
  statValue: { color: "#fff", fontSize: 22, fontWeight: "900" },
  statLabel: { marginTop: 4, color: "rgba(255,255,255,0.5)", fontSize: 12, fontWeight: "700" },
  statsFoot: { marginTop: 12, color: "rgba(255,255,255,0.4)", fontSize: 12, lineHeight: 17 },

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
  date: { color: "#fff", fontWeight: "900", fontSize: 15, flex: 1 },
  runTitle: { marginTop: 6, color: "rgba(255,255,255,0.85)", fontWeight: "800", fontSize: 14, lineHeight: 19 },
  venue: { marginTop: 6, color: "rgba(255,255,255,0.55)", fontWeight: "700" },

  resultRow: { marginTop: 12 },
  resultText: { fontSize: 16, fontWeight: "900" },
  resultWin: { color: LIME },
  resultLoss: { color: MUTED },
  resultPending: { color: MUTED, fontWeight: "800" },

  teamLine: { marginTop: 10, fontSize: 14 },
  metaK: { color: "rgba(255,255,255,0.45)", fontWeight: "800" },
  teamValue: { color: "rgba(255,255,255,0.85)", fontWeight: "800" },

  myAwards: { marginTop: 10, gap: 4 },
  awardLine: { color: LIME, fontWeight: "800", fontSize: 14 },
});
