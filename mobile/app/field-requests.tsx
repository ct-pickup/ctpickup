import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { FieldScreenShell } from "@/components/fields/FieldScreenShell";
import { RequestTracker } from "@/components/fields/RequestTracker";
import { useAuth } from "@/context/AuthContext";
import { statusLabel } from "@/lib/fields/requestTracker";
import { timeAgo } from "@/lib/timeAgo";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";
import { formatRequestWhen, type RequestStatus } from "@shared/fields/requestEmail";

type Row = {
  id: string;
  venue_key: string;
  requested_date: string;
  start_time: string;
  duration_hours: number;
  players: number;
  status: RequestStatus;
  created_at: string;
  venues: { name: string } | { name: string }[] | null;
};

function venueName(r: Row): string {
  const v = Array.isArray(r.venues) ? r.venues[0] : r.venues;
  return v?.name ?? "Field";
}

/** The player's own field requests, newest first, each with the four-step tracker. Reads only their own rows (RLS). */
export default function MyFieldRequestsScreen() {
  useThemedStyles(publish_styles);
  const { supabase, session } = useAuth();
  const uid = session?.user?.id ?? null;
  const { request } = useLocalSearchParams<{ request?: string }>();

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(request ?? null);

  const load = useCallback(async () => {
    if (!supabase || !uid) {
      setLoading(false);
      return;
    }
    const { data, error: err } = await supabase
      .from("venue_requests")
      .select("id,venue_key,requested_date,start_time,duration_hours,players,status,created_at,venues(name)")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(50);
    if (err) {
      setError("We couldn't load your requests. Pull back to this screen to try again.");
    } else {
      const list = (data ?? []) as unknown as Row[];
      setRows(list);
      setError(null);
      // Open the one the player came for (a push tap), otherwise the newest.
      setOpenId((cur) => cur ?? request ?? list[0]?.id ?? null);
    }
    setLoading(false);
  }, [supabase, uid, request]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <FieldScreenShell fallback="/(tabs)/sessions?view=fields">
      <Stack.Screen options={{ headerShown: false }} />
      <Text style={styles.title}>My requests</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {loading ? (
        <ActivityIndicator color={themeColor().muted} style={{ marginTop: 24 }} />
      ) : rows.length === 0 ? (
        <Text style={styles.empty}>You haven’t asked for a field yet.</Text>
      ) : (
        rows.map((r) => {
          const open = openId === r.id;
          const declined = r.status === "declined" || r.status === "cancelled";
          return (
            <View key={r.id} style={styles.card}>
              <Pressable onPress={() => setOpenId(open ? null : r.id)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={styles.head}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.venue}>{venueName(r)}</Text>
                  <Text style={styles.sub}>
                    {formatRequestWhen(r.requested_date, r.start_time, Number(r.duration_hours))} · {r.players} players
                  </Text>
                  <Text style={styles.sub}>Sent {timeAgo(r.created_at)}</Text>
                </View>
                <View style={[styles.pill, r.status === "approved" && styles.pillOk, declined && styles.pillBad]}>
                  <Text style={[styles.pillText, r.status === "approved" && styles.pillTextOk]}>{statusLabel(r.status)}</Text>
                </View>
              </Pressable>
              {open ? <RequestTracker status={r.status} /> : null}
            </View>
          );
        })
      )}
    </FieldScreenShell>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    title: { fontSize: 28, lineHeight: 32, ...headline, color: c.text },
    error: { color: c.coralText, fontSize: 14, fontFamily: "Inter_500Medium" },
    empty: { color: c.muted, fontSize: 15, fontFamily: "Inter_400Regular", marginTop: 12 },
    card: { gap: 12 },
    head: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 14, backgroundColor: c.card, borderRadius: radius.card, borderWidth: 1, borderColor: c.line },
    venue: { fontSize: 17, ...headline, color: c.text },
    sub: { fontSize: 13, fontFamily: "Inter_400Regular", color: c.muted },
    pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: c.overlaySubtle },
    pillOk: { backgroundColor: c.pitch },
    pillBad: { backgroundColor: c.overlaySubtle, borderWidth: 1, borderColor: c.line },
    pillText: { fontSize: 12, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: c.text },
    pillTextOk: { color: c.onPitch },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
