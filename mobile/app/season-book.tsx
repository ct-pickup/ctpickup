import { Stack, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { FieldCard } from "@/components/fields/FieldCard";
import { FieldScreenShell } from "@/components/fields/FieldScreenShell";
import { useAuth } from "@/context/AuthContext";
import { useProfileAdmin } from "@/context/ProfileAdminContext";
import { useFieldListings } from "@/hooks/useFieldListings";
import { startPlanCheckout } from "@/lib/fields/plansApi";
import { filterFields } from "@/lib/fields/presentation";
import { DEFAULT_START, DURATIONS, START_TIMES, timeLabel } from "@/lib/fields/requestOptions";
import { NO_FIELD_FILTERS } from "@/lib/fields/types";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";
import { formatPlanPrice, PLANS, SEASON_COUNTS_COPY, SEASON_DEFAULT_WEEKS, SEASON_WEEK_OPTIONS } from "@shared/fields/plans";
import { durationLabel } from "@shared/fields/requestRules";
import { weekdayName } from "@shared/fields/season";

const MATCHES = 6;
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0]; // Monday first

/**
 * Book my season: pick the field, weekday, start time, length and number of weeks, then pay once in Stripe Checkout (test mode).
 * When payment completes the server creates ONE request for the admin. Reuses the request screen's time and length rules.
 */
export default function SeasonBookScreen() {
  useThemedStyles(publish_styles);
  const router = useRouter();
  const { session } = useAuth();
  const { isAdmin } = useProfileAdmin();
  const { fields, loading } = useFieldListings();
  const [query, setQuery] = useState("");
  const [venueKey, setVenueKey] = useState<string | null>(null);
  const [weekday, setWeekday] = useState(6);
  const [time, setTime] = useState<string>(DEFAULT_START);
  const [hours, setHours] = useState<number>(2);
  const [weeks, setWeeks] = useState<number>(SEASON_DEFAULT_WEEKS);
  const [busy, setBusy] = useState(false);

  const picked = useMemo(() => fields.find((f) => f.venue.venue_key === venueKey) ?? null, [fields, venueKey]);
  const matches = useMemo(() => (query.trim().length < 2 ? [] : filterFields(fields, { ...NO_FIELD_FILTERS, query }).slice(0, MATCHES)), [fields, query]);
  const price = PLANS.season.priceCents;

  async function pay() {
    const token = session?.access_token;
    if (!token || !picked) return;
    setBusy(true);
    try {
      const res = await startPlanCheckout(token, { plan: "season", venue_key: picked.venue.venue_key, weekday, start_time: time, duration_hours: hours, weeks });
      if (!res.ok) {
        Alert.alert("Couldn’t start checkout", res.message);
        return;
      }
      await WebBrowser.openBrowserAsync(res.url);
      // The request appears once the payment is confirmed. My requests shows it.
      router.replace("/field-requests");
    } finally {
      setBusy(false);
    }
  }

  if (!isAdmin) {
    return (
      <FieldScreenShell fallback="/plans">
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.title}>Book my season</Text>
        <Text style={styles.muted}>Plans aren’t available yet.</Text>
      </FieldScreenShell>
    );
  }

  return (
    <FieldScreenShell
      fallback="/plans"
      footer={
        <Pressable onPress={() => void pay()} disabled={busy || !picked} style={[styles.cta, (busy || !picked) && styles.ctaOff]} accessibilityRole="button">
          {busy ? <ActivityIndicator color={themeColor().onPitch} /> : <Text style={styles.ctaText}>{picked ? `Pay ${formatPlanPrice(price)} and book` : "Pick a field first"}</Text>}
        </Pressable>
      }
    >
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ gap: 4 }}>
        <Text style={styles.title}>Book my season</Text>
        <Text style={styles.muted}>{SEASON_COUNTS_COPY} Field fees are not included.</Text>
      </View>

      <Text style={styles.label}>Field</Text>
      {picked ? (
        <View style={{ gap: 8 }}>
          <FieldCard item={picked} onPress={() => setVenueKey(null)} />
          <Text style={styles.muted}>Tap the field to choose a different one.</Text>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search fields, schools, towns"
            placeholderTextColor={themeColor().muted}
            style={styles.input}
            accessibilityLabel="Search fields"
          />
          {loading ? <ActivityIndicator color={themeColor().muted} /> : null}
          {matches.map((f) => (
            <FieldCard key={f.venue.venue_key} item={f} onPress={() => setVenueKey(f.venue.venue_key)} />
          ))}
          {!loading && query.trim().length >= 2 && matches.length === 0 ? <Text style={styles.muted}>No fields match.</Text> : null}
        </View>
      )}

      <Text style={styles.label}>Day of the week</Text>
      <View style={styles.wrap}>
        {WEEKDAYS.map((d) => (
          <Pressable key={d} onPress={() => setWeekday(d)} style={[styles.chip, weekday === d && styles.on]} accessibilityRole="button" accessibilityState={{ selected: weekday === d }}>
            <Text style={[styles.chipText, weekday === d && styles.onText]}>{weekdayName(d).slice(0, 3)}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Start time</Text>
      <View style={styles.wrap}>
        {START_TIMES.map((t) => (
          <Pressable key={t} onPress={() => setTime(t)} style={[styles.chip, time === t && styles.on]} accessibilityRole="button" accessibilityState={{ selected: time === t }}>
            <Text style={[styles.chipText, time === t && styles.onText]}>{timeLabel(t)}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Length</Text>
      <View style={styles.wrap}>
        {DURATIONS.map((h) => (
          <Pressable key={h} onPress={() => setHours(h)} style={[styles.chip, hours === h && styles.on]} accessibilityRole="button" accessibilityState={{ selected: hours === h }}>
            <Text style={[styles.chipText, hours === h && styles.onText]}>{durationLabel(h)}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Number of weeks</Text>
      <View style={styles.wrap}>
        {SEASON_WEEK_OPTIONS.map((w) => (
          <Pressable key={w} onPress={() => setWeeks(w)} style={[styles.chip, weeks === w && styles.on]} accessibilityRole="button" accessibilityState={{ selected: weeks === w }}>
            <Text style={[styles.chipText, weeks === w && styles.onText]}>{w}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.summary}>
        <Text style={styles.summaryTitle}>{PLANS.season.name}</Text>
        <Text style={styles.muted}>
          Every {weekdayName(weekday)}, {timeLabel(time)} for {durationLabel(hours)}, {weeks} weeks. We contact the venue, handle any permit and confirm it. If the venue doesn’t reply in 7 days you get it back as credit.
        </Text>
      </View>
    </FieldScreenShell>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    title: { fontSize: 28, lineHeight: 32, ...headline, color: c.text },
    muted: { fontSize: 14, fontFamily: "Inter_400Regular", color: c.muted, lineHeight: 20 },
    label: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: c.muted, marginTop: 4 },
    input: { height: 44, paddingHorizontal: 12, borderRadius: radius.button, borderWidth: 1, borderColor: c.line, backgroundColor: c.card, color: c.text, fontSize: 15, fontFamily: "Inter_400Regular" },
    wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: { paddingHorizontal: 12, paddingVertical: 9, alignItems: "center", borderRadius: radius.card, backgroundColor: c.card, borderWidth: 1, borderColor: c.line },
    chipText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: c.text },
    on: { backgroundColor: c.pitch, borderColor: c.pitch },
    onText: { color: c.onPitch },
    summary: { padding: 14, borderRadius: radius.card, backgroundColor: c.pitchPanel, gap: 4 },
    summaryTitle: { fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700", color: c.onPitchPanel },
    cta: { backgroundColor: c.pitch, borderRadius: radius.button, paddingVertical: 16, alignItems: "center" },
    ctaOff: { opacity: 0.55 },
    ctaText: { color: c.onPitch, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
