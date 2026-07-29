import { useAuth } from "@/context/AuthContext";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
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

type AvatarPreview = { id: string; initials: string };

type LiveRow = {
  run_id: string;
  title: string | null;
  start_at: string | null;
  location: string | null;
  capacity: number;
  spots_taken: number;
  fee_cents: number;
  status: string | null;
  avatars: AvatarPreview[];
};

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

const LIVE_STATUSES = new Set(["active", "in_progress", "planning"]);

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

function fmtStarted(iso: string | null): string {
  if (!iso) return "Time TBD";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Time TBD";
  const now = Date.now();
  const t = d.getTime();
  if (t <= now) {
    const mins = Math.max(1, Math.round((now - t) / 60000));
    if (mins < 60) return `Started ${mins}m ago`;
    const hrs = Math.round(mins / 60);
    return `Started ${hrs}h ago`;
  }
  return `Starts ${fmtDateTime(iso)}`;
}

function fmtFee(cents: number): string {
  if (!cents || cents <= 0) return "Free";
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

function initialsFromProfile(p: {
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
} | null): string {
  const first = (p?.first_name ?? "").trim();
  const last = (p?.last_name ?? "").trim();
  if (first || last) return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase() || "?";
  const u = (p?.username ?? "").trim();
  return (u[0] ?? "?").toUpperCase();
}

function isLiveRun(status: string | null, startAt: string | null, nowMs: number): boolean {
  const st = (status ?? "").trim().toLowerCase();
  if (!LIVE_STATUSES.has(st)) return false;
  const t = startAt ? new Date(startAt).getTime() : NaN;
  if (!Number.isFinite(t)) return false;
  const twoHoursAgo = nowMs - 2 * 60 * 60 * 1000;
  if (t <= twoHoursAgo) return false;
  // Planning far in the future belongs in Upcoming, not Live.
  if (st === "planning" && t > nowMs + 3 * 60 * 60 * 1000) return false;
  return true;
}

function LivePulseDot() {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.55] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] });

  return (
    <View style={styles.liveBadge}>
      <View style={styles.liveDotWrap}>
        <Animated.View style={[styles.liveDotRing, { opacity, transform: [{ scale }] }]} />
        <View style={styles.liveDot} />
      </View>
      <Text style={styles.liveBadgeText}>LIVE</Text>
    </View>
  );
}

export default function SessionsTabScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session, supabase, isReady } = useAuth();
  const uid = session?.user?.id ?? null;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [live, setLive] = useState<LiveRow[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingRow[]>([]);
  const [past, setPast] = useState<PastRow[]>([]);
  const [nearbyOpenCount, setNearbyOpenCount] = useState(0);
  const [sessionsPlayed, setSessionsPlayed] = useState(0);
  const [wins, setWins] = useState(0);
  const [losses, setLosses] = useState(0);
  const [points, setPoints] = useState(0);

  const load = useCallback(async () => {
    if (!isReady || !supabase || !uid) {
      setLive([]);
      setUpcoming([]);
      setPast([]);
      setNearbyOpenCount(0);
      setLoading(false);
      return;
    }

    try {
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

      const now = Date.now();
      const twoHoursAgoIso = new Date(now - 2 * 60 * 60 * 1000).toISOString();

      const [{ data: rsvpData }, { data: nearbyRuns }] = await Promise.all([
        supabase
          .from("pickup_run_rsvps")
          .select("run_id")
          .eq("user_id", uid)
          .eq("status", "confirmed")
          .limit(200),
        supabase
          .from("pickup_runs")
          .select("id", { count: "exact", head: false })
          .in("status", ["planning", "active", "in_progress"])
          .gt("start_at", twoHoursAgoIso)
          .limit(40),
      ]);

      const myRunIds = Array.from(
        new Set(
          ((rsvpData ?? []) as Array<{ run_id: string | null }>)
            .map((r) => r.run_id)
            .filter((v): v is string => Boolean(v)),
        ),
      );

      setNearbyOpenCount(
        Array.isArray(nearbyRuns)
          ? nearbyRuns.filter((r) => {
              const id = typeof (r as { id?: unknown }).id === "string" ? (r as { id: string }).id : "";
              return id && !myRunIds.includes(id);
            }).length
          : 0,
      );

      if (!myRunIds.length) {
        setLive([]);
        setUpcoming([]);
        setPast([]);
        return;
      }

      const { data: runsData } = await supabase
        .from("pickup_runs")
        .select("id,title,start_at,location_text,capacity,spots_taken,fee_cents,status,created_by")
        .in("id", myRunIds);

      const runs = (runsData ?? []) as Array<{
        id: string;
        title: string | null;
        start_at: string | null;
        location_text: string | null;
        capacity: number | null;
        spots_taken: number | null;
        fee_cents: number | null;
        status: string | null;
        created_by: string | null;
      }>;

      const liveRuns = runs
        .filter((r) => isLiveRun(r.status, r.start_at, now))
        .sort((a, b) => String(a.start_at ?? "").localeCompare(String(b.start_at ?? "")));

      const liveIds = new Set(liveRuns.map((r) => r.id));

      const avatarByRun = new Map<string, AvatarPreview[]>();
      if (liveIds.size > 0) {
        const liveIdList = [...liveIds];
        const { data: liveRsvps } = await supabase
          .from("pickup_run_rsvps")
          .select("run_id,user_id")
          .in("run_id", liveIdList)
          .in("status", ["confirmed", "pending_payment"])
          .limit(120);

        const rsvpRows = (liveRsvps ?? []) as Array<{ run_id: string; user_id: string }>;
        const userIds = Array.from(new Set(rsvpRows.map((r) => r.user_id).filter(Boolean)));
        const profileById = new Map<
          string,
          { first_name: string | null; last_name: string | null; username: string | null }
        >();
        if (userIds.length) {
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id,first_name,last_name,username")
            .in("id", userIds);
          for (const p of (profiles ?? []) as Array<{
            id: string;
            first_name: string | null;
            last_name: string | null;
            username: string | null;
          }>) {
            profileById.set(p.id, p);
          }
        }
        for (const runId of liveIdList) {
          const people = rsvpRows
            .filter((r) => r.run_id === runId)
            .slice(0, 3)
            .map((r) => ({
              id: r.user_id,
              initials: initialsFromProfile(profileById.get(r.user_id) ?? null),
            }));
          avatarByRun.set(runId, people);
        }
      }

      const liveRows: LiveRow[] = liveRuns.map((r) => ({
        run_id: r.id,
        title: r.title,
        start_at: r.start_at,
        location: (r.location_text ?? "").trim() || null,
        capacity: Math.max(0, Number(r.capacity ?? 0)),
        spots_taken: Math.max(0, Number(r.spots_taken ?? 0)),
        fee_cents: Math.max(0, Number(r.fee_cents ?? 0)),
        status: r.status,
        avatars: avatarByRun.get(r.id) ?? [],
      }));

      const upcomingRows = runs
        .filter((r) => {
          if (liveIds.has(r.id)) return false;
          const t = r.start_at ? new Date(r.start_at).getTime() : NaN;
          const st = (r.status ?? "").trim().toLowerCase();
          if (st === "completed" || st === "canceled" || st === "cancelled") return false;
          return Number.isFinite(t) && t > now;
        })
        .sort((a, b) => String(a.start_at ?? "").localeCompare(String(b.start_at ?? "")))
        .slice(0, 8)
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
          if (liveIds.has(r.id)) return false;
          const t = r.start_at ? new Date(r.start_at).getTime() : NaN;
          const st = (r.status ?? "").trim().toLowerCase();
          return st === "completed" || (Number.isFinite(t) && t <= now);
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

      setLive(liveRows);
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
  const showJoinCard = !loading && upcoming.length === 0 && live.length === 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Text style={styles.header}>Sessions</Text>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 120 + insets.bottom }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={LIME} />
        }
      >
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
            {/* LIVE NOW */}
            {live.length > 0 ? (
              <>
                <Text style={styles.sectionTitle}>Live now</Text>
                <View style={{ gap: 12, marginBottom: 8 }}>
                  {live.map((row) => {
                    const spotsLeft = Math.max(0, row.capacity - row.spots_taken);
                    return (
                      <Pressable
                        key={row.run_id}
                        onPress={() =>
                          (router.push as (href: string) => void)(
                            `/session/${encodeURIComponent(row.run_id)}`,
                          )
                        }
                        style={styles.liveCard}
                        accessibilityRole="button"
                        accessibilityLabel={`Live session ${row.title || "Session"}`}
                      >
                        <View style={styles.liveTop}>
                          <LivePulseDot />
                          <Text style={styles.liveTime}>{fmtStarted(row.start_at)}</Text>
                        </View>
                        <Text style={styles.liveTitle} numberOfLines={2}>
                          {row.title || "Session"}
                        </Text>
                        {row.location ? (
                          <Text style={styles.cardMeta} numberOfLines={1}>
                            {row.location}
                          </Text>
                        ) : null}
                        <View style={styles.liveFooter}>
                          <View style={styles.avatarRow}>
                            {row.avatars.map((a) => (
                              <View key={a.id} style={styles.avatar}>
                                <Text style={styles.avatarText}>{a.initials}</Text>
                              </View>
                            ))}
                            {row.spots_taken > row.avatars.length ? (
                              <Text style={styles.avatarMore}>+{row.spots_taken - row.avatars.length}</Text>
                            ) : null}
                          </View>
                          <Text style={styles.cardChipLime}>
                            {spotsLeft} spot{spotsLeft === 1 ? "" : "s"} left
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}

            {/* JOIN A SESSION */}
            {showJoinCard ? (
              <>
                <Text style={[styles.sectionTitle, live.length > 0 ? { marginTop: 20 } : null]}>
                  Join a session
                </Text>
                <Pressable
                  onPress={() => (router.push as (href: string) => void)("/session-map")}
                  style={styles.joinCard}
                  accessibilityRole="button"
                  accessibilityLabel="Find a run near you"
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.joinTitle}>Find a run near you →</Text>
                    <Text style={styles.joinSub}>
                      {nearbyOpenCount > 0
                        ? `${nearbyOpenCount} open session${nearbyOpenCount === 1 ? "" : "s"} on the map`
                        : "Browse open sessions on the map"}
                    </Text>
                  </View>
                  <FontAwesome name="map-marker" size={22} color={LIME} />
                </Pressable>
              </>
            ) : null}

            {/* UPCOMING */}
            <Text style={[styles.sectionTitle, { marginTop: live.length > 0 || showJoinCard ? 24 : 0 }]}>
              Upcoming
            </Text>
            {upcoming.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>
                  {live.length > 0
                    ? "No other upcoming sessions."
                    : "No upcoming sessions yet."}
                </Text>
                {!showJoinCard ? (
                  <Pressable
                    onPress={() => (router.push as (href: string) => void)("/session-map")}
                    style={styles.findBtn}
                  >
                    <Text style={styles.findBtnText}>Find a run →</Text>
                  </Pressable>
                ) : null}
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

            {/* PAST */}
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

      <Pressable
        onPress={() => (router.push as (href: string) => void)("/session-create")}
        style={[styles.fab, { bottom: Math.max(24, insets.bottom + 16) }]}
        accessibilityRole="button"
        accessibilityLabel="Host a Session"
      >
        <FontAwesome name="plus" size={22} color="#0a0a0a" />
      </Pressable>
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
  joinCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "rgba(163,230,53,0.1)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
    padding: 16,
  },
  joinTitle: { color: "#fff", fontSize: 17, fontWeight: "800" },
  joinSub: { marginTop: 4, color: "rgba(255,255,255,0.6)", fontSize: 13, lineHeight: 18 },
  liveCard: {
    backgroundColor: "rgba(163,230,53,0.08)",
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "rgba(163,230,53,0.45)",
    padding: 14,
    gap: 6,
  },
  liveTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(163,230,53,0.18)",
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.4)",
  },
  liveDotWrap: { width: 10, height: 10, alignItems: "center", justifyContent: "center" },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: LIME,
  },
  liveDotRing: {
    position: "absolute",
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: LIME,
  },
  liveBadgeText: { color: LIME, fontSize: 11, fontWeight: "900", letterSpacing: 0.8 },
  liveTime: { color: MUTED, fontSize: 12, fontWeight: "600" },
  liveTitle: { color: "#fff", fontSize: 17, fontWeight: "800", marginTop: 2 },
  liveFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
  },
  avatarRow: { flexDirection: "row", alignItems: "center" },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(163,230,53,0.2)",
    borderWidth: 1.5,
    borderColor: "#0a0a0a",
    alignItems: "center",
    justifyContent: "center",
    marginRight: -8,
  },
  avatarText: { color: LIME, fontSize: 10, fontWeight: "800" },
  avatarMore: { marginLeft: 14, color: MUTED, fontSize: 12, fontWeight: "700" },
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
  fab: {
    position: "absolute",
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: LIME,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
