import { useAuth } from "@/context/AuthContext";
import { profileDisplayName } from "@/lib/profileFields";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { themeColor, useThemedStyles } from "@/theme";
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
  useThemedStyles(publish_styles);

  const { id: raw } = useLocalSearchParams<{ id: string | string[] }>();
  const runId = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : "";
  const navigation = useNavigation();
  const router = useRouter();
  const { session, supabase, isReady } = useAuth();

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
  const [myRsvpStatus, setMyRsvpStatus] = useState<string | null>(null);

  const [myTeam, setMyTeam] = useState<Team | null>(null);
  const [winningTeam, setWinningTeam] = useState<Team | null>(null);
  const [awards, setAwards] = useState<AwardEntry[]>([]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: "Run",
      headerStyle: { backgroundColor: themeColor().bg },
      headerTintColor: themeColor().text,
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
      console.warn("[run detail] pickup_runs load failed", runRes.error.message ?? runRes.error);
      setErr("Something went wrong. Please try again.");
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
      const profs = await supabase
        .from("profiles")
        .select("id,first_name,last_name,username")
        .in("id", uniqueIds);
      if (profs.data) {
        for (const p of profs.data as Array<{
          id: string;
          first_name: string | null;
          last_name: string | null;
          username: string | null;
        }>) {
          const nm =
            profileDisplayName(p) ||
            (p.username ? `@${(p.username ?? "").trim()}` : "") ||
            p.id;
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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={themeColor().pitchText} />
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
            <FontAwesome name={outcome === "Won" ? "trophy" : "flag"} size={14} color={outcome === "Won" ? themeColor().onPitch : themeColor().muted} />
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

    </ScrollView>
  );
}

function make_styles() {
  return StyleSheet.create({
  scroll: { flex: 1, backgroundColor: themeColor().bg },
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, backgroundColor: themeColor().bg, justifyContent: "center", alignItems: "center", padding: 24 },
  errText: { color: themeColor().coralText, fontSize: 16, fontFamily: "Inter_400Regular", textAlign: "center" },
  h1: { fontSize: 24, fontFamily: "InstrumentSerif_400Regular", fontWeight: "900", color: themeColor().text },
  sub: { marginTop: 10, color: themeColor().muted, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },

  card: {
    marginTop: 14,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().card,
  },
  row: { flexDirection: "row", gap: 12 },
  label: { fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "800", color: themeColor().muted, },
  value: { marginTop: 8, color: themeColor().text, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "800" },
  valueMuted: { marginTop: 8, color: themeColor().muted, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
  winningTeamHeadline: {
    marginTop: 14,
    color: themeColor().pitchText,
    fontSize: 16, fontFamily: "Inter_700Bold",
    fontWeight: "900",
  },

  awardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: themeColor().line,
  },
  awardLabel: { color: themeColor().muted, fontWeight: "700", fontSize: 14, fontFamily: "Inter_700Bold" },
  awardNameWrap: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: themeColor().pitch,
    backgroundColor: themeColor().pitchPanel,
  },
  awardName: { color: themeColor().pitchText, fontWeight: "900", fontSize: 14, fontFamily: "Inter_700Bold" },
  awardNameMuted: { color: themeColor().muted, fontWeight: "700", fontSize: 14, fontFamily: "Inter_700Bold" },

  pill: { marginTop: 14, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
  pillWin: { borderColor: themeColor().pitch, backgroundColor: themeColor().pitch },
  pillLoss: { borderColor: themeColor().line, backgroundColor: themeColor().overlaySubtle },
  pillText: { fontWeight: "900", fontSize: 13, fontFamily: "Inter_700Bold" },
  pillTextWin: { color: themeColor().onPitch },
  pillTextLoss: { color: themeColor().text },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}

