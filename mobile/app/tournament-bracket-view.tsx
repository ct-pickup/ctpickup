import { useAuth } from "@/context/AuthContext";
import { fetchTournamentBracketPlayer } from "@/lib/siteApi";
import { siteOrigin } from "@/lib/env";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

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

function parseBracket(json: unknown): { teams: Team[]; matches: Match[]; standings: GroupMember[] } | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (!Array.isArray(o.teams) || !Array.isArray(o.matches) || !Array.isArray(o.standings)) return null;
  return {
    teams: o.teams as Team[],
    matches: o.matches as Match[],
    standings: o.standings as GroupMember[],
  };
}

export default function TournamentBracketViewScreen() {
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
  const [teamMap, setTeamMap] = useState<Record<string, Team>>({});

  useEffect(() => {
    navigation.setOptions({
      title: "Live bracket",
      headerStyle: { backgroundColor: BG },
      headerTintColor: "#fff",
    });
  }, [navigation]);

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
          setLoadError(msg || "This bracket is not available for your region.");
        } else if (r.status === 401) {
          setLoadError(msg || "Sign in again to view the bracket.");
        } else {
          setLoadError(msg || "Could not load bracket.");
        }
        setTeams([]);
        setMatches([]);
        setStandings([]);
        setTeamMap({});
        return;
      }
      const parsed = parseBracket(r.json);
      if (!parsed) {
        setLoadError("Invalid response from server.");
        setTeams([]);
        setMatches([]);
        setStandings([]);
        setTeamMap({});
        return;
      }
      setTeams(parsed.teams);
      const map: Record<string, Team> = {};
      for (const t of parsed.teams) map[t.id] = t;
      setTeamMap(map);
      setMatches(parsed.matches);
      setStandings(parsed.standings);
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
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, tournamentId, load]);

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

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {loading && teams.length === 0 ? <ActivityIndicator color={LIME} style={{ marginVertical: 24 }} /> : null}

      <Text style={styles.title}>Bracket</Text>
      <Text style={styles.sub}>{teams.length} confirmed teams</Text>
      {loadError ? <Text style={styles.err}>{loadError}</Text> : null}

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
          {matches
            .filter((m) => m.group_name === gName)
            .map((match) => (
              <View key={match.id} style={styles.matchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.matchTeam} numberOfLines={1}>
                    {teamMap[match.team_a_id]?.team_name || "TBD"}
                  </Text>
                </View>
                <View style={styles.scoreBox}>
                  <Text style={styles.scoreText}>
                    {match.score_a !== null && match.score_b !== null ? `${match.score_a} - ${match.score_b}` : "vs"}
                  </Text>
                </View>
                <View style={{ flex: 1, alignItems: "flex-end" }}>
                  <Text style={styles.matchTeam} numberOfLines={1}>
                    {match.team_b_id ? teamMap[match.team_b_id]?.team_name || "TBD" : "BYE"}
                  </Text>
                </View>
              </View>
            ))}
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
                {stageMatches.map((match) => (
                  <View key={match.id} style={styles.matchRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.matchTeam} numberOfLines={1}>
                        {match.team_a_id ? teamMap[match.team_a_id]?.team_name || "TBD" : "TBD"}
                      </Text>
                    </View>
                    <View style={styles.scoreBox}>
                      <Text style={styles.scoreText}>
                        {match.is_bye
                          ? "BYE"
                          : match.score_a !== null && match.score_b !== null
                            ? `${match.score_a} - ${match.score_b}`
                            : "vs"}
                      </Text>
                    </View>
                    <View style={{ flex: 1, alignItems: "flex-end" }}>
                      <Text style={styles.matchTeam} numberOfLines={1}>
                        {match.team_b_id ? teamMap[match.team_b_id]?.team_name || "TBD" : "BYE"}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            );
          })}
        </View>
      ) : null}

      {!loading && matches.length === 0 && teams.length === 0 ? (
        <Text style={styles.muted}>Bracket data will appear when staff generate groups.</Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  content: { padding: 16, paddingBottom: 48 },
  center: { flex: 1, backgroundColor: BG, justifyContent: "center", padding: 24 },
  title: { color: "#fff", fontSize: 24, fontWeight: "800" },
  sub: { color: "rgba(255,255,255,0.45)", fontSize: 13, marginTop: 4, marginBottom: 16 },
  muted: { color: "rgba(255,255,255,0.5)", fontSize: 14, lineHeight: 20 },
  err: { color: "#f87171", fontSize: 14, lineHeight: 20, marginBottom: 12 },
  section: { marginBottom: 20 },
  sectionTitle: { color: LIME, fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 },
  stageLabel: { color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: "700", textTransform: "uppercase", marginTop: 10, marginBottom: 6 },
  standingsHeader: { flexDirection: "row", paddingHorizontal: 8, marginBottom: 4 },
  standingsRow: { flexDirection: "row", paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8 },
  standingsRowQualify: { backgroundColor: "rgba(163,230,53,0.06)", borderLeftWidth: 2, borderLeftColor: LIME },
  standingsCell: { flex: 1, color: "rgba(255,255,255,0.5)", fontSize: 11, textAlign: "center" },
  standingsCellName: { color: "#fff", fontWeight: "700", textAlign: "left" },
  standingsPts: { color: LIME, fontWeight: "800" },
  matchRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  matchTeam: { color: "#fff", fontSize: 13, fontWeight: "700" },
  scoreBox: { paddingHorizontal: 12 },
  scoreText: { color: LIME, fontWeight: "800", fontSize: 14 },
});
