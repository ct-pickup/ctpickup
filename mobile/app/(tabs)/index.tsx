import { FieldTournamentCard } from "@/components/FieldTournamentCard";
import { useAuth } from "@/context/AuthContext";
import { useFieldTournament } from "@/hooks/useFieldTournament";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const LIME = "#a3e635";

function welcomeFromEmail(email: string | undefined): string {
  if (!email) return "there";
  const local = email.split("@")[0]?.trim() ?? "";
  if (!local) return "there";
  const word = local.replace(/[._-]+/g, " ").trim();
  if (!word) return "there";
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session } = useAuth();
  const email = session?.user?.email ?? undefined;
  const {
    loading: fieldTournamentLoading,
    error: fieldTournamentError,
    payload: fieldTournamentPayload,
  } = useFieldTournament();

  const welcome = welcomeFromEmail(email);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top, 12) + 8 }]}
    >
      <View style={styles.topRow}>
        <View style={styles.topLeft}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Help"
            onPress={() => (router.push as (href: string) => void)("/help")}
            style={({ pressed }) => [styles.profileBtn, pressed && { opacity: 0.92 }]}
          >
            <FontAwesome name="question" size={16} color={LIME} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Search players"
            onPress={() => (router.push as (href: string) => void)("/players")}
            style={({ pressed }) => [styles.profileBtn, pressed && { opacity: 0.92 }]}
          >
            <FontAwesome name="search" size={16} color={LIME} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Leaderboards"
            onPress={() => (router.push as (href: string) => void)("/leaderboards")}
            style={({ pressed }) => [styles.profileBtn, pressed && { opacity: 0.92 }]}
          >
            <FontAwesome name="trophy" size={16} color={LIME} />
          </Pressable>
        </View>
        <View style={styles.topMiddle}>
          <Text style={styles.welcomeLine} numberOfLines={1}>
            Welcome back, <Text style={styles.welcomeName}>{welcome}</Text>
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open profile"
          onPress={() => router.push("/(tabs)/account")}
          style={({ pressed }) => [styles.profileBtn, pressed && { opacity: 0.92 }]}
        >
          <FontAwesome name="user" size={16} color={LIME} />
        </Pressable>
      </View>

      <Text style={styles.headline}>
        Find Your{"\n"}Next <Text style={styles.headlineAccent}>Run</Text>.
      </Text>
      <Text style={styles.tagline}>Tonight / this week stay locked in.</Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Pickup by state, choose NY CT NJ or MD"
        onPress={() => router.navigate("/(tabs)/runs")}
        style={({ pressed }) => [styles.regionHub, pressed && { opacity: 0.92 }]}
      >
        <View style={styles.regionHubIconWrap}>
          <FontAwesome name="map-marker" size={22} color="#0a0a0a" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.regionHubTitle}>Pickup by state</Text>
          <Text style={styles.regionHubSub}>NY · CT · NJ · MD</Text>
        </View>
        <FontAwesome name="chevron-right" size={16} color="rgba(255,255,255,0.5)" />
      </Pressable>

      <Text style={[styles.sectionLabel, styles.sectionLabelTournament]}>IN-PERSON TOURNAMENT</Text>
      <FieldTournamentCard
        loading={fieldTournamentLoading}
        error={fieldTournamentError}
        payload={fieldTournamentPayload}
        onPress={() => router.push("/field-tournament")}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: "#0a0a0a" },
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 24,
  },
  topLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  topMiddle: { flex: 1, minWidth: 0, alignItems: "center" },
  welcomeLine: {
    flexShrink: 1,
    color: "rgba(255,255,255,0.55)",
    fontSize: 13,
    textAlign: "center",
  },
  welcomeName: { color: "#fff", fontWeight: "600" },
  profileBtn: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.65)",
    backgroundColor: "rgba(163,230,53,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  headline: {
    fontSize: 32,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: -0.5,
    lineHeight: 38,
  },
  headlineAccent: { color: LIME },
  tagline: { marginTop: 8, fontSize: 15, color: "rgba(255,255,255,0.5)" },
  regionHub: {
    marginTop: 18,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.22)",
    backgroundColor: "rgba(163,230,53,0.06)",
    gap: 14,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  regionHubIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: LIME,
    alignItems: "center",
    justifyContent: "center",
  },
  regionHubTitle: { fontSize: 17, fontWeight: "800", color: "#fff", letterSpacing: -0.2 },
  regionHubSub: { marginTop: 4, fontSize: 13, color: "rgba(255,255,255,0.48)" },
  sectionLabel: {
    marginTop: 28,
    marginBottom: 12,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: "rgba(255,255,255,0.4)",
  },
  sectionLabelTournament: { marginTop: 32 },
});
