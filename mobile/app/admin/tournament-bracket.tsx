import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { siteOrigin } from "@/lib/env";

const LIME = "#a3e635";
const BG = "#0a0a0a";

type Team = { id: string; team_name: string; captain_name: string };
type Match = {
  id: string;
  stage: string;
  group_name: string | null;
  match_number: number;
  team_a_id: string;
  team_b_id: string | null;
  score_a: number | null;
  score_b: number | null;
  winner_id: string | null;
  is_bye: boolean;
  completed_at: string | null;
};
type GroupMember = {
  id: string;
  team_id: string;
  group_id: string;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  points: number;
};
type Goal = { scorer_name: string; team_id: string; minute: string; is_own_goal: boolean };

export default function TournamentBracketScreen() {
  const { tournament_id } = useLocalSearchParams<{ tournament_id: string }>();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const token = session?.access_token;

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [standings, setStandings] = useState<GroupMember[]>([]);
  const [teamMap, setTeamMap] = useState<Record<string, Team>>({});

  // Score modal
  const [scoreModal, setScoreModal] = useState<Match | null>(null);
  const [scoreA, setScoreA] = useState("");
  const [scoreB, setScoreB] = useState("");
  const [goals, setGoals] = useState<Goal[]>([]);

  useEffect(() => {
    navigation.setOptions({ title: "Tournament Bracket" });
  }, [navigation]);

  const load = useCallback(async () => {
    if (!token || !tournament_id) return;
    setLoading(true);
    try {
      // Load teams
      const tr = await fetch(`${siteOrigin()}/api/admin/tournaments/bracket?tournament_id=${tournament_id}&action=data`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const tj = await tr.json();
      if (tj.teams) {
        setTeams(tj.teams);
        const map: Record<string, Team> = {};
        for (const t of tj.teams) map[t.id] = t;
        setTeamMap(map);
      }
      if (tj.matches) setMatches(tj.matches);
      if (tj.standings) setStandings(tj.standings);
    } finally {
      setLoading(false);
    }
  }, [token, tournament_id]);

  useEffect(() => { void load(); }, [load]);

  async function postBracket(action: string, extra?: Record<string, unknown>) {
    const r = await fetch(`${siteOrigin()}/api/admin/tournaments/bracket`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action, tournament_id, ...extra }),
    });
    return r.json();
  }

  async function onGenerate() {
    Alert.alert("Generate bracket?", "This will shuffle teams into groups and create all group stage matches.", [
      { text: "Cancel", style: "cancel" },
      { text: "Generate", onPress: async () => {
        setBusy("generate");
        const j = await postBracket("generate");
        setBusy(null);
        if (j.error) { Alert.alert("Error", j.error); return; }
        Alert.alert("Done", j.message);
        void load();
      }},
    ]);
  }

  async function onGenerateKnockout() {
    Alert.alert("Generate knockout?", "This will advance top 2 from each group to knockout stage.", [
      { text: "Cancel", style: "cancel" },
      { text: "Generate", onPress: async () => {
        setBusy("knockout");
        const j = await postBracket("generate_knockout");
        setBusy(null);
        if (j.error) { Alert.alert("Error", j.error); return; }
        Alert.alert("Done", j.message);
        void load();
      }},
    ]);
  }

  async function onLogScore() {
    if (!scoreModal) return;
    const sa = parseInt(scoreA);
    const sb = parseInt(scoreB);
    if (isNaN(sa) || isNaN(sb)) { Alert.alert("Invalid scores"); return; }
    setBusy("score");
    const j = await postBracket("log_score", {
      match_id: scoreModal.id,
      score_a: sa,
      score_b: sb,
      goals: goals.map(g => ({ ...g, minute: parseInt(g.minute) || null })),
    });
    setBusy(null);
    if (j.error) { Alert.alert("Error", j.error); return; }
    setScoreModal(null);
    setScoreA(""); setScoreB(""); setGoals([]);
    void load();
  }

  function openScoreModal(match: Match) {
    setScoreModal(match);
    setScoreA(match.score_a !== null ? String(match.score_a) : "");
    setScoreB(match.score_b !== null ? String(match.score_b) : "");
    setGoals([]);
  }

  function addGoal() {
    setGoals(g => [...g, { scorer_name: "", team_id: scoreModal?.team_a_id || "", minute: "", is_own_goal: false }]);
  }

  const groupNames = Array.from(new Set(matches.filter(m => m.stage === "group").map(m => m.group_name)));
  const knockoutMatches = matches.filter(m => m.stage !== "group");
  const groupComplete = matches.filter(m => m.stage === "group").every(m => m.completed_at);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Bracket</Text>
        <Text style={styles.sub}>{teams.length} confirmed teams</Text>

        <View style={styles.btnRow}>
          <Pressable onPress={onGenerate} disabled={!!busy} style={[styles.btn, busy === "generate" && styles.disabled]}>
            <Text style={styles.btnText}>{busy === "generate" ? "Generating..." : "⚡ Generate Groups"}</Text>
          </Pressable>
          {groupComplete && knockoutMatches.length === 0 ? (
            <Pressable onPress={onGenerateKnockout} disabled={!!busy} style={[styles.btn, styles.btnSecondary, busy === "knockout" && styles.disabled]}>
              <Text style={styles.btnText}>{busy === "knockout" ? "..." : "🏆 Generate Knockout"}</Text>
            </Pressable>
          ) : null}
        </View>

        {/* Group Standings */}
        {groupNames.map(gName => {
          const gStandings = standings
            .filter(s => {
              const gMatch = matches.find(m => m.group_name === gName && (m.team_a_id === s.team_id || m.team_b_id === s.team_id));
              return !!gMatch;
            })
            .sort((a, b) => b.points - a.points || b.goal_difference - a.goal_difference || b.goals_for - a.goals_for);
          return (
            <View key={gName} style={styles.section}>
              <Text style={styles.sectionTitle}>Group {gName}</Text>
              <View style={styles.standingsHeader}>
                <Text style={[styles.standingsCell, { flex: 3 }]}>Team</Text>
                <Text style={styles.standingsCe}>W</Text>
                <Text style={styles.standingsCell}>D</Text>
                <Text style={styles.standingsCell}>L</Text>
                <Text style={styles.standingsCell}>GF</Text>
                <Text style={styles.standingsCell}>GA</Text>
                <Text style={styles.standingsCell}>GD</Text>
                <Text style={styles.standingsCell}>Pts</Text>
              </View>
              {gStandings.map((s, i) => (
                <View key={s.id} style={[styles.standingsRow, i < 2 && styles.standingsRowQualify]}>
                  <Text style={[styles.standingsCell, styles.standingsCellName, { flex: 3 }]} numberOfLines={1}>
                    {teamMap[s.team_id]?.team_name || s.team_id.slice(0, 6)}
                  </Text>
                  <Text style={styles.standingsCell}>{s.wins}</Text>
                  <Text style={styles.standingsCell}>{s.draws}</Text>
                  <Text style={styles.standingsCell}>{s.losses}</Text>
                  <Text style={styles.standingsCell}>{s.goals_for}</Text>
                  <Text style={styles.standingsCell}>{s.goals_against}</Text>
                  <Text style={styles.standingsCell}>{s.goal_difference}</Text>
                  <Text style={[styles.standingsCell, styles.standingsPts]}>{s.points}</Text>
                </View>
              ))}
            </View>
          );
        })}

        {/* Group Matches */}
        {groupNames.map(gName => (
          <View key={"m" + gName} style={styles.section}>
            <Text style={styles.sectionTitle}>Group {gName} Matches</Text>
            {matches.filter(m => m.group_name === gName).map(match => (
              <Pressable key={match.id} onPress={() => openScoreModal(match)} style={styles.matchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.matchTeam} numberOfLines={1}>{teamMap[match.team_a_id]?.team_name || "TBD"}</Text>
                </View>
                <View style={styles.scoreBox}>
                  <Text style={styles.scoreText}>
                    {match.score_a !== null ? `${match.score_a} - ${match.score_b}` : "vs"}
                  </Text>
                </View>
                <View style={{ flex: 1, alignItems: "flex-end" }}>
                  <Text style={styles.matchTeam} numberOfLines={1}>{match.team_b_id ? teamMap[match.team_b_id]?.team_name || "TBD" : "BYE"}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        ))}

        {/* Knockout Matches */}
        {knockoutMatches.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Knockout Stage</Text>
            {["qf", "sf", "final"].map(stage => {
              const stageMathces = knockoutMatches.filter(m => m.stage === stage);
              if (!stageMathces.length) return null;
              const stageLabel = stage === "qf" ? "Quarter Finals" : stage === "sf" ? "Semi Finals" : "Final";
              return (
                <View key={stage}>
                  <Text style={styles.stageLabel}>{stageLabel}</Text>
                  {stageMathces.map(match => (
                    <Pressable key={match.id} onPress={() => !match.is_bye && openScoreModal(match)} style={styles.matchRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.matchTeam} numberOfLines={1}>{match.team_a_id ? teamMap[match.team_a_id]?.team_name || "TBD" : "TBD"}</Text>
                      </View>
                      <View style={styles.scoreBox}>
                        <Text style={styles.scoreText}>
                          {match.is_bye ? "BYE" : match.score_a !== null ? `${match.score_a} - ${match.score_b}` : "vs"}
                        </Text>
                      </View>
                      <View style={{ flex: 1, alignItems: "flex-end" }}>
                        <Text style={styles.matchTeam} numberOfLines={1}>{match.team_b_id ? teamMap[match.team_b_id]?.team_name || "TBD" : "BYE"}</Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              );
            })}
          </View>
        ) : null}
      </ScrollView>

      {/* Score Modal */}
      <Modal visible={!!scoreModal} transparent animationType="slide" onRequestClose={() => setScoreModal(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Log Score</Text>
            {scoreModal ? (
              <>
                <Text style={styles.modalMatchup}>
                  {teamMap[scoreModal.team_a_id]?.team_name || "Team A"} vs {scoreModal.team_b_id ? teamMap[scoreModal.team_b_id]?.team_name || "Team B" : "BYE"}
                </Text>
                <View style={styles.scoreInputRow}>
                  <View style={styles.scoreInputBox}>
                    <Text style={styles.scoreInputLabel}>{teamMap[scoreModal.team_a_id]?.team_name || "Team A"}</Text>
                    <TextInput style={styles.scoreInput} value={scoreA} onChangeText={setScoreA} keyboardType="number-pad" placeholder="0" placeholderTextColor="rgba(255,255,255,0.3)" />
                  </View>
                  <Text style={styles.scoreDash}>—</Text>
                  <View style={styles.scoreInputBox}>
                    <Text style={styles.scoreInputLabel}>{scoreModal.team_b_id ? teamMap[scoreModal.team_b_id]?.team_name || "Team B" : "BYE"}</Text>
                    <TextInput style={styles.scoreInput} value={scoreB} onChangeText={setScoreB} keyboardType="number-pad" placeholder="0" placeholderTextColor="rgba(255,255,255,0.3)" />
                  </View>
                </View>

                <Text style={styles.modalSubtitle}>Goal Scorers</Text>
                {goals.map((g, i) => (
                  <View key={i} style={styles.goalRow}>
                    <TextInput
                      style={[styles.goalInput, { flex: 2 }]}
                      value={g.scorer_name}
                      onChangeText={v => setGoals(gs => gs.map((x, j) => j === i ? { ...x, scorer_ne: v } : x))}
                      placeholder="Player name"
                      placeholderTextColor="rgba(255,255,255,0.3)"
                    />
                    <TextInput
                      style={[styles.goalInput, { width: 50 }]}
                      value={g.minute}
                      onChangeText={v => setGoals(gs => gs.map((x, j) => j === i ? { ...x, minute: v } : x))}
                      placeholder="Min"
                      placeholderTextColor="rgba(255,255,255,0.3)"
                      keyboardType="number-pad"
                    />
                    <Pressable
                      onPress={() => setGoals(gs => gs.map((x, j) => j === i ? { ...x, team_id: x.team_id === scoreModal.team_a_id ? (scoreModal.team_b_id || "") : scoreModal.team_a_id } : x))}
                      style={[styles.teamToggle, g.team_id === scoreModal.team_a_id ? styles.teamToggleA : styles.teamToggleB]}
                    >
                      <Text style={styles.teamToggleText}>{g.team_id === scoreModal.team_a_id ? "A" : "B"}</Text>
                    </Pressable>
                  </View>
                ))}
                <Pressable onPress={addGoal} style={styles.addGoalBtn}>
                  <Text style={styles.addGoalText}>+ Add goal scorer</Text>
                </Pressable>

                <View style={styles.modalBtnRow}>
                  <Pressable onPress={() => setScoreModal(null)} style={styles.cancelBtn}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </Pressable>
                  <Pressable onPress={onLogScore} disabled={busy === "score"} style={[styles.saveBtn, busy === "score" && styles.disabled]}>
                    <Text style={styles.saveBtnText}>{busy === "score" ? "Saving..." : "Save Score"}</Text>
                  </Pressable>
                </View>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  content: { padding: 16, paddingBottom: 60 },
  title: { color: "#fff", fontSize: 24, fontWeight: "800" },
  sub: { color: "rgba(255,255,255,0.45)", fontSize: 13, marginTop: 4, marginBottom: 16 },
  btnRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
  btn: { flex: 1, backgroundColor: LIME, borderRadius: 10, padding: 12, alignItems: "center" },
  btnSecondary: { backgroundColor: "rgba(163,230,53,0.15)", borderWidth: 1, borderColor: LIME },
  btnText: { color: "#111", fontWeight: "800", fontSize: 13 },
  disabled: { opacity: 0.5 },
  section: { marginBottom: 20 },
  sectionTitle: { color: LIME, fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 },
  stageLabel: { color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: "700", textTransform: "uppercase", marginTop: 10, marginBottom: 6 },
  standingsHeader: { flexDirection: "row", paddingHorizontal: 8, marginBottom: 4 },
  standingsRow: { flexDirection: "row", paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8 },
  standingsRowQualify: { backgroundColor: "rgba(163,230,53,0.06)", borderLeftWidth: 2, borderLeftColor: LIME },
  standingsCell: { flex: 1, color: "rgba(255,255,255,0.5)", fontSize: 11, textAlign: "center" },
  standingsCellName: { color: "#fff", fontWeight: "700", textAlign: "left" },
  standingsPts: { color: LIME, fontWeight: "800" },
  matchRow: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 10, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  matchTeam: { color: "#fff", fontSize: 13, fontWeight: "700" },
  scoreBox: { paddingHorizontal: 12 },
  scoreText: { color: LIME, fontWeight: "800", fontSize: 14 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: "#111", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 },
  modalTitle: { color: "#fff", fontSize: 18, fontWeight: "800", marginBottom: 4 },
  modalMatchup: { color: "rgba(255,255,255,0.5)", fontSize: 13, marginBottom: 16 },
  scoreInputRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16, marginBottom: 20 },
  scoreInputBox: { alignItems: "center" },
  scoreInputLabel: { color: "rgba(255,255,255,0.5)", fontSize: 11, marginBottom: 6 },
  scoreInput: { backgroundColor: "#1a1a1a", borderRadius: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", color: "#fff", fontSize: 24, fontWeight: "800", textAlign: "center", width: 70, padding: 10 },
  scoreDash: { color: "rgba(255,255,255,0.3)", fontSize: 24 },
  modalSubtitle: { color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: "700", textTransform: "uppercase", marginBottom: 8 },
  goalRow: { flexDirection: "row", gap: 8, marginBottom: 8, alignItems: "center" },
  goalInput: { backgroundColor: "#1a1a1a", borderRadius: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", color: "#fff", padding: 8, fontSize: 13 },
  teamToggle: { width: 36, height: 36, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  teamToggleA: { backgroundColor: "rgba(163,230,53,0.2)", borderWidth: 1, borderColor: LIME },
  teamToggleB: { backgroundColor: "rgba(99,179,237,0.2)", borderWidth: 1, borderColor: "#63b3ed" },
  teamToggleText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  addGoalBtn: { marginBottom: 16 },
  addGoalText: { color: LIME, fontSize: 13, fontWeight: "700" },
  modalBtnRow: { flexDirection: "row", gap: 10 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", alignItems: "center" },
  cancelBtnText: { color: "rgba(255,255,255,0.5)", fontWeight: "700" },
  saveBtn: { flex: 1, backgroundColor: LIME, padding: 14, borderRadius: 10, alignItems: "center" },
  saveBtnText: { color: "#111", fontWeight: "800", fontSize: 15 },
});
