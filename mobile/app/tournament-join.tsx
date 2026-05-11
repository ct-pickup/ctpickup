import { useAuth } from "@/context/AuthContext";
import { useSelectedRegion } from "@/context/SelectedRegionContext";
import { useFieldTournament } from "@/hooks/useFieldTournament";
import {
  fetchTournamentJoinCatalog,
  postTournamentRoster,
  type TournamentJoinCatalogTeam,
} from "@/lib/siteApi";
import { siteOrigin } from "@/lib/env";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

const LIME = "#a3e635";

export default function TournamentJoinScreen() {
  const navigation = useNavigation();
  const router = useRouter();
  const { region } = useSelectedRegion();
  const { session } = useAuth();
  const { payload, reload } = useFieldTournament();
  const token = session?.access_token ?? null;
  const tournamentId = payload?.tournament?.id ?? null;

  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [teams, setTeams] = useState<TournamentJoinCatalogTeam[]>([]);
  const [myPending, setMyPending] = useState<{ id: string; captain_id: string; message: string | null; created_at: string }[]>(
    [],
  );
  const [selected, setSelected] = useState<TournamentJoinCatalogTeam | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token || !tournamentId) {
      setTeams([]);
      setMyPending([]);
      return;
    }
    setLoading(true);
    try {
      const r = await fetchTournamentJoinCatalog(token, tournamentId, region);
      if (!r.ok) {
        setTeams([]);
        setMyPending([]);
        return;
      }
      setTeams(r.teams);
      setMyPending(r.my_pending_requests);
    } finally {
      setLoading(false);
    }
  }, [token, tournamentId, region]);

  useEffect(() => {
    navigation.setOptions({
      title: "Find a team",
      headerStyle: { backgroundColor: "#0a0a0a" },
      headerTintColor: "#fff",
    });
  }, [navigation]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return teams;
    return teams.filter(
      (t) =>
        t.team_name.toLowerCase().includes(q) ||
        t.captain_name.toLowerCase().includes(q) ||
        t.captain_id.toLowerCase().includes(q),
    );
  }, [teams, search]);

  async function onRequestJoin() {
    if (!token || !tournamentId || !selected) return;
    if (!siteOrigin()) {
      Alert.alert("", "Set EXPO_PUBLIC_SITE_URL in mobile/.env");
      return;
    }
    setBusy(true);
    try {
      const r = await postTournamentRoster(token, {
        action: "request_join",
        captain_id: selected.captain_id,
        tournament_id: tournamentId,
        message: message.trim() || undefined,
      });
      const err = (r.json as { error?: string })?.error;
      if (!r.ok) {
        Alert.alert("", err || `Request failed (${r.status})`);
        return;
      }
      setMessage("");
      Alert.alert("", "Join request sent.");
      await load();
      void reload();
    } finally {
      setBusy(false);
    }
  }

  const pendingForSelected = selected
    ? myPending.filter((p) => p.captain_id === selected.captain_id)
    : [];

  if (!session) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Sign in to browse teams and send join requests.</Text>
        <Pressable style={styles.primaryBtn} onPress={() => router.push("/login")}>
          <Text style={styles.primaryBtnText}>Sign in</Text>
        </Pressable>
      </View>
    );
  }

  if (!tournamentId) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>No active in-person tournament for your state right now.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.kicker}>REGION · {region}</Text>
      <Text style={styles.lead}>Confirmed teams for the live tournament. Request to join and the captain can approve you onto the roster.</Text>

      <View style={styles.searchWrap}>
        <FontAwesome name="search" size={14} color="rgba(255,255,255,0.35)" style={styles.searchIcon} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search by team or captain"
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={styles.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {loading ? <ActivityIndicator color={LIME} style={{ marginTop: 16 }} /> : null}

      {!loading && filtered.length === 0 ? (
        <Text style={styles.muted}>No teams match your search.</Text>
      ) : null}

      {filtered.map((t) => {
        const active = selected?.captain_id === t.captain_id;
        return (
          <Pressable
            key={t.captain_id}
            onPress={() => setSelected(active ? null : t)}
            style={({ pressed }) => [
              styles.teamCard,
              active && styles.teamCardActive,
              pressed && { opacity: 0.92 },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.teamName} numberOfLines={2}>
                {t.team_name || "Team"}
              </Text>
              <Text style={styles.captainLine} numberOfLines={1}>
                Captain: {t.captain_name || "—"}
              </Text>
              <Text style={styles.spotsLine}>
                Spots remaining: {t.spots_remaining}
                {t.expected_players ? ` · Roster cap ${t.expected_players}` : ""}
              </Text>
            </View>
            <FontAwesome name={active ? "chevron-up" : "chevron-down"} size={14} color="rgba(255,255,255,0.4)" />
          </Pressable>
        );
      })}

      {selected ? (
        <View style={styles.detailCard}>
          <Text style={styles.detailTitle}>{selected.team_name}</Text>
          <Text style={styles.detailSub}>Captain {selected.captain_name}</Text>
          <Text style={styles.detailSub}>Open spots: {selected.spots_remaining}</Text>

          {pendingForSelected.length > 0 ? (
            <View style={styles.pendingBox}>
              <Text style={styles.pendingTitle}>Your pending request</Text>
              {pendingForSelected.map((p) => (
                <Text key={p.id} style={styles.pendingText}>
                  Submitted {new Date(p.created_at).toLocaleString()}
                  {p.message ? ` · “${p.message}”` : ""}
                </Text>
              ))}
            </View>
          ) : null}

          {selected.spots_remaining <= 0 ? (
            <Text style={styles.warn}>This team’s roster is full.</Text>
          ) : (
            <>
              <Text style={styles.label}>Optional message to the captain</Text>
              <TextInput
                value={message}
                onChangeText={setMessage}
                placeholder="e.g. position, availability…"
                placeholderTextColor="rgba(255,255,255,0.35)"
                style={styles.messageInput}
                multiline
                maxLength={500}
              />
              <Pressable
                style={[styles.primaryBtn, busy && styles.primaryBtnDisabled]}
                disabled={busy}
                onPress={() => void onRequestJoin()}
              >
                {busy ? (
                  <ActivityIndicator color="#111" />
                ) : (
                  <Text style={styles.primaryBtnText}>Request to join</Text>
                )}
              </Pressable>
            </>
          )}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0a0a0a" },
  content: { padding: 20, paddingBottom: 48 },
  center: { flex: 1, backgroundColor: "#0a0a0a", padding: 24, justifyContent: "center" },
  kicker: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.4,
    color: "rgba(163,230,53,0.65)",
  },
  lead: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 22,
    color: "rgba(255,255,255,0.58)",
  },
  muted: { color: "rgba(255,255,255,0.5)", fontSize: 15, lineHeight: 22 },
  searchWrap: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
    paddingHorizontal: 12,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, color: "#fff", paddingVertical: 12, fontSize: 15 },
  teamCard: {
    marginTop: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.04)",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  teamCardActive: {
    borderColor: "rgba(163,230,53,0.45)",
    backgroundColor: "rgba(163,230,53,0.08)",
  },
  teamName: { fontSize: 16, fontWeight: "800", color: "#fff" },
  captainLine: { marginTop: 4, fontSize: 13, color: "rgba(255,255,255,0.55)" },
  spotsLine: { marginTop: 4, fontSize: 12, color: "rgba(163,230,53,0.85)", fontWeight: "700" },
  detailCard: {
    marginTop: 16,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  detailTitle: { fontSize: 18, fontWeight: "800", color: "#fff" },
  detailSub: { marginTop: 6, fontSize: 14, color: "rgba(255,255,255,0.6)" },
  pendingBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "rgba(163,230,53,0.06)",
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.25)",
  },
  pendingTitle: { fontSize: 12, fontWeight: "800", color: LIME, textTransform: "uppercase" },
  pendingText: { marginTop: 6, fontSize: 13, color: "rgba(255,255,255,0.75)", lineHeight: 20 },
  label: { marginTop: 14, fontSize: 12, fontWeight: "700", color: "rgba(255,255,255,0.45)" },
  messageInput: {
    marginTop: 8,
    minHeight: 72,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    padding: 12,
    color: "#fff",
    fontSize: 15,
    textAlignVertical: "top",
  },
  warn: { marginTop: 12, color: "rgba(251,191,36,0.95)", fontSize: 14, fontWeight: "600" },
  primaryBtn: {
    marginTop: 14,
    backgroundColor: LIME,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: "#111", fontWeight: "800", fontSize: 15 },
});
