import { useAuth } from "@/context/AuthContext";
import {
  fetchTournamentBracketPlayer,
  fetchTournamentMvpVotes,
  postTournamentMvpVote,
  type TournamentMvpTally,
} from "@/lib/siteApi";
import { siteOrigin } from "@/lib/env";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { themeColor, useThemedStyles } from "@/theme";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

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
type TopScorer = { scorer_name: string; goals: number; rank: number };

type MvpMatchInfo = {
  tallies: TournamentMvpTally[];
  my_vote: string | null;
  can_vote: boolean;
  eligible_players: string[];
};

type TabId = "standings" | "bracket" | "scorers";

function matchIsMvpVotable(m: Match): boolean {
  if (!m.team_b_id || m.is_bye) return false;
  return m.score_a !== null && m.score_b !== null;
}

function parseMvpResponse(json: unknown): MvpMatchInfo | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const tallies: TournamentMvpTally[] = [];
  if (Array.isArray(o.tallies)) {
    for (const x of o.tallies) {
      if (!x || typeof x !== "object") continue;
      const r = x as Record<string, unknown>;
      const name = typeof r.name === "string" ? r.name.trim() : "";
      const votes = Number(r.votes);
      if (!name || !Number.isFinite(votes) || votes < 0) continue;
      tallies.push({
        name,
        votes: Math.trunc(votes),
        is_winner: r.is_winner === true,
      });
    }
  }
  const my_vote = typeof o.my_vote === "string" && o.my_vote.trim() ? o.my_vote.trim() : null;
  const can_vote = o.can_vote === true;
  const eligible_players: string[] = [];
  if (Array.isArray(o.eligible_players)) {
    for (const x of o.eligible_players) {
      if (typeof x === "string" && x.trim()) eligible_players.push(x.trim());
    }
  }
  return { tallies, my_vote, can_vote, eligible_players };
}

function topMvpDisplay(tallies: TournamentMvpTally[]): { name: string; votes: number } | null {
  if (!tallies.length) return null;
  const winner = tallies.find((t) => t.is_winner) ?? tallies[0];
  return { name: winner.name, votes: winner.votes };
}

function parseTopScorers(raw: unknown): TopScorer[] {
  if (!Array.isArray(raw)) return [];
  const out: TopScorer[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    const scorer_name = typeof r.scorer_name === "string" ? r.scorer_name.trim() : "";
    const goals = Number(r.goals);
    const rank = Number(r.rank);
    if (!scorer_name || !Number.isFinite(goals) || goals < 0) continue;
    out.push({
      scorer_name,
      goals: Math.trunc(goals),
      rank: Number.isFinite(rank) && rank > 0 ? Math.trunc(rank) : out.length + 1,
    });
  }
  return out;
}

function parseBracket(
  json: unknown,
): { teams: Team[]; matches: Match[]; standings: GroupMember[]; top_scorers: TopScorer[] } | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (!Array.isArray(o.teams) || !Array.isArray(o.matches) || !Array.isArray(o.standings)) return null;
  return {
    teams: o.teams as Team[],
    matches: o.matches as Match[],
    standings: o.standings as GroupMember[],
    top_scorers: parseTopScorers(o.top_scorers),
  };
}

function rankMedal(rank: number): string {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return "";
}

export default function TournamentBracketViewScreen() {
  useThemedStyles(publish_styles);

  const navigation = useNavigation();
  const params = useLocalSearchParams<{ tournament_id?: string | string[] }>();
  const raw = params.tournament_id;
  const tournamentId = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : "";
  const { session, supabase } = useAuth();
  const token = session?.access_token;

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [standings, setStandings] = useState<GroupMember[]>([]);
  const [topScorers, setTopScorers] = useState<TopScorer[]>([]);
  const [teamMap, setTeamMap] = useState<Record<string, Team>>({});
  const [tab, setTab] = useState<TabId>("standings");
  const [mvpByMatchId, setMvpByMatchId] = useState<Record<string, MvpMatchInfo>>({});
  const [mvpModalMatchId, setMvpModalMatchId] = useState<string | null>(null);
  const [mvpSelectedName, setMvpSelectedName] = useState<string | null>(null);
  const [mvpSubmitBusy, setMvpSubmitBusy] = useState(false);
  const matchesRef = useRef<Match[]>([]);

  useEffect(() => {
    navigation.setOptions({
      title: "Live bracket",
      headerStyle: { backgroundColor: themeColor().bg },
      headerTintColor: themeColor().text,
    });
  }, [navigation]);

  useEffect(() => {
    matchesRef.current = matches;
  }, [matches]);

  const load = useCallback(async () => {
    if (!token || !tournamentId) return;
    if (!siteOrigin()) {
      setLoadError("Set EXPO_PUBLIC_SITE_URL in mobile/.env");
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const r = await fetchTournamentBracketPlayer(token, tournamentId);
      if (!r.ok) {
        const j = r.json && typeof r.json === "object" ? (r.json as Record<string, unknown>) : null;
        const msg = typeof j?.error === "string" ? j.error : null;
        if (r.status === 403) {
          setLoadError(msg || "You need an approved account to view this bracket.");
        } else if (r.status === 401) {
          setLoadError(msg || "Sign in again to view the bracket.");
        } else {
          setLoadError(msg || "Could not load bracket.");
        }
        setTeams([]);
        setMatches([]);
        setStandings([]);
        setTopScorers([]);
        setTeamMap({});
        return;
      }
      const parsed = parseBracket(r.json);
      if (!parsed) {
        setLoadError("Invalid response from server.");
        setTeams([]);
        setMatches([]);
        setStandings([]);
        setTopScorers([]);
        setTeamMap({});
        return;
      }
      setTeams(parsed.teams);
      const map: Record<string, Team> = {};
      for (const t of parsed.teams) map[t.id] = t;
      setTeamMap(map);
      setMatches(parsed.matches);
      setStandings(parsed.standings);
      setTopScorers(parsed.top_scorers);
    } finally {
      setLoading(false);
    }
  }, [token, tournamentId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!supabase || !tournamentId) return;
    const topic = `tournament-bracket:${tournamentId}`;
    const channel = supabase
      .channel(topic)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tournament_matches",
          filter: `tournament_id=eq.${tournamentId}`,
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
          filter: `tournament_id=eq.${tournamentId}`,
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
          filter: `tournament_id=eq.${tournamentId}`,
        },
        () => {
          void load();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, tournamentId, load]);

  const refreshMvpVotes = useCallback(async (authToken: string, matchList: Match[]) => {
    const ids = matchList.filter(matchIsMvpVotable).map((m) => m.id);
    if (!ids.length || !siteOrigin()) {
      setMvpByMatchId({});
      return;
    }
    const entries = await Promise.all(
      ids.map(async (id) => {
        const r = await fetchTournamentMvpVotes(authToken, id);
        const parsed = r.ok && r.json ? parseMvpResponse(r.json) : null;
        const fallback: MvpMatchInfo = {
          tallies: [],
          my_vote: null,
          can_vote: false,
          eligible_players: [],
        };
        return [id, parsed ?? fallback] as const;
      }),
    );
    setMvpByMatchId(Object.fromEntries(entries));
  }, []);

  const mvpFingerprint = useMemo(
    () =>
      matches
        .filter(matchIsMvpVotable)
        .map((m) => `${m.id}:${m.score_a}:${m.score_b}`)
        .sort()
        .join("|"),
    [matches],
  );

  useEffect(() => {
    if (!token) return;
    void refreshMvpVotes(token, matches);
  }, [token, mvpFingerprint, matches, refreshMvpVotes]);

  useEffect(() => {
    if (!supabase || !tournamentId || !token) return;
    const ids = matchesRef.current.filter(matchIsMvpVotable).map((m) => m.id);
    if (!ids.length) return;
    const filter = `match_id=in.(${ids.join(",")})`;
    const ch = supabase
      .channel(`tournament-mvp-votes:${tournamentId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tournament_mvp_votes",
          filter,
        },
        () => {
          void refreshMvpVotes(token, matchesRef.current);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [supabase, tournamentId, token, mvpFingerprint, refreshMvpVotes]);

  const closeMvpModal = useCallback(() => {
    setMvpModalMatchId(null);
    setMvpSelectedName(null);
  }, []);

  const submitMvpVote = useCallback(async () => {
    if (!token || !mvpModalMatchId || !mvpSelectedName) return;
    setMvpSubmitBusy(true);
    try {
      const r = await postTournamentMvpVote(token, mvpModalMatchId, mvpSelectedName);
      if (r.ok) {
        closeMvpModal();
        await refreshMvpVotes(token, matchesRef.current);
      }
    } finally {
      setMvpSubmitBusy(false);
    }
  }, [token, mvpModalMatchId, mvpSelectedName, closeMvpModal, refreshMvpVotes]);

  const groupNames = Array.from(new Set(matches.filter((m) => m.stage === "group").map((m) => m.group_name)));
  const knockoutMatches = matches.filter((m) => m.stage !== "group");

  if (!token) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Sign in to view the live bracket.</Text>
      </View>
    );
  }

  if (!tournamentId) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Missing tournament.</Text>
      </View>
    );
  }

  const renderBracketMatchCard = (match: Match) => {
    const mvp = mvpByMatchId[match.id];
    const votable = matchIsMvpVotable(match);
    const top = mvp?.tallies?.length ? topMvpDisplay(mvp.tallies) : null;
    const scoreLabel =
      match.is_bye && match.stage !== "group"
        ? "BYE"
        : match.score_a !== null && match.score_b !== null
          ? `${match.score_a} - ${match.score_b}`
          : "vs";
    const openVote = () => {
      if (!mvp?.can_vote || !mvp.eligible_players.length) return;
      setMvpModalMatchId(match.id);
      setMvpSelectedName(null);
    };
    return (
      <View key={match.id} style={styles.matchCard}>
        <View style={styles.matchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.matchTeam} numberOfLines={1}>
              {match.team_a_id ? teamMap[match.team_a_id]?.team_name || "TBD" : "TBD"}
            </Text>
          </View>
          <View style={styles.scoreBox}>
            <Text style={styles.scoreText}>{scoreLabel}</Text>
          </View>
          <View style={{ flex: 1, alignItems: "flex-end" }}>
            <Text style={styles.matchTeam} numberOfLines={1}>
              {match.team_b_id ? teamMap[match.team_b_id]?.team_name || "TBD" : "BYE"}
            </Text>
          </View>
        </View>
        {votable ? (
          <View style={styles.mvpRow}>
            {mvp?.can_vote ? (
              <Pressable
                onPress={openVote}
                style={({ pressed }) => [styles.mvpVoteBtn, pressed && { opacity: 0.88 }]}
                accessibilityRole="button"
                accessibilityLabel="Vote for match MVP"
              >
                <Text style={styles.mvpVoteBtnText}>Vote MVP ⭐</Text>
              </Pressable>
            ) : top ? (
              <Text style={styles.mvpResultText}>
                MVP: {top.name} ⭐ ({top.votes} {top.votes === 1 ? "vote" : "votes"})
              </Text>
            ) : (
              <Text style={styles.mvpMutedSmall}>No MVP votes yet</Text>
            )}
          </View>
        ) : null}
      </View>
    );
  };

  const mvpModalPlayers = mvpModalMatchId ? mvpByMatchId[mvpModalMatchId]?.eligible_players ?? [] : [];

  return (
    <>
    <View style={styles.root}>
      <View style={styles.tabRow}>
        {(
          [
            ["standings", "Standings"],
            ["bracket", "Bracket"],
            ["scorers", "Top Scorers ⚽"],
          ] as const
        ).map(([id, label]) => (
          <Pressable
            key={id}
            onPress={() => setTab(id)}
            style={({ pressed }) => [
              styles.tab,
              tab === id && styles.tabActive,
              pressed && { opacity: 0.85 },
            ]}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === id }}
          >
            <Text style={[styles.tabText, tab === id && styles.tabTextActive]} numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {loadError ? <Text style={styles.err}>{loadError}</Text> : null}

        {tab === "standings" ? (
          <>
            {loading && teams.length === 0 ? (
              <ActivityIndicator color={themeColor().pitchText} style={{ marginVertical: 24 }} />
            ) : null}
            <Text style={styles.title}>Standings</Text>
            <Text style={styles.sub}>{teams.length} confirmed teams</Text>

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

            {!loading && matches.length === 0 && teams.length === 0 ? (
              <Text style={styles.muted}>Bracket data will appear when staff generate groups.</Text>
            ) : null}
          </>
        ) : null}

        {tab === "bracket" ? (
          <>
            {loading && teams.length === 0 ? (
              <ActivityIndicator color={themeColor().pitchText} style={{ marginVertical: 24 }} />
            ) : null}
            <Text style={styles.title}>Bracket</Text>
            <Text style={styles.sub}>{teams.length} confirmed teams</Text>

            {groupNames.map((gName) => (
              <View key={`m-${String(gName)}`} style={styles.section}>
                <Text style={styles.sectionTitle}>Group {gName} matches</Text>
                {matches
                  .filter((m) => m.group_name === gName)
                  .map((match) => renderBracketMatchCard(match))}
              </View>
            ))}

            {knockoutMatches.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Knockout</Text>
                {(["qf", "sf", "final"] as const).map((stage) => {
                  const stageMatches = knockoutMatches.filter((m) => m.stage === stage);
                  if (!stageMatches.length) return null;
                  const stageLabel = stage === "qf" ? "Quarter-finals" : stage === "sf" ? "Semi-finals" : "Final";
                  return (
                    <View key={stage}>
                      <Text style={styles.stageLabel}>{stageLabel}</Text>
                      {stageMatches.map((match) => renderBracketMatchCard(match))}
                    </View>
                  );
                })}
              </View>
            ) : null}

            {!loading && matches.length === 0 && teams.length === 0 ? (
              <Text style={styles.muted}>Bracket data will appear when staff generate groups.</Text>
            ) : null}
          </>
        ) : null}

        {tab === "scorers" ? (
          <>
            {loading ? <ActivityIndicator color={themeColor().pitchText} style={{ marginVertical: 24 }} /> : null}
            <Text style={styles.title}>Top scorers</Text>
            <Text style={styles.sub}>Goals in this tournament</Text>

            {!loading && topScorers.length === 0 ? (
              <Text style={styles.muted}>No goals recorded yet</Text>
            ) : null}

            {!loading && topScorers.length > 0
              ? topScorers.map((row) => {
                  const isTop = row.rank === 1;
                  const medal = rankMedal(row.rank);
                  return (
                    <View
                      key={`${row.rank}-${row.scorer_name}`}
                      style={[styles.scorerRow, isTop && styles.scorerRowTop]}
                    >
                      <Text style={styles.scorerRank}>
                        {medal ? `${medal} ` : ""}
                        {row.rank}
                      </Text>
                      <Text style={styles.scorerName} numberOfLines={1}>
                        {row.scorer_name}
                      </Text>
                      <Text style={styles.scorerGoals}>{row.goals}</Text>
                    </View>
                  );
                })
              : null}
          </>
        ) : null}
      </ScrollView>
    </View>

    <Modal
      visible={mvpModalMatchId !== null}
      animationType="slide"
      transparent
      onRequestClose={closeMvpModal}
    >
      <KeyboardAvoidingView
        style={styles.mvpModalBackdrop}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable style={styles.mvpModalBackdropPress} onPress={closeMvpModal} accessibilityLabel="Dismiss" />
        <View style={styles.mvpModalSheet}>
          <Text style={styles.mvpModalTitle}>Pick match MVP</Text>
          <Text style={styles.mvpModalHint}>Tap a name to select. Tap again to clear.</Text>
          <ScrollView style={styles.mvpModalList} keyboardShouldPersistTaps="handled">
            {mvpModalPlayers.map((name) => {
              const selected = mvpSelectedName === name;
              return (
                <Pressable
                  key={name}
                  onPress={() => setMvpSelectedName((prev) => (prev === name ? null : name))}
                  style={({ pressed }) => [
                    styles.mvpNameRow,
                    selected && styles.mvpNameRowSelected,
                    pressed && { opacity: 0.9 },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.mvpNameText, selected && styles.mvpNameTextSelected]} numberOfLines={2}>
                    {name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable
            style={[
              styles.mvpSubmitBtn,
              (!mvpSelectedName || mvpSubmitBusy) && styles.mvpSubmitBtnDisabled,
            ]}
            disabled={!mvpSelectedName || mvpSubmitBusy}
            onPress={() => void submitMvpVote()}
            accessibilityRole="button"
          >
            {mvpSubmitBusy ? (
              <ActivityIndicator color={themeColor().onPitch} size="small" />
            ) : (
              <Text style={styles.mvpSubmitBtnText}>Submit Vote</Text>
            )}
          </Pressable>
          <Pressable onPress={closeMvpModal} style={styles.mvpModalClose}>
            <Text style={styles.mvpModalCloseText}>Cancel</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
    </>
  );
}

function make_styles() {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: themeColor().bg },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 48 },
  center: { flex: 1, backgroundColor: themeColor().bg, justifyContent: "center", padding: 24 },
  tabRow: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: themeColor().line,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 10,
    backgroundColor: themeColor().overlaySubtle,
    borderWidth: 1,
    borderColor: themeColor().line,
    alignItems: "center",
    justifyContent: "center",
  },
  tabActive: {
    backgroundColor: themeColor().pitchPanel,
    borderColor: themeColor().pitch,
  },
  tabText: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700", textAlign: "center" },
  tabTextActive: { color: themeColor().text },
  title: { color: themeColor().text, fontSize: 24, fontFamily: "InstrumentSerif_400Regular", fontWeight: "800" },
  sub: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4, marginBottom: 16 },
  muted: { color: themeColor().muted, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  err: { color: themeColor().coralText, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20, marginBottom: 12 },
  section: { marginBottom: 20 },
  sectionTitle: { color: themeColor().pitchText, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "800", marginBottom: 8 },
  stageLabel: { color: themeColor().muted, fontSize: 11, fontFamily: "Inter_700Bold", fontWeight: "700", marginTop: 10, marginBottom: 6 },
  standingsHeader: { flexDirection: "row", paddingHorizontal: 8, marginBottom: 4 },
  standingsRow: { flexDirection: "row", paddingHorizontal: 8, paddingVertical: 6, borderRadius: 10 },
  standingsRowQualify: { backgroundColor: themeColor().pitchPanel, borderLeftWidth: 2, borderLeftColor: themeColor().pitch },
  standingsCell: { flex: 1, color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  standingsCellName: { color: themeColor().text, fontWeight: "700", textAlign: "left" },
  standingsPts: { color: themeColor().pitchText, fontWeight: "800" },
  matchRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    marginBottom: 0,
    backgroundColor: "transparent",
  },
  matchCard: {
    marginBottom: 6,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: themeColor().card,
    borderWidth: 1,
    borderColor: themeColor().line,
  },
  mvpRow: {
    paddingHorizontal: 12,
    paddingTop: 0,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: themeColor().line,
  },
  mvpVoteBtn: {
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: themeColor().pitch,
    backgroundColor: themeColor().pitchPanel,
  },
  mvpVoteBtnText: { color: themeColor().onPitchPanel, fontWeight: "800", fontSize: 13, fontFamily: "Inter_700Bold" },
  mvpResultText: { color: themeColor().text, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700" },
  mvpMutedSmall: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular" },
  mvpModalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: themeColor().scrim },
  mvpModalBackdropPress: { ...StyleSheet.absoluteFillObject },
  mvpModalSheet: {
    backgroundColor: themeColor().bg,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 28,
    borderWidth: 1,
    borderColor: themeColor().line,
    maxHeight: "72%",
  },
  mvpModalTitle: { color: themeColor().text, fontSize: 20, fontFamily: "InstrumentSerif_400Regular", fontWeight: "800", marginBottom: 6 },
  mvpModalHint: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 12 },
  mvpModalList: { maxHeight: 320, marginBottom: 12 },
  mvpNameRow: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 6,
    backgroundColor: themeColor().card,
    borderWidth: 1,
    borderColor: themeColor().line,
  },
  mvpNameRowSelected: {
    borderColor: themeColor().pitch,
    backgroundColor: themeColor().pitchPanel,
  },
  mvpNameText: { color: themeColor().text, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
  mvpNameTextSelected: { color: themeColor().pitchText },
  mvpSubmitBtn: {
    backgroundColor: themeColor().pitch,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 4,
  },
  mvpSubmitBtnDisabled: { opacity: 0.45 },
  mvpSubmitBtnText: { color: themeColor().onPitch, fontWeight: "800", fontSize: 16, fontFamily: "Inter_700Bold" },
  mvpModalClose: { paddingVertical: 14, alignItems: "center" },
  mvpModalCloseText: { color: themeColor().muted, fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  matchTeam: { color: themeColor().text, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700" },
  scoreBox: { paddingHorizontal: 12 },
  scoreText: { color: themeColor().pitchText, fontWeight: "800", fontSize: 14, fontFamily: "Inter_700Bold" },
  scorerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 8,
    borderRadius: 10,
    backgroundColor: themeColor().card,
    borderWidth: 1,
    borderColor: themeColor().line,
  },
  scorerRowTop: {
    backgroundColor: themeColor().pitchPanel,
    borderColor: themeColor().pitch,
  },
  scorerRank: { width: 52, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "800", color: themeColor().text, textAlign: "left" },
  scorerName: { flex: 1, color: themeColor().text, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700", marginRight: 8 },
  scorerGoals: { color: themeColor().pitchText, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "800", minWidth: 36, textAlign: "right" },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}

