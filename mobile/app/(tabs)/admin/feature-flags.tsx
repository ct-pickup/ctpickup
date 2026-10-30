import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { useFeatureFlags } from "@/context/FeatureFlagsContext";
import { changeAdminFlag, fetchAdminFlags, type AdminFlagEvent, type AdminFlagView } from "@/lib/adminApi";
import { tabBarContentPadding } from "@/lib/tabBar";
import { timeAgo } from "@/lib/timeAgo";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";

const COPY: Record<AdminFlagView["key"], { title: string; detail: string }> = {
  fields: { title: "Fields", detail: "Browse, request, suggest and report fields, games at fields, field alerts." },
  paid_plans: { title: "Paid plans", detail: "Concierge and Book my season checkout. Needs Fields on too." },
  rating_v2: { title: "Rating v2", detail: "New rating formula. Switch is global: it applies to every game settled while on. Tune numbers in rating_config." },
  rating_results: { title: "Rating results", detail: "Confirmed team results move ratings a little, and captains confirm scores. Needs Rating v2 on." },
};

function describe(e: AdminFlagEvent): string {
  const c = e.change as { enabled?: { to?: boolean }; added?: { email?: string }; removed?: { id?: string } };
  const what = c.enabled ? (c.enabled.to ? "turned on for everyone" : "turned off for everyone") : c.added ? `added ${c.added.email ?? "a player"}` : c.removed ? "removed a player" : "changed";
  return `${COPY[e.flag_key as AdminFlagView["key"]]?.title ?? e.flag_key}: ${what} · ${e.actor_email ?? "an admin"} · ${timeAgo(e.created_at)}`;
}

/** Remote on/off switches. A flag is on for everyone when switched on, for players on its allowlist, and for admins. Admin only. */
export default function AdminFeatureFlagsScreen() {
  useThemedStyles(publish_styles);
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { refresh: refreshMine } = useFeatureFlags();
  const token = session?.access_token ?? null;

  const [flags, setFlags] = useState<AdminFlagView[]>([]);
  const [events, setEvents] = useState<AdminFlagEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [emails, setEmails] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!token) return;
    const r = await fetchAdminFlags(token);
    if (r.ok) {
      setFlags(r.data.flags);
      setEvents(r.data.events);
      setError(null);
    } else setError(r.error);
    setLoading(false);
    setRefreshing(false);
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function apply(key: string, body: { enabled?: boolean; add_email?: string; remove_id?: string }) {
    if (!token) return;
    setBusy(key);
    const r = await changeAdminFlag(token, { key, ...body });
    setBusy(null);
    if (!r.ok) {
      Alert.alert("Couldn’t save", r.error);
      return;
    }
    if (body.add_email) setEmails((m) => ({ ...m, [key]: "" }));
    await Promise.all([load(), refreshMine()]);
  }

  function confirmToggle(f: AdminFlagView, next: boolean) {
    Alert.alert(
      next ? `Turn ${COPY[f.key].title} on for everyone?` : `Turn ${COPY[f.key].title} off for everyone?`,
      next ? "Every signed-in player will see it the next time their app checks (within a minute or when they reopen the app)." : "Players lose it the next time their app checks. Admins and the allowlist keep it only if you leave them on the list.",
      [
        { text: "Cancel", style: "cancel" },
        { text: next ? "Turn on" : "Turn off", style: next ? "default" : "destructive", onPress: () => void apply(f.key, { enabled: next }) },
      ],
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: tabBarContentPadding(insets.bottom) }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={themeColor().muted} />}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.head}>
          <Text style={styles.title}>Feature flags</Text>
          <Text style={styles.adminTag}>ADMIN</Text>
        </View>
        <Text style={styles.muted}>Off by default. A flag is on for a player when it is on for everyone, or they are on its allowlist, or they are an admin.</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {loading ? <ActivityIndicator color={themeColor().muted} /> : null}

        {flags.map((f) => (
          <View key={f.key} style={styles.card}>
            <View style={styles.cardHead}>
              <View style={styles.cardText}>
                <Text style={styles.flagTitle}>{COPY[f.key].title}</Text>
                <Text style={styles.muted}>{COPY[f.key].detail}</Text>
              </View>
              <Switch
                value={f.enabled}
                disabled={busy === f.key}
                onValueChange={(v) => confirmToggle(f, v)}
                trackColor={{ false: themeColor().line, true: themeColor().pitch }}
                accessibilityLabel={`${COPY[f.key].title} on for everyone`}
              />
            </View>
            <Text style={styles.state}>{f.enabled ? "On for everyone" : "Off for everyone"}</Text>

            <Text style={styles.sub}>Allowlist ({f.allowlist.length})</Text>
            {f.allowlist.length === 0 ? <Text style={styles.muted}>No one yet. Admins always have it.</Text> : null}
            {f.allowlist.map((u) => (
              <View key={u.id} style={styles.row}>
                <Text style={styles.rowText} numberOfLines={1}>{u.email ?? u.id}</Text>
                <Pressable onPress={() => void apply(f.key, { remove_id: u.id })} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${u.email ?? "player"}`}>
                  <Text style={styles.remove}>Remove</Text>
                </Pressable>
              </View>
            ))}
            <View style={styles.addRow}>
              <TextInput
                style={styles.input}
                value={emails[f.key] ?? ""}
                onChangeText={(t) => setEmails((m) => ({ ...m, [f.key]: t }))}
                placeholder="player@email.com"
                placeholderTextColor={themeColor().muted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
              />
              <Pressable
                style={[styles.primary, (!(emails[f.key] ?? "").includes("@") || busy === f.key) && styles.disabled]}
                disabled={!(emails[f.key] ?? "").includes("@") || busy === f.key}
                onPress={() => void apply(f.key, { add_email: (emails[f.key] ?? "").trim() })}
                accessibilityRole="button"
              >
                <Text style={styles.primaryText}>Add</Text>
              </Pressable>
            </View>
          </View>
        ))}

        <Text style={styles.sub}>Recent changes</Text>
        {events.length === 0 ? <Text style={styles.muted}>Nothing yet.</Text> : null}
        {events.map((e) => (
          <Text key={e.id} style={styles.muted}>{describe(e)}</Text>
        ))}
      </ScrollView>
    </View>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    content: { padding: 20, gap: 12 },
    head: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
    title: { fontSize: 30, ...headline, color: c.text },
    adminTag: { fontSize: 12, fontFamily: "Inter_700Bold", fontWeight: "700", color: c.muted },
    muted: { fontSize: 14, fontFamily: "Inter_400Regular", color: c.muted, lineHeight: 20 },
    error: { fontSize: 14, fontFamily: "Inter_500Medium", color: c.coralText },
    card: { padding: 14, backgroundColor: c.card, borderRadius: radius.card, borderWidth: 1, borderColor: c.line, gap: 8 },
    cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
    cardText: { flex: 1, gap: 2 },
    flagTitle: { fontSize: 18, ...headline, color: c.text },
    state: { fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: c.pitchText },
    sub: { fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "700", color: c.text, marginTop: 4 },
    row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, minHeight: 32 },
    rowText: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium", color: c.text },
    remove: { fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: c.coralText },
    addRow: { flexDirection: "row", gap: 8, alignItems: "center" },
    input: { flex: 1, height: 44, paddingHorizontal: 12, borderRadius: radius.button, borderWidth: 1, borderColor: c.line, backgroundColor: c.bg, color: c.text, fontSize: 15, fontFamily: "Inter_400Regular" },
    primary: { backgroundColor: c.pitch, borderRadius: radius.button, paddingVertical: 11, paddingHorizontal: 16 },
    primaryText: { color: c.onPitch, fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "700" },
    disabled: { opacity: 0.45 },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
