import FontAwesome from "@expo/vector-icons/FontAwesome";
import { goToAdminMenu } from "@/lib/adminNavigation";
import { SEASON_PRIZE_ENABLED } from "@/lib/seasonPrize";
import { useRouter, type Href } from "expo-router";
import type { ComponentProps } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { headline, themeColor, useThemedStyles } from "@/theme";
type ToolDef = {
  id: string;
  title: string;
  description: string;
  icon: ComponentProps<typeof FontAwesome>["name"];
  href: Href;
};

const TOOLS: ToolDef[] = [
  {
    id: "proximity",
    title: "Player Proximity Search",
    description: "Find all players within X minutes of any venue",
    icon: "map-marker",
    href: "/admin/proximity-search" as Href,
  },
  {
    id: "monthly-leaders",
    title: "Monthly Leaders",
    description: "View this month's top players by attendance and awards",
    icon: "trophy",
    href: "/admin/monthly-leaders" as Href,
  },
  {
    id: "database",
    title: "Database",
    description: "Browse all Supabase tables",
    icon: "database",
    href: "/admin/database",
  },
  {
    id: "analytics",
    title: "Analytics",
    description: "Pickup and tournament analytics",
    icon: "bar-chart",
    href: "/admin/analytics",
  },
  ...(SEASON_PRIZE_ENABLED
    ? [
        {
          id: "season-prize",
          title: "Season prize",
          description: "Current winner and the top 10 eligible entrants",
          icon: "trophy" as const,
          href: "/admin/season-prize" as Href,
        },
      ]
    : []),
  {
    id: "photo-reports",
    title: "Photo reports",
    description: "Review reported profile photos: remove or dismiss",
    icon: "flag",
    href: "/admin/photo-reports" as Href,
  },
  {
    id: "tier-suggestions",
    title: "Tier Suggestions",
    description: "Players suggested for tier upgrades",
    icon: "star",
    href: "/admin/tier-suggestions",
  },
];

function ToolCard({ tool, onPress }: { tool: ToolDef; onPress: () => void }) {
  useThemedStyles(publish_styles);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.88, transform: [{ scale: 0.99 }] }]}
    >
      <View style={styles.cardIconWrap}>
        <FontAwesome name={tool.icon} size={20} color={themeColor().pitchText} />
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle}>{tool.title}</Text>
        <Text style={styles.cardDesc}>{tool.description}</Text>
      </View>
      <FontAwesome name="chevron-right" size={14} color={themeColor().muted} />
    </Pressable>
  );
}

export default function AdminToolsScreen() {
  useThemedStyles(publish_styles);

  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => goToAdminMenu(router)} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.85 }]}>
          <FontAwesome name="chevron-left" size={18} color={themeColor().text} />
          <Text style={styles.backBtnText}>Back</Text>
        </Pressable>
        <Text style={styles.topTitle}>Admin Tools</Text>
        <View style={styles.topBarSpacer} />
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.h1}>Admin Tools</Text>
        <Text style={styles.sub}>Utilities for outreach, data, and player management.</Text>
        <View style={styles.list}>
          {TOOLS.map((tool) => (
            <ToolCard key={tool.id} tool={tool} onPress={() => router.push(tool.href)} />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function make_styles() {
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: themeColor().bg },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 8 },
  backBtnText: { color: themeColor().text, fontSize: 16, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  topTitle: { flex: 1, fontSize: 20, ...headline, color: themeColor().text, textAlign: "center" },
  topBarSpacer: { width: 72 },
  scroll: { flex: 1, backgroundColor: themeColor().bg },
  content: { padding: 20, paddingBottom: 40 },
  h1: { fontSize: 32, ...headline, color: themeColor().text,},
  sub: { marginTop: 8, fontSize: 14, fontFamily: "Inter_400Regular", color: themeColor().muted, lineHeight: 20 },
  list: { marginTop: 20, gap: 12 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().card,
  },
  cardIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: themeColor().pitchPanel,
    borderWidth: 1,
    borderColor: themeColor().pitchText,
  },
  cardBody: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "800", color: themeColor().text },
  cardDesc: { marginTop: 4, fontSize: 13, fontFamily: "Inter_400Regular", color: themeColor().muted, lineHeight: 18 },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}

