import { useAuth } from "@/context/AuthContext";
import {
  fetchAdminTournamentBracket,
  postAdminTournamentBracket,
  type AdminBracketMatchGoal,
  type AdminBracketRatingOptions,
  type AdminBracketRosterPlayer,
} from "@/lib/adminApi";
import { siteOrigin } from "@/lib/env";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { headline, themeColor, useThemedStyles } from "@/theme";
import { ratingReasonText } from "@shared/ratedTournament";
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
  started_at?: string | null;
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
type GoalDraft = { scorer_name: string; team_id: string; minute: string; is_own_goal: boolean };

function parseMatchGoals(raw: unknown): Record<string, AdminBracketMatchGoal[]> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, AdminBracketMatchGoal[]> = {};
  for (const [matchId, rows] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(rows)) continue;
    const goals: AdminBracketMatchGoal[] = [];
    for (const x of rows) {
      if (!x || typeof x !== "object") continue;
      const r = x as Record<string, unknown>;
      const scorer_name = typeof r.scorer_name === "string" ? r.scorer_name.trim() : "";
      const team_id = typeof r.team_id === "string" ? r.team_id : "";
      if (!scorer_name || !team_id) continue;
      const minuteRaw = r.minute;
      const minute =
        minuteRaw === null || minuteRaw === undefined
          ? null
          : Number.isFinite(Number(minuteRaw))
            ? Math.trunc(Number(minuteRaw))
            : null;
      goals.push({
        team_id,
        scorer_name,
        minute,
        is_own_goal: r.is_own_goal === true,
      });
    }
    if (goals.length) out[matchId] = goals;
  }
  return out;
}

function goalsToDraft(rows: AdminBracketMatchGoal[]): GoalDraft[] {
  return rows.map((g) => ({
    scorer_name: g.scorer_name,
    team_id: g.team_id,
    minute: g.minute != null ? String(g.minute) : "",
    is_own_goal: g.is_own_goal,
  }));
}

export default function TournamentBracketScreen() {
  useThemedStyles(publish_styles);

  const { tournament_id: tournamentIdParam } = useLocalSearchParams<{ tournament_id?: string | string[] }>();
  const tournament_id =
    typeof tournamentIdParam === "string"
      ? tournamentIdParam
      : Array.isArray(tournamentIdParam)
        ? tournamentIdParam[0]
        : "";
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { session, supabase } = useAuth();
  const token = session?.access_token;

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [standings, setStandings] = useState<GroupMember[]>([]);
  const [teamMap, setTeamMap] = useState<Record<string, Team>>({});
  const [rosterPlayers, setRosterPlayers] = useState<AdminBracketRosterPlayer[]>([]);
  const [matchGoalsById, setMatchGoalsById] = useState<Record<string, AdminBracketMatchGoal[]>>({});
  const [ratingOptions, setRatingOptions] = useState<AdminBracketRatingOptions | null>(null);
  const [matchRatings, setMatchRatings] = useState<Record<string, { counted: boolean; reason: string | null }>>({});

  const [scoreModal, setScoreModal] = useState<Match | null>(null);
  const [scoreA, setScoreA] = useState("");
  const [scoreB, setScoreB] = useState("");
  const [goals, setGoals] = useState<GoalDraft[]>([]);
  const [playerPickerIndex, setPlayerPickerIndex] = useState<number | null>(null);
  const [playerSearch, setPlayerSearch] = useState("");
  /** Who won on penalties, for a knockout match whose score is level. */
  const [penaltyWinner, setPenaltyWinner] = useState<string | null>(null);

  useEffect(() => {
    navigation.setOptions({ title: "Tournament Bracket" });
  }, [navigation]);

  const load = useCallback(async () => {
    if (!token || !tournament_id) return;
    if (!siteOrigin()) {
      Alert.alert("Config", "Set EXPO_PUBLIC_SITE_URL in mobile/.env");
      return;
    }
    setLoading(true);
    try {
      const res = await fetchAdminTournamentBracket(token, tournament_id);
      if (!res.ok) {
        Alert.alert("Error", res.error);
        return;
      }
      const data = res.data;
      const loadedTeams = (data.teams ?? []) as Team[];
      setTeams(loadedTeams);
      const map: Record<string, Team> = {};
      for (const t of loadedTeams) map[t.id] = t;
      setTeamMap(map);
      setMatches((data.matches ?? []) as Match[]);
      setStandings((data.standings ?? []) as GroupMember[]);
      setRosterPlayers(Array.isArray(data.roster_players) ? data.roster_players : []);
      setMatchGoalsById(parseMatchGoals(data.match_goals));
      setRatingOptions(data.rating_options ?? null);
      setMatchRatings(data.match_ratings ?? {});
    } finally {
      setLoading(false);
    }
  }, [token, tournament_id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!supabase || !tournament_id) return;
    const topic = `admin-tournament-bracket:${tournament_id}`;
    const channel = supabase
      .channel(topic)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tournament_matches",
          filter: `tournament_id=eq.${tournament_id}`,
        },
        () => {
          void load();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tournament_group_members",
          filter: `tournament_id=eq.${tournament_id}`,
        },
        () => {
          void load();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tournament_match_goals",
          filter: `tournament_id=eq.${tournament_id}`,
        },
        () => {
          void load();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, tournament_id, load]);

  type BracketPostResult = { ok?: boolean; message?: string; error?: string; warnings?: string[]; status?: number; detail?: unknown; rating?: { status: string; counted: boolean; reason: string | null } };
  async function postBracket(action: string, extra?: Record<string, unknown>): Promise<BracketPostResult> {
    if (!token) return { error: "Not signed in" };
    const res = await postAdminTournamentBracket(token, { action, tournament_id, ...extra });
    if (!res.ok) return { error: res.error, status: res.status, detail: res.detail };
    return res.data ?? { ok: true };
  }

  /** Rated and Counts for season. Rated is refused by the server once a match has a score; the switch is also off then. */
  async function onSetRatingOption(patch: { rated?: boolean; count_for_season?: boolean }) {
    setBusy("rating");
    const j = await postBracket("set_rating_options", patch);
    setBusy(null);
    if (j.error) {
      Alert.alert("Can’t change that", j.error);
    }
    void load();
  }

  async function onGenerate() {
    Alert.alert("Generate bracket?", "This will shuffle teams into groups and create all group stage matches.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Generate",
        onPress: async () => {
          setBusy("generate");
          const j = await postBracket("generate");
          setBusy(null);
          if (j.error) {
            Alert.alert("Error", j.error);
            return;
          }
          Alert.alert("Done", typeof j.message === "string" ? j.message : "Groups generated.");
          void load();
        },
      },
    ]);
  }

  async function onGenerateKnockout() {
    Alert.alert("Generate knockout?", "This will advance top 2 from each group to knockout stage.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Generate",
        onPress: async () => {
          setBusy("knockout");
          const j = await postBracket("generate_knockout");
          setBusy(null);
          if (j.error) {
            Alert.alert("Error", j.error);
            return;
          }
          Alert.alert("Done", typeof j.message === "string" ? j.message : "Knockout generated.");
          void load();
        },
      },
    ]);
  }

  function closeScoreModal() {
    setPenaltyWinner(null);
    setScoreModal(null);
    setScoreA("");
    setScoreB("");
    setGoals([]);
    setPlayerPickerIndex(null);
    setPlayerSearch("");
  }

  function openScoreModal(match: Match) {
    if (match.is_bye || !match.team_b_id) return;
    setScoreModal(match);
    setScoreA(match.score_a !== null ? String(match.score_a) : "");
    setScoreB(match.score_b !== null ? String(match.score_b) : "");
    setPenaltyWinner(match.score_a !== null && match.score_a === match.score_b ? match.winner_id : null);
    setGoals(goalsToDraft(matchGoalsById[match.id] ?? []));
    setPlayerPickerIndex(null);
    setPlayerSearch("");
  }

  function addGoal() {
    if (!scoreModal) return;
    setGoals((g) => {
      setPlayerPickerIndex(g.length);
      setPlayerSearch("");
      return [
        ...g,
        { scorer_name: "", team_id: scoreModal.team_a_id, minute: "", is_own_goal: false },
      ];
    });
  }

  const isKnockoutMatch = (m: Match | null) => !!m && (m.stage === "qf" || m.stage === "sf" || m.stage === "final");
  const parsedA = parseInt(scoreA, 10);
  const parsedB = parseInt(scoreB, 10);
  /** A knockout match can't end level: when the score is level the admin names who won on penalties. */
  const needsPenaltyWinner = isKnockoutMatch(scoreModal) && Number.isFinite(parsedA) && Number.isFinite(parsedB) && parsedA === parsedB;

  async function sendScore(sa: number, sb: number, payloadGoals: unknown[], confirmReset: boolean) {
    if (!scoreModal) return;
    setBusy("score");
    const j = await postBracket("log_score", {
      match_id: scoreModal.id,
      score_a: sa,
      score_b: sb,
      goals: payloadGoals,
      ...(needsPenaltyWinner ? { winner_id: penaltyWinner } : {}),
      ...(confirmReset ? { confirm_reset: true } : {}),
    });
    setBusy(null);
    if (j.error) {
      const detail = j.detail as { code?: string; affected?: string[] } | undefined;
      if (detail?.code === "confirm_reset") {
        const list = Array.isArray(detail.affected) && detail.affected.length ? detail.affected.join(", ") : "later matches";
        Alert.alert("This changes who plays next", `Saving will clear the result of: ${list}. Those matches get the new teams.`, [
          { text: "Cancel", style: "cancel" },
          { text: "Clear and save", style: "destructive", onPress: () => void sendScore(sa, sb, payloadGoals, true) },
        ]);
        return;
      }
      Alert.alert("Error", j.error);
      return;
    }
    const warnings = [...(Array.isArray(j.warnings) ? j.warnings : [])];
    // A rated match that did not count says why, in plain words. A match that counted, or any match of a tournament that is not rated, adds nothing here.
    if (j.rating && j.rating.status === "skipped" && j.rating.reason) warnings.push(ratingReasonText(j.rating.reason));
    closeScoreModal();
    void load();
    if (warnings.length) Alert.alert("Saved", warnings.join("\n"));
  }

  async function onLogScore() {
    if (!scoreModal) return;
    const sa = parseInt(scoreA, 10);
    const sb = parseInt(scoreB, 10);
    if (!Number.isFinite(sa) || !Number.isFinite(sb) || sa < 0 || sb < 0) {
      Alert.alert("Invalid scores", "Enter a non-negative whole number for each team.");
      return;
    }
    if (needsPenaltyWinner && !penaltyWinner) {
      Alert.alert("Pick the winner", "A knockout match can't end level. Pick the team that won on penalties.");
      return;
    }
    const payloadGoals = goals
      .filter((g) => g.scorer_name.trim())
      .map((g) => ({
        team_id: g.team_id,
        scorer_name: g.scorer_name.trim(),
        minute: g.minute.trim() ? parseInt(g.minute, 10) : null,
        is_own_goal: g.is_own_goal,
      }));
    await sendScore(sa, sb, payloadGoals, false);
  }

  async function onStartMatch(match: Match) {
    setBusy(`start:${match.id}`);
    const j = await postBracket("start_match", { match_id: match.id });
    setBusy(null);
    if (j.error) {
      Alert.alert("Error", j.error);
      return;
    }
    void load();
  }

  const pickerGoalTeamId = useMemo(() => {
    if (playerPickerIndex === null || !scoreModal) return null;
    return goals[playerPickerIndex]?.team_id ?? scoreModal.team_a_id;
  }, [playerPickerIndex, goals, scoreModal]);

  const filteredRosterPlayers = useMemo(() => {
    const q = playerSearch.trim().toLowerCase();
    return rosterPlayers.filter((p) => {
      if (pickerGoalTeamId && p.team_id !== pickerGoalTeamId) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || p.team_name.toLowerCase().includes(q);
    });
  }, [rosterPlayers, playerSearch, pickerGoalTeamId]);

  const groupNames = Array.from(new Set(matches.filter((m) => m.stage === "group").map((m) => m.group_name)));
  const knockoutMatches = matches.filter((m) => m.stage !== "group");
  const groupComplete = matches.filter((m) => m.stage === "group").every((m) => m.completed_at);

  const renderMatchRow = (match: Match) => {
    const scored = match.score_a !== null && match.score_b !== null;
    const canLog = !match.is_bye && !!match.team_b_id;
    const knockout = match.stage === "qf" || match.stage === "sf" || match.stage === "final";
    const penalties = knockout && !!match.completed_at && !!match.winner_id && scored && match.score_a === match.score_b;
    const inProgress = !match.completed_at && !!match.started_at && canLog;
    const canStart = canLog && !match.completed_at && !match.started_at;
    return (
      <View key={match.id}>
      <Pressable
        onPress={() => (canLog ? openScoreModal(match) : undefined)}
        disabled={!canLog}
        style={({ pressed }) => [
          styles.matchRow,
          scored && styles.matchRowScored,
          canLog && pressed && { opacity: 0.88 },
        ]}
        accessibilityRole={canLog ? "button" : undefined}
        accessibilityLabel={
          canLog
            ? `Log score for ${teamMap[match.team_a_id]?.team_name ?? "Team A"} vs ${teamMap[match.team_b_id!]?.team_name ?? "Team B"}`
            : undefined
        }
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.matchTeam} numberOfLines={1}>
            {teamMap[match.team_a_id]?.team_name || "TBD"}
          </Text>
        </View>
        <View style={styles.scoreBox}>
          <Text style={styles.scoreText}>
            {match.is_bye ? "BYE" : scored ? `${match.score_a} - ${match.score_b}` : "vs"}
          </Text>
          {canLog ? (
            <Text style={styles.logHint}>{scored ? "Edit score" : inProgress ? "In progress" : "Log score"}</Text>
          ) : null}
        </View>
        <View style={{ flex: 1, alignItems: "flex-end" }}>
          <Text style={styles.matchTeam} numberOfLines={1}>
            {match.team_b_id ? teamMap[match.team_b_id]?.team_name || "TBD" : "BYE"}
          </Text>
        </View>
      </Pressable>
      {penalties ? (
        <Text style={styles.penaltyNote}>{teamMap[match.winner_id!]?.team_name || "Winner"} won on penalties</Text>
      ) : null}
      {ratingOptions?.rated && matchRatings[match.id] ? (
        <Text style={styles.penaltyNote}>{ratingReasonText(matchRatings[match.id]!.counted ? null : matchRatings[match.id]!.reason)}</Text>
      ) : null}
      {knockout && match.completed_at && !match.winner_id ? (
        <Text style={styles.penaltyNote}>No winner saved. Edit the score and pick who won.</Text>
      ) : null}
      {canStart ? (
        <Pressable
          onPress={() => void onStartMatch(match)}
          disabled={busy === `start:${match.id}`}
          style={({ pressed }) => [styles.startBtn, pressed && { opacity: 0.88 }, busy === `start:${match.id}` && styles.disabled]}
          accessibilityRole="button"
          accessibilityLabel="Mark this match as in progress"
        >
          <Text style={styles.startBtnText}>{busy === `start:${match.id}` ? "Starting..." : "Start match"}</Text>
        </Pressable>
      ) : null}
      </View>
    );
  };

  if (!tournament_id) {
    return (
      <View style={[styles.root, styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.muted}>Missing tournament.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.content}>
        {loading && teams.length === 0 ? (
          <ActivityIndicator color={themeColor().pitchText} style={{ marginVertical: 16 }} />
        ) : null}

        <Text style={styles.title}>Bracket</Text>
        <Text style={styles.sub}>{teams.length} confirmed teams · tap a match to log score</Text>

        {ratingOptions ? (
          <View style={styles.ratingCard} accessibilityLabel="Rating settings">
            <View style={styles.ratingRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.ratingTitle}>{ratingOptions.rated_label}</Text>
                <Text style={styles.ratingNote}>{ratingOptions.rated_note}</Text>
              </View>
              <Switch
                value={ratingOptions.rated}
                onValueChange={(v) => void onSetRatingOption({ rated: v })}
                disabled={ratingOptions.rated_locked || busy === "rating"}
                trackColor={{ false: themeColor().overlayStrong, true: themeColor().pitch }}
                thumbColor={themeColor().text}
                accessibilityLabel="Rated"
              />
            </View>
            <View style={[styles.ratingRow, styles.ratingRowDivider]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.ratingTitle}>{ratingOptions.season_label}</Text>
                <Text style={styles.ratingNote}>{ratingOptions.season_note}</Text>
              </View>
              <Switch
                value={ratingOptions.count_for_season}
                onValueChange={(v) => void onSetRatingOption({ count_for_season: v })}
                disabled={busy === "rating"}
                trackColor={{ false: themeColor().overlayStrong, true: themeColor().pitch }}
                thumbColor={themeColor().text}
                accessibilityLabel="Counts for season"
              />
            </View>
          </View>
        ) : null}

        <View style={styles.btnRow}>
          <Pressable onPress={onGenerate} disabled={!!busy} style={[styles.btn, busy === "generate" && styles.disabled]}>
            <Text style={styles.btnText}>{busy === "generate" ? "Generating..." : "Generate Groups"}</Text>
          </Pressable>
          {groupComplete && knockoutMatches.length === 0 ? (
            <Pressable
              onPress={onGenerateKnockout}
              disabled={!!busy}
              style={[styles.btn, styles.btnSecondary, busy === "knockout" && styles.disabled]}
            >
              <Text style={styles.btnText}>{busy === "knockout" ? "..." : "Generate Knockout"}</Text>
            </Pressable>
          ) : null}
        </View>

        {groupNames.map((gName) => {
          const gStandings = standings
            .filter((s) => {
              const gMatch = matches.find(
                (m) => m.group_name === gName && (m.team_a_id === s.team_id || m.team_b_id === s.team_id),
              );
              return !!gMatch;
            })
            .sort(
              (a, b) =>
                b.points - a.points ||
                b.goal_difference - a.goal_difference ||
                b.goals_for - a.goals_for,
            );
          return (
            <View key={String(gName)} style={styles.section}>
              <Text style={styles.sectionTitle}>Group {gName}</Text>
              <View style={styles.standingsHeader}>
                <Text style={[styles.standingsCell, { flex: 3 }]}>Team</Text>
                <Text style={styles.standingsCell}>W</Text>
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

        {groupNames.map((gName) => (
          <View key={`m-${String(gName)}`} style={styles.section}>
            <Text style={styles.sectionTitle}>Group {gName} matches</Text>
            {matches.filter((m) => m.group_name === gName).map((match) => renderMatchRow(match))}
          </View>
        ))}

        {knockoutMatches.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Knockout stage</Text>
            {(["qf", "sf", "final"] as const).map((stage) => {
              const stageMatches = knockoutMatches.filter((m) => m.stage === stage);
              if (!stageMatches.length) return null;
              const stageLabel = stage === "qf" ? "Quarter-finals" : stage === "sf" ? "Semi-finals" : "Final";
              return (
                <View key={stage}>
                  <Text style={styles.stageLabel}>{stageLabel}</Text>
                  {stageMatches.map((match) => renderMatchRow(match))}
                </View>
              );
            })}
          </View>
        ) : null}

        {!loading && matches.length === 0 && teams.length > 0 ? (
          <Text style={styles.muted}>Generate groups to create matches.</Text>
        ) : null}
      </ScrollView>

      <Modal visible={!!scoreModal} transparent animationType="slide" onRequestClose={closeScoreModal}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable style={styles.modalBackdrop} onPress={closeScoreModal} accessibilityLabel="Dismiss" />
          <View style={styles.modalSheet}>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalScroll}>
              <Text style={styles.modalTitle}>Log score</Text>
              {scoreModal ? (
                <>
                  <Text style={styles.modalMatchup}>
                    {teamMap[scoreModal.team_a_id]?.team_name || "Team A"} vs{" "}
                    {teamMap[scoreModal.team_b_id!]?.team_name || "Team B"}
                  </Text>
                  <View style={styles.scoreInputRow}>
                    <View style={styles.scoreInputBox}>
                      <Text style={styles.scoreInputLabel}>
                        {teamMap[scoreModal.team_a_id]?.team_name || "Team A"}
                      </Text>
                      <TextInput
                        style={styles.scoreInput}
                        value={scoreA}
                        onChangeText={setScoreA}
                        keyboardType="number-pad"
                        placeholder="0"
                        placeholderTextColor={themeColor().muted}
                      />
                    </View>
                    <Text style={styles.scoreDash}>—</Text>
                    <View style={styles.scoreInputBox}>
                      <Text style={styles.scoreInputLabel}>
                        {teamMap[scoreModal.team_b_id!]?.team_name || "Team B"}
                      </Text>
                      <TextInput
                        style={styles.scoreInput}
                        value={scoreB}
                        onChangeText={setScoreB}
                        keyboardType="number-pad"
                        placeholder="0"
                        placeholderTextColor={themeColor().muted}
                      />
                    </View>
                  </View>

                  {needsPenaltyWinner ? (
                    <View style={styles.penaltyBox}>
                      <Text style={styles.modalSubtitle}>Level after full time</Text>
                      <Text style={styles.mutedSmall}>A knockout match cannot end level. Pick the team that won on penalties.</Text>
                      <View style={styles.penaltyRow}>
                        {[scoreModal.team_a_id, scoreModal.team_b_id].map((id) =>
                          id ? (
                            <Pressable
                              key={id}
                              onPress={() => setPenaltyWinner(id)}
                              style={[styles.penaltyPick, penaltyWinner === id && styles.penaltyPickOn]}
                              accessibilityRole="button"
                              accessibilityState={{ selected: penaltyWinner === id }}
                            >
                              <Text style={[styles.penaltyPickText, penaltyWinner === id && styles.penaltyPickTextOn]} numberOfLines={1}>
                                {teamMap[id]?.team_name || "Team"}
                              </Text>
                            </Pressable>
                          ) : null,
                        )}
                      </View>
                    </View>
                  ) : null}

                  <Text style={styles.modalSubtitle}>Goal scorers</Text>
                  {rosterPlayers.length === 0 ? (
                    <Text style={styles.mutedSmall}>No roster players loaded yet. Add goals after roster is set.</Text>
                  ) : null}

                  {goals.map((g, i) => (
                    <View key={`goal-${i}`} style={styles.goalRow}>
                      <Pressable
                        onPress={() => {
                          setPlayerPickerIndex(i);
                          setPlayerSearch("");
                        }}
                        style={({ pressed }) => [styles.playerPickBtn, pressed && { opacity: 0.9 }]}
                      >
                        <Text style={g.scorer_name ? styles.playerPickText : styles.playerPickPlaceholder} numberOfLines={1}>
                          {g.scorer_name || "Select player"}
                        </Text>
                      </Pressable>
                      <TextInput
                        style={styles.minuteInput}
                        value={g.minute}
                        onChangeText={(v) => setGoals((gs) => gs.map((x, j) => (j === i ? { ...x, minute: v } : x)))}
                        placeholder="Min"
                        placeholderTextColor={themeColor().muted}
                        keyboardType="number-pad"
                      />
                      <Pressable
                        onPress={() =>
                          setGoals((gs) =>
                            gs.map((x, j) =>
                              j === i
                                ? {
                                    ...x,
                                    team_id:
                                      x.team_id === scoreModal.team_a_id
                                        ? scoreModal.team_b_id || scoreModal.team_a_id
                                        : scoreModal.team_a_id,
                                  }
                                : x,
                            ),
                          )
                        }
                        style={[
                          styles.teamToggle,
                          g.team_id === scoreModal.team_a_id ? styles.teamToggleA : styles.teamToggleB,
                        ]}
                      >
                        <Text style={styles.teamToggleText}>
                          {g.team_id === scoreModal.team_a_id ? "A" : "B"}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          setGoals((gs) => gs.filter((_, j) => j !== i));
                          if (playerPickerIndex === i) setPlayerPickerIndex(null);
                        }}
                        style={styles.removeGoalBtn}
                        accessibilityLabel="Remove goal"
                      >
                        <Text style={styles.removeGoalText}>×</Text>
                      </Pressable>
                    </View>
                  ))}

                  {playerPickerIndex !== null && scoreModal ? (
                    <View style={styles.pickerPanel}>
                      <TextInput
                        style={styles.pickerSearch}
                        value={playerSearch}
                        onChangeText={setPlayerSearch}
                        placeholder="Search roster…"
                        placeholderTextColor={themeColor().muted}
                        autoFocus
                      />
                      <ScrollView style={styles.pickerList} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                        {filteredRosterPlayers.length === 0 ? (
                          <Text style={styles.mutedSmall}>No players match.</Text>
                        ) : (
                          filteredRosterPlayers.map((p) => (
                            <Pressable
                              key={`${p.team_id}-${p.name}`}
                              onPress={() => {
                                setGoals((gs) =>
                                  gs.map((x, j) =>
                                    j === playerPickerIndex
                                      ? { ...x, scorer_name: p.name, team_id: p.team_id }
                                      : x,
                                  ),
                                );
                                setPlayerPickerIndex(null);
                                setPlayerSearch("");
                              }}
                              style={({ pressed }) => [styles.pickerRow, pressed && { opacity: 0.88 }]}
                            >
                              <Text style={styles.pickerName} numberOfLines={1}>
                                {p.name}
                              </Text>
                              <Text style={styles.pickerTeam} numberOfLines={1}>
                                {p.team_name}
                              </Text>
                            </Pressable>
                          ))
                        )}
                      </ScrollView>
                    </View>
                  ) : null}

                  <Pressable onPress={addGoal} style={styles.addGoalBtn} disabled={!rosterPlayers.length}>
                    <Text style={styles.addGoalText}>+ Add goal scorer</Text>
                  </Pressable>

                  <View style={styles.modalBtnRow}>
                    <Pressable onPress={closeScoreModal} style={styles.cancelBtn}>
                      <Text style={styles.cancelBtnText}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => void onLogScore()}
                      disabled={busy === "score"}
                      style={[styles.saveBtn, busy === "score" && styles.disabled]}
                    >
                      <Text style={styles.saveBtnText}>{busy === "score" ? "Saving..." : "Save score"}</Text>
                    </Pressable>
                  </View>
                </>
              ) : null}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function make_styles() {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: themeColor().bg },
  centered: { justifyContent: "center", alignItems: "center", padding: 24 },
  content: { padding: 16, paddingBottom: 60 },
  title: { color: themeColor().text, fontSize: 24, ...headline },
  sub: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4, marginBottom: 16 },
  muted: { color: themeColor().muted, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  mutedSmall: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 8 },
  btnRow: { flexDirection: "row", gap: 8, marginBottom: 20 },
  btn: { flex: 1, backgroundColor: themeColor().pitch, borderRadius: 10, padding: 12, alignItems: "center" },
  btnSecondary: { backgroundColor: themeColor().pitchPanel, borderWidth: 1, borderColor: themeColor().pitchText },
  btnText: { color: themeColor().onPitch, fontWeight: "800", fontSize: 13, fontFamily: "Inter_700Bold" },
  disabled: { opacity: 0.5 },
  ratingCard: { backgroundColor: themeColor().card, borderRadius: 12, borderWidth: 1, borderColor: themeColor().line, padding: 14, marginBottom: 16 },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  ratingRowDivider: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: themeColor().line },
  ratingTitle: { color: themeColor().text, fontSize: 15, fontFamily: "Inter_700Bold", fontWeight: "700" },
  ratingNote: { color: themeColor().muted, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17, marginTop: 2 },
  penaltyNote: { color: themeColor().muted, fontSize: 12, fontFamily: "Inter_400Regular", marginTop: -4, marginBottom: 6, paddingHorizontal: 12 },
  startBtn: {
    alignSelf: "flex-start",
    marginTop: -2,
    marginBottom: 8,
    marginLeft: 12,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: themeColor().pitchText,
    backgroundColor: themeColor().pitchPanel,
  },
  startBtnText: { color: themeColor().onPitchPanel, fontSize: 12, fontFamily: "Inter_700Bold", fontWeight: "800" },
  penaltyBox: { marginBottom: 12 },
  penaltyRow: { flexDirection: "row", gap: 8 },
  penaltyPick: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: themeColor().card,
    borderWidth: 1,
    borderColor: themeColor().line,
  },
  penaltyPickOn: { backgroundColor: themeColor().pitchPanel, borderColor: themeColor().pitchText },
  penaltyPickText: { color: themeColor().text, fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "700" },
  penaltyPickTextOn: { color: themeColor().pitchText },
  section: { marginBottom: 20 },
  sectionTitle: {
    color: themeColor().pitchText,
    fontSize: 13, fontFamily: "Inter_700Bold",
    fontWeight: "800",
    marginBottom: 8,
  },
  stageLabel: {
    color: themeColor().muted,
    fontSize: 11, fontFamily: "Inter_700Bold",
    fontWeight: "700",
    marginTop: 8,
    marginBottom: 4,
  },
  standingsHeader: { flexDirection: "row", paddingHorizontal: 8, marginBottom: 4 },
  standingsRow: { flexDirection: "row", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  standingsRowQualify: { backgroundColor: themeColor().pitchPanel, borderLeftWidth: 2, borderLeftColor: themeColor().pitch },
  standingsCell: { flex: 1, color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  standingsCellName: { color: themeColor().text, fontWeight: "700", textAlign: "left" },
  standingsPts: { color: themeColor().pitchText, fontWeight: "800" },
  matchRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: themeColor().card,
    borderRadius: 10,
    padding: 12,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: themeColor().line,
  },
  matchRowScored: { borderColor: themeColor().pitchText },
  matchTeam: { color: themeColor().text, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700" },
  scoreBox: { paddingHorizontal: 12, alignItems: "center" },
  scoreText: { color: themeColor().pitchText, fontWeight: "800", fontSize: 14, fontFamily: "Inter_700Bold" },
  logHint: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_600SemiBold", marginTop: 4, fontWeight: "600" },
  modalOverlay: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: themeColor().scrim },
  modalSheet: {
    backgroundColor: themeColor().bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "88%",
    borderWidth: 1,
    borderColor: themeColor().line,
  },
  modalScroll: { padding: 20, paddingBottom: 36 },
  modalTitle: { color: themeColor().text, fontSize: 20, ...headline, marginBottom: 4 },
  modalMatchup: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 16 },
  scoreInputRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16, marginBottom: 20 },
  scoreInputBox: { alignItems: "center" },
  scoreInputLabel: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 4, maxWidth: 120 },
  scoreInput: {
    backgroundColor: themeColor().card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: themeColor().line,
    color: themeColor().text,
    fontSize: 24, ...headline,
    textAlign: "center",
    width: 70,
    padding: 8,
  },
  scoreDash: { color: themeColor().muted, fontSize: 24, ...headline },
  modalSubtitle: {
    color: themeColor().muted,
    fontSize: 13, fontFamily: "Inter_700Bold",
    fontWeight: "700",
    marginBottom: 8,
  },
  goalRow: { flexDirection: "row", gap: 8, marginBottom: 8, alignItems: "center" },
  playerPickBtn: {
    flex: 1,
    backgroundColor: themeColor().card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: themeColor().line,
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  playerPickText: { color: themeColor().text, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700" },
  playerPickPlaceholder: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular" },
  minuteInput: {
    width: 52,
    backgroundColor: themeColor().card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: themeColor().line,
    color: themeColor().text,
    padding: 8,
    fontSize: 13, fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  teamToggle: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  teamToggleA: { backgroundColor: themeColor().pitchPanel, borderWidth: 1, borderColor: themeColor().pitchText },
  teamToggleB: { backgroundColor: themeColor().card, borderWidth: 1, borderColor: themeColor().line },
  teamToggleText: { color: themeColor().text, fontWeight: "800", fontSize: 13, fontFamily: "Inter_700Bold" },
  removeGoalBtn: {
    width: 32,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  removeGoalText: { color: themeColor().muted, fontSize: 24, ...headline },
  pickerPanel: {
    marginBottom: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: themeColor().pitchText,
    backgroundColor: themeColor().card,
    padding: 8,
  },
  pickerSearch: {
    backgroundColor: themeColor().card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: themeColor().line,
    color: themeColor().text,
    padding: 8,
    fontSize: 14, fontFamily: "Inter_400Regular",
    marginBottom: 8,
  },
  pickerList: { maxHeight: 160 },
  pickerRow: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: themeColor().line,
  },
  pickerName: { color: themeColor().text, fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "700" },
  pickerTeam: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4 },
  addGoalBtn: { marginBottom: 16 },
  addGoalText: { color: themeColor().pitchText, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700" },
  modalBtnRow: { flexDirection: "row", gap: 8 },
  cancelBtn: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: themeColor().line,
    alignItems: "center",
  },
  cancelBtnText: { color: themeColor().muted, fontWeight: "700" },
  saveBtn: { flex: 1, backgroundColor: themeColor().pitch, padding: 12, borderRadius: 10, alignItems: "center" },
  saveBtnText: { color: themeColor().onPitch, fontWeight: "800", fontSize: 16, fontFamily: "Inter_700Bold" },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}

