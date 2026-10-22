import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Linking, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { calendarCounts, calendarState, calendarStateLabel, calendarVenueName, providerLabel, type CalendarRow } from "@/lib/fields/calendars";
import { siteOrigin } from "@/lib/env";
import { tabBarContentPadding } from "@/lib/tabBar";
import { timeAgo } from "@/lib/timeAgo";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";
import { guessProvider, normalizeCalendarUrl } from "@shared/fields/ics";

type VenueHit = { venue_key: string; name: string; address: string | null };

/** Which venues show live availability. Everything else shows Unknown. Admin only. */
export default function AdminVenueCalendarsScreen() {
  useThemedStyles(publish_styles);
  const insets = useSafeAreaInsets();
  const { supabase, session } = useAuth();
  const token = session?.access_token ?? null;

  const [rows, setRows] = useState<CalendarRow[]>([]);
  const [totalVenues, setTotalVenues] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [linkFor, setLinkFor] = useState<CalendarRow | null>(null);
  const [linkText, setLinkText] = useState("");
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<VenueHit[]>([]);

  const load = useCallback(async () => {
    if (!supabase) return;
    const [cal, total] = await Promise.all([
      supabase.from("venue_calendars").select("venue_key,provider,calendar_url,sync_status,last_synced_at,last_error,last_error_at,venues(name)").order("updated_at", { ascending: false }),
      supabase.from("venues").select("venue_key", { count: "exact", head: true }),
    ]);
    if (cal.error) setError("We couldn’t load calendars.");
    else {
      setRows((cal.data ?? []) as unknown as CalendarRow[]);
      setError(null);
    }
    setTotalVenues(total.count ?? 0);
    setLoading(false);
    setRefreshing(false);
  }, [supabase]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function syncNow(venueKey: string) {
    const origin = siteOrigin();
    if (!origin || !token) return;
    setBusyKey(venueKey);
    try {
      const r = await fetch(`${origin}/api/admin/venue-calendars`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ venue_key: venueKey }),
      });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string; events?: number } | null;
      if (!r.ok && !j) Alert.alert("Sync failed", "Please try again.");
    } catch {
      Alert.alert("Sync failed", "We couldn’t reach the server.");
    } finally {
      setBusyKey(null);
      await load();
    }
  }

  async function saveLink() {
    if (!supabase || !linkFor) return;
    const url = normalizeCalendarUrl(linkText);
    if (!url) {
      Alert.alert("That link doesn’t work", "Paste an https calendar link (an .ics or Google “secret address in iCal format”).");
      return;
    }
    const { error: err } = await supabase.from("venue_calendars").update({ calendar_url: url, provider: guessProvider(url) }).eq("venue_key", linkFor.venue_key);
    if (err) {
      Alert.alert("Couldn’t save", "Please try again.");
      return;
    }
    const key = linkFor.venue_key;
    setLinkFor(null);
    setLinkText("");
    await syncNow(key);
  }

  async function searchVenues(q: string) {
    setQuery(q);
    if (!supabase || q.trim().length < 2) {
      setHits([]);
      return;
    }
    const { data } = await supabase.from("venues").select("venue_key,name,address").ilike("name", `%${q.trim().replace(/[%_]/g, "")}%`).limit(8);
    setHits((data ?? []) as VenueHit[]);
  }

  async function addVenue(v: VenueHit) {
    if (!supabase) return;
    const { error: err } = await supabase.from("venue_calendars").upsert({ venue_key: v.venue_key, sync_status: "not_connected" }, { onConflict: "venue_key", ignoreDuplicates: true });
    if (err) Alert.alert("Couldn’t add", "Please try again.");
    setAdding(false);
    setQuery("");
    setHits([]);
    await load();
  }

  const counts = calendarCounts(rows, totalVenues);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: tabBarContentPadding(insets.bottom) }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={themeColor().muted} />}
      >
        <View style={styles.head}>
          <Text style={styles.title}>Venue calendars</Text>
          <Text style={styles.adminTag}>ADMIN</Text>
        </View>
        <Text style={styles.muted}>Connected venues show live availability. Everything else shows Unknown.</Text>

        <View style={styles.tiles}>
          <Tile n={counts.live} label="Live" />
          <Tile n={counts.needsAttention} label="Needs attention" />
          <Tile n={counts.unknown} label="Unknown" />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {loading ? <ActivityIndicator color={themeColor().muted} /> : null}

        {rows.map((r) => {
          const state = calendarState(r);
          const busy = busyKey === r.venue_key;
          return (
            <View key={r.venue_key} style={styles.card}>
              <View style={styles.cardHead}>
                <Text style={styles.venue} numberOfLines={2}>
                  {calendarVenueName(r)}
                </Text>
                <View style={[styles.pill, state === "live" && styles.pillLive, (state === "failed" || state === "stale") && styles.pillBad]}>
                  <Text style={[styles.pillText, state === "live" && styles.pillTextLive]}>{calendarStateLabel(state)}</Text>
                </View>
              </View>

              {state === "live" ? (
                <Text style={styles.muted}>
                  {providerLabel(r.provider)} · last synced {timeAgo(r.last_synced_at)}
                </Text>
              ) : state === "not_connected" ? (
                <Text style={styles.muted}>{r.calendar_url ? "Link saved, not synced yet." : "No calendar yet."} Showing Unknown.</Text>
              ) : (
                <Text style={styles.muted}>
                  {r.last_error ?? "This calendar stopped syncing."} {r.last_error_at ? `(${timeAgo(r.last_error_at)}) ` : ""}Showing Unknown.
                </Text>
              )}

              {busy ? (
                <ActivityIndicator color={themeColor().muted} />
              ) : (
                <View style={styles.actions}>
                  {state === "live" ? (
                    <Pressable onPress={() => void syncNow(r.venue_key)} style={styles.secondary} accessibilityRole="button">
                      <Text style={styles.secondaryText}>Sync now</Text>
                    </Pressable>
                  ) : null}
                  {state === "failed" || state === "stale" ? (
                    <Pressable onPress={() => { setLinkFor(r); setLinkText(r.calendar_url ?? ""); }} style={styles.primary} accessibilityRole="button">
                      <Text style={styles.primaryText}>Fix connection</Text>
                    </Pressable>
                  ) : null}
                  {state === "not_connected" ? (
                    <>
                      <Pressable onPress={() => { setLinkFor(r); setLinkText(r.calendar_url ?? ""); }} style={styles.primary} accessibilityRole="button">
                        <Text style={styles.primaryText}>Paste calendar link</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => void Linking.openURL(`mailto:?subject=${encodeURIComponent("Share your field calendar with Competitive Together")}&body=${encodeURIComponent(`Hello,\n\nWe'd like to show when ${calendarVenueName(r)} is free for community soccer. Could you share a link to your field calendar (an .ics or Google Calendar "secret address in iCal format")?\n\nThank you,\nCompetitive Together`)}`)}
                        style={styles.secondary}
                        accessibilityRole="button"
                      >
                        <Text style={styles.secondaryText}>Email them</Text>
                      </Pressable>
                    </>
                  ) : null}
                </View>
              )}
            </View>
          );
        })}

        <Pressable onPress={() => setAdding(true)} style={styles.invite} accessibilityRole="button">
          <Text style={styles.inviteText}>Invite a venue to connect</Text>
        </Pressable>
        <Text style={styles.note}>Calendars with repeating events can’t be read yet and stay Unknown.</Text>
      </ScrollView>

      <Modal visible={linkFor != null} animationType="slide" transparent onRequestClose={() => setLinkFor(null)}>
        <View style={styles.modalWrap}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>{linkFor ? calendarVenueName(linkFor) : ""}</Text>
            <Text style={styles.muted}>Paste an https calendar link (.ics, or Google Calendar’s “secret address in iCal format”).</Text>
            <TextInput value={linkText} onChangeText={setLinkText} autoCapitalize="none" autoCorrect={false} placeholder="https://…" placeholderTextColor={themeColor().muted} style={styles.input} accessibilityLabel="Calendar link" />
            <View style={styles.actions}>
              <Pressable onPress={() => void saveLink()} style={styles.primary} accessibilityRole="button">
                <Text style={styles.primaryText}>Save and sync</Text>
              </Pressable>
              <Pressable onPress={() => setLinkFor(null)} style={styles.secondary} accessibilityRole="button">
                <Text style={styles.secondaryText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={adding} animationType="slide" transparent onRequestClose={() => setAdding(false)}>
        <View style={styles.modalWrap}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Invite a venue</Text>
            <TextInput value={query} onChangeText={(t) => void searchVenues(t)} autoCapitalize="none" placeholder="Search venues by name" placeholderTextColor={themeColor().muted} style={styles.input} accessibilityLabel="Search venues" />
            {hits.map((h) => (
              <Pressable key={h.venue_key} onPress={() => void addVenue(h)} style={styles.hit} accessibilityRole="button">
                <Text style={styles.hitName}>{h.name}</Text>
                {h.address ? <Text style={styles.muted}>{h.address}</Text> : null}
              </Pressable>
            ))}
            <Pressable onPress={() => setAdding(false)} style={styles.secondary} accessibilityRole="button">
              <Text style={styles.secondaryText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Tile({ n, label }: { n: number; label: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileNum}>{n.toLocaleString()}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    content: { padding: 20, gap: 12 },
    head: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
    title: { fontSize: 30, ...headline, color: c.text },
    adminTag: { fontSize: 12, fontFamily: "Inter_700Bold", fontWeight: "700", color: c.muted },
    muted: { fontSize: 14, fontFamily: "Inter_400Regular", color: c.muted, lineHeight: 20 },
    error: { fontSize: 14, fontFamily: "Inter_500Medium", color: c.coralText },
    tiles: { flexDirection: "row", gap: 10 },
    tile: { flex: 1, padding: 12, backgroundColor: c.card, borderRadius: radius.card, borderWidth: 1, borderColor: c.line, gap: 2 },
    tileNum: { fontSize: 24, ...headline, color: c.text },
    tileLabel: { fontSize: 12, fontFamily: "Inter_500Medium", color: c.muted },
    card: { padding: 14, backgroundColor: c.card, borderRadius: radius.card, borderWidth: 1, borderColor: c.line, gap: 8 },
    cardHead: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
    venue: { flex: 1, fontSize: 16, ...headline, color: c.text },
    pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: c.overlaySubtle },
    pillLive: { backgroundColor: c.pitch },
    pillBad: { borderWidth: 1, borderColor: c.line },
    pillText: { fontSize: 12, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: c.text },
    pillTextLive: { color: c.onPitch },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    primary: { backgroundColor: c.pitch, borderRadius: radius.button, paddingVertical: 11, paddingHorizontal: 14 },
    primaryText: { color: c.onPitch, fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "700" },
    secondary: { borderRadius: radius.button, paddingVertical: 11, paddingHorizontal: 14, borderWidth: 1, borderColor: c.line, backgroundColor: c.card },
    secondaryText: { color: c.text, fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    invite: { alignItems: "center", paddingVertical: 14, borderRadius: radius.button, borderWidth: 1, borderColor: c.pitchText },
    inviteText: { color: c.pitchText, fontSize: 15, fontFamily: "Inter_700Bold", fontWeight: "700" },
    note: { fontSize: 12, fontFamily: "Inter_400Regular", color: c.muted },
    modalWrap: { flex: 1, justifyContent: "flex-end", backgroundColor: c.photoScrim },
    modal: { backgroundColor: c.bg, padding: 20, gap: 12, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
    modalTitle: { fontSize: 20, ...headline, color: c.text },
    input: { height: 44, paddingHorizontal: 12, borderRadius: radius.button, borderWidth: 1, borderColor: c.line, backgroundColor: c.card, color: c.text, fontSize: 15, fontFamily: "Inter_400Regular" },
    hit: { padding: 12, borderRadius: radius.card, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, gap: 2 },
    hitName: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: c.text },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
