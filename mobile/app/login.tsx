import { SignInPanel } from "@/components/SignInPanel";
import { useAuth } from "@/context/AuthContext";
import { Redirect } from "expo-router";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
        contentContainerStyle={[
          styles.content,
          { paddingTop: Math.max(insets.top, 16) + 10, paddingBottom: Math.max(insets.bottom, 24) + 30 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.formWrap}>
          <Text style={styles.lead}>Enter your email to get a sign-in code</Text>
          <SignInPanel hideHeading variant="premium" />
        </View>
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
  content: {
    flexGrow: 1,
    paddingHorizontal: 20,
    justifyContent: "center",
  },
  formWrap: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    alignItems: "stretch",
  },
  lead: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 15.5,
    lineHeight: 22,
    textAlign: "center",
  },
});
