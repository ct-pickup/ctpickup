import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { FieldScreenShell } from "@/components/fields/FieldScreenShell";
import { useAuth } from "@/context/AuthContext";
import { useFieldListing } from "@/hooks/useFieldListings";
import { PinPicker } from "@/components/fields/PinPicker";
import { siteOrigin } from "@/lib/env";
import { searchVenues } from "@/lib/fields/placeSearchApi";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";
import { MIN_QUERY, type PlaceHit } from "@shared/fields/placeSearch";
import { REPORT_REASONS, type SuggestionProblem } from "@shared/fields/suggestions";

/**
 * Report a problem with a field: pick what's wrong (with a pin, a search for the other field, or a short text where it helps),
 * add an optional note, and an admin reviews it. Sent through the server so repeated reports can protect the map.
 */
export default function ReportProblemScreen() {
  useThemedStyles(publish_styles);
  const { supabase, session } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { listing: item, loading } = useFieldListing(id);
  const [problem, setProblem] = useState<SuggestionProblem | null>(null);
  const [detail, setDetail] = useState("");
  const [note, setNote] = useState("");
  const [pinOpen, setPinOpen] = useState(false);
  const pin = useRef<{ lat: number; lon: number } | null>(null);
  const [dupQuery, setDupQuery] = useState("");
  const [dupHits, setDupHits] = useState<PlaceHit[]>([]);
  const [dup, setDup] = useState<{ key: string; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const back = { pathname: "/field/[id]", params: { id: id ?? "" } } as const;
  const thisKey = item?.venue.venue_key ?? null;

  // Search our own venues for the other field (a short pause after typing).
  useEffect(() => {
    const q = dupQuery.trim();
    if (problem !== "duplicate" || q.length < MIN_QUERY || !supabase) return;
    let cancelled = false;
    const t = setTimeout(() => {
      void searchVenues(supabase, q).then((hits) => {
        if (!cancelled) setDupHits(hits.filter((h) => h.key !== `v:${thisKey}`));
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [dupQuery, problem, supabase, thisKey]);

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
    if (problem === "wrong_info" && detail.trim().length < 3) return "Tell us what’s wrong in a few words.";
    if (problem === "duplicate" && !dup) return "Search for the other field and pick it.";
    return null;
  }

  async function send() {
    const missing = detailMissing();
    const origin = siteOrigin();
    const token = session?.access_token;
    if (missing || !origin || !token) {
      setError(missing ?? "Sign in again to send this.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`${origin}/api/fields/report`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          venue_key: v.venue_key,
          problem,
          note,
          detail: problem === "wrong_info" ? detail : null,
          duplicate_of: problem === "duplicate" ? dup?.key : null,
          lat: problem === "wrong_location" && pinOpen ? pin.current?.lat : null,
          lon: problem === "wrong_location" && pinOpen ? pin.current?.lon : null,
        }),
      });
      const j = (await r.json().catch(() => null)) as { error?: string } | null;
      if (!r.ok) setError(j?.error ?? "We couldn’t send that. Please try again.");
      else setDone(true);
    } catch {
      setError("We couldn’t send that. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
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
      <View style={styles.list}>
        {REPORT_REASONS.map((p) => (
          <Pressable key={p.key} onPress={() => setProblem(p.key)} style={[styles.reason, problem === p.key && styles.on]} accessibilityRole="button" accessibilityState={{ selected: problem === p.key }}>
            <Text style={[styles.chipText, problem === p.key && styles.onText]}>{p.label}</Text>
          </Pressable>
        ))}
      </View>

      {problem === "wrong_location" ? (
        <>
          <Pressable onPress={() => setPinOpen((o) => !o)} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.link}>{pinOpen ? "Don’t send a pin" : "Drop a pin where it really is (optional)"}</Text>
          </Pressable>
          {pinOpen && v.lat != null && v.lon != null ? (
            <PinPicker
              start={{ latitude: v.lat, longitude: v.lon, latitudeDelta: 0.003, longitudeDelta: 0.003 }}
              onCenter={(lat, lon) => {
                pin.current = { lat, lon };
              }}
            />
          ) : null}
        </>
      ) : null}

      {problem === "duplicate" ? (
        <>
          <Text style={styles.label}>Which field is it a duplicate of?</Text>
          {dup ? (
            <Pressable onPress={() => setDup(null)} style={styles.picked} accessibilityRole="button" accessibilityLabel={`${dup.label}. Tap to change.`}>
              <Text style={styles.chipText}>{dup.label}</Text>
              <Text style={styles.link}>Change</Text>
            </Pressable>
          ) : (
            <>
              <TextInput value={dupQuery} onChangeText={setDupQuery} placeholder="Search by field or school name" placeholderTextColor={themeColor().muted} autoCorrect={false} style={styles.input} accessibilityLabel="Search for the other field" />
              {dupQuery.trim().length >= MIN_QUERY
                ? dupHits.map((h) => (
                    <Pressable key={h.key} onPress={() => setDup({ key: h.key.slice(2), label: h.label })} style={styles.reason} accessibilityRole="button">
                      <Text style={styles.chipText}>{h.label}</Text>
                      {h.sub ? <Text style={styles.muted}>{h.sub}</Text> : null}
                    </Pressable>
                  ))
                : null}
            </>
          )}
        </>
      ) : null}

      {problem === "wrong_info" ? (
        <>
          <Text style={styles.label}>What’s wrong, and what should it say?</Text>
          <TextInput value={detail} onChangeText={setDetail} placeholder="e.g. Price is $60/hr, call 203-555-0100 to book" placeholderTextColor={themeColor().muted} multiline style={[styles.input, styles.multi]} accessibilityLabel="What is wrong" />
        </>
      ) : null}

      <Text style={styles.label}>Note (optional)</Text>
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
    list: { gap: 8 },
    reason: { paddingHorizontal: 14, paddingVertical: 12, borderRadius: radius.card, backgroundColor: themeColor().card, borderWidth: 1, borderColor: themeColor().line, gap: 2 },
    picked: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 12, borderRadius: radius.card, backgroundColor: themeColor().card, borderWidth: 1, borderColor: themeColor().pitch },
    link: { fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: themeColor().pitchText },
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
