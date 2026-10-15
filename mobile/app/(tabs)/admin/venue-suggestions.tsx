import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { useAuth } from "@/context/AuthContext";
import { siteOrigin } from "@/lib/env";
import { problemLabel, type SuggestionRow } from "@shared/fields/suggestions";
import { radius, themeColor, useThemedStyles } from "@/theme";

type Item = SuggestionRow & {
  created_at: string;
  suggested_by: string;
  venue: { venue_key: string; name: string | null; address: string | null } | null;
  duplicate: { venue_key: string; name: string | null; address: string | null } | null;
};
type Hidden = { venue_key: string; name: string; address: string | null; status_reason: string | null; players: number; notes: string[] };
/** Reports that are about the field existing at all: they get the field-level actions instead of a plain Approve. */
const FIELD_REPORTS = ["doesnt_exist", "not_soccer", "private", "closed", "wrong_location", "duplicate"];

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
  if (s.detail) out.push(`Detail: ${s.detail}`);
  if (s.duplicate_of) out.push(`Duplicate of: ${s.duplicate ? `${s.duplicate.name ?? s.duplicate.venue_key}${s.duplicate.address ? ` (${s.duplicate.address})` : ""}` : s.duplicate_of}`);
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
  const [hidden, setHidden] = useState<Hidden[]>([]);
  const [closing, setClosing] = useState<string | null>(null);
  const [until, setUntil] = useState("");

  const load = useCallback(async () => {
    const origin = siteOrigin();
    if (!origin || !token) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${origin}/api/admin/venue-suggestions?status=pending`, { headers: { Authorization: `Bearer ${token}` } });
      const j = (await r.json().catch(() => null)) as { items?: Item[]; hidden?: Hidden[]; error?: string } | null;
      if (!r.ok) {
        setError(j?.error ?? "Couldn't load suggestions. Try again in a moment.");
        return;
      }
      setItems(j?.items ?? []);
      setHidden(j?.hidden ?? []);
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

  async function post(body: Record<string, unknown>, busyKey: string, doneMessage?: string): Promise<boolean> {
    const origin = siteOrigin();
    if (!origin || !token || busyId) return false;
    setBusyId(busyKey);
    try {
      const r = await fetch(`${origin}/api/admin/venue-suggestions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await r.json().catch(() => null)) as { error?: string; code?: string } | null;
      if (!r.ok) {
        Alert.alert(j?.code === "already" ? "Already handled" : "Couldn't do that", j?.error ?? "Please try again.");
        if (j?.code === "already") setItems((cur) => cur.filter((x) => x.id !== busyKey));
        return false;
      }
      if (doneMessage) Alert.alert("Done", doneMessage);
      await load();
      return true;
    } catch {
      Alert.alert("Couldn't do that", "Check your connection and try again.");
      return false;
    } finally {
      setBusyId(null);
    }
  }

  const act = (s: Item, action: "approve" | "reject") => post({ id: s.id, action }, s.id);

  function sure(title: string, message: string, label: string, run: () => void, destructive = true) {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      { text: label, style: destructive ? "destructive" : "default", onPress: run },
    ]);
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
      {hidden.length > 0 ? <Text style={styles.section}>Hidden for review</Text> : null}
      {hidden.map((h) => (
        <View key={h.venue_key} style={styles.card}>
          <Text style={styles.kind}>HIDDEN FROM THE MAP</Text>
          <Text style={styles.title}>{h.name}</Text>
          {h.address ? <Text style={styles.meta}>{h.address}</Text> : null}
          <Text style={styles.meta}>{h.players} {h.players === 1 ? "player" : "players"} reported it{h.status_reason ? ` · ${h.status_reason}` : ""}</Text>
          {h.notes.map((n) => (
            <Text key={n} style={styles.line}>
              {n}
            </Text>
          ))}
          <View style={styles.actions}>
            <Pressable onPress={() => sure("Remove this field?", "It stays off the map for good and imports will not bring it back.", "Remove", () => void post({ action: "remove", venue_key: h.venue_key }, h.venue_key))} disabled={busyId != null} style={[styles.secondary, busyId != null && styles.off]} accessibilityRole="button">
              <Text style={styles.dangerText}>Remove</Text>
            </Pressable>
            <Pressable onPress={() => void post({ action: "restore", venue_key: h.venue_key }, h.venue_key)} disabled={busyId != null} style={[styles.primary, busyId != null && styles.off]} accessibilityRole="button">
              <Text style={styles.primaryText}>{busyId === h.venue_key ? "Working" : "Restore"}</Text>
            </Pressable>
          </View>
        </View>
      ))}
      {items.length > 0 ? <Text style={styles.section}>Suggestions</Text> : null}
      {!loading && !error && items.length === 0 && hidden.length === 0 ? <Text style={styles.empty}>No suggestions waiting.</Text> : null}
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
          {FIELD_REPORTS.includes(s.problem ?? "") && s.venue ? (
            <View style={styles.actions}>
              <Pressable onPress={() => sure("Remove this field?", "It leaves the map for good. It is never deleted, and imports will not bring it back.", "Remove field", () => void post({ id: s.id, action: "remove_field" }, s.id))} disabled={busyId != null} style={[styles.secondary, busyId != null && styles.off]} accessibilityRole="button">
                <Text style={styles.dangerText}>Remove field</Text>
              </Pressable>
              {s.problem === "duplicate" && s.duplicate_of ? (
                <Pressable onPress={() => sure("Merge into the other field?", "Notes and contacts move to the other field and this one is removed.", "Merge", () => void post({ id: s.id, action: "merge" }, s.id), false)} disabled={busyId != null} style={[styles.secondary, busyId != null && styles.off]} accessibilityRole="button">
                  <Text style={styles.secondaryText}>Merge into duplicate</Text>
                </Pressable>
              ) : null}
              {s.problem === "wrong_location" && s.lat != null && s.lon != null ? (
                <Pressable onPress={() => sure("Move the pin?", "The field moves to the reported spot and imports will not move it back.", "Move pin", () => void post({ id: s.id, action: "move_pin" }, s.id), false)} disabled={busyId != null} style={[styles.secondary, busyId != null && styles.off]} accessibilityRole="button">
                  <Text style={styles.secondaryText}>Move pin</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={() => setClosing(closing === s.id ? null : s.id)} disabled={busyId != null} style={[styles.secondary, busyId != null && styles.off]} accessibilityRole="button">
                <Text style={styles.secondaryText}>Mark closed until…</Text>
              </Pressable>
              <Pressable onPress={() => confirm(s, "reject")} disabled={busyId != null} style={[styles.secondary, busyId != null && styles.off]} accessibilityRole="button">
                <Text style={styles.secondaryText}>Dismiss</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.actions}>
              <Pressable onPress={() => confirm(s, "reject")} disabled={busyId != null} accessibilityRole="button" style={[styles.secondary, busyId != null && styles.off]}>
                <Text style={styles.secondaryText}>Reject</Text>
              </Pressable>
              <Pressable onPress={() => confirm(s, "approve")} disabled={busyId != null} accessibilityRole="button" style={[styles.primary, busyId != null && styles.off]}>
                <Text style={styles.primaryText}>{busyId === s.id ? "Working" : "Approve"}</Text>
              </Pressable>
            </View>
          )}
          {closing === s.id ? (
            <View style={styles.closeRow}>
              <TextInput value={until} onChangeText={setUntil} placeholder="Closed until (YYYY-MM-DD)" placeholderTextColor={themeColor().muted} autoCapitalize="none" style={styles.input} accessibilityLabel="Closed until date" />
              <Pressable onPress={() => void post({ id: s.id, action: "close_until", until, reason: s.note ?? null }, s.id).then((ok) => ok && setClosing(null))} disabled={busyId != null} style={[styles.primary, busyId != null && styles.off]} accessibilityRole="button">
                <Text style={styles.primaryText}>Set</Text>
              </Pressable>
            </View>
          ) : null}
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
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 10 },
    primary: { flex: 1, backgroundColor: c.pitch, borderRadius: radius.button, paddingVertical: 12, alignItems: "center" },
    primaryText: { color: c.onPitch, fontSize: 15, fontFamily: "Inter_700Bold", fontWeight: "700" },
    secondary: { flexGrow: 1, borderWidth: 1, borderColor: c.line, borderRadius: radius.button, paddingVertical: 12, alignItems: "center" },
    secondaryText: { color: c.text, fontSize: 15, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    off: { opacity: 0.6 },
    section: { fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700", color: c.muted, marginTop: 6 },
    dangerText: { color: c.coralText, fontSize: 15, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    closeRow: { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 8 },
    input: { flex: 1, height: 42, paddingHorizontal: 12, borderRadius: radius.button, borderWidth: 1, borderColor: c.line, backgroundColor: c.bg, color: c.text, fontSize: 15, fontFamily: "Inter_400Regular" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
