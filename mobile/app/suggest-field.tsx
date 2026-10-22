import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { Region } from "react-native-maps";

import { OsmCredit } from "@/components/fields/FieldBits";
import { PinPicker } from "@/components/fields/PinPicker";
import { FieldScreenShell } from "@/components/fields/FieldScreenShell";
import { useAuth } from "@/context/AuthContext";
import { findNearbyFields, submitSuggestion, type NearbyField } from "@/lib/fields/suggestionsApi";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";
import { DUPLICATE_RADIUS_M, newVenueProblem, type VenueSettingValue } from "@shared/fields/suggestions";

const FALLBACK: Region = { latitude: 41.25, longitude: -73.25, latitudeDelta: 0.35, longitudeDelta: 0.5 };
const SETTINGS: { value: VenueSettingValue; label: string }[] = [
  { value: "outdoor", label: "Outdoor" },
  { value: "indoor", label: "Indoor" },
  { value: "both", label: "Both" },
];
const SURFACES = ["Grass", "Turf", "Other"];

type Phase = "pin" | "form" | "duplicates" | "done";

/**
 * Suggest a field: drop a pin by moving the map under it, fill in what you know, and we check for a field already within about
 * 150 m before saving. A player's suggestion waits for an admin; nothing appears on the map until it is approved.
 */
export default function SuggestFieldScreen() {
  useThemedStyles(publish_styles);
  const router = useRouter();
  const { supabase, session } = useAuth();
  const p = useLocalSearchParams<{ lat?: string; lon?: string; dlat?: string; dlon?: string }>();
  const start: Region =
    p.lat && p.lon
      ? { latitude: Number(p.lat), longitude: Number(p.lon), latitudeDelta: Number(p.dlat) || FALLBACK.latitudeDelta, longitudeDelta: Number(p.dlon) || FALLBACK.longitudeDelta }
      : FALLBACK;
  const centre = useRef({ lat: start.latitude, lon: start.longitude });
  const [phase, setPhase] = useState<Phase>("pin");
  const [pin, setPin] = useState<{ lat: number; lon: number } | null>(null);
  const [name, setName] = useState("");
  const [setting, setSetting] = useState<VenueSettingValue | null>("outdoor");
  const [surface, setSurface] = useState<string | null>(null);
  const [price, setPrice] = useState("");
  const [permit, setPermit] = useState("");
  const [website, setWebsite] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dupes, setDupes] = useState<NearbyField[]>([]);

  async function save() {
    const uid = session?.user?.id;
    if (!supabase || !uid || !pin) return;
    setBusy(true);
    setError(null);
    const res = await submitSuggestion(supabase, uid, {
      kind: "new_venue",
      lat: pin.lat,
      lon: pin.lon,
      name,
      setting,
      surface,
      price_note: price,
      permit_note: permit,
      website,
      note,
    });
    setBusy(false);
    if (!res.ok) setError(res.message);
    else setPhase("done");
  }

  async function submit() {
    const problem = newVenueProblem({ name, lat: pin?.lat ?? null, lon: pin?.lon ?? null, setting, website });
    if (problem) {
      setError(problem);
      return;
    }
    if (!supabase || !pin) return;
    setBusy(true);
    setError(null);
    try {
      const near = await findNearbyFields(supabase, pin.lat, pin.lon);
      if (near.length > 0) {
        setDupes(near.slice(0, 3));
        setPhase("duplicates");
        return;
      }
    } catch {
      // If the check itself fails we still let the suggestion through: an admin reviews every one.
    } finally {
      setBusy(false);
    }
    await save();
  }

  if (phase === "pin") {
    return (
      <FieldScreenShell
        fallback="/(tabs)/sessions?view=fields"
        footer={
          <Pressable
            onPress={() => {
              setPin({ lat: centre.current.lat, lon: centre.current.lon });
              setPhase("form");
            }}
            style={styles.cta}
            accessibilityRole="button"
          >
            <Text style={styles.ctaText}>Use this spot</Text>
          </Pressable>
        }
      >
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.title}>Suggest a field</Text>
        <PinPicker
          start={start}
          onCenter={(lat, lon) => {
            centre.current = { lat, lon };
          }}
        />
        <OsmCredit />
      </FieldScreenShell>
    );
  }

  if (phase === "done") {
    return (
      <FieldScreenShell fallback="/(tabs)/sessions?view=fields" footer={<Pressable onPress={() => router.replace("/(tabs)/sessions?view=fields")} style={styles.cta} accessibilityRole="button"><Text style={styles.ctaText}>Back to fields</Text></Pressable>}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.title}>Thanks</Text>
        <Text style={styles.muted}>We’ll review your suggestion. Once it’s approved the field shows up on the map as player-reported.</Text>
      </FieldScreenShell>
    );
  }

  if (phase === "duplicates") {
    return (
      <FieldScreenShell fallback="/(tabs)/sessions?view=fields">
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.title}>Is this one of these?</Text>
        <Text style={styles.muted}>There {dupes.length === 1 ? "is a field" : "are fields"} within {DUPLICATE_RADIUS_M} m of your pin.</Text>
        {dupes.map((d) => (
          <View key={d.listing.venue.venue_key} style={styles.dupe}>
            <Text style={styles.dupeName}>Is this the same as {d.listing.venue.name}?</Text>
            <Text style={styles.muted}>{Math.round(d.meters)} m away</Text>
            <Pressable onPress={() => router.replace({ pathname: "/report-problem", params: { id: d.listing.venue.venue_key } })} style={styles.secondary} accessibilityRole="button">
              <Text style={styles.secondaryText}>Yes, report a correction instead</Text>
            </Pressable>
          </View>
        ))}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable onPress={() => void save()} disabled={busy} style={[styles.cta, busy && styles.off]} accessibilityRole="button">
          {busy ? <ActivityIndicator color={themeColor().onPitch} /> : <Text style={styles.ctaText}>No, it’s a different field. Save mine</Text>}
        </Pressable>
      </FieldScreenShell>
    );
  }

  return (
    <FieldScreenShell
      fallback="/(tabs)/sessions?view=fields"
      footer={
        <>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable onPress={() => void submit()} disabled={busy} style={[styles.cta, busy && styles.off]} accessibilityRole="button">
            {busy ? <ActivityIndicator color={themeColor().onPitch} /> : <Text style={styles.ctaText}>Send suggestion</Text>}
          </Pressable>
        </>
      }
    >
      <Stack.Screen options={{ headerShown: false }} />
      <Text style={styles.title}>About this field</Text>
      <Pressable onPress={() => setPhase("pin")} accessibilityRole="button" hitSlop={8}>
        <Text style={styles.link}>Move the pin</Text>
      </Pressable>

      <Text style={styles.label}>Name</Text>
      <TextInput value={name} onChangeText={setName} placeholder="Field or park name" placeholderTextColor={themeColor().muted} style={styles.input} accessibilityLabel="Field name" />

      <Text style={styles.label}>Indoor or outdoor</Text>
      <View style={styles.wrap}>
        {SETTINGS.map((s) => (
          <Pressable key={s.value} onPress={() => setSetting(s.value)} style={[styles.chip, setting === s.value && styles.on]} accessibilityRole="button" accessibilityState={{ selected: setting === s.value }}>
            <Text style={[styles.chipText, setting === s.value && styles.onText]}>{s.label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Surface (optional)</Text>
      <View style={styles.wrap}>
        {SURFACES.map((s) => (
          <Pressable key={s} onPress={() => setSurface(surface === s ? null : s)} style={[styles.chip, surface === s && styles.on]} accessibilityRole="button" accessibilityState={{ selected: surface === s }}>
            <Text style={[styles.chipText, surface === s && styles.onText]}>{s}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Price (optional)</Text>
      <TextInput value={price} onChangeText={setPrice} placeholder="Free, or $40/hr" placeholderTextColor={themeColor().muted} style={styles.input} accessibilityLabel="Price" />
      <Text style={styles.label}>Permit or booking (optional)</Text>
      <TextInput value={permit} onChangeText={setPermit} placeholder="No permit, or town permit needed" placeholderTextColor={themeColor().muted} style={styles.input} accessibilityLabel="Permit" />
      <Text style={styles.label}>Website (optional)</Text>
      <TextInput value={website} onChangeText={setWebsite} placeholder="example.com" placeholderTextColor={themeColor().muted} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={styles.input} accessibilityLabel="Website" />
      <Text style={styles.label}>Anything else (optional)</Text>
      <TextInput value={note} onChangeText={setNote} placeholder="Lights until 9, gate code, parking…" placeholderTextColor={themeColor().muted} multiline style={[styles.input, styles.multi]} accessibilityLabel="Notes" />
    </FieldScreenShell>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    title: { fontSize: 28, lineHeight: 32, ...headline, color: c.text },
    muted: { fontSize: 14, fontFamily: "Inter_400Regular", color: c.muted, lineHeight: 20 },
    label: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: c.muted, marginTop: 4 },
    link: { fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: c.pitchText },
    error: { color: c.coralText, fontSize: 14, fontFamily: "Inter_500Medium", textAlign: "center" },
    input: { height: 44, paddingHorizontal: 12, borderRadius: radius.button, borderWidth: 1, borderColor: c.line, backgroundColor: c.card, color: c.text, fontSize: 15, fontFamily: "Inter_400Regular" },
    multi: { height: 90, paddingTop: 10, textAlignVertical: "top" },
    wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.card, backgroundColor: c.card, borderWidth: 1, borderColor: c.line },
    chipText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: c.text },
    on: { backgroundColor: c.pitch, borderColor: c.pitch },
    onText: { color: c.onPitch },
    dupe: { padding: 14, borderRadius: radius.card, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, gap: 8 },
    dupeName: { fontSize: 16, ...headline, color: c.text },
    secondary: { borderRadius: radius.button, paddingVertical: 12, alignItems: "center", borderWidth: 1, borderColor: c.line, backgroundColor: c.card },
    secondaryText: { color: c.text, fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    cta: { backgroundColor: c.pitch, borderRadius: radius.button, paddingVertical: 16, alignItems: "center" },
    off: { opacity: 0.6 },
    ctaText: { color: c.onPitch, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
