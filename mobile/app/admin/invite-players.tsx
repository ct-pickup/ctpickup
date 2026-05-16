import { useAuth } from "@/context/AuthContext";
import {
  fetchAdminPickupInvitePlayersForm,
  postAdminPickupInvitePlayers,
  type InvitePlayersFormPlayer,
} from "@/lib/adminApi";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useLocalSearchParams, useRouter } from "expo-router";
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
import { SafeAreaView } from "react-native-safe-area-context";

const LIME = "#a3e635";

export default function InvitePlayersScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ run_id?: string }>();
  const runId = typeof params.run_id === "string" && params.run_id.trim() ? params.run_id.trim() : "";
  const { session } = useAuth();
  const token = session?.access_token ?? null;

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runTitle, setRunTitle] = useState<string>("");
  const [players, setPlayers] = useState<InvitePlayersFormPlayer[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    if (!token || !runId) {
      setLoading(false);
      setError(!runId ? "Missing run." : "Not signed in.");
      return;
    }
    setLoading(true);
    setError(null);
    const r = await fetchAdminPickupInvitePlayersForm(token, runId);
    setLoading(false);
    if (!r.ok) {
      setError(r.error);
      setPlayers([]);
      return;
    }
    const titleRaw = r.data.run?.title;
    setRunTitle(typeof titleRaw === "string" && titleRaw.trim() ? titleRaw.trim() : "Pickup run");
    setPlayers(Array.isArray(r.data.players) ? r.data.players : []);
  }, [token, runId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return players;
    return players.filter((p) => {
      const name = p.display_name.toLowerCase();
      const un = (p.username || "").toLowerCase();
      return name.includes(q) || un.includes(q);
    });
  }, [players, query]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const nSel = selected.size;

  async function onInvite() {
    if (!token || !runId || nSel === 0 || busy) return;
    setBusy(true);
    setError(null);
    const r = await postAdminPickupInvitePlayers(token, {
      run_id: runId,
      user_ids: Array.from(selected),
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    const invited = Number(r.data.invited ?? 0);
    setSelected(new Set());
    void load();
    Alert.alert(
      invited ? "Invites sent" : "Already invited",
      invited ? `Sent ${invited} invite${invited === 1 ? "" : "s"}.` : "Those players already had an invite for this run.",
    );
  }

  if (!runId) {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom"]}>
        <Text style={styles.err}>Missing run_id.</Text>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>Go back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backIcon, pressed && { opacity: 0.8 }]}>
          <FontAwesome name="chevron-left" size={18} color="#fff" />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.h1} numberOfLines={2}>
            Invite players
          </Text>
          <Text style={styles.sub} numberOfLines={2}>
            {runTitle}
          </Text>
        </View>
      </View>
      <Text style={styles.help}>
        Select runs are invite-only. Checked players get a push notification and can confirm or decline in the app.
      </Text>

      <TextInput
        style={styles.search}
        placeholder="Search by name or username"
        placeholderTextColor="rgba(255,255,255,0.35)"
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        autoCorrect={false}
      />

      {loading ? (
        <ActivityIndicator color="#fff" style={{ marginTop: 24 }} />
      ) : error ? (
        <Text style={styles.err}>{error}</Text>
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 120 }}>
          {filtered.length === 0 ? (
            <Text style={styles.empty}>No players match your search.</Text>
          ) : (
            filtered.map((p) => {
              const on = selected.has(p.id);
              return (
                <Pressable
                  key={p.id}
                  onPress={() => toggle(p.id)}
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.9 }]}
                >
                  <View style={[styles.checkbox, on && styles.checkboxOn]}>
                    {on ? <FontAwesome name="check" size={14} color="#111" /> : null}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.name} numberOfLines={1}>
                      {p.display_name}
                    </Text>
                    {p.username ? (
                      <Text style={styles.username} numberOfLines={1}>
                        @{p.username}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })
          )}
        </ScrollView>
      )}

      <View style={styles.footer}>
        <Pressable
          onPress={() => void onInvite()}
          disabled={busy || nSel === 0 || loading}
          style={({ pressed }) => [
            styles.inviteBtn,
            (busy || nSel === 0 || loading) && styles.inviteBtnDisabled,
            pressed && nSel > 0 && !busy && !loading && { opacity: 0.92 },
          ]}
        >
          {busy ? (
            <ActivityIndicator color="#111" />
          ) : (
            <Text style={styles.inviteBtnText}>
              Invite {nSel} player{nSel === 1 ? "" : "s"}
            </Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0a0a0a", paddingHorizontal: 16 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginTop: 8 },
  backIcon: { paddingVertical: 8, paddingRight: 4 },
  h1: { fontSize: 22, fontWeight: "800", color: "#fff" },
  sub: { marginTop: 4, fontSize: 14, color: "rgba(255,255,255,0.55)" },
  help: {
    marginTop: 14,
    fontSize: 14,
    lineHeight: 20,
    color: "rgba(255,255,255,0.65)",
  },
  search: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#fff",
    fontSize: 16,
  },
  list: { flex: 1, marginTop: 12 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.28)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  checkboxOn: {
    borderColor: LIME,
    backgroundColor: LIME,
  },
  name: { fontSize: 16, fontWeight: "700", color: "#fff" },
  username: { marginTop: 2, fontSize: 13, color: "rgba(255,255,255,0.45)" },
  empty: { marginTop: 24, color: "rgba(255,255,255,0.45)", fontSize: 15 },
  err: { marginTop: 16, color: "#fca5a5", fontSize: 15 },
  footer: {
    paddingVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.08)",
    backgroundColor: "#0a0a0a",
  },
  inviteBtn: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: LIME,
    paddingVertical: 16,
    borderRadius: 14,
    minHeight: 52,
  },
  inviteBtnDisabled: { opacity: 0.45 },
  inviteBtnText: { color: "#111", fontWeight: "800", fontSize: 16 },
  backBtn: { marginTop: 16, alignSelf: "flex-start", paddingVertical: 10, paddingHorizontal: 14 },
  backBtnText: { color: LIME, fontWeight: "700", fontSize: 15 },
});
