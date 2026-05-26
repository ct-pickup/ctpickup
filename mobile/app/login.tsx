import { SignInPanel } from "@/components/SignInPanel";
import { useAuth } from "@/context/AuthContext";
import { Redirect } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function LoginScreen() {
  const { session, isReady, sessionExpiredNotice, clearSessionExpiredNotice } = useAuth();
  const insets = useSafeAreaInsets();
  const isIPad = Platform.OS === "ios" && Platform.isPad;

  useEffect(() => {
    return () => clearSessionExpiredNotice();
  }, [clearSessionExpiredNotice]);

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
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? (isIPad ? "height" : "padding") : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? (isIPad ? 0 : 8) : 0}
        style={styles.screen}
      >
        <ScrollView
          contentContainerStyle={[
            styles.content,
            {
              paddingTop: Math.max(insets.top, 16) + 10,
              paddingBottom: 200,
            },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.formWrap}>
            {sessionExpiredNotice ? (
              <Text style={styles.sessionExpiredNotice}>{sessionExpiredNotice}</Text>
            ) : null}
            <SignInPanel hideHeading variant="premium" />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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
  sessionExpiredNotice: {
    marginBottom: 16,
    color: "rgba(252,211,212,0.92)",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
});
