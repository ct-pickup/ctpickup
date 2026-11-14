import { useAuth } from "@/context/AuthContext";
import {
  fetchTournamentBracketPlayer,
  fetchTournamentMvpVotes,
  postTournamentMvpVote,
  type TournamentMvpTally,
} from "@/lib/siteApi";
import { siteOrigin } from "@/lib/env";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { SelectionPill, useSelectionPill } from "@/components/motion/SelectionPill";
import { LiveTag } from "@/components/tournament/LiveTag";
import { MOTION } from "@/lib/motion";
import {
  avgText,
  hasLiveMatch,
  knockoutRounds,
  parseBracketPayload,
  penaltyText,
  scheduledText,
  scoreText,
  seedAndAvgText,
  SEED_HELP,
  STATUS_LABEL,
  teamName,
  winnerSide,
  type BracketMatch,
  type BracketPayload,
  type BracketSlot,
  type BracketTeam,
  type TopScorer,
} from "@/lib/tournamentBracketCore";
import { useFocusEffect, useLocalSearchParams, useNavigation } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { headline, themeColor, useThemedStyles } from "@/theme";
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

type MvpMatchInfo = {
  tallies: TournamentMvpTally[];
  my_vote: string | null;
  can_vote: boolean;
  eligible_players: string[];
};

type TabId = "standings" | "bracket" | "scorers";

/** How often the screen asks for fresh results while it is on screen. Realtime updates arrive sooner when they work. */
const POLL_MS = 10_000;

const EMPTY: BracketPayload = { teams: [], matches: [], standings: [], upcoming: [], top_scorers: [] };

function matchIsMvpVotable(m: BracketMatch): boolean {
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

function rankMedal(rank: number): string {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return "";
}

/** The score in the middle of a card. A new score fades in; under Reduce Motion it just changes. */
function ScoreText({ label, reduceMotion }: { label: string; reduceMotion: boolean }) {
  if (reduceMotion) return <Text style={styles.scoreText}>{label}</Text>;
  return (
    <Animated.Text key={label} entering={FadeIn.duration(MOTION.duration.base)} style={styles.scoreText}>
      {label}
    </Animated.Text>
  );
}

export default function TournamentBracketViewScreen() {
  useThemedStyles(publish_styles);

  const navigation = useNavigation();
  const reduceMotion = useReduceMotion();
  const params = useLocalSearchParams<{ tournament_id?: string | string[] }>();
  const raw = params.tournament_id;
  const tournamentId = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : "";
  const { session, supabase } = useAuth();
  const token = session?.access_token;

  const [data, setData] = useState<BracketPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<TabId>("standings");
  const [mvpByMatchId, setMvpByMatchId] = useState<Record<string, MvpMatchInfo>>({});
  const [mvpModalMatchId, setMvpModalMatchId] = useState<string | null>(null);
  const [mvpSelectedName, setMvpSelectedName] = useState<string | null>(null);
  const [mvpSubmitBusy, setMvpSubmitBusy] = useState(false);
  const matchesRef = useRef<BracketMatch[]>([]);
  const inflight = useRef<Promise<void> | null>(null);

  const view = data ?? EMPTY;
  const { teams, matches, standings, upcoming } = view;
  const topScorers: TopScorer[] = view.top_scorers;
  const loading = data === null && !loadError;
  const teamMap = useMemo(() => {
    const map: Record<string, BracketTeam> = {};
    for (const t of teams) map[t.id] = t;
    return map;
  }, [teams]);
  const tabPill = useSelectionPill<TabId>(tab);

  // Refresh only while this screen is the one being looked at: focused, and the app in the foreground.
  const [focused, setFocused] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setAppActive(s === "active"));
    return () => sub.remove();
  }, []);
  const active = focused && appActive;

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

  /** One request at a time: a poll that lands while another is running joins it instead of stacking up. */
  const load = useCallback((): Promise<void> => {
    if (inflight.current) return inflight.current;
    if (!token || !tournamentId) return Promise.resolve();
    if (!siteOrigin()) {
      setLoadError("Set EXPO_PUBLIC_SITE_URL in mobile/.env");
      return Promise.resolve();
    }
    const p = (async () => {
      const r = await fetchTournamentBracketPlayer(token, tournamentId);
      if (!r.ok) {
        const j = r.json && typeof r.json === "object" ? (r.json as Record<string, unknown>) : null;
        const msg = typeof j?.error === "string" ? j.error : null;
        if (r.status === 403) setLoadError(msg || "You need an approved account to view this bracket.");
        else if (r.status === 401) setLoadError(msg || "Sign in again to view the bracket.");
        else setLoadError(msg || "Could not load bracket.");
        // Keep showing the last good bracket if there is one; only a first load leaves the screen empty.
        return;
      }
      const parsed = parseBracketPayload(r.json);
      if (!parsed) {
        setLoadError("Invalid response from server.");
        return;
      }
      setLoadError(null);
      setData(parsed);
    })().finally(() => {
      inflight.current = null;
    });
    inflight.current = p;
    return p;
  }, [token, tournamentId]);

  useEffect(() => {
    if (!active || !token || !tournamentId) return;
    // Fresh results the moment the screen comes into view, then every POLL_MS.
    void load();
    const timer = setInterval(() => void load(), POLL_MS);

    // The app already listens to these tables here; keep that, so a score the admin saves shows up without waiting for the poll.
    const channel = supabase
      ?.channel(`tournament-bracket:${tournamentId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_matches", filter: `tournament_id=eq.${tournamentId}` }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_group_members", filter: `tournament_id=eq.${tournamentId}` }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_match_goals", filter: `tournament_id=eq.${tournamentId}` }, () => void load())
      .subscribe();

    return () => {
      clearInterval(timer);
      if (channel && supabase) void supabase.removeChannel(channel);
    };
  }, [active, token, tournamentId, supabase, load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const refreshMvpVotes = useCallback(async (authToken: string, matchList: BracketMatch[]) => {
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
    if (!active || !supabase || !tournamentId || !token) return;
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
  }, [active, supabase, tournamentId, token, mvpFingerprint, refreshMvpVotes]);

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
  const rounds = useMemo(() => knockoutRounds(matches, upcoming), [matches, upcoming]);
  const seeded = useMemo(
    () => teams.filter((t) => t.seed != null).sort((a, b) => (a.seed as number) - (b.seed as number)),
    [teams],
  );
  const anyLive = hasLiveMatch(matches);

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

  const enter = reduceMotion ? undefined : FadeIn.duration(MOTION.duration.base);

  const renderTeamSide = (id: string | null, align: "left" | "right", won: boolean, lost: boolean, fallback: string) => {
    const team = id ? teamMap[id] : undefined;
    const sub = seedAndAvgText(team);
    return (
      <View style={{ flex: 1, alignItems: align === "right" ? "flex-end" : "flex-start" }}>
        <View style={styles.teamNameRow}>
          {won && align === "left" ? <FontAwesome name="check-circle" size={13} color={themeColor().pitchText} style={{ marginRight: 4 }} /> : null}
          <Text style={[styles.matchTeam, won && styles.matchTeamWon, lost && styles.matchTeamLost]} numberOfLines={1}>
            {team?.team_name || fallback}
          </Text>
          {won && align === "right" ? <FontAwesome name="check-circle" size={13} color={themeColor().pitchText} style={{ marginLeft: 4 }} /> : null}
        </View>
        {sub ? (
          <Text style={[styles.seedSub, lost && styles.matchTeamLost]} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
    );
  };

  const renderBracketMatchCard = (match: BracketMatch) => {
    const mvp = mvpByMatchId[match.id];
    const votable = matchIsMvpVotable(match);
    const top = mvp?.tallies?.length ? topMvpDisplay(mvp.tallies) : null;
    const side = winnerSide(match);
    const when = match.status === "scheduled" ? scheduledText(match.scheduled_at) : null;
    const pens = penaltyText(match, teamMap);
    const openVote = () => {
      if (!mvp?.can_vote || !mvp.eligible_players.length) return;
      setMvpModalMatchId(match.id);
      setMvpSelectedName(null);
    };
    return (
      <Animated.View
        key={match.id}
        entering={enter}
        style={[styles.matchCard, match.status === "in_progress" && styles.matchCardLive]}
        accessible
        accessibilityLabel={`${teamName(teamMap, match.team_a_id)} versus ${match.team_b_id ? teamName(teamMap, match.team_b_id) : "bye"}. ${STATUS_LABEL[match.status]}.`}
      >
        <View style={styles.cardTop}>
          <View style={[styles.statusChip, match.status === "in_progress" && styles.statusChipLive, match.status === "final" && styles.statusChipFinal]}>
            <Text style={[styles.statusText, match.status === "in_progress" && styles.statusTextLive]}>{STATUS_LABEL[match.status]}</Text>
          </View>
          {when ? <Text style={styles.whenText}>{when}</Text> : null}
        </View>
        <View style={styles.matchRow}>
          {renderTeamSide(match.team_a_id, "left", side === "a", side === "b", "TBD")}
          <View style={styles.scoreBox}>
            <ScoreText label={scoreText(match)} reduceMotion={reduceMotion} />
          </View>
          {renderTeamSide(match.team_b_id, "right", side === "b", side === "a", match.is_bye ? "BYE" : "TBD")}
        </View>
        {pens ? <Text style={styles.penaltyText}>{pens}</Text> : null}
        {votable ? (
          <View style={styles.mvpRow}>
            {mvp?.can_vote ? (
              <Pressable
                onPress={openVote}
                style={({ pressed }) => [styles.mvpVoteBtn, pressed && { opacity: 0.88 }]}
                accessibilityRole="button"
                accessibilityLabel="Vote for match MVP"
              >
                <Text style={styles.mvpVoteBtnText}>
                  Vote MVP <FontAwesome name="star" size={13} color={themeColor().onPitchPanel} />
                </Text>
              </Pressable>
            ) : top ? (
              <Text style={styles.mvpResultText}>
                MVP: {top.name} <FontAwesome name="star" size={13} color={themeColor().pitchText} /> ({top.votes} {top.votes === 1 ? "vote" : "votes"})
              </Text>
            ) : (
              <Text style={styles.mvpMutedSmall}>No MVP votes yet</Text>
            )}
          </View>
        ) : null}
      </Animated.View>
    );
  };

  /** A later round that has no match yet: the teams already known are filled in, the rest say who they are waiting for. */
  const renderSlotCard = (slot: BracketSlot) => {
    const known = (id: string | null, label: string | null) => (id ? teamMap[id]?.team_name || "TBD" : label || "TBD");
    return (
      <Animated.View key={slot.id} entering={enter} style={[styles.matchCard, styles.slotCard]} accessible accessibilityLabel="Waiting for earlier results">
        <View style={styles.cardTop}>
          <View style={styles.statusChip}>
            <Text style={styles.statusText}>{slot.is_bye ? "Bye" : "Waiting"}</Text>
          </View>
        </View>
        <View style={styles.matchRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.matchTeam, !slot.team_a_id && styles.slotText]} numberOfLines={1}>
              {known(slot.team_a_id, slot.label_a)}
            </Text>
          </View>
          <View style={styles.scoreBox}>
            <Text style={styles.scoreText}>vs</Text>
          </View>
          <View style={{ flex: 1, alignItems: "flex-end" }}>
            <Text style={[styles.matchTeam, !slot.team_b_id && styles.slotText]} numberOfLines={1}>
              {slot.is_bye ? "BYE" : known(slot.team_b_id, slot.label_b)}
            </Text>
          </View>
        </View>
      </Animated.View>
    );
  };

  const mvpModalPlayers = mvpModalMatchId ? mvpByMatchId[mvpModalMatchId]?.eligible_players ?? [] : [];

  return (
    <>
    <View style={styles.root}>
      <View style={styles.tabRow}>
        <SelectionPill style={tabPill.pillStyle} />
        {(
          [
            ["standings", "Standings"],
            ["bracket", "Bracket"],
            ["scorers", "Top Scorers"],
          ] as const
        ).map(([id, label]) => (
          <Pressable
            key={id}
            onLayout={tabPill.onLayoutFor(id)}
            onPress={() => setTab(id)}
            style={({ pressed }) => [
              styles.tab,
              tab === id && (tabPill.ready ? styles.tabOnPill : styles.tabActive),
              pressed && { opacity: 0.85 },
            ]}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === id }}
          >
            <Text style={[styles.tabText, tab === id && (tabPill.ready ? styles.tabTextOnPill : styles.tabTextActive)]} numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={themeColor().pitchText} />}
      >
        {loadError ? <Text style={styles.err}>{loadError}</Text> : null}

        {tab === "standings" ? (
          <>
            {loading ? <ActivityIndicator color={themeColor().pitchText} style={{ marginVertical: 24 }} /> : null}
            <View style={styles.titleRow}>
              <Text style={styles.title}>Standings</Text>
              {data && !loadError ? <LiveTag pulsing={anyLive} /> : null}
            </View>
            <Text style={styles.sub}>{teams.length} confirmed teams</Text>

            {seeded.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Seeds</Text>
                {seeded.map((t) => (
                  <Animated.View key={t.id} entering={enter} style={styles.seedRow}>
                    <View style={styles.seedBadge}>
                      <Text style={styles.seedBadgeText}>{t.seed}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.seedName} numberOfLines={1}>
                        {t.team_name}
                      </Text>
                      {t.roster.length ? (
                        <Text style={styles.seedRoster} numberOfLines={2}>
                          {t.roster.join(", ")}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={styles.seedAvg}>{avgText(t)}</Text>
                  </Animated.View>
                ))}
                <Text style={styles.help}>{SEED_HELP}</Text>
              </View>
            ) : null}

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
            {loading ? <ActivityIndicator color={themeColor().pitchText} style={{ marginVertical: 24 }} /> : null}
            <View style={styles.titleRow}>
              <Text style={styles.title}>Bracket</Text>
              {data && !loadError ? <LiveTag pulsing={anyLive} /> : null}
            </View>
            <Text style={styles.sub}>{teams.length} confirmed teams</Text>

            {groupNames.map((gName) => (
              <View key={`m-${String(gName)}`} style={styles.section}>
                <Text style={styles.sectionTitle}>Group {gName} matches</Text>
                {matches
                  .filter((m) => m.group_name === gName)
                  .map((match) => renderBracketMatchCard(match))}
              </View>
            ))}

            {rounds.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Knockout</Text>
                {rounds.map((round) => (
                  <View key={round.stage}>
                    <Text style={styles.stageLabel}>{round.title}</Text>
                    {round.items.map((item) => (item.kind === "match" ? renderBracketMatchCard(item.match) : renderSlotCard(item.slot)))}
                  </View>
                ))}
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
            <View style={styles.titleRow}>
              <Text style={styles.title}>Top scorers</Text>
              {data && !loadError ? <LiveTag pulsing={anyLive} /> : null}
            </View>
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
    paddingTop: 8,
    paddingBottom: 4,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: themeColor().line,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 999,
    backgroundColor: themeColor().overlaySubtle,
    borderWidth: 1,
    borderColor: themeColor().line,
    alignItems: "center",
    justifyContent: "center",
  },
  tabActive: {
    backgroundColor: themeColor().pitchPanel,
    borderColor: themeColor().pitchText,
  },
  /* once the selection pill has measured the tabs it carries the colour, so the selected tab itself goes clear */
  tabOnPill: { backgroundColor: "transparent", borderColor: "transparent" },
  tabText: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700", textAlign: "center" },
  tabTextActive: { color: themeColor().text },
  tabTextOnPill: { color: themeColor().onPitch },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: themeColor().text, fontSize: 24, ...headline },
  sub: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4, marginBottom: 16 },
  muted: { color: themeColor().muted, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  err: { color: themeColor().coralText, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20, marginBottom: 12 },
  help: { color: themeColor().muted, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17, marginTop: 6 },
  section: { marginBottom: 20 },
  sectionTitle: { color: themeColor().pitchText, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "800", marginBottom: 8 },
  stageLabel: { color: themeColor().muted, fontSize: 11, fontFamily: "Inter_700Bold", fontWeight: "700", marginTop: 8, marginBottom: 4 },
  seedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 6,
    borderRadius: 10,
    backgroundColor: themeColor().card,
    borderWidth: 1,
    borderColor: themeColor().line,
  },
  seedBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: themeColor().pitchPanel,
    borderWidth: 1,
    borderColor: themeColor().pitchText,
  },
  seedBadgeText: { color: themeColor().pitchText, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "800" },
  seedName: { color: themeColor().text, fontSize: 15, fontFamily: "Inter_700Bold", fontWeight: "700" },
  seedRoster: { color: themeColor().muted, fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 16 },
  seedAvg: { color: themeColor().pitchText, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "800" },
  standingsHeader: { flexDirection: "row", paddingHorizontal: 8, marginBottom: 4 },
  standingsRow: { flexDirection: "row", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  standingsRowQualify: { backgroundColor: themeColor().pitchPanel, borderLeftWidth: 2, borderLeftColor: themeColor().pitch },
  standingsCell: { flex: 1, color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  standingsCellName: { color: themeColor().text, fontWeight: "700", textAlign: "left" },
  standingsPts: { color: themeColor().pitchText, fontWeight: "800" },
  matchRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 12,
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
  matchCardLive: { borderColor: themeColor().pitchText },
  slotCard: { borderStyle: "dashed", backgroundColor: "transparent" },
  slotText: { color: themeColor().muted, fontWeight: "600" },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingTop: 10 },
  statusChip: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: themeColor().overlaySubtle,
  },
  statusChipLive: { backgroundColor: themeColor().pitchPanel },
  statusChipFinal: { backgroundColor: "transparent" },
  statusText: { color: themeColor().muted, fontSize: 11, fontFamily: "Inter_700Bold", fontWeight: "700" },
  statusTextLive: { color: themeColor().pitchText },
  whenText: { color: themeColor().muted, fontSize: 11, fontFamily: "Inter_400Regular" },
  teamNameRow: { flexDirection: "row", alignItems: "center" },
  seedSub: { color: themeColor().muted, fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  penaltyText: { color: themeColor().muted, fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", paddingHorizontal: 12, paddingBottom: 10, marginTop: -4 },
  mvpRow: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: themeColor().line,
  },
  mvpVoteBtn: {
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: themeColor().pitchText,
    backgroundColor: themeColor().pitchPanel,
  },
  mvpVoteBtnText: { color: themeColor().onPitchPanel, fontWeight: "800", fontSize: 13, fontFamily: "Inter_700Bold" },
  mvpResultText: { color: themeColor().text, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700" },
  mvpMutedSmall: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular" },
  mvpModalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: themeColor().scrim },
  mvpModalBackdropPress: { ...StyleSheet.absoluteFill },
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
  mvpModalTitle: { color: themeColor().text, fontSize: 20, ...headline, marginBottom: 4 },
  mvpModalHint: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 12 },
  mvpModalList: { maxHeight: 320, marginBottom: 12 },
  mvpNameRow: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 4,
    backgroundColor: themeColor().card,
    borderWidth: 1,
    borderColor: themeColor().line,
  },
  mvpNameRowSelected: {
    borderColor: themeColor().pitchText,
    backgroundColor: themeColor().pitchPanel,
  },
  mvpNameText: { color: themeColor().text, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
  mvpNameTextSelected: { color: themeColor().pitchText },
  mvpSubmitBtn: {
    backgroundColor: themeColor().pitch,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 4,
  },
  mvpSubmitBtnDisabled: { opacity: 0.45 },
  mvpSubmitBtnText: { color: themeColor().onPitch, fontWeight: "800", fontSize: 16, fontFamily: "Inter_700Bold" },
  mvpModalClose: { paddingVertical: 12, alignItems: "center" },
  mvpModalCloseText: { color: themeColor().muted, fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  matchTeam: { color: themeColor().text, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700", flexShrink: 1 },
  matchTeamWon: { color: themeColor().pitchText, fontWeight: "800" },
  matchTeamLost: { opacity: 0.55 },
  scoreBox: { paddingHorizontal: 12 },
  scoreText: { color: themeColor().pitchText, fontWeight: "800", fontSize: 16, fontFamily: "Inter_700Bold" },
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
    borderColor: themeColor().pitchText,
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
