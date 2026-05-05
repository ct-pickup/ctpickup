import { useAuth } from "@/context/AuthContext";
import { siteOrigin } from "@/lib/env";
import { formatTournamentStartEt } from "@/lib/formatTournament";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

const LIME = "#a3e635";
const BG = "#0a0a0a";

type MatchRow = {
  id: string;
  tournament_id: string;
  stage_id: string;
  player1_user_id: string;
  player2_user_id: string;
  scheduled_deadline: string | null;
  status: string;
  winner_user_id: string | null;
  score_player1: number | null;
  score_player2: number | null;
};

type StageRow = { id: string; name: string };
type ReportRow = {
  match_id: string;
  reporter_user_id: string;
  score_player1: number;
  score_player2: number;
  opponent_response: string;
};

type ProfileMini = { id: string; first_name: string | null; last_name: string | null };

function opponentName(p: ProfileMini | undefined): string {
  if (!p) return "Opponent";
  const a = (p.first_name ?? "").trim();
  const b = (p.last_name ?? "").trim();
  const s = `${a} ${b}`.trim();
  return s || "Opponent";
}

function statusBadgeStyle(status: string): { bg: string; border: string; color: string } {
  const u = status.toLowerCase();
  if (u === "completed") return { bg: "rgba(163,230,53,0.12)", border: "rgba(163,230,53,0.35)", color: "rgba(163,230,53,0.95)" };
  if (u === "awaiting_confirmation")
    return { bg: "rgba(251,191,36,0.12)", border: "rgba(251,191,36,0.35)", color: "rgba(253,224,71,0.95)" };
  if (u === "disputed") return { bg: "rgba(248,113,113,0.12)", border: "rgba(248,113,113,0.35)", color: "#fca5a5" };
  if (u === "scheduled") return { bg: "rgba(255,255,255,0.06)", border: "rgba(255,255,255,0.14)", color: "rgba(255,255,255,0.75)" };
  if (u === "under_review") return { bg: "rgba(96,165,250,0.12)", border: "rgba(96,165,250,0.35)", color: "#93c5fd" };
  return { bg: "rgba(255,255,255,0.06)", border: "rgba(255,255,255,0.14)", color: "rgba(255,255,255,0.7)" };
}

function humanStatus(status: string): string {
  const u = status.toLowerCase();
  if (u === "awaiting_confirmation") return "Awaiting confirmation";
  if (u === "under_review") return "Under review";
  if (u.includes("_")) {
    return u
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }
  return u.charAt(0).toUpperCase() + u.slice(1);
}

function parseNonNegInt(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return null;
  return n;
}

export default function EsportsPlayScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const tournamentId = typeof rawId === "string" ? rawId : Array.isArray(rawId) ? rawId[0] : "";
  const { supabase, session, isReady } = useAuth();
  const token = session?.access_token ?? null;
  const userId = session?.user?.id ?? null;
  const navigation = useNavigation();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [stagesById, setStagesById] = useState<Record<string, string>>({});
  const [reportsByMatchId, setReportsByMatchId] = useState<Record<string, ReportRow>>({});
  const [profilesById, setProfilesById] = useState<Record<string, ProfileMini>>({});

  const [reportModalMatch, setReportModalMatch] = useState<MatchRow | null>(null);
  const [yourScoreText, setYourScoreText] = useState("");
  const [oppScoreText, setOppScoreText] = useState("");
  const [submitBusy, setSubmitBusy] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  const baseUrl = useMemo(() => siteOrigin(), []);

  const load = useCallback(async () => {
    if (!isReady || !tournamentId || !supabase || !userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr(null);
    const { data: matchData, error: mErr } = await supabase
      .from("esports_matches")
      .select(
        "id,tournament_id,stage_id,player1_user_id,player2_user_id,scheduled_deadline,status,winner_user_id,score_player1,score_player2",
      )
      .eq("tournament_id", tournamentId)
      .or(`player1_user_id.eq.${userId},player2_user_id.eq.${userId}`)
      .order("scheduled_deadline", { ascending: true, nullsFirst: false });

    if (mErr) {
      setErr(mErr.message);
      setMatches([]);
      setLoading(false);
      return;
    }

    const list = (matchData ?? []) as MatchRow[];
    setMatches(list);

    const stageIds = [...new Set(list.map((m) => m.stage_id).filter(Boolean))];
    if (stageIds.length) {
      const { data: stData } = await supabase.from("esports_tournament_stages").select("id,name").in("id", stageIds);
      const map: Record<string, string> = {};
      for (const s of (stData ?? []) as StageRow[]) map[s.id] = s.name;
      setStagesById(map);
    } else {
      setStagesById({});
    }

    const matchIds = list.map((m) => m.id);
    if (matchIds.length) {
      const { data: repData } = await supabase
        .from("esports_match_reports")
        .select("match_id,reporter_user_id,score_player1,score_player2,opponent_response")
        .in("match_id", matchIds);
      const rmap: Record<string, ReportRow> = {};
      for (const r of (repData ?? []) as ReportRow[]) rmap[r.match_id] = r;
      setReportsByMatchId(rmap);
    } else {
      setReportsByMatchId({});
    }

    const oppIds = [...new Set(list.map((m) => (m.player1_user_id === userId ? m.player2_user_id : m.player1_user_id)))];
    if (oppIds.length) {
      const { data: profData } = await supabase.from("profiles").select("id,first_name,last_name").in("id", oppIds);
      const pmap: Record<string, ProfileMini> = {};
      for (const p of (profData ?? []) as ProfileMini[]) pmap[p.id] = p;
      setProfilesById(pmap);
    } else {
      setProfilesById({});
    }

    setLoading(false);
  }, [isReady, supabase, tournamentId, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  useLayoutEffect(() => {
    navigation.setOptions?.({
      headerShown: true,
      title: "",
      headerTitleAlign: "center",
      headerStyle: { backgroundColor: BG },
      headerTintColor: "#fff",
      headerLeft: () => (
        <Pressable
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace(`/(tabs)/esports`);
          }}
          style={styles.headerBack}
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <FontAwesome name="chevron-left" size={18} color={LIME} />
          <Text style={styles.headerBackText}>Esports</Text>
        </Pressable>
      ),
    });
  }, [navigation, router]);

  async function postJson(path: string, body?: object) {
    const base = baseUrl;
    if (!base) throw new Error("Set EXPO_PUBLIC_SITE_URL in mobile/.env to your deployed API host.");
    if (!token) throw new Error("Sign in again to continue.");
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : "{}",
    });
    const j = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean };
    if (!res.ok) throw new Error(typeof j.error === "string" ? j.error : `Request failed (${res.status})`);
    return j;
  }

  function openReportModal(m: MatchRow) {
    setYourScoreText("");
    setOppScoreText("");
    setReportModalMatch(m);
  }

  async function submitReport() {
    const m = reportModalMatch;
    if (!m || !userId) return;
    const ys = parseNonNegInt(yourScoreText);
    const os = parseNonNegInt(oppScoreText);
    if (ys === null || os === null) {
      Alert.alert("Invalid scores", "Enter non-negative whole numbers for both scores.");
      return;
    }
    const p1 = m.player1_user_id;
    const score_player1 = userId === p1 ? ys : os;
    const score_player2 = userId === p1 ? os : ys;
    setSubmitBusy(true);
    try {
      await postJson(`/api/esports/matches/${m.id}/report`, { score_player1, score_player2 });
      setReportModalMatch(null);
      await load();
    } catch (e) {
      Alert.alert("Could not submit", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSubmitBusy(false);
    }
  }

  async function confirmMatch(matchId: string) {
    setActionBusyId(matchId);
    try {
      await postJson(`/api/esports/matches/${matchId}/confirm`);
      await load();
    } catch (e) {
      Alert.alert("Could not confirm", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setActionBusyId(null);
    }
  }

  async function disputeMatch(matchId: string) {
    setActionBusyId(matchId);
    try {
      await postJson(`/api/esports/matches/${matchId}/dispute`, {});
      await load();
    } catch (e) {
      Alert.alert("Could not dispute", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setActionBusyId(null);
    }
  }

  if (!tournamentId) {
    return (
      <View style={styles.centered}>
        <Text style={styles.err}>Missing tournament id.</Text>
      </View>
    );
  }

  if (!isReady) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#fff" size="large" />
      </View>
    );
  }

  if (!supabase) {
    return (
      <View style={styles.pad}>
        <Text style={styles.err}>Sign in or configure Supabase in mobile/.env.</Text>
      </View>
    );
  }

  if (!session || !userId) {
    return (
      <View style={styles.pad}>
        <Text style={styles.subtitle}>Report results and confirm scores</Text>
        <Text style={styles.bodyMuted}>Sign in to see your matches for this tournament.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#fff" size="large" />
      </View>
    );
  }

  if (err) {
    return (
      <View style={styles.pad}>
        <Text style={styles.err}>{err}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.heroTitle}>Tournament play</Text>
      <Text style={styles.heroSubtitle}>Report results and confirm scores</Text>

      {matches.length === 0 ? (
        <Text style={styles.empty}>No matches yet for this tournament</Text>
      ) : (
        matches.map((m) => {
          const oppId = m.player1_user_id === userId ? m.player2_user_id : m.player1_user_id;
          const stageName = stagesById[m.stage_id] ?? "—";
          const deadline = m.scheduled_deadline ? formatTournamentStartEt(m.scheduled_deadline) : "—";
          const st = (m.status ?? "").toLowerCase();
          const badge = statusBadgeStyle(st);
          const isP1 = userId === m.player1_user_id;
          const yourS = isP1 ? m.score_player1 : m.score_player2;
          const oppS = isP1 ? m.score_player2 : m.score_player1;
          const rep = reportsByMatchId[m.id];
          const opponentReported =
            st === "awaiting_confirmation" && rep && rep.reporter_user_id !== userId && rep.opponent_response === "pending";

          let outcome: "win" | "loss" | null = null;
          if (st === "completed" && m.winner_user_id) {
            if (m.winner_user_id === userId) outcome = "win";
            else if (m.winner_user_id === oppId) outcome = "loss";
          }

          return (
            <View key={m.id} style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.stageName}>{stageName}</Text>
                <View style={[styles.statusPill, { backgroundColor: badge.bg, borderColor: badge.border }]}>
                  <Text style={[styles.statusPillText, { color: badge.color }]}>{humanStatus(st)}</Text>
                </View>
              </View>
              <Text style={styles.vs}>vs {opponentName(profilesById[oppId])}</Text>
              <Text style={styles.deadlineLabel}>Play by</Text>
              <Text style={styles.deadline}>{deadline}</Text>

              {st === "completed" && yourS != null && oppS != null ? (
                <Text style={styles.scoreLine}>
                  You <Text style={styles.scoreEm}>{yourS}</Text> — <Text style={styles.scoreEm}>{oppS}</Text> Opponent
                </Text>
              ) : null}

              {outcome === "win" ? (
                <View style={[styles.outcomeBadge, styles.outcomeWin]}>
                  <Text style={styles.outcomeWinText}>You won</Text>
                </View>
              ) : outcome === "loss" ? (
                <View style={[styles.outcomeBadge, styles.outcomeLoss]}>
                  <Text style={styles.outcomeLossText}>You lost</Text>
                </View>
              ) : null}

              {st === "scheduled" ? (
                <Pressable
                  style={styles.reportBtn}
                  onPress={() => openReportModal(m)}
                  accessibilityRole="button"
                  accessibilityLabel="Report result"
                >
                  <Text style={styles.reportBtnText}>Report result</Text>
                </Pressable>
              ) : null}

              {opponentReported ? (
                <View style={styles.confirmRow}>
                  <Pressable
                    style={[styles.secondaryBtn, styles.confirmBtn]}
                    disabled={actionBusyId === m.id}
                    onPress={() => void confirmMatch(m.id)}
                    accessibilityRole="button"
                    accessibilityLabel="Confirm reported score"
                  >
                    {actionBusyId === m.id ? (
                      <ActivityIndicator color="#111" />
                    ) : (
                      <Text style={styles.secondaryBtnTextDark}>Confirm</Text>
                    )}
                  </Pressable>
                  <Pressable
                    style={[styles.secondaryBtn, styles.disputeBtn]}
                    disabled={actionBusyId === m.id}
                    onPress={() => {
                      Alert.alert("Dispute result?", "Staff will review this match.", [
                        { text: "Cancel", style: "cancel" },
                        { text: "Dispute", style: "destructive", onPress: () => void disputeMatch(m.id) },
                      ]);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Dispute reported score"
                  >
                    <Text style={styles.disputeBtnText}>Dispute</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          );
        })
      )}

      <Modal visible={reportModalMatch != null} animationType="slide" transparent onRequestClose={() => setReportModalMatch(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => !submitBusy && setReportModalMatch(null)} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Report result</Text>
            <Text style={styles.modalHint}>Enter the final score from your perspective.</Text>
            <Text style={styles.inputLabel}>Your score</Text>
            <TextInput
              style={styles.input}
              keyboardType="number-pad"
              value={yourScoreText}
              onChangeText={setYourScoreText}
              placeholder="0"
              placeholderTextColor="rgba(255,255,255,0.35)"
              editable={!submitBusy}
            />
            <Text style={styles.inputLabel}>Opponent score</Text>
            <TextInput
              style={styles.input}
              keyboardType="number-pad"
              value={oppScoreText}
              onChangeText={setOppScoreText}
              placeholder="0"
              placeholderTextColor="rgba(255,255,255,0.35)"
              editable={!submitBusy}
            />
            {!baseUrl ? <Text style={styles.modalWarn}>Set EXPO_PUBLIC_SITE_URL to submit.</Text> : null}
            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalCancel}
                disabled={submitBusy}
                onPress={() => setReportModalMatch(null)}
                accessibilityRole="button"
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalSubmit, (!baseUrl || submitBusy) && styles.modalSubmitDisabled]}
                disabled={!baseUrl || submitBusy}
                onPress={() => void submitReport()}
                accessibilityRole="button"
              >
                {submitBusy ? <ActivityIndicator color="#111" /> : <Text style={styles.modalSubmitText}>Submit</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  content: { padding: 20, paddingBottom: 48 },
  centered: { flex: 1, backgroundColor: BG, justifyContent: "center", alignItems: "center", padding: 24 },
  pad: { flex: 1, backgroundColor: BG, padding: 20 },
  headerBack: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 4,
    paddingVertical: 8,
    gap: 6,
  },
  headerBackText: { color: "#fff", fontSize: 17, fontWeight: "500" },
  heroTitle: { fontSize: 22, fontWeight: "800", color: "#fff", letterSpacing: -0.3 },
  heroSubtitle: { marginTop: 6, fontSize: 14, color: "rgba(255,255,255,0.55)", lineHeight: 20 },
  empty: { marginTop: 28, fontSize: 15, color: "rgba(255,255,255,0.65)", textAlign: "center" },
  err: { color: "#fca5a5", fontSize: 15, lineHeight: 22 },
  bodyMuted: { marginTop: 12, fontSize: 15, color: "rgba(255,255,255,0.55)", lineHeight: 22 },
  subtitle: { fontSize: 14, color: "rgba(255,255,255,0.55)" },
  card: {
    marginTop: 18,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  stageName: { flex: 1, fontSize: 16, fontWeight: "800", color: "#fff" },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusPillText: { fontSize: 11, fontWeight: "800" },
  vs: { marginTop: 10, fontSize: 15, color: "rgba(255,255,255,0.82)", fontWeight: "600" },
  deadlineLabel: { marginTop: 12, fontSize: 11, fontWeight: "800", letterSpacing: 1.1, color: "rgba(255,255,255,0.4)" },
  deadline: { marginTop: 4, fontSize: 14, color: "rgba(255,255,255,0.78)" },
  scoreLine: { marginTop: 12, fontSize: 15, color: "rgba(255,255,255,0.85)" },
  scoreEm: { fontWeight: "900", color: LIME },
  outcomeBadge: {
    alignSelf: "flex-start",
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  outcomeWin: {
    backgroundColor: "rgba(163,230,53,0.15)",
    borderColor: "rgba(163,230,53,0.45)",
  },
  outcomeWinText: { color: LIME, fontWeight: "900", fontSize: 13 },
  outcomeLoss: {
    backgroundColor: "rgba(248,113,113,0.12)",
    borderColor: "rgba(248,113,113,0.45)",
  },
  outcomeLossText: { color: "#f87171", fontWeight: "900", fontSize: 13 },
  reportBtn: {
    marginTop: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: LIME,
  },
  reportBtnText: { color: "#111", fontWeight: "800", fontSize: 15 },
  confirmRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  secondaryBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 10,
    minHeight: 46,
  },
  confirmBtn: { backgroundColor: LIME },
  secondaryBtnTextDark: { color: "#111", fontWeight: "800", fontSize: 15 },
  disputeBtn: {
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.55)",
    backgroundColor: "rgba(248,113,113,0.08)",
  },
  disputeBtnText: { color: "#fca5a5", fontWeight: "800", fontSize: 15 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: "#111",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 22,
    paddingBottom: 28,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.2)",
  },
  modalTitle: { fontSize: 18, fontWeight: "800", color: "#fff" },
  modalHint: { marginTop: 8, fontSize: 14, color: "rgba(255,255,255,0.55)", lineHeight: 20 },
  inputLabel: { marginTop: 14, fontSize: 12, fontWeight: "700", color: "rgba(255,255,255,0.45)" },
  input: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 17,
    color: "#fff",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  modalWarn: { marginTop: 10, color: "#fca5a5", fontSize: 13 },
  modalActions: { flexDirection: "row", gap: 12, marginTop: 22 },
  modalCancel: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  modalCancelText: { color: "rgba(255,255,255,0.85)", fontWeight: "700" },
  modalSubmit: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: LIME,
  },
  modalSubmitDisabled: { opacity: 0.45 },
  modalSubmitText: { color: "#111", fontWeight: "800", fontSize: 15 },
});
