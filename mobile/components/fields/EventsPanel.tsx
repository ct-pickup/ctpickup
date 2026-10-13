import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/context/AuthContext";
import {
  EVENT_FILTERS,
  eventDateBlock,
  eventJoinedLabel,
  eventPriceLabel,
  eventSourceLabel,
  eventTimeLabel,
  eventVenueName,
  filterEvents,
  type EventFilter,
  type EventRow,
} from "@/lib/fields/events";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";

const WEEK_MS = 7 * 86_400_000;

/** Games, leagues and tournaments at venues over the next seven days. Reads published rows from the events table. */
export function EventsPanel() {
  useThemedStyles(publish_styles);
  const { supabase, session } = useAuth();
  const uid = session?.user?.id ?? null;
  const [rows, setRows] = useState<EventRow[]>([]);
  const [filter, setFilter] = useState<EventFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !uid) {
      setLoading(false);
      return;
    }
    // Start a little before now so a game that began a few minutes ago still shows.
    const from = new Date(Date.now() - 3 * 3_600_000).toISOString();
    const to = new Date(Date.now() + WEEK_MS).toISOString();
    const { data, error: err } = await supabase
      .from("events")
      .select("id,title,event_type,starts_at,capacity,joined_count,price_cents,price_unit,source,source_note,venue_key,venues(name)")
      .gte("starts_at", from)
      .lt("starts_at", to)
      .order("starts_at", { ascending: true })
      .limit(100);
    if (err) setError("We couldn’t load events. Pull back to this tab to try again.");
    else {
      setRows((data ?? []) as unknown as EventRow[]);
      setError(null);
    }
    setLoading(false);
  }, [supabase, uid]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const shown = useMemo(() => filterEvents(rows, filter), [rows, filter]);

  return (
    <View style={styles.root}>
      <View style={styles.head}>
        <Text style={styles.title}>This week</Text>
      </View>
      <View style={styles.chips}>
        {EVENT_FILTERS.map((f) => (
          <Pressable key={f.key} onPress={() => setFilter(f.key)} style={[styles.chip, filter === f.key && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: filter === f.key }}>
            <Text style={[styles.chipText, filter === f.key && styles.chipTextOn]}>{f.label}</Text>
          </Pressable>
        ))}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {loading ? (
        <ActivityIndicator color={themeColor().muted} />
      ) : shown.length === 0 ? (
        <Text style={styles.empty}>Nothing listed for this week.</Text>
      ) : (
        shown.map((e) => {
          const d = eventDateBlock(e.starts_at);
          const venue = eventVenueName(e);
          const source = eventSourceLabel(e);
          const joined = eventJoinedLabel(e);
          const price = eventPriceLabel(e);
          return (
            <View key={e.id} style={styles.card}>
              <View style={styles.dateBlock}>
                <Text style={styles.dateDay}>{d.weekday}</Text>
                <Text style={styles.dateNum}>{d.day}</Text>
              </View>
              <View style={styles.body}>
                <Text style={styles.name} numberOfLines={2}>
                  {e.title}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {[venue, eventTimeLabel(e.starts_at)].filter(Boolean).join(" · ")}
                </Text>
                <View style={styles.foot}>
                  <Text style={styles.footLeft}>{source ?? joined ?? ""}</Text>
                  {price ? <Text style={styles.price}>{price}</Text> : null}
                </View>
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    root: { gap: 12 },
    head: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
    title: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: c.text },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: c.card, borderWidth: 1, borderColor: c.line },
    chipOn: { backgroundColor: c.pitch, borderColor: c.pitch },
    chipText: { fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: c.text },
    chipTextOn: { color: c.onPitch },
    error: { fontSize: 14, fontFamily: "Inter_500Medium", color: c.coralText },
    empty: { fontSize: 14, fontFamily: "Inter_400Regular", color: c.muted },
    card: { flexDirection: "row", gap: 12, padding: 12, backgroundColor: c.card, borderRadius: radius.card, borderWidth: 1, borderColor: c.line },
    dateBlock: { width: 48, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: c.pitchPanel, paddingVertical: 6 },
    dateDay: { fontSize: 11, fontFamily: "Inter_700Bold", fontWeight: "700", color: c.onPitchPanel },
    dateNum: { fontSize: 20, ...headline, color: c.onPitchPanel },
    body: { flex: 1, gap: 2 },
    name: { fontSize: 16, ...headline, color: c.text },
    meta: { fontSize: 13, fontFamily: "Inter_400Regular", color: c.muted },
    foot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6, gap: 8 },
    footLeft: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: c.muted },
    price: { fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "700", color: c.text },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
