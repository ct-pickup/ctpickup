import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { fetchAdminSeasonPrize, setAdminSeasonPrizeDisqualified, type SeasonPrizeAdminResponse } from "@/lib/adminApi";
import { goToAdminMenu } from "@/lib/adminNavigation";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";

/**
 * One prize per season. Eligible entrants in prize order: points, then wins, then Player of the Day awards, then
 * earliest entry. The first is the current winner; disqualify them and the next eligible player takes the place.
 */
export default function AdminSeasonPrizeScreen() {
  useThemedStyles(publish_styles);
  const router = useRouter();
  const { session } = useAuth();
  const token = session?.access_token ?? null;

  const [data, setData] = useState<SeasonPrizeAdminResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (isRefresh = false) => {
      if (!token) {
        setError("Not signed in.");
        setLoading(false);
        return;
      }
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      const r = await fetchAdminSeasonPrize(token);
      setRefreshing(false);
      setLoading(false);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setData(r.data);
    },
    [token],
  );

  // Reloads whenever the screen is shown, so a winner change made elsewhere is picked up.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const change = useCallback(
    async (userId: string, disqualified: boolean) => {
      if (!token) return;
      setBusyId(userId);
      const r = await setAdminSeasonPrizeDisqualified(token, userId, disqualified);
      setBusyId(null);
      if (!r.ok) {
        Alert.alert("Could not update", r.error);
        return;
      }
      void load(true);
    },
    [load, token],
  );

  const confirmDisqualify = (userId: string, name: string) =>
    Alert.alert("Disqualify " + name + "?", "They are removed from this season's prize. The next eligible player moves up.", [
      { text: "Cancel", style: "cancel" },
      { text: "Disqualify", style: "destructive", onPress: () => void change(userId, true) },
    ]);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => goToAdminMenu(router)} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.85 }]}>
          <FontAwesome name="chevron-left" size={18} color={themeColor().text} />
          <Text style={styles.backBtnText}>Back</Text>
        </Pressable>
        <Text style={styles.topTitle}>Season prize</Text>
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={themeColor().pitchText} />}
      >
        {loading && !data ? <ActivityIndicator color={themeColor().pitchText} style={{ marginTop: 24 }} /> : null}
        {error ? <Text style={styles.err}>{error}</Text> : null}
        {data ? (
          <>
            <Text style={styles.sub}>
              {data.season.label} · ${data.prize_usd} to one winner · {data.entrants_total} entered · {data.min_games} games minimum
            </Text>
            <Text style={styles.sub}>Order: points, then wins, then Player of the Day awards, then earliest entry.</Text>

            {data.top.length === 0 ? <Text style={styles.muted}>No eligible entrants yet.</Text> : null}
            {data.top.map((e) => (
              <View key={e.user_id} style={[styles.card, e.is_winner && styles.winnerCard]}>
                <View style={styles.cardTop}>
                  <Text style={styles.rank}>{e.rank}</Text>
                  <View style={styles.cardBody}>
                    <Text style={styles.name} numberOfLines={1}>
                      {e.name}
                    </Text>
                    <Text style={styles.meta}>
                      {e.points} pts · {e.wins} wins · {e.potd} POTD · {e.games} games
                    </Text>
                  </View>
                  {e.is_winner ? (
                    <View style={styles.badge}>
                      <FontAwesome name="trophy" size={12} color={themeColor().onPitch} />
                      <Text style={styles.badgeText}>Current winner</Text>
                    </View>
                  ) : null}
                </View>
                <Pressable
                  onPress={() => confirmDisqualify(e.user_id, e.name)}
                  disabled={busyId === e.user_id}
                  hitSlop={8}
                  accessibilityRole="button"
                >
                  <Text style={styles.action}>{busyId === e.user_id ? "Updating…" : "Disqualify"}</Text>
                </Pressable>
              </View>
            ))}

            {data.disqualified.length > 0 ? (
              <>
                <Text style={styles.section}>Disqualified</Text>
                {data.disqualified.map((d) => (
                  <View key={d.user_id} style={styles.card}>
                    <Text style={styles.name}>{d.name}</Text>
                    <Pressable onPress={() => void change(d.user_id, false)} disabled={busyId === d.user_id} hitSlop={8} accessibilityRole="button">
                      <Text style={styles.action}>{busyId === d.user_id ? "Updating…" : "Reinstate"}</Text>
                    </Pressable>
                  </View>
                ))}
              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    topBar: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
    backBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 8, paddingRight: 8 },
    backBtnText: { color: c.text, fontSize: 16, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    topTitle: { flex: 1, fontSize: 24, ...headline, color: c.text },
    content: { padding: 16, paddingBottom: 40, gap: 10 },
    sub: { color: c.muted, fontSize: 13, fontFamily: "Inter_400Regular" },
    muted: { color: c.muted, fontSize: 14, fontFamily: "Inter_400Regular", fontStyle: "italic" },
    err: { color: c.coralText, lineHeight: 20 },
    section: { color: c.muted, fontSize: 12, fontFamily: "Inter_600SemiBold", fontWeight: "600", marginTop: 12 },
    card: { padding: 14, borderRadius: radius.card, borderWidth: 1, borderColor: c.line, backgroundColor: c.card, gap: 8 },
    winnerCard: { borderColor: c.pitch, backgroundColor: c.pitchPanel },
    cardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
    cardBody: { flex: 1, minWidth: 0 },
    rank: { width: 22, color: c.pitchText, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "800" },
    name: { color: c.text, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
    meta: { color: c.muted, fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
    badge: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: c.pitch, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
    badgeText: { color: c.onPitch, fontSize: 12, fontFamily: "Inter_700Bold", fontWeight: "700" },
    action: { color: c.accent, fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
