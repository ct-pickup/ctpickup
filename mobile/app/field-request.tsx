import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { VenueNotice } from "@/components/fields/FieldBits";
import { FieldScreenShell } from "@/components/fields/FieldScreenShell";
import { useAuth } from "@/context/AuthContext";
import { useFieldListing } from "@/hooks/useFieldListings";
import { requestEstimate } from "@/lib/fields/presentation";
import {
  clampPlayers,
  DEFAULT_DURATION,
  DEFAULT_PLAYERS,
  DEFAULT_START,
  defaultDay,
  DURATIONS,
  requestDays,
  START_TIMES,
  timeLabel,
} from "@/lib/fields/requestOptions";
import { windowStatus, type DbSlot } from "@/lib/fields/schedule";
import { durationLabel } from "@shared/fields/requestRules";
import { submitFieldRequest } from "@/lib/fields/requestApi";
import { FIELDS_SAMPLE_DATA } from "@/lib/fields/config";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";

export default function FieldRequestScreen() {
  useThemedStyles(publish_styles);
  const router = useRouter();
  const { session, supabase } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { id } = useLocalSearchParams<{ id: string }>();
  const { listing: item, loading } = useFieldListing(id);
  const days = useMemo(() => requestDays(), []);
  const [day, setDay] = useState(() => defaultDay(days));
  const [time, setTime] = useState<string>(DEFAULT_START);
  const [hours, setHours] = useState<number>(DEFAULT_DURATION);
  const [players, setPlayers] = useState(DEFAULT_PLAYERS);
  const [slots, setSlots] = useState<DbSlot[]>([]);
  const venueKey = item?.venue.venue_key ?? null;

  // Bookings we hold for this venue over the pickable window, so booked times can be marked.
  useEffect(() => {
    if (!supabase || !venueKey) return;
    let cancelled = false;
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 32 * 86_400_000).toISOString();
    void supabase
      .from("schedule_slots")
      .select("starts_at,ends_at,status,title")
      .eq("venue_key", venueKey)
      .lt("starts_at", to)
      .gt("ends_at", from)
      .then(({ data, error: err }) => {
        if (!cancelled && !err) setSlots((data ?? []) as DbSlot[]);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, venueKey]);

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
  const estimate = requestEstimate(v, hours);
  const perHour = estimate.cents != null && estimate.cents > 0 ? ` × $${Math.round(estimate.cents / 100 / hours)}` : "";
  const chosenStatus = windowStatus({ date: day, start: time, hours, slots, calendarConnected: item.calendar_connected });
  const chosenBooked = chosenStatus === "booked";
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
      duration_hours: hours,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    router.replace({ pathname: "/field-request-sent", params: { id: v.venue_key, day, time, hours: String(hours), players: String(players), request: res.id } });
  }

  return (
    <FieldScreenShell
      fallback={{ pathname: "/field/[id]", params: { id: v.venue_key } }}
      footer={
        <>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable onPress={() => void send()} disabled={busy || chosenBooked} style={[styles.cta, (busy || chosenBooked) && styles.ctaBusy]} accessibilityRole="button">
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
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
        {days.map((d, i) => (
          <View key={d.iso} style={styles.dayCol}>
            <Text style={styles.monthLabel}>{i === 0 || d.dayNum === 1 ? d.month : " "}</Text>
            <Pressable onPress={() => setDay(d.iso)} style={[styles.day, day === d.iso && styles.on]} accessibilityRole="button" accessibilityLabel={d.long} accessibilityState={{ selected: day === d.iso }}>
              <Text style={[styles.dayName, day === d.iso && styles.onText]}>{d.weekday}</Text>
              <Text style={[styles.dayNum, day === d.iso && styles.onText]}>{d.dayNum}</Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>

      <Text style={styles.label}>Start time</Text>
      <View style={styles.wrap}>
        {START_TIMES.map((t) => {
          const st = windowStatus({ date: day, start: t, hours, slots, calendarConnected: item.calendar_connected });
          const booked = st === "booked";
          return (
            <Pressable
              key={t}
              onPress={() => setTime(t)}
              disabled={booked}
              style={[styles.time, time === t && styles.on, booked && styles.timeBooked]}
              accessibilityRole="button"
              accessibilityLabel={`${timeLabel(t)}${booked ? ", booked" : st === "open" ? ", open" : ""}`}
              accessibilityState={{ selected: time === t, disabled: booked }}
            >
              <Text style={[styles.timeText, time === t && styles.onText, booked && styles.timeTextBooked]}>{timeLabel(t)}</Text>
              {booked ? <Text style={styles.timeTag}>Booked</Text> : st === "open" ? <Text style={[styles.timeTag, time === t && styles.onText]}>Open</Text> : null}
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.label}>Length</Text>
      <View style={styles.wrap}>
        {DURATIONS.map((h) => (
          <Pressable key={h} onPress={() => setHours(h)} style={[styles.time, hours === h && styles.on]} accessibilityRole="button" accessibilityState={{ selected: hours === h }}>
            <Text style={[styles.timeText, hours === h && styles.onText]}>{durationLabel(h)}</Text>
          </Pressable>
        ))}
      </View>
      {chosenBooked ? <Text style={styles.error}>That time overlaps a booking. Pick a different start time or a shorter length.</Text> : null}
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
          Estimate · {durationLabel(hours)}{perHour}
        </Text>
        <Text style={styles.estimateValue}>{estimate.label}</Text>
      </View>
      <VenueNotice />
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
    strip: { gap: 8, paddingRight: 8 },
    dayCol: { gap: 4 },
    monthLabel: { fontSize: 11, fontFamily: "Inter_700Bold", fontWeight: "700", color: c.muted, height: 14 },
    timeBooked: { opacity: 0.45 },
    timeTextBooked: { textDecorationLine: "line-through" },
    timeTag: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: c.muted },
    day: { width: 56, paddingVertical: 10, borderRadius: radius.card, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, alignItems: "center" },
    dayName: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: c.muted },
    dayNum: { fontSize: 20, ...headline, color: c.text },
    time: { paddingHorizontal: 12, paddingVertical: 9, alignItems: "center", borderRadius: radius.card, backgroundColor: c.card, borderWidth: 1, borderColor: c.line },
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
