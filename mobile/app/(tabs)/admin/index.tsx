import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useRouter, type Href } from "expo-router";
import type { ComponentProps } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAdminAttention } from "@/lib/adminAttention";
import { tabBarContentPadding } from "@/lib/tabBar";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";

type IconName = ComponentProps<typeof FontAwesome>["name"];

const TILES: Array<{ label: string; icon: IconName; href: Href }> = [
  { label: "Players", icon: "users", href: "/admin/members" as Href },
  { label: "Games", icon: "calendar", href: "/admin/pickup" as Href },
  { label: "Broadcast", icon: "bullhorn", href: "/admin/bulk-message" as Href },
  { label: "Analytics", icon: "bar-chart", href: "/admin/analytics" as Href },
  { label: "Payouts", icon: "credit-card", href: "/admin/session-economics" as Href },
];

/** Less-used screens, kept reachable as plain links under the tiles. */
const MORE: Array<{ label: string; href: Href }> = [
  { label: "Player levels", href: "/admin/tier-management" as Href },
  { label: "Standing", href: "/admin/standing" as Href },
  { label: "Chat moderation", href: "/admin/chat" as Href },
  { label: "Tournaments", href: "/admin/tournament" as Href },
  { label: "Tools", href: "/admin/tools" as Href },
];

export default function AdminMenuScreen() {
  useThemedStyles(publish_styles);

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { counts } = useAdminAttention();

  // No Payouts row here: it needs a "paid out" marker (migration) before it can be a real queue.
  // Payouts stays reachable from the tile grid.
  const rows = counts
    ? [
        { key: "verify", label: "Verification requests", count: counts.verifications, href: "/admin/verification" as Href },
        { key: "signups", label: "New signups to approve", count: counts.signups, href: "/admin/members" as Href },
        { key: "settle", label: "Sessions to settle", count: counts.settlements, href: "/admin/pickup" as Href },
      ].filter((r) => r.count > 0)
    : [];

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingBottom: tabBarContentPadding(insets.bottom) }]}>
        <Text style={styles.title}>Admin</Text>

        <Text style={styles.sectionLabel}>Needs attention</Text>
        {counts == null ? (
          <View style={styles.card}>
            <ActivityIndicator color={themeColor().pitchText} />
          </View>
        ) : rows.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.caughtUp}>All caught up</Text>
          </View>
        ) : (
          <View style={styles.card}>
            {rows.map((r, i) => (
              <Pressable
                key={r.key}
                onPress={() => router.push(r.href)}
                style={({ pressed }) => [styles.attentionRow, i > 0 && styles.attentionRowDivider, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`${r.label}, ${r.count}`}
              >
                <Text style={styles.attentionLabel}>{r.label}</Text>
                <View style={styles.countPill}>
                  <Text style={styles.countText}>{r.count}</Text>
                </View>
                <FontAwesome name="chevron-right" size={12} color={themeColor().muted} />
              </Pressable>
            ))}
          </View>
        )}

        <View style={styles.grid}>
          {TILES.map((t) => (
            <Pressable
              key={t.label}
              onPress={() => router.push(t.href)}
              style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={t.label}
            >
              <FontAwesome name={t.icon} size={20} color={themeColor().pitchText} />
              <Text style={styles.tileLabel}>{t.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionLabel}>More</Text>
        <View style={styles.card}>
          {MORE.map((m, i) => (
            <Pressable
              key={m.label}
              onPress={() => router.push(m.href)}
              style={({ pressed }) => [styles.attentionRow, i > 0 && styles.attentionRowDivider, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.attentionLabel}>{m.label}</Text>
              <FontAwesome name="chevron-right" size={12} color={themeColor().muted} />
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    scroll: { flex: 1, backgroundColor: c.bg },
    content: { padding: 20 },
    pressed: { opacity: 0.85 },
    title: { fontSize: 40, ...headline, color: c.text },
    sectionLabel: { marginTop: 24, marginBottom: 8, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700", color: c.muted },
    card: { borderRadius: radius.card, borderWidth: 1, borderColor: c.line, backgroundColor: c.card, overflow: "hidden" },
    caughtUp: { padding: 16, fontSize: 15, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: c.muted },
    attentionRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 14 },
    attentionRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
    attentionLabel: { flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: c.text },
    countPill: { minWidth: 28, paddingHorizontal: 8, height: 24, borderRadius: radius.pill, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" },
    countText: { fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700", color: c.onAccent },
    grid: { marginTop: 24, flexDirection: "row", flexWrap: "wrap", gap: 12 },
    tile: {
      width: "48%",
      height: 84,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: c.line,
      backgroundColor: c.card,
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    tileLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: c.text },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
