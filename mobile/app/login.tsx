import { SignInPanel } from "@/components/SignInPanel";
import { useAuth } from "@/context/AuthContext";
import { Redirect } from "expo-router";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const LIME = "#a3e635";

export default function LoginScreen() {
  const { session, isReady } = useAuth();
  const insets = useSafeAreaInsets();

  if (!isReady) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  if (session?.user?.email) {
    return <Redirect href="/(tabs)" />;
  }

  return (
    <View style={styles.screen}>
      <View pointerEvents="none" style={styles.bgGlowA} />
      <View pointerEvents="none" style={styles.bgGlowB} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top, 16) + 10 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brandRow}>
          <Image
            source={require("../assets/images/ct-pickup-wordmark.png")}
            style={styles.wordmark}
            resizeMode="contain"
            accessibilityLabel="CT Pickup"
          />
        </View>

        <Text style={styles.hero}>Welcome back</Text>
        <Text style={styles.lead}>
          Sign in to join your next run.{"\n"}
          Use your email to get an 8-digit login code.
        </Text>

        <SignInPanel hideHeading variant="premium" />

        <Pressable style={styles.aboutRow} accessibilityRole="button">
          <View style={styles.aboutLeft}>
            <FontAwesome name="info-circle" size={16} color="rgba(255,255,255,0.4)" />
            <Text style={styles.aboutText}>About this app</Text>
          </View>
          <FontAwesome name="chevron-right" size={14} color="rgba(255,255,255,0.25)" />
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0a0a0a" },
  center: { flex: 1, backgroundColor: "#0a0a0a", justifyContent: "center", alignItems: "center" },
  bgGlowA: {
    position: "absolute",
    top: -220,
    left: -160,
    width: 420,
    height: 420,
    borderRadius: 420,
    backgroundColor: "rgba(163,230,53,0.10)",
  },
  bgGlowB: {
    position: "absolute",
    bottom: -260,
    right: -220,
    width: 520,
    height: 520,
    borderRadius: 520,
    backgroundColor: "rgba(163,230,53,0.06)",
  },
  content: { paddingHorizontal: 20, paddingBottom: 54 },
  brandRow: { alignItems: "center", marginBottom: 26, marginTop: 8 },
  wordmark: { height: 22, width: 170, opacity: 0.95 },
  hero: { fontSize: 34, fontWeight: "900", color: "#fff", letterSpacing: -0.6, lineHeight: 38 },
  lead: { marginTop: 10, color: "rgba(255,255,255,0.62)", fontSize: 15.5, lineHeight: 22 },
  aboutRow: {
    marginTop: 18,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.03)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  aboutLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  aboutText: { color: "rgba(255,255,255,0.55)", fontSize: 14.5, fontWeight: "700" },
});
