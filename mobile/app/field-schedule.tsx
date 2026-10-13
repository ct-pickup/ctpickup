import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { FieldScreenShell } from "@/components/fields/FieldScreenShell";
import { useAuth } from "@/context/AuthContext";
import { useFieldListing } from "@/hooks/useFieldListings";
import { buildDay, scheduleDays, type DbSlot, type OwnRequest } from "@/lib/fields/schedule";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";

/**
 * One field, one week, hour by hour. A time is Open only when the venue's calendar is connected. Otherwise a free-looking
 * hour is Unknown. Bookings we hold and the player's own requests always show.
 */
export default function FieldScheduleScreen() {
  useThemedStyles(publish_styles);
  const router = useRouter();
  const { supabase, session } = useAuth();
  const uid = session?.user?.id ?? null;
  const { id } = useLocalSearchParams<{ id: string }>();
  const venueKey = typeof id === "string" ? id : "";
  const { listing: known } = useFieldListing(venueKey);

  const days = useMemo(() => scheduleDays(new Date()), []);
  const [day, setDay] = useState(days[0]!.iso);
  const [name, setName] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [slots, setSlots] = useState<DbSlot[]>([]);
  const [own, setOwn] = useState<OwnRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !uid || !venueKey) {
      setLoading(false);
      return;
    }
    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 9 * 86_400_000).toISOString();
    const [conn, slotRes, reqRes, venueRes] = await Promise.all([
      supabase.rpc("connected_venue_keys"),
      supabase.from("schedule_slots").select("starts_at,ends_at,status,title").eq("venue_key", venueKey).lt("starts_at", to).gt("ends_at", from),
      supabase
        .from("venue_requests")
        .select("requested_date,start_time,duration_hours")
        .eq("user_id", uid)
        .eq("venue_key", venueKey)
        .in("status", ["new", "waiting_on_school", "approved"]),
      supabase.from("venues").select("name").eq("venue_key", venueKey).maybeSingle(),
    ]);
    // A failed read must never turn into "connected". Unknown is the safe answer.
    setConnected(!conn.error && Array.isArray(conn.data) && (conn.data as unknown[]).some((k) => k === venueKey || (k as { connected_venue_keys?: string })?.connected_venue_keys === venueKey));
    setSlots(slotRes.error ? [] : ((slotRes.data ?? []) as DbSlot[]));
    setOwn(reqRes.error ? [] : ((reqRes.data ?? []) as OwnRequest[]));
    const n = (venueRes.data as { name?: string } | null)?.name;
    if (n) setName(n);
    setError(slotRes.error || conn.error ? "We couldn't load this schedule. Times show as Unknown." : null);
    setLoading(false);
  }, [supabase, uid, venueKey]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const rows = useMemo(() => buildDay({ date: day, slots, ownRequests: own, calendarConnected: connected }), [day, slots, own, connected]);

  return (
    <FieldScreenShell
      fallback={{ pathname: "/field/[id]", params: { id: venueKey } }}
      footer={
        <Pressable onPress={() => router.push({ pathname: "/field-request", params: { id: venueKey } })} style={styles.cta} accessibilityRole="button">
          <Text style={styles.ctaText}>Request a time</Text>
        </Pressable>
      }
    >
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ gap: 4 }}>
        <Text style={styles.title}>Schedule</Text>
        {name ?? known?.venue.name ? <Text style={styles.muted}>{name ?? known?.venue.name}</Text> : null}
      </View>

      <View style={styles.days}>
        {days.map((d) => (
          <Pressable key={d.iso} onPress={() => setDay(d.iso)} style={[styles.day, day === d.iso && styles.dayOn]} accessibilityRole="button" accessibilityState={{ selected: day === d.iso }}>
            <Text style={[styles.dayName, day === d.iso && styles.dayOnText]}>{d.weekday}</Text>
            <Text style={[styles.dayNum, day === d.iso && styles.dayOnText]}>{d.dayNum}</Text>
          </Pressable>
        ))}
      </View>

      {!connected ? (
        <Text style={styles.notice}>This venue’s calendar isn’t connected, so times we can’t see show as Unknown until the venue confirms.</Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.legend}>
        <Legend color="booked" label="Booked" />
        <Legend color="pending" label="Your request" />
        <Legend color="unknown" label="Unknown" />
        {connected ? <Legend color="open" label="Open" /> : null}
      </View>

      {loading ? (
        <ActivityIndicator color={themeColor().muted} />
      ) : (
        <View style={styles.list}>
          {rows.map((r) => (
            <View key={r.hour} style={styles.row}>
              <Text style={styles.hour}>{r.label}</Text>
              <View style={[styles.block, styles[`block_${r.status}`]]}>
                <Text style={[styles.blockTitle, styles[`text_${r.status}`]]} numberOfLines={1}>
                  {r.status === "unknown" ? "Unknown" : r.status === "open" ? "Open" : (r.title ?? (r.status === "booked" ? "Booked" : "Pending"))}
                </Text>
                {r.status === "booked" || r.status === "pending" ? <Text style={[styles.blockTag, styles[`text_${r.status}`]]}>{r.status === "booked" ? "Booked" : "Pending"}</Text> : null}
              </View>
            </View>
          ))}
        </View>
      )}
    </FieldScreenShell>
  );
}

function Legend({ color, label }: { color: "booked" | "pending" | "unknown" | "open"; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.swatch, styles[`block_${color}`]]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    title: { fontSize: 28, lineHeight: 32, ...headline, color: c.text },
    muted: { fontSize: 14, fontFamily: "Inter_400Regular", color: c.muted },
    days: { flexDirection: "row", gap: 6 },
    day: { flex: 1, paddingVertical: 8, borderRadius: radius.card, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, alignItems: "center" },
    dayOn: { backgroundColor: c.pitch, borderColor: c.pitch },
    dayName: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: c.muted },
    dayNum: { fontSize: 17, ...headline, color: c.text },
    dayOnText: { color: c.onPitch },
    notice: { fontSize: 14, fontFamily: "Inter_400Regular", color: c.muted, lineHeight: 20 },
    error: { fontSize: 14, fontFamily: "Inter_500Medium", color: c.coralText },
    legend: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
    legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
    swatch: { width: 14, height: 14, borderRadius: 4 },
    legendText: { fontSize: 12, fontFamily: "Inter_500Medium", color: c.muted },
    list: { gap: 8 },
    row: { flexDirection: "row", alignItems: "center", gap: 12 },
    hour: { width: 48, fontSize: 13, fontFamily: "Inter_600SemiBold", color: c.muted },
    block: { flex: 1, minHeight: 44, borderRadius: radius.button, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
    block_unknown: { backgroundColor: c.overlaySubtle, borderWidth: 1, borderColor: c.line, borderStyle: "dashed" },
    block_open: { backgroundColor: c.pitchPanel },
    block_booked: { backgroundColor: c.inkSurface },
    block_pending: { backgroundColor: c.pitch },
    blockTitle: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    text_unknown: { color: c.muted },
    text_open: { color: c.onPitchPanel },
    text_booked: { color: c.onInk },
    text_pending: { color: c.onPitch },
    blockTag: { fontSize: 12, fontFamily: "Inter_700Bold", fontWeight: "700" },
    cta: { backgroundColor: c.pitch, borderRadius: radius.button, paddingVertical: 16, alignItems: "center" },
    ctaText: { color: c.onPitch, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
