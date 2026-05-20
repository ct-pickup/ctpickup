import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useRouter, type Href } from "expo-router";
import type { ComponentProps } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const LIME = "#a3e635";
const BG = "#0a0a0a";

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
    href: "/admin/pickup",
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
  {
    id: "tier-suggestions",
    title: "Tier Suggestions",
    description: "Players suggested for tier upgrades",
    icon: "star",
    href: "/admin/tier-suggestions",
  },
];

function ToolCard({ tool, onPress }: { tool: ToolDef; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.88, transform: [{ scale: 0.99 }] }]}
    >
      <View style={styles.cardIconWrap}>
        <FontAwesome name={tool.icon} size={20} color={LIME} />
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle}>{tool.title}</Text>
        <Text style={styles.cardDesc}>{tool.description}</Text>
      </View>
      <FontAwesome name="chevron-right" size={14} color="rgba(255,255,255,0.35)" />
    </Pressable>
  );
}

export default function AdminToolsScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  scroll: { flex: 1, backgroundColor: BG },
  content: { padding: 20, paddingBottom: 40 },
  h1: { fontSize: 32, fontWeight: "800", color: "#fff", letterSpacing: 0.2 },
  sub: { marginTop: 8, fontSize: 14, color: "rgba(255,255,255,0.55)", lineHeight: 20 },
  list: { marginTop: 20, gap: 12 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  cardIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(163,230,53,0.12)",
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.25)",
  },
  cardBody: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: 16, fontWeight: "800", color: "#fff" },
  cardDesc: { marginTop: 4, fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 18 },
});
