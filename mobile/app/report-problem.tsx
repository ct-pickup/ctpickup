import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { FieldScreenShell } from "@/components/fields/FieldScreenShell";
import { useAuth } from "@/context/AuthContext";
import { useFieldListing } from "@/hooks/useFieldListings";
import { submitSuggestion } from "@/lib/fields/suggestionsApi";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";
import { PROBLEMS, type SuggestionProblem, type VenueSettingValue } from "@shared/fields/suggestions";

const SETTINGS: { value: VenueSettingValue; label: string }[] = [
  { value: "outdoor", label: "Outdoor" },
  { value: "indoor", label: "Indoor" },
  { value: "both", label: "Both" },
];

/** Report a problem with a field: pick what's wrong, say what it should be, and an admin reviews it. */
export default function ReportProblemScreen() {
  useThemedStyles(publish_styles);
  const { supabase, session } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { listing: item, loading } = useFieldListing(id);
  const [problem, setProblem] = useState<SuggestionProblem | null>(null);
  const [price, setPrice] = useState("");
  const [permit, setPermit] = useState("");
  const [setting, setSetting] = useState<VenueSettingValue | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const back = { pathname: "/field/[id]", params: { id: id ?? "" } } as const;

  if (loading) {
    return (
      <FieldScreenShell fallback="/(tabs)/sessions?view=fields">
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={themeColor().muted} />
      </FieldScreenShell>
    );
  }
  if (!item) {
    return (
      <FieldScreenShell fallback="/(tabs)/sessions?view=fields">
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.title}>Field not found</Text>
      </FieldScreenShell>
    );
  }
  const v = item.venue;

  function detailMissing(): string | null {
    if (!problem) return "Choose what’s wrong.";
    if (problem === "wrong_price" && !price.trim()) return "Tell us the right price.";
    if (problem === "wrong_permit" && !permit.trim()) return "Tell us the right permit info.";
    if (problem === "wrong_setting" && !setting) return "Choose indoor, outdoor or both.";
    if ((problem === "wrong_location" || problem === "closed" || problem === "other") && note.trim().length < 3) return "Add a short note so we can check it.";
    return null;
  }

  async function send() {
    const missing = detailMissing();
    const uid = session?.user?.id;
    if (missing || !supabase || !uid) {
      setError(missing ?? "Sign in again to send this.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await submitSuggestion(supabase, uid, {
      kind: "correction",
      venue_key: v.venue_key,
      problem,
      price_note: problem === "wrong_price" ? price : null,
      permit_note: problem === "wrong_permit" ? permit : null,
      setting: problem === "wrong_setting" ? setting : null,
      note,
    });
    setBusy(false);
    if (!res.ok) setError(res.message);
    else setDone(true);
  }

  if (done) {
    return (
      <FieldScreenShell fallback={back}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.title}>Thanks</Text>
        <Text style={styles.muted}>We’ll check it and fix {v.name} if you’re right.</Text>
      </FieldScreenShell>
    );
  }

  return (
    <FieldScreenShell
      fallback={back}
      footer={
        <>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable onPress={() => void send()} disabled={busy} style={[styles.cta, busy && styles.off]} accessibilityRole="button">
            {busy ? <ActivityIndicator color={themeColor().onPitch} /> : <Text style={styles.ctaText}>Send report</Text>}
          </Pressable>
        </>
      }
    >
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ gap: 4 }}>
        <Text style={styles.title}>Report a problem</Text>
        <Text style={styles.muted}>{v.name}</Text>
      </View>

      <Text style={styles.label}>What’s wrong?</Text>
      <View style={styles.wrap}>
        {PROBLEMS.map((p) => (
          <Pressable key={p.key} onPress={() => setProblem(p.key)} style={[styles.chip, problem === p.key && styles.on]} accessibilityRole="button" accessibilityState={{ selected: problem === p.key }}>
            <Text style={[styles.chipText, problem === p.key && styles.onText]}>{p.label}</Text>
          </Pressable>
        ))}
      </View>

      {problem === "wrong_price" ? (
        <>
          <Text style={styles.label}>What’s the right price?</Text>
          <TextInput value={price} onChangeText={setPrice} placeholder="Free, or $40/hr" placeholderTextColor={themeColor().muted} style={styles.input} accessibilityLabel="Right price" />
        </>
      ) : null}
      {problem === "wrong_permit" ? (
        <>
          <Text style={styles.label}>What’s the right permit info?</Text>
          <TextInput value={permit} onChangeText={setPermit} placeholder="No permit, or town permit needed" placeholderTextColor={themeColor().muted} style={styles.input} accessibilityLabel="Right permit info" />
        </>
      ) : null}
      {problem === "wrong_setting" ? (
        <>
          <Text style={styles.label}>It is actually</Text>
          <View style={styles.wrap}>
            {SETTINGS.map((s) => (
              <Pressable key={s.value} onPress={() => setSetting(s.value)} style={[styles.chip, setting === s.value && styles.on]} accessibilityRole="button" accessibilityState={{ selected: setting === s.value }}>
                <Text style={[styles.chipText, setting === s.value && styles.onText]}>{s.label}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      <Text style={styles.label}>Note{problem === "wrong_location" || problem === "closed" || problem === "other" ? "" : " (optional)"}</Text>
      <TextInput value={note} onChangeText={setNote} placeholder="Anything that helps us check it" placeholderTextColor={themeColor().muted} multiline style={[styles.input, styles.multi]} accessibilityLabel="Note" />
    </FieldScreenShell>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    title: { fontSize: 28, lineHeight: 32, ...headline, color: c.text },
    muted: { fontSize: 14, fontFamily: "Inter_400Regular", color: c.muted, lineHeight: 20 },
    label: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: c.muted, marginTop: 4 },
    error: { color: c.coralText, fontSize: 14, fontFamily: "Inter_500Medium", textAlign: "center" },
    input: { height: 44, paddingHorizontal: 12, borderRadius: radius.button, borderWidth: 1, borderColor: c.line, backgroundColor: c.card, color: c.text, fontSize: 15, fontFamily: "Inter_400Regular" },
    multi: { height: 90, paddingTop: 10, textAlignVertical: "top" },
    wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.card, backgroundColor: c.card, borderWidth: 1, borderColor: c.line },
    chipText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: c.text },
    on: { backgroundColor: c.pitch, borderColor: c.pitch },
    onText: { color: c.onPitch },
    cta: { backgroundColor: c.pitch, borderRadius: radius.button, paddingVertical: 16, alignItems: "center" },
    off: { opacity: 0.6 },
    ctaText: { color: c.onPitch, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
