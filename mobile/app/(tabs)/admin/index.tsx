import { useRouter, type Href } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { themeColor, useThemedStyles } from "@/theme";
export default function AdminMenuScreen() {
  useThemedStyles(publish_styles);

  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Admin</Text>
        <Text style={styles.sub}>Admin Mode is enabled on this device.</Text>

        <Pressable
          style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
          onPress={() => router.push("/admin/tools" as Href)}
        >
          <Text style={styles.cardTitle}>Tools</Text>
          <Text style={styles.cardBody}>
            Proximity search, monthly leaders, database browser, analytics, and tier suggestions.
          </Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
          onPress={() => router.push("/admin/pickup")}
        >
          <Text style={styles.cardTitle}>Pickup ops</Text>
          <Text style={styles.cardBody}>
            Create runs, view roster, promote waitlist, mark attendance, record late cancels.
          </Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
          onPress={() => router.push("/admin/analytics")}
        >
          <Text style={styles.cardTitle}>Analytics 📊</Text>
          <Text style={styles.cardBody}>
            Revenue, runs by region, attendance, top players, and churn signals by month.
          </Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
          onPress={() => router.push("/admin/bulk-message" as Href)}
        >
          <Text style={styles.cardTitle}>Broadcast 📣</Text>
          <Text style={styles.cardBody}>
            Send a push and announcements-room message to a filtered group of players.
          </Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
          onPress={() => router.push("/admin/members")}
        >
          <Text style={styles.cardTitle}>Members</Text>
          <Text style={styles.cardBody}>View new signups, approve accounts, and set player tiers.</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
          onPress={() => router.push("/admin/verification")}
        >
          <Text style={styles.cardTitle}>Verification Requests</Text>
          <Text style={styles.cardBody}>Review and approve player verification requests. Grant Document Verified status.</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
          onPress={() => router.push("/admin/tier-management")}
        >
          <Text style={styles.cardTitle}>Tier Management</Text>
          <Text style={styles.cardBody}>Search players and manually set their tier and verification level.</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
          onPress={() => router.push("/admin/session-economics")}
        >
          <Text style={styles.cardTitle}>Session Economics</Text>
          <Text style={styles.cardBody}>See who to pay after each session — host payout, your rake, Diamond player compensation.</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
          onPress={() => router.push("/admin/standing")}
        >
          <Text style={styles.cardTitle}>Standing</Text>
          <Text style={styles.cardBody}>
            Search players, set manual standing overrides, reliability score overrides, staff notes.
          </Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
          onPress={() => router.push("/admin/chat")}
        >
          <Text style={styles.cardTitle}>Chat moderation</Text>
          <Text style={styles.cardBody}>Create/edit rooms, toggle announcements-only, manage room mutes.</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
          onPress={() => router.push("/admin/tournament")}
        >
          <Text style={styles.cardTitle}>Tournament hub</Text>
          <Text style={styles.cardBody}>
            Make an outdoor / captain tournament live on the public tournament pages, or take the hub offline.
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function make_styles() {
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: themeColor().bg },
  scroll: { flex: 1, backgroundColor: themeColor().bg },
  content: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 40, fontFamily: "InstrumentSerif_400Regular", fontWeight: "800", color: themeColor().text,},
  sub: { marginTop: 10, color: themeColor().muted, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  card: {
    marginTop: 14,
    padding: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().overlaySubtle,
  },
  cardTitle: { fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "800", color: themeColor().text },
  cardBody: { marginTop: 10, fontSize: 14, fontFamily: "Inter_400Regular", color: themeColor().muted, lineHeight: 20 },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}

