import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { FieldScreenShell } from "@/components/fields/FieldScreenShell";
import { useAuth } from "@/context/AuthContext";
import { useFieldListing } from "@/hooks/useFieldListings";
import { requestEstimate } from "@/lib/fields/presentation";
import {
  clampPlayers,
  DEFAULT_PLAYERS,
  REQUEST_HOURS,
  TIME_OPTIONS,
  weekendDays,
} from "@/lib/fields/requestOptions";
import { submitFieldRequest } from "@/lib/fields/requestApi";
import { FIELDS_SAMPLE_DATA } from "@/lib/fields/config";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";

export default function FieldRequestScreen() {
  useThemedStyles(publish_styles);
  const router = useRouter();
  const { session } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { id } = useLocalSearchParams<{ id: string }>();
  const { listing: item, loading } = useFieldListing(id);
  const days = useMemo(() => weekendDays(new Date()), []);
  const [day, setDay] = useState(days[0]!.iso);
  const [time, setTime] = useState<string>(TIME_OPTIONS[1].value);
  const [players, setPlayers] = useState(DEFAULT_PLAYERS);

  if (loading) {
    return (
      <FieldScreenShell fallback="/(tabs)/sessions">
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={themeColor().muted} />
      </FieldScreenShell>
    );
  }

  if (!item) {
    return (
      <FieldScreenShell fallback="/(tabs)/sessions">
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.title}>Field not found</Text>
      </FieldScreenShell>
    );
  }

  const v = item.venue;
  const estimate = requestEstimate(v, REQUEST_HOURS);
  const perHour = estimate.cents != null && estimate.cents > 0 ? ` × $${Math.round(estimate.cents / 100 / REQUEST_HOURS)}` : "";
  const permitNeeded = v.permit_required === "yes";

  async function send() {
    const token = session?.access_token;
    if (!token) {
      setError("Sign in again to send a request.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await submitFieldRequest(token, {
      venue_key: v.venue_key,
      requested_date: day,
      start_time: time,
      players,
      duration_hours: REQUEST_HOURS,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    router.replace({ pathname: "/field-request-sent", params: { id: v.venue_key, day, time, players: String(players), request: res.id } });
  }

  return (
    <FieldScreenShell
      fallback={{ pathname: "/field/[id]", params: { id: v.venue_key } }}
      footer={
        <>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable onPress={() => void send()} disabled={busy} style={[styles.cta, busy && styles.ctaBusy]} accessibilityRole="button">
            {busy ? <ActivityIndicator color={themeColor().onPitch} /> : <Text style={styles.ctaText}>Send request</Text>}
          </Pressable>
        </>
      }
    >
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ gap: 4 }}>
        <Text style={styles.title}>Request this field</Text>
        <Text style={styles.muted}>{v.name}{FIELDS_SAMPLE_DATA ? " · Sample data" : ""}</Text>
      </View>

      <Text style={styles.label}>Day</Text>
      <View style={styles.wrap}>
        {days.map((d) => (
          <Pressable key={d.iso} onPress={() => setDay(d.iso)} style={[styles.day, day === d.iso && styles.on]} accessibilityRole="button" accessibilityState={{ selected: day === d.iso }}>
            <Text style={[styles.dayName, day === d.iso && styles.onText]}>{d.weekday}</Text>
            <Text style={[styles.dayNum, day === d.iso && styles.onText]}>{d.dayNum}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Time</Text>
      <View style={styles.wrap}>
        {TIME_OPTIONS.map((t) => (
          <Pressable key={t.value} onPress={() => setTime(t.value)} style={[styles.time, time === t.value && styles.on]} accessibilityRole="button" accessibilityState={{ selected: time === t.value }}>
            <Text style={[styles.timeText, time === t.value && styles.onText]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      {!item.calendar_connected ? (
        <Text style={styles.muted}>We can’t see this field’s calendar, so the venue confirms whether the time works.</Text>
      ) : null}

      <Text style={styles.label}>Players</Text>
      <View style={styles.playersRow}>
        <Text style={styles.muted}>Used on the permit request</Text>
        <View style={styles.stepper}>
          <Pressable onPress={() => setPlayers((n) => clampPlayers(n - 1))} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel="Fewer players">
            <Text style={styles.stepText}>−</Text>
          </Pressable>
          <Text style={styles.count} accessibilityLabel={`${players} players`}>
            {players}
          </Text>
          <Pressable onPress={() => setPlayers((n) => clampPlayers(n + 1))} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel="More players">
            <Text style={styles.stepText}>+</Text>
          </Pressable>
        </View>
      </View>

      {permitNeeded ? (
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Permit needed for this field</Text>
          <Text style={styles.noticeBody}>
            We send the facility-use request to the venue for you and tell you when it’s approved. You aren’t charged until it is.
          </Text>
        </View>
      ) : null}

      <View style={styles.estimate}>
        <Text style={styles.muted}>
          Estimate · {REQUEST_HOURS} hours{perHour}
        </Text>
        <Text style={styles.estimateValue}>{estimate.label}</Text>
      </View>
    </FieldScreenShell>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    title: { fontSize: 28, lineHeight: 32, ...headline, color: c.text },
    muted: { fontSize: 14, fontFamily: "Inter_400Regular", color: c.muted, flexShrink: 1 },
    label: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: c.muted, marginTop: 4 },
    wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    day: { width: 68, paddingVertical: 10, borderRadius: radius.card, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, alignItems: "center" },
    dayName: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: c.muted },
    dayNum: { fontSize: 20, ...headline, color: c.text },
    time: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: radius.card, backgroundColor: c.card, borderWidth: 1, borderColor: c.line },
    timeText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: c.text },
    on: { backgroundColor: c.pitch, borderColor: c.pitch },
    onText: { color: c.onPitch },
    playersRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
    stepper: { flexDirection: "row", alignItems: "center", gap: 14 },
    stepBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, alignItems: "center", justifyContent: "center" },
    stepText: { fontSize: 22, color: c.text, fontFamily: "Inter_600SemiBold" },
    count: { minWidth: 28, textAlign: "center", fontSize: 20, ...headline, color: c.text },
    notice: { padding: 14, borderRadius: radius.card, backgroundColor: c.pitchPanel, gap: 4 },
    noticeTitle: { fontSize: 15, fontFamily: "Inter_700Bold", fontWeight: "700", color: c.onPitchPanel },
    noticeBody: { fontSize: 14, fontFamily: "Inter_400Regular", color: c.onPitchPanel, lineHeight: 20 },
    estimate: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 4 },
    estimateValue: { fontSize: 20, ...headline, color: c.text },
    error: { color: themeColor().coralText, fontSize: 14, fontFamily: "Inter_500Medium", textAlign: "center" },
    ctaBusy: { opacity: 0.7 },
    cta: { backgroundColor: c.pitch, borderRadius: radius.button, paddingVertical: 16, alignItems: "center" },
    ctaText: { color: c.onPitch, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
