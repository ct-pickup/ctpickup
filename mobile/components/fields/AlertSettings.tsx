import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";

import { useAuth } from "@/context/AuthContext";
import { VISIBLE_ALERT_OPTIONS, alertEnabled, type AlertType } from "@/lib/fields/alerts";
import { radius, themeColor, useThemedStyles } from "@/theme";

type Row = { alert_type: string; enabled: boolean };
type Saved = { venue_key: string; venues: { name: string } | { name: string }[] | null };

/** Field alert switches and saved fields. Lives inside the Notifications screen. Own rows only (RLS). */
export function AlertSettings() {
  useThemedStyles(publish_styles);
  const { supabase, session } = useAuth();
  const uid = session?.user?.id ?? null;
  const [rows, setRows] = useState<Row[]>([]);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !uid) return;
    const [a, s] = await Promise.all([
      supabase.from("alert_subscriptions").select("alert_type,enabled").eq("user_id", uid),
      supabase.from("saved_venues").select("venue_key,venues(name)").eq("user_id", uid).order("created_at", { ascending: false }),
    ]);
    if (!a.error) setRows((a.data ?? []) as Row[]);
    if (!s.error) setSaved((s.data ?? []) as unknown as Saved[]);
  }, [supabase, uid]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function toggle(type: AlertType, next: boolean) {
    if (!supabase || !uid) return;
    const before = rows;
    setRows((cur) => [...cur.filter((r) => r.alert_type !== type), { alert_type: type, enabled: next }]);
    const { error: err } = await supabase.from("alert_subscriptions").upsert({ user_id: uid, alert_type: type, enabled: next }, { onConflict: "user_id,alert_type" });
    if (err) {
      setRows(before);
      setError("We couldn’t save that. Please try again.");
    } else setError(null);
  }

  async function removeSaved(venueKey: string) {
    if (!supabase || !uid) return;
    const { error: err } = await supabase.from("saved_venues").delete().eq("user_id", uid).eq("venue_key", venueKey);
    if (!err) setSaved((cur) => cur.filter((s) => s.venue_key !== venueKey));
  }

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Field alerts</Text>
      <Text style={styles.sub}>Get told the moment something changes.</Text>
      <View style={styles.group}>
        {VISIBLE_ALERT_OPTIONS.map((o, i) => (
          <View key={o.type} style={[styles.row, i > 0 && styles.divider]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{o.title}</Text>
              <Text style={styles.rowSub}>{o.sub}</Text>
            </View>
            <Switch
              value={alertEnabled(rows, o.type)}
              onValueChange={(v) => void toggle(o.type, v)}
              trackColor={{ false: themeColor().overlayStrong, true: themeColor().pitch }}
              accessibilityLabel={o.title}
            />
          </View>
        ))}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.title}>Saved fields</Text>
      {saved.length === 0 ? (
        <Text style={styles.sub}>Save a field from its page to get alerts about it.</Text>
      ) : (
        <View style={styles.chips}>
          {saved.map((s) => {
            const v = Array.isArray(s.venues) ? s.venues[0] : s.venues;
            return (
              <Pressable key={s.venue_key} onPress={() => void removeSaved(s.venue_key)} style={styles.chip} accessibilityRole="button" accessibilityLabel={`Remove ${v?.name ?? "field"}`}>
                <Text style={styles.chipText}>{v?.name ?? s.venue_key} ×</Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    root: { gap: 10, marginTop: 24 },
    title: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: c.text },
    sub: { fontSize: 14, fontFamily: "Inter_400Regular", color: c.muted },
    group: { backgroundColor: c.card, borderRadius: radius.card, borderWidth: 1, borderColor: c.line },
    row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
    rowTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: c.text },
    rowSub: { fontSize: 13, fontFamily: "Inter_400Regular", color: c.muted },
    error: { fontSize: 14, fontFamily: "Inter_500Medium", color: c.coralText },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: c.pitchPanel },
    chipText: { fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: c.onPitchPanel },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
