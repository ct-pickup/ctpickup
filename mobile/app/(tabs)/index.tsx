import { FieldTournamentCard } from "@/components/FieldTournamentCard";
import { useAuth } from "@/context/AuthContext";
import { useFieldTournament } from "@/hooks/useFieldTournament";
import { useNextTournament } from "@/hooks/useNextTournament";
import { formatTournamentStartEt } from "@/lib/formatTournament";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
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

function splitTournamentStartEt(iso: string): { dateLine: string; timeLine: string } {
  const s = formatTournamentStartEt(iso);
  // Example: "Apr 13, 2026, 12:00 AM EDT"
  const parts = s.split(",").map((p) => p.trim());
  if (parts.length >= 3) {
    return { dateLine: `${parts[0]}, ${parts[1]}`, timeLine: parts.slice(2).join(", ") };
  }
  return { dateLine: s, timeLine: "" };
}

function statusTitleCase(s: string): string {
  const v = (s ?? "").trim();
  if (!v) return "";
  return v.charAt(0).toUpperCase() + v.slice(1);
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session } = useAuth();
  const email = session?.user?.email ?? undefined;
  const { loading: nextTournamentLoading, error: nextTournamentError, next: nextTournament } = useNextTournament();
  const {
    loading: fieldTournamentLoading,
    error: fieldTournamentError,
    payload: fieldTournamentPayload,
  } = useFieldTournament();

  const welcome = welcomeFromEmail(email);

  const startDisplay = nextTournament?.start_date ? splitTournamentStartEt(nextTournament.start_date) : null;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top, 12) + 8 }]}
    >
      <View style={styles.topRow}>
        <Image
          source={require("../../assets/images/ct-pickup-wordmark.png")}
          style={styles.wordmark}
          resizeMode="contain"
          accessibilityLabel="CT Pickup"
        />
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
      <Text style={styles.tagline}>Tonight / this week — stay locked in.</Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Pickup by state, choose NY CT NJ or MD"
        onPress={() => router.navigate("/(tabs)/runs")}
        style={({ pressed }) => [styles.regionHub, pressed && { opacity: 0.92 }]}
      >
        <View style={styles.cardGlow} pointerEvents="none" />
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
        onPress={() => router.push("/(tabs)/tournaments")}
      />

      <Text style={[styles.sectionLabel, styles.sectionLabelEsports]}>ESPORTS (ONLINE)</Text>

      {nextTournamentLoading ? (
        <View style={styles.esportsCard}>
          <View style={styles.cardGlow} pointerEvents="none" />
          <View style={styles.esportsTopRow}>
            <View style={styles.esportsIconWrap}>
              <MaterialCommunityIcons name="controller-classic" size={24} color="#0a0a0a" />
            </View>
            <View style={{ flex: 1 }} />
            <ActivityIndicator size="small" color={LIME} style={{ marginTop: 8 }} />
          </View>
        </View>
      ) : nextTournamentError ? (
        <View style={styles.esportsCard}>
          <View style={styles.cardGlow} pointerEvents="none" />
          <View style={styles.esportsTopRow}>
            <View style={styles.esportsIconWrap}>
              <MaterialCommunityIcons name="controller-classic" size={24} color="#0a0a0a" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.tournamentErr}>{nextTournamentError}</Text>
            </View>
          </View>
        </View>
      ) : !nextTournament ? (
        <View style={styles.esportsCardNeutral}>
          <View style={styles.esportsTopRow}>
            <View style={styles.esportsIconWrapNeutral}>
              <MaterialCommunityIcons name="controller-classic" size={24} color="rgba(255,255,255,0.55)" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.tournamentEmptyTitle}>No esports event scheduled</Text>
              <Text style={styles.tournamentEmptySub}>When an EA FC tournament is upcoming or active, it shows here.</Text>
            </View>
          </View>
        </View>
      ) : (
        <Pressable
          onPress={() => router.push("/(tabs)/tournaments")}
          style={({ pressed }) => [styles.esportsCard, pressed && { opacity: 0.92 }]}
          accessibilityRole="button"
          accessibilityLabel={`Next esports tournament: ${nextTournament.title}. Open tournaments tab.`}
        >
          <View style={styles.cardGlow} pointerEvents="none" />
          <View style={styles.esportsTopRow}>
            <View style={styles.esportsIconWrap}>
              <MaterialCommunityIcons name="controller-classic" size={24} color="#0a0a0a" />
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.esportsPill}>
                <Text style={styles.esportsPillText}>ESPORTS · NEXT UP</Text>
              </View>
              <Text style={styles.esportsTitle}>{nextTournament.title}</Text>
            </View>
            <FontAwesome name="chevron-right" size={14} color="rgba(255,255,255,0.35)" />
          </View>
          <Text style={styles.esportsGame}>{nextTournament.game}</Text>
          <View style={styles.esportsMetaRow}>
            <View style={styles.esportsMetaCol}>
              <FontAwesome name="calendar" size={14} color="rgba(255,255,255,0.55)" />
              <View style={{ flex: 1 }}>
                <Text style={styles.esportsMetaLabel}>Starts</Text>
                <Text style={styles.esportsMetaValue}>
                  {startDisplay?.dateLine ?? formatTournamentStartEt(nextTournament.start_date)}
                  {startDisplay?.timeLine ? `\n${startDisplay.timeLine}` : ""}
                </Text>
              </View>
            </View>
            <View style={styles.esportsMetaDivider} />
            <View style={styles.esportsMetaCol}>
              <FontAwesome name="trophy" size={14} color="rgba(255,255,255,0.55)" />
              <View style={{ flex: 1 }}>
                <Text style={styles.esportsMetaLabel}>Prize</Text>
                <Text style={styles.esportsMetaValue}>{nextTournament.prize}</Text>
              </View>
            </View>
          </View>
          <View style={styles.esportsStatusPill}>
            <FontAwesome name="clock-o" size={14} color={LIME} />
            <Text style={styles.esportsStatusPillText}>{statusTitleCase(nextTournament.status)}</Text>
          </View>
        </Pressable>
      )}
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
  wordmark: { width: 86, height: 28, flexShrink: 0 },
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
  cardGlow: {
    position: "absolute",
    left: -40,
    right: -40,
    bottom: -60,
    height: 160,
    backgroundColor: "rgba(163,230,53,0.08)",
    transform: [{ rotate: "-8deg" }],
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
  sectionLabelEsports: { marginTop: 28 },
  esportsCard: {
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.22)",
    backgroundColor: "rgba(163,230,53,0.06)",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  esportsCardNeutral: {
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  esportsTopRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  esportsIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: LIME,
    alignItems: "center",
    justifyContent: "center",
  },
  esportsIconWrapNeutral: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  esportsPill: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.22)",
    backgroundColor: "rgba(163,230,53,0.12)",
  },
  esportsPillText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.9,
    color: "rgba(163,230,53,0.85)",
  },
  esportsTitle: { marginTop: 8, fontSize: 20, fontWeight: "800", color: "#fff", lineHeight: 26, letterSpacing: -0.2 },
  esportsGame: { marginTop: 10, fontSize: 14, color: "rgba(255,255,255,0.6)" },
  esportsMetaRow: { marginTop: 14, flexDirection: "row", alignItems: "stretch", gap: 12 },
  esportsMetaCol: { flex: 1, flexDirection: "row", alignItems: "flex-start", gap: 10 },
  esportsMetaDivider: { width: 1, backgroundColor: "rgba(255,255,255,0.1)" },
  esportsMetaLabel: { fontSize: 12, fontWeight: "700", color: "rgba(255,255,255,0.5)" },
  esportsMetaValue: { marginTop: 4, fontSize: 13, lineHeight: 18, color: "rgba(255,255,255,0.78)" },
  esportsStatusPill: {
    alignSelf: "flex-start",
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.24)",
    backgroundColor: "rgba(0,0,0,0.18)",
  },
  esportsStatusPillText: { color: "rgba(163,230,53,0.9)", fontSize: 12, fontWeight: "800" },
  tournamentEmptyTitle: { fontSize: 17, fontWeight: "700", color: "#fff" },
  tournamentEmptySub: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 21,
    color: "rgba(255,255,255,0.5)",
  },
  tournamentErr: { fontSize: 14, lineHeight: 20, color: "#fca5a5" },
});
