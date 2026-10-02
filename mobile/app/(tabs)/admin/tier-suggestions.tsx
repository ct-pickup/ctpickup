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

import { headline, themeColor, useThemedStyles } from "@/theme";
function pct01(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v * 100)}%`;
}

export default function AdminTierSuggestionsScreen() {
  useThemedStyles(publish_styles);

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
            {busy === "algo" ? <ActivityIndicator color={themeColor().onPitch} /> : <Text style={styles.primaryText}>Run Promotion Algorithm</Text>}
          </Pressable>
        </View>

        {loading ? <ActivityIndicator color={themeColor().text} style={{ marginTop: 12 }} /> : null}
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
                <FontAwesome name="angle-right" size={16} color={themeColor().muted} />
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

function make_styles() {
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: themeColor().bg },
  content: { padding: 16, paddingBottom: 48 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  h1: { color: themeColor().text, fontSize: 24, ...headline },
  sub: { marginTop: 4, color: themeColor().muted, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700" },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: themeColor().pitch,
    backgroundColor: themeColor().pitchPanel,
  },
  chipText: { color: themeColor().onPitchPanel, fontWeight: "900", fontSize: 13, fontFamily: "Inter_700Bold" },
  actionRow: { marginTop: 12 },
  primary: {
    backgroundColor: themeColor().pitch,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  primaryText: { color: themeColor().onPitch, fontWeight: "900", fontSize: 14, fontFamily: "Inter_700Bold" },
  disabled: { opacity: 0.55 },
  err: { marginTop: 12, color: themeColor().coralText },
  emptyCard: {
    marginTop: 12,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().card,
  },
  emptyTitle: { color: themeColor().text, fontWeight: "900", fontSize: 16, fontFamily: "Inter_700Bold" },
  emptyBody: { marginTop: 8, color: themeColor().muted, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  card: {
    marginTop: 12,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().card,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardName: { color: themeColor().text, fontWeight: "900", fontSize: 16, fontFamily: "Inter_700Bold" },
  cardMeta: { marginTop: 4, color: themeColor().muted, fontWeight: "700", fontSize: 13, fontFamily: "Inter_700Bold" },
  cardMetaStrong: { color: themeColor().pitchText, fontWeight: "900" },
  factRow: { marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 8 },
  factPill: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().bg,
  },
  factText: { color: themeColor().text, fontWeight: "800", fontSize: 13, fontFamily: "Inter_700Bold" },
  reason: { marginTop: 8, color: themeColor().text, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  btnRow: { marginTop: 12, flexDirection: "row", gap: 8 },
  acceptBtn: {
    flex: 1,
    backgroundColor: themeColor().pitch,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  acceptText: { color: themeColor().onPitch, fontWeight: "900" },
  rejectBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: themeColor().coral,
    backgroundColor: themeColor().overlaySubtle,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  rejectText: { color: themeColor().coralText, fontWeight: "900" },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}


