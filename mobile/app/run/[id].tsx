import { useAuth } from "@/context/AuthContext";
import { usePickupJoin } from "@/hooks/usePickupJoin";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

const BG = "#0a0a0a";
const LIME = "#a3e635";

type Team = "A" | "B" | "C";

type AwardSlot = "player" | "goalie" | "attacker" | "midfielder" | "defender";

type AwardEntry = {
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
  const router = useRouter();
  const { session, supabase, isReady } = useAuth();
  const { declinePickup, declineBusy } = usePickupJoin();

  const userId = session?.user?.id ?? null;
  const token = session?.access_token ?? null;

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [startAt, setStartAt] = useState<string | null>(null);
  const [locationPrivate, setLocationPrivate] = useState<string | null>(null);
  const [serviceRegion, setServiceRegion] = useState<string | null>(null);
  const [isCompleted, setIsCompleted] = useState(false);
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [lockedAt, setLockedAt] = useState<string | null>(null);
  const [cancellationDeadline, setCancellationDeadline] = useState<string | null>(null);
  const [myRsvpStatus, setMyRsvpStatus] = useState<string | null>(null);

  const [myTeam, setMyTeam] = useState<Team | null>(null);
  const [winningTeam, setWinningTeam] = useState<Team | null>(null);
  const [awards, setAwards] = useState<AwardEntry[]>([]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: "Run",
      headerStyle: { backgroundColor: BG },
      headerTintColor: "#fff",
      headerShadowVisible: false,
    });
  }, [navigation]);

  const loadRunDetail = useCallback(async () => {
    if (!isReady || !supabase || !runId) return;
    if (!userId) {
      setLoading(false);
      setErr("Sign in to view runs.");
      return;
    }

    setLoading(true);
    setErr(null);

    const [runRes, myRes, resRes, rsvpRes] = await Promise.all([
      supabase
        .from("pickup_runs")
        .select(
          "id,start_at,location_private,service_region,status,is_completed,locked_at,cancellation_deadline",
        )
        .eq("id", runId)
        .maybeSingle(),
      supabase
        .from("pickup_run_team_assignments")
        .select("team")
        .eq("run_id", runId)
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("pickup_run_results")
        .select(
          "winning_team,player_of_day,goalie_of_the_day,defender_of_day,midfielder_of_day,attacker_of_day",
        )
        .eq("run_id", runId)
        .maybeSingle(),
      supabase.from("pickup_run_rsvps").select("status").eq("run_id", runId).eq("user_id", userId).maybeSingle(),
    ]);

    if (runRes.error) {
      setErr(runRes.error.message ?? "Couldn’t load run.");
      setLoading(false);
      return;
    }

    if (runRes.data == null) {
      setErr("Run not found");
      setLoading(false);
      return;
    }

    const run = runRes.data as
      | null
      | {
          start_at: string | null;
          location_private: string | null;
          service_region: string | null;
          status: string | null;
          is_completed: boolean | null;
          locked_at?: string | null;
          cancellation_deadline?: string | null;
        };
    setStartAt(run?.start_at ?? null);
    setLocationPrivate(run?.location_private ?? null);
    setServiceRegion(run?.service_region ?? null);
    setRunStatus(run?.status ?? null);
    setIsCompleted(run?.is_completed === true);
    const la = run?.locked_at;
    setLockedAt(typeof la === "string" && la.trim().length > 0 ? la : null);
    const cd = run?.cancellation_deadline;
    setCancellationDeadline(typeof cd === "string" && cd.trim().length > 0 ? cd : null);

    if (!rsvpRes.error && rsvpRes.data && typeof (rsvpRes.data as { status?: unknown }).status === "string") {
      setMyRsvpStatus((rsvpRes.data as { status: string }).status);
    } else {
      setMyRsvpStatus(null);
    }

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

    const slotToUserId: Record<AwardSlot, string | null> = {
      player: rr?.player_of_day ?? null,
      goalie: rr?.goalie_of_the_day ?? null,
      attacker: rr?.attacker_of_day ?? null,
      midfielder: rr?.midfielder_of_day ?? null,
      defender: rr?.defender_of_day ?? null,
    };

    const uniqueIds = Array.from(
      new Set(Object.values(slotToUserId).filter((v): v is string => typeof v === "string" && v.length > 0)),
    );

    const nameById = new Map<string, string>();
    if (uniqueIds.length > 0) {
      const profs = await supabase.from("profiles").select("id,full_name,username").in("id", uniqueIds);
      if (profs.data) {
        for (const p of profs.data as Array<{ id: string; full_name: string | null; username: string | null }>) {
          const nm = (p.full_name ?? "").trim() || (p.username ? `@${(p.username ?? "").trim()}` : "") || p.id;
          nameById.set(p.id, nm);
        }
      }
    }

    const next: AwardEntry[] = AWARD_ORDER.map(({ slot, label }) => {
      const uid = slotToUserId[slot];
      return {
        slot,
        label,
        userId: uid,
        name: uid ? nameById.get(uid) ?? null : null,
      };
    });

    setAwards(next);
    setLoading(false);
  }, [isReady, supabase, userId, runId]);

  useEffect(() => {
    if (!isReady || !supabase || !runId) {
      setLoading(false);
      setErr("Missing run.");
      return;
    }
    if (!userId) {
      setLoading(false);
      setErr("Sign in to view runs.");
      return;
    }
    void loadRunDetail();
  }, [isReady, supabase, userId, runId, loadRunDetail]);

  const outcome = useMemo(() => {
    if (!myTeam || !winningTeam) return null;
    return myTeam === winningTeam ? "Won" : "Lost";
  }, [myTeam, winningTeam]);

  /** Show the results section only once the run is completed (matches what's shown in the admin "Post Results" workflow). */
  const showResults = useMemo(() => {
    if (isCompleted) return true;
    return String(runStatus || "").trim().toLowerCase() === "completed";
  }, [isCompleted, runStatus]);

  const runLocked = useMemo(() => {
    const st = String(runStatus || "").trim().toLowerCase();
    if (st === "in_progress") return true;
    return typeof lockedAt === "string" && lockedAt.trim().length > 0;
  }, [runStatus, lockedAt]);

  const showCancelSpot =
    myRsvpStatus === "confirmed" && !runLocked && Boolean(token) && Boolean(runId);

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
        {showResults && winningTeam ? (
          <Text style={styles.winningTeamHeadline}>🏆 Team {winningTeam} won</Text>
        ) : null}
        {outcome ? (
          <View style={[styles.pill, outcome === "Won" ? styles.pillWin : styles.pillLoss]}>
            <FontAwesome name={outcome === "Won" ? "trophy" : "flag"} size={14} color={outcome === "Won" ? "#111" : "#fff"} />
            <Text style={[styles.pillText, outcome === "Won" ? styles.pillTextWin : styles.pillTextLoss]}>
              {outcome}
            </Text>
          </View>
        ) : null}
      </View>

      {showResults && awards.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.label}>Awards</Text>
          {awards.every((a) => a.userId == null) ? (
            <Text style={styles.valueMuted}>—</Text>
          ) : (
            awards.map((a) => (
              <View key={a.slot} style={styles.awardRow}>
                <Text style={styles.awardLabel}>{a.label}:</Text>
                {a.userId && a.name ? (
                  <Pressable
                    onPress={() => router.push(`/player/${encodeURIComponent(a.userId!)}`)}
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
            ))
          )}
        </View>
      ) : null}

      {showCancelSpot ? (
        <View style={styles.cancelSection}>
          <Pressable
            disabled={declineBusy}
            onPress={() =>
              void declinePickup(
                token,
                runId,
                { start_at: startAt, cancellation_deadline: cancellationDeadline },
                loadRunDetail,
              )
            }
            style={({ pressed }) => [
              styles.cancelSpotButton,
              declineBusy && styles.cancelSpotButtonDisabled,
              pressed && !declineBusy && { opacity: 0.85 },
            ]}
          >
            {declineBusy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.cancelSpotText}>Cancel spot</Text>
            )}
          </Pressable>
        </View>
      ) : null}
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
  winningTeamHeadline: {
    marginTop: 14,
    color: LIME,
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: 0.2,
  },

  awardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  awardLabel: { color: "rgba(255,255,255,0.65)", fontWeight: "700", fontSize: 14 },
  awardNameWrap: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
    backgroundColor: "rgba(163,230,53,0.10)",
  },
  awardName: { color: LIME, fontWeight: "900", fontSize: 14 },
  awardNameMuted: { color: "rgba(255,255,255,0.4)", fontWeight: "700", fontSize: 14 },

  pill: { marginTop: 14, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
  pillWin: { borderColor: "rgba(163,230,53,0.55)", backgroundColor: LIME },
  pillLoss: { borderColor: "rgba(248,113,113,0.45)", backgroundColor: "rgba(248,113,113,0.10)" },
  pillText: { fontWeight: "900", fontSize: 13 },
  pillTextWin: { color: "#111" },
  pillTextLoss: { color: "#fff" },

  cancelSection: { marginTop: 28, alignSelf: "stretch" },
  cancelSpotButton: {
    alignSelf: "stretch",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  cancelSpotButtonDisabled: { opacity: 0.45 },
  cancelSpotText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
