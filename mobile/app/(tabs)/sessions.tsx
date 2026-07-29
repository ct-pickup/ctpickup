import { useAuth } from "@/context/AuthContext";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const BG = "#0a0a0a";
const LIME = "#a3e635";
const CARD = "rgba(255,255,255,0.04)";
const CARD_BORDER = "rgba(255,255,255,0.08)";
const MUTED = "rgba(255,255,255,0.45)";

type UpcomingRow = {
  run_id: string;
  title: string | null;
  start_at: string | null;
  location: string | null;
  capacity: number;
  spots_taken: number;
  fee_cents: number;
};

type PastRow = {
  run_id: string;
  title: string | null;
  start_at: string | null;
  location: string | null;
  result: "Won" | "Lost" | "Completed" | null;
  awards: string[];
};

const TIER_PTS: Record<string, number> = {
  diamond: 8,
  platinum: 6,
  gold: 4,
  silver: 2,
  bronze: 0,
};

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function fmtFee(cents: number): string {
  if (!cents || cents <= 0) return "Free";
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

export default function SessionsTabScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session, supabase, isReady } = useAuth();
  const uid = session?.user?.id ?? null;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [upcoming, setUpcoming] = useState<UpcomingRow[]>([]);
  const [past, setPast] = useState<PastRow[]>([]);
  const [sessionsPlayed, setSessionsPlayed] = useState(0);
  const [wins, setWins] = useState(0);
  const [losses, setLosses] = useState(0);
  const [points, setPoints] = useState(0);

  const load = useCallback(async () => {
    if (!isReady || !supabase || !uid) {
      setUpcoming([]);
      setPast([]);
      setLoading(false);
      return;
    }

    try {
      // Stats: player_ratings + profiles (same sources as account).
      const [ratingRes, profileRes] = await Promise.all([
        supabase
          .from("player_ratings")
          .select("tier,sessions,score")
          .eq("user_id", uid)
          .maybeSingle(),
        supabase
          .from("profiles")
          .select("pickup_wins_count,pickup_losses_count")
          .eq("id", uid)
          .maybeSingle(),
      ]);

      const rating = ratingRes.data as {
        tier?: string | null;
        sessions?: number | null;
        score?: number | null;
      } | null;
      const profile = profileRes.data as {
        pickup_wins_count?: number | null;
        pickup_losses_count?: number | null;
      } | null;

      const sessionsCount = Math.max(0, Math.trunc(Number(rating?.sessions ?? 0)));
      const winsCount = Math.max(0, Math.trunc(Number(profile?.pickup_wins_count ?? 0)));
      const lossesCount = Math.max(0, Math.trunc(Number(profile?.pickup_losses_count ?? 0)));
      const tier = (rating?.tier ?? "bronze").toLowerCase();
      const tierPts = TIER_PTS[tier] ?? 0;
      setSessionsPlayed(sessionsCount);
      setWins(winsCount);
      setLosses(lossesCount);
      setPoints(sessionsCount * tierPts * 10);

      // Query 1: confirmed RSVPs (no join).
      const { data: rsvpData } = await supabase
        .from("pickup_run_rsvps")
        .select("run_id")
        .eq("user_id", uid)
        .eq("status", "confirmed")
        .limit(200);

      const runIds = Array.from(
        new Set(
          ((rsvpData ?? []) as Array<{ run_id: string | null }>)
            .map((r) => r.run_id)
            .filter((v): v is string => Boolean(v)),
        ),
      );

      if (!runIds.length) {
        setUpcoming([]);
        setPast([]);
        return;
      }

      // Query 2: run details for those ids.
      const { data: runsData } = await supabase
        .from("pickup_runs")
        .select("id,title,start_at,location_text,capacity,spots_taken,fee_cents,status")
        .in("id", runIds);

      const runs = (runsData ?? []) as Array<{
        id: string;
        title: string | null;
        start_at: string | null;
        location_text: string | null;
        capacity: number | null;
        spots_taken: number | null;
        fee_cents: number | null;
        status: string | null;
      }>;

      const now = Date.now();
      const upcomingRows = runs
        .filter((r) => {
          const t = r.start_at ? new Date(r.start_at).getTime() : NaN;
          return Number.isFinite(t) && t > now;
        })
        .sort((a, b) => String(a.start_at ?? "").localeCompare(String(b.start_at ?? "")))
        .slice(0, 5)
        .map(
          (r): UpcomingRow => ({
            run_id: r.id,
            title: r.title,
            start_at: r.start_at,
            location: (r.location_text ?? "").trim() || null,
            capacity: Math.max(0, Number(r.capacity ?? 0)),
            spots_taken: Math.max(0, Number(r.spots_taken ?? 0)),
            fee_cents: Math.max(0, Number(r.fee_cents ?? 0)),
          }),
        );

      const pastRuns = runs
        .filter((r) => {
          const t = r.start_at ? new Date(r.start_at).getTime() : NaN;
          return Number.isFinite(t) && t <= now;
        })
        .sort((a, b) => String(b.start_at ?? "").localeCompare(String(a.start_at ?? "")))
        .slice(0, 20);

      const pastIds = pastRuns.map((r) => r.id);
      let teamByRun = new Map<string, string>();
      let resultByRun = new Map<
        string,
        {
          winning_team: string | null;
          player_of_day: string | null;
          goalie_of_the_day: string | null;
          defender_of_day: string | null;
          midfielder_of_day: string | null;
          attacker_of_day: string | null;
        }
      >();

      if (pastIds.length) {
        const [{ data: assigns }, { data: results }] = await Promise.all([
          supabase
            .from("pickup_run_team_assignments")
            .select("run_id,team")
            .eq("user_id", uid)
            .in("run_id", pastIds),
          supabase
            .from("pickup_run_results")
            .select(
              "run_id,winning_team,player_of_day,goalie_of_the_day,defender_of_day,midfielder_of_day,attacker_of_day",
            )
            .in("run_id", pastIds),
        ]);

        teamByRun = new Map();
        for (const a of (assigns ?? []) as Array<{ run_id: string; team: string }>) {
          if (a?.run_id && a.team) teamByRun.set(a.run_id, a.team);
        }
        resultByRun = new Map();
        for (const r of (results ?? []) as Array<{
          run_id: string;
          winning_team: string | null;
          player_of_day: string | null;
          goalie_of_the_day: string | null;
          defender_of_day: string | null;
          midfielder_of_day: string | null;
          attacker_of_day: string | null;
        }>) {
          if (r?.run_id) resultByRun.set(r.run_id, r);
        }
      }

      const pastRows = pastRuns.map((r): PastRow => {
        const res = resultByRun.get(r.id) ?? null;
        const team = teamByRun.get(r.id) ?? null;
        let result: PastRow["result"] = null;
        if (res?.winning_team && team) {
          result = team === res.winning_team ? "Won" : "Lost";
        } else if (res || r.status === "completed") {
          result = "Completed";
        }
        const awards: string[] = [];
        if (res?.player_of_day === uid) awards.push("POTD");
        if (res?.goalie_of_the_day === uid) awards.push("Goalie");
        if (res?.defender_of_day === uid) awards.push("Defender");
        if (res?.midfielder_of_day === uid) awards.push("Midfielder");
        if (res?.attacker_of_day === uid) awards.push("Attacker");
        return {
          run_id: r.id,
          title: r.title,
          start_at: r.start_at,
          location: (r.location_text ?? "").trim() || null,
          result,
          awards,
        };
      });

      setUpcoming(upcomingRows);
      setPast(pastRows);
    } catch (e) {
      console.error("[sessions tab load]", e);
    } finally {
      setLoading(false);
    }
  }, [isReady, supabase, uid]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const gamesPlayed = wins + losses;
  const winPct = gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 100) : null;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Text style={styles.header}>Sessions</Text>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={LIME} />
        }
      >
        {/* Stats bar */}
        <View style={styles.statsBar}>
          <View style={styles.statCell}>
            <Text style={styles.statValue}>{sessionsPlayed}</Text>
            <Text style={styles.statLabel}>Sessions</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statValue}>{wins}</Text>
            <Text style={styles.statLabel}>Wins</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statValue}>{winPct == null ? "—" : `${winPct}%`}</Text>
            <Text style={styles.statLabel}>Win %</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
              {points.toLocaleString()}
            </Text>
            <Text style={styles.statLabel}>Points</Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={LIME} />
          </View>
        ) : (
          <>
            {/* Upcoming */}
            <Text style={styles.sectionTitle}>Upcoming</Text>
            {upcoming.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>No upcoming sessions. Find a run →</Text>
                <Pressable
                  onPress={() => (router.push as (href: string) => void)("/session-map")}
                  style={styles.findBtn}
                >
                  <Text style={styles.findBtnText}>Find a run →</Text>
                </Pressable>
              </View>
            ) : (
              <View style={{ gap: 10 }}>
                {upcoming.map((row) => {
                  const spotsLeft = Math.max(0, row.capacity - row.spots_taken);
                  return (
                    <Pressable
                      key={row.run_id}
                      onPress={() =>
                        (router.push as (href: string) => void)(
                          `/session/${encodeURIComponent(row.run_id)}`,
                        )
                      }
                      style={styles.card}
                    >
                      <Text style={styles.cardMeta}>{fmtDateTime(row.start_at)}</Text>
                      <Text style={styles.cardTitle} numberOfLines={2}>
                        {row.title || "Session"}
                      </Text>
                      {row.location ? (
                        <Text style={styles.cardMeta} numberOfLines={1}>
                          {row.location}
                        </Text>
                      ) : null}
                      <View style={styles.cardFooter}>
                        <Text style={styles.cardChip}>
                          {spotsLeft} spot{spotsLeft === 1 ? "" : "s"} left
                        </Text>
                        <Text style={styles.cardChipLime}>{fmtFee(row.fee_cents)}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {/* Past */}
            <Text style={[styles.sectionTitle, { marginTop: 28 }]}>Past Sessions</Text>
            {past.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>No past sessions yet.</Text>
              </View>
            ) : (
              <View style={{ gap: 10 }}>
                {past.map((row) => {
                  const badgeColor =
                    row.result === "Won"
                      ? LIME
                      : row.result === "Lost"
                        ? "#ef4444"
                        : "rgba(255,255,255,0.4)";
                  return (
                    <Pressable
                      key={row.run_id}
                      onPress={() =>
                        (router.push as (href: string) => void)(
                          `/run/${encodeURIComponent(row.run_id)}`,
                        )
                      }
                      style={styles.card}
                    >
                      <View style={styles.pastTop}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.cardMeta}>{fmtDate(row.start_at)}</Text>
                          <Text style={styles.cardTitle} numberOfLines={2}>
                            {row.title || "Session"}
                          </Text>
                          {row.location ? (
                            <Text style={styles.cardMeta} numberOfLines={1}>
                              {row.location}
                            </Text>
                          ) : null}
                        </View>
                        {row.result ? (
                          <Text style={[styles.resultBadge, { color: badgeColor }]}>
                            {row.result}
                          </Text>
                        ) : null}
                      </View>
                      {row.awards.length > 0 ? (
                        <Text style={styles.awards} numberOfLines={1}>
                          {row.awards.join(" · ")}
                        </Text>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  header: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.4,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  content: { paddingHorizontal: 16, paddingBottom: 120 },
  statsBar: {
    flexDirection: "row",
    backgroundColor: CARD,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    paddingVertical: 14,
    marginBottom: 22,
  },
  statCell: { flex: 1, alignItems: "center", gap: 4 },
  statValue: { color: "#fff", fontSize: 18, fontWeight: "800" },
  statLabel: { color: MUTED, fontSize: 11, fontWeight: "600" },
  sectionTitle: {
    color: LIME,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  loadingWrap: { paddingVertical: 40, alignItems: "center" },
  emptyCard: {
    backgroundColor: CARD,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 16,
    gap: 12,
  },
  emptyText: { color: MUTED, fontSize: 14, lineHeight: 20 },
  findBtn: {
    alignSelf: "flex-start",
    backgroundColor: LIME,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  findBtnText: { color: "#0a0a0a", fontWeight: "800", fontSize: 14 },
  card: {
    backgroundColor: CARD,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 14,
    gap: 4,
  },
  cardMeta: { color: MUTED, fontSize: 12, fontWeight: "600" },
  cardTitle: { color: "#fff", fontSize: 16, fontWeight: "700", marginTop: 2 },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 10,
  },
  cardChip: { color: MUTED, fontSize: 12, fontWeight: "600" },
  cardChipLime: { color: LIME, fontSize: 12, fontWeight: "700" },
  pastTop: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  resultBadge: { fontSize: 13, fontWeight: "800", marginTop: 2 },
  awards: { color: LIME, fontSize: 12, fontWeight: "600", marginTop: 8 },
});
