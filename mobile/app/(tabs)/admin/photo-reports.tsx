import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/context/AuthContext";
import { siteOrigin } from "@/lib/env";
import { PHOTO_REPORT_REASONS } from "@shared/profilePhoto";
import { headline, themeColor, useThemedStyles } from "@/theme";

type Group = {
  user_id: string;
  name: string;
  username: string | null;
  avatar_url: string | null;
  reports: { id: string; reason: string | null; created_at: string; reporter_name: string }[];
};

function reasonLabel(reason: string | null): string {
  return PHOTO_REPORT_REASONS.find((r) => r.value === reason)?.label ?? "No reason given";
}

export default function AdminPhotoReportsScreen() {
  useThemedStyles(publish_s);
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const origin = siteOrigin();
    if (!origin || !token) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${origin}/api/admin/photo-reports`, { headers: { Authorization: `Bearer ${token}` } });
      const j = (await r.json().catch(() => null)) as { groups?: Group[]; error?: string } | null;
      if (!r.ok) {
        setError(j?.error ?? "Couldn't load reports. Try again in a moment.");
        return;
      }
      setGroups(j?.groups ?? []);
    } catch {
      setError("Couldn't load reports. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function review(g: Group, action: "remove" | "dismiss") {
    const origin = siteOrigin();
    if (!origin || !token || busyId) return;
    setBusyId(g.user_id);
    try {
      const r = await fetch(`${origin}/api/admin/photo-reports`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: g.user_id, action }),
      });
      const j = (await r.json().catch(() => null)) as { error?: string } | null;
      if (!r.ok) {
        Alert.alert("Not saved", j?.error ?? "Couldn't save that. Try again.");
        return;
      }
      setGroups((cur) => cur.filter((x) => x.user_id !== g.user_id));
    } catch {
      Alert.alert("Not saved", "Couldn't save that. Check your connection.");
    } finally {
      setBusyId(null);
    }
  }

  if (loading && groups.length === 0) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={themeColor().pitchText} size="large" />
      </View>
    );
  }

  return (
    <ScrollView style={s.root} contentContainerStyle={{ paddingBottom: 60 }}>
      <Text style={s.pageTitle}>Photo reports</Text>
      {error ? <Text style={s.error}>{error}</Text> : null}
      {!error && groups.length === 0 ? (
        <View style={s.card}>
          <Text style={s.muted}>No open reports.</Text>
        </View>
      ) : null}
      {groups.map((g) => {
        const busy = busyId === g.user_id;
        return (
          <View key={g.user_id} style={s.card}>
            <View style={s.header}>
              {g.avatar_url ? (
                <Image source={{ uri: g.avatar_url }} style={s.photo} accessibilityLabel={`${g.name}'s photo`} />
              ) : (
                <View style={[s.photo, s.photoEmpty]}>
                  <FontAwesome name="user" size={32} color={themeColor().muted} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={s.name}>{g.name}</Text>
                {g.username ? <Text style={s.muted}>@{g.username}</Text> : null}
                <Text style={s.muted}>
                  {g.reports.length} open {g.reports.length === 1 ? "report" : "reports"}
                </Text>
              </View>
            </View>
            {g.reports.map((r) => (
              <Text key={r.id} style={s.reportLine}>
                {reasonLabel(r.reason)} · {r.reporter_name} · {new Date(r.created_at).toLocaleDateString()}
              </Text>
            ))}
            <View style={s.actions}>
              <Pressable
                disabled={busy}
                style={[s.dismissBtn, busy && s.disabled]}
                onPress={() => void review(g, "dismiss")}
                accessibilityRole="button"
              >
                <Text style={s.dismissText}>Dismiss</Text>
              </Pressable>
              <Pressable
                disabled={busy}
                style={[s.removeBtn, busy && s.disabled]}
                onPress={() =>
                  Alert.alert("Remove photo?", `${g.name} will be asked to add a new one.`, [
                    { text: "Cancel", style: "cancel" },
                    { text: "Remove photo", style: "destructive", onPress: () => void review(g, "remove") },
                  ])
                }
                accessibilityRole="button"
              >
                {busy ? <ActivityIndicator color={themeColor().coralText} size="small" /> : <Text style={s.removeText}>Remove photo</Text>}
              </Pressable>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

function make_s() {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: themeColor().bg, padding: 16 },
    center: { flex: 1, backgroundColor: themeColor().bg, alignItems: "center", justifyContent: "center" },
    pageTitle: { color: themeColor().text, fontSize: 24, ...headline, marginBottom: 20, marginTop: 8 },
    error: { color: themeColor().coralText, fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 12 },
    card: { backgroundColor: themeColor().card, borderRadius: 12, borderWidth: 1, borderColor: themeColor().line, padding: 16, marginBottom: 12 },
    header: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
    photo: { width: 88, height: 88, borderRadius: 44 },
    photoEmpty: { backgroundColor: themeColor().pitchPanel, alignItems: "center", justifyContent: "center" },
    name: { color: themeColor().text, fontSize: 16, fontFamily: "Inter_700Bold" },
    muted: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
    reportLine: { color: themeColor().text, fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 4 },
    actions: { flexDirection: "row", gap: 8, marginTop: 12 },
    dismissBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: themeColor().line, alignItems: "center" },
    dismissText: { color: themeColor().text, fontSize: 14, fontFamily: "Inter_700Bold" },
    removeBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: themeColor().coral, alignItems: "center" },
    removeText: { color: themeColor().coralText, fontSize: 14, fontFamily: "Inter_700Bold" },
    disabled: { opacity: 0.5 },
  });
}
let s = make_s();
function publish_s() {
  s = make_s();
}
