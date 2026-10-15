import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/context/AuthContext";
import { siteOrigin } from "@/lib/env";
import { problemLabel, type SuggestionRow } from "@shared/fields/suggestions";
import { radius, themeColor, useThemedStyles } from "@/theme";

type Item = SuggestionRow & {
  created_at: string;
  suggested_by: string;
  venue: { venue_key: string; name: string | null; address: string | null } | null;
};

/** The fields a suggestion proposes, as short "Label: value" lines. */
function details(s: Item): string[] {
  const out: string[] = [];
  if (s.name) out.push(`Name: ${s.name}`);
  if (s.lat != null && s.lon != null) out.push(`Pin: ${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}`);
  if (s.setting) out.push(`Setting: ${s.setting}`);
  if (s.surface) out.push(`Surface: ${s.surface}`);
  if (s.price_note) out.push(`Price: ${s.price_note}`);
  if (s.permit_note) out.push(`Permit: ${s.permit_note}`);
  if (s.website) out.push(`Website: ${s.website}`);
  if (s.note) out.push(`Note: ${s.note}`);
  return out;
}

export default function AdminVenueSuggestionsScreen() {
  useThemedStyles(publish_styles);
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const origin = siteOrigin();
    if (!origin || !token) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${origin}/api/admin/venue-suggestions?status=pending`, { headers: { Authorization: `Bearer ${token}` } });
      const j = (await r.json().catch(() => null)) as { items?: Item[]; error?: string } | null;
      if (!r.ok) {
        setError(j?.error ?? "Couldn't load suggestions. Try again in a moment.");
        return;
      }
      setItems(j?.items ?? []);
    } catch {
      setError("Couldn't load suggestions. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function act(s: Item, action: "approve" | "reject") {
    const origin = siteOrigin();
    if (!origin || !token || busyId) return;
    setBusyId(s.id);
    try {
      const r = await fetch(`${origin}/api/admin/venue-suggestions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id: s.id, action }),
      });
      const j = (await r.json().catch(() => null)) as { error?: string; code?: string } | null;
      if (!r.ok) {
        Alert.alert(j?.code === "already" ? "Already handled" : "Couldn't do that", j?.error ?? "Please try again.");
        if (j?.code === "already") setItems((cur) => cur.filter((x) => x.id !== s.id));
        return;
      }
      setItems((cur) => cur.filter((x) => x.id !== s.id));
    } catch {
      Alert.alert("Couldn't do that", "Check your connection and try again.");
    } finally {
      setBusyId(null);
    }
  }

  function confirm(s: Item, action: "approve" | "reject") {
    const approve = action === "approve";
    Alert.alert(
      approve ? "Approve this suggestion?" : "Reject this suggestion?",
      approve
        ? s.kind === "new_venue"
          ? "This adds the field to the app. Imports will never overwrite it."
          : "This applies the changes and protects them from imports."
        : "The player is not notified.",
      [
        { text: "Cancel", style: "cancel" },
        { text: approve ? "Approve" : "Reject", style: approve ? "default" : "destructive", onPress: () => void act(s, action) },
      ],
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {loading ? <ActivityIndicator color={themeColor().muted} /> : null}
      {error ? (
        <Pressable onPress={() => void load()} accessibilityRole="button">
          <Text style={styles.error}>{error} Tap to retry.</Text>
        </Pressable>
      ) : null}
      {!loading && !error && items.length === 0 ? <Text style={styles.empty}>No suggestions waiting.</Text> : null}
      {items.map((s) => (
        <View key={s.id} style={styles.card}>
          <Text style={styles.kind}>{s.kind === "new_venue" ? "New field" : `Correction: ${problemLabel(s.problem)}`}</Text>
          {s.venue ? <Text style={styles.title}>{s.venue.name ?? s.venue.venue_key}</Text> : null}
          {s.venue?.address ? <Text style={styles.meta}>{s.venue.address}</Text> : null}
          <Text style={styles.meta}>From {s.suggested_by}</Text>
          {details(s).map((line) => (
            <Text key={line} style={styles.line}>
              {line}
            </Text>
          ))}
          <View style={styles.actions}>
            <Pressable
              onPress={() => confirm(s, "reject")}
              disabled={busyId != null}
              accessibilityRole="button"
              style={[styles.secondary, busyId != null && styles.off]}
            >
              <Text style={styles.secondaryText}>Reject</Text>
            </Pressable>
            <Pressable onPress={() => confirm(s, "approve")} disabled={busyId != null} accessibilityRole="button" style={[styles.primary, busyId != null && styles.off]}>
              <Text style={styles.primaryText}>{busyId === s.id ? "Working" : "Approve"}</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    content: { padding: 20, gap: 12 },
    error: { color: c.coralText, fontSize: 14, fontFamily: "Inter_400Regular" },
    empty: { color: c.muted, fontSize: 15, fontFamily: "Inter_400Regular" },
    card: { backgroundColor: c.card, borderRadius: radius.card, borderWidth: 1, borderColor: c.line, padding: 16, gap: 4 },
    kind: { color: c.pitchText, fontSize: 12, fontFamily: "Inter_700Bold", fontWeight: "700" },
    title: { color: c.text, fontSize: 17, fontFamily: "Inter_700Bold", fontWeight: "700" },
    meta: { color: c.muted, fontSize: 13, fontFamily: "Inter_400Regular" },
    line: { color: c.text, fontSize: 14, fontFamily: "Inter_400Regular" },
    actions: { flexDirection: "row", gap: 10, marginTop: 10 },
    primary: { flex: 1, backgroundColor: c.pitch, borderRadius: radius.button, paddingVertical: 12, alignItems: "center" },
    primaryText: { color: c.onPitch, fontSize: 15, fontFamily: "Inter_700Bold", fontWeight: "700" },
    secondary: { flex: 1, borderWidth: 1, borderColor: c.line, borderRadius: radius.button, paddingVertical: 12, alignItems: "center" },
    secondaryText: { color: c.text, fontSize: 15, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    off: { opacity: 0.6 },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
