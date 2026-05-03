import { Redirect, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useAdminMode } from "@/context/AdminModeContext";
import { useAuth } from "@/context/AuthContext";

export default function AdminScreen() {
  const { session, isReady } = useAuth();
  const { enabled: adminModeEnabled, isReady: adminModeReady } = useAdminMode();
  const router = useRouter();

  const signedEmail = session?.user?.email?.toLowerCase();
  const isOmeed = signedEmail === "omeedpooya@gmail.com";

  if (!isReady || !adminModeReady) return null;

  if (!signedEmail) return <Redirect href="/login" />;
  if (!isOmeed || !adminModeEnabled) return <Redirect href="/account" />;

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Admin</Text>
        <Text style={styles.sub}>Admin Mode is enabled on this device.</Text>

        <Pressable style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]} onPress={() => router.push("/admin/pickup")}>
          <Text style={styles.cardTitle}>Pickup ops</Text>
          <Text style={styles.cardBody}>Create runs, view roster, promote standby, mark attendance, record late cancels.</Text>
        </Pressable>

        <Pressable style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]} onPress={() => router.push("/admin/standing")}>
          <Text style={styles.cardTitle}>Standing</Text>
          <Text style={styles.cardBody}>Search players, set manual standing overrides, reliability score overrides, staff notes.</Text>
        </Pressable>

        <Pressable style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]} onPress={() => router.push("/admin/chat")}>
          <Text style={styles.cardTitle}>Chat moderation</Text>
          <Text style={styles.cardBody}>Create/edit rooms, toggle announcements-only, manage room mutes.</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0a0a0a" },
  scroll: { flex: 1, backgroundColor: "#0a0a0a" },
  content: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 36, fontWeight: "800", color: "#fff", letterSpacing: 0.2 },
  sub: { marginTop: 10, color: "rgba(255,255,255,0.6)", fontSize: 14, lineHeight: 20 },
  card: {
    marginTop: 14,
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  cardTitle: { fontSize: 16, fontWeight: "800", color: "#fff" },
  cardBody: { marginTop: 10, fontSize: 14, color: "rgba(255,255,255,0.65)", lineHeight: 20 },
});

