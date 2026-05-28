import { useAuth } from "@/context/AuthContext";
import {
  fetchAdminTierSuggestions,
  postAdminReviewTierSuggestion,
  postAdminRunTierSuggestionAlgorithm,
  type TierSuggestionRow,
} from "@/lib/adminApi";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

const LIME = "#a3e635";

function pct01(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v * 100)}%`;
}

export default function AdminTierSuggestionsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const token = session?.access_token ?? null;

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<TierSuggestionRow[]>([]);

  const pendingCount = rows.length;

  const load = useCallback(async () => {
    if (!token) {
      setError("Not signed in.");
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    const r = await fetchAdminTierSuggestions(token);
    setLoading(false);
    if (!r.ok) {
      setError(r.error);
      setRows([]);
      return;
    }
    setRows(r.data.suggestions || []);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(() => [...rows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))), [rows]);

  async function onRunAlgorithm() {
    if (!token) return;
    Alert.alert("Run promotion algorithm?", "This will scan approved players and create new suggestions.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Run",
        onPress: () => {
          void (async () => {
            setBusy("algo");
            const r = await postAdminRunTierSuggestionAlgorithm(token);
            setBusy(null);
            if (!r.ok) return Alert.alert("Run failed", r.error);
            Alert.alert("Done", `${r.data.inserted} suggestions created.`);
            void load();
          })();
        },
      },
    ]);
  }

  async function review(id: string, accepted: boolean) {
    if (!token) return;
    setBusy(`review:${id}:${accepted ? "a" : "r"}`);
    const r = await postAdminReviewTierSuggestion(token, id, accepted);
    setBusy(null);
    if (!r.ok) return Alert.alert("Save failed", r.error);
    setRows((prev) => prev.filter((x) => x.id !== id));
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.h1}>Tier Suggestions</Text>
            <Text style={styles.sub}>{pendingCount} pending</Text>
          </View>
          <Pressable
            onPress={() => void load()}
            style={({ pressed }) => [styles.chip, pressed && { opacity: 0.9 }]}
          >
            <Text style={styles.chipText}>Refresh</Text>
          </Pressable>
        </View>

        <View style={styles.actionRow}>
          <Pressable
            onPress={onRunAlgorithm}
            disabled={busy === "algo"}
            style={({ pressed }) => [
              styles.primary,
              pressed && { opacity: 0.9 },
              busy === "algo" && styles.disabled,
            ]}
          >
            {busy === "algo" ? <ActivityIndicator color="#111" /> : <Text style={styles.primaryText}>Run Promotion Algorithm</Text>}
          </Pressable>
        </View>

        {loading ? <ActivityIndicator color="#fff" style={{ marginTop: 14 }} /> : null}
        {error ? <Text style={styles.err}>{error}</Text> : null}

        {sorted.length === 0 && !loading && !error ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No pending suggestions.</Text>
            <Text style={styles.emptyBody}>Run the algorithm, or check back later.</Text>
          </View>
        ) : null}

        {sorted.map((s) => {
          const p = s.profile;
          const name = p?.full_name || "Player";
          const isBusy = busy?.startsWith(`review:${s.id}:`) ?? false;
          return (
            <View key={s.id} style={styles.card}>
              <Pressable
                onPress={() => router.push(`/player/${encodeURIComponent(s.user_id)}`)}
                style={({ pressed }) => [styles.cardTop, pressed && { opacity: 0.9 }]}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.cardName} numberOfLines={1}>
                    {name}
                  </Text>
                  <Text style={styles.cardMeta} numberOfLines={1}>
                    {s.current_tier ?? p?.tier ?? "—"} → <Text style={styles.cardMetaStrong}>{s.suggested_tier}</Text>
                  </Text>
                </View>
                <FontAwesome name="angle-right" size={16} color="rgba(255,255,255,0.35)" />
              </Pressable>

              <View style={styles.factRow}>
                <View style={styles.factPill}>
                  <Text style={styles.factText}>{s.runs_attended} attended</Text>
                </View>
                <View style={styles.factPill}>
                  <Text style={styles.factText}>{pct01(s.attendance_rate)} attendance</Text>
                </View>
                <View style={styles.factPill}>
                  <Text style={styles.factText}>{s.no_show_count} no-shows</Text>
                </View>
              </View>

              {s.reason ? <Text style={styles.reason}>{s.reason}</Text> : null}

              <View style={styles.btnRow}>
                <Pressable
                  disabled={isBusy}
                  onPress={() => void review(s.id, true)}
                  style={({ pressed }) => [styles.acceptBtn, pressed && { opacity: 0.9 }, isBusy && styles.disabled]}
                >
                  <Text style={styles.acceptText}>Accept</Text>
                </Pressable>
                <Pressable
                  disabled={isBusy}
                  onPress={() => void review(s.id, false)}
                  style={({ pressed }) => [styles.rejectBtn, pressed && { opacity: 0.9 }, isBusy && styles.disabled]}
                >
                  <Text style={styles.rejectText}>Reject</Text>
                </Pressable>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0a0a0a" },
  content: { padding: 16, paddingBottom: 48 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  h1: { color: "#fff", fontSize: 26, fontWeight: "900" },
  sub: { marginTop: 6, color: "rgba(255,255,255,0.55)", fontSize: 13, fontWeight: "700" },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
    backgroundColor: "rgba(163,230,53,0.08)",
  },
  chipText: { color: LIME, fontWeight: "900", fontSize: 13 },
  actionRow: { marginTop: 14 },
  primary: {
    backgroundColor: LIME,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  primaryText: { color: "#111", fontWeight: "900", fontSize: 14 },
  disabled: { opacity: 0.55 },
  err: { marginTop: 14, color: "#fca5a5" },
  emptyCard: {
    marginTop: 14,
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  emptyTitle: { color: "#fff", fontWeight: "900", fontSize: 16 },
  emptyBody: { marginTop: 8, color: "rgba(255,255,255,0.6)", fontSize: 14, lineHeight: 20 },
  card: {
    marginTop: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardName: { color: "#fff", fontWeight: "900", fontSize: 16 },
  cardMeta: { marginTop: 6, color: "rgba(255,255,255,0.6)", fontWeight: "700", fontSize: 13 },
  cardMetaStrong: { color: LIME, fontWeight: "900" },
  factRow: { marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 8 },
  factPill: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  factText: { color: "rgba(255,255,255,0.78)", fontWeight: "800", fontSize: 12 },
  reason: { marginTop: 10, color: "rgba(255,255,255,0.78)", fontSize: 13, lineHeight: 18 },
  btnRow: { marginTop: 14, flexDirection: "row", gap: 10 },
  acceptBtn: {
    flex: 1,
    backgroundColor: LIME,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  acceptText: { color: "#111", fontWeight: "900" },
  rejectBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.5)",
    backgroundColor: "rgba(248,113,113,0.08)",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  rejectText: { color: "rgba(248,113,113,0.95)", fontWeight: "900" },
});

