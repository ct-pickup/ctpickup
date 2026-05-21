import { useAuth } from "@/context/AuthContext";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const PASSWORD_MIN_LEN = 8;

export default function ResetPasswordScreen() {
  const { supabase } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setHasSession(false);
      setSessionChecked(true);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!cancelled) setHasSession(!!data.session);
      } catch (e) {
        console.warn("[reset-password] getSession failed", e);
        if (!cancelled) setHasSession(false);
      } finally {
        if (!cancelled) setSessionChecked(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase]);

  async function submitNewPassword() {
    if (!supabase || busy) return;

    if (newPassword.length < PASSWORD_MIN_LEN) {
      Alert.alert("Password", `Password must be at least ${PASSWORD_MIN_LEN} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert("Password", "Passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        Alert.alert("Password update failed", error.message);
        console.warn("[reset-password] updateUser password failed", error.message ?? error);
        return;
      }
      Alert.alert("Password updated!", "Your password has been saved.", [
        { text: "OK", onPress: () => router.replace("/(tabs)") },
      ]);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Something went wrong. Please try again.";
      Alert.alert("Password update failed", message);
      console.warn("[reset-password] updateUser threw", e);
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    newPassword.length >= PASSWORD_MIN_LEN &&
    confirmPassword.length >= PASSWORD_MIN_LEN &&
    !busy &&
    !!supabase;

  if (!sessionChecked) {
    return (
      <View style={[styles.screen, styles.centered]}>
        <ActivityIndicator color="#a3e635" size="large" />
      </View>
    );
  }

  if (!hasSession) {
    return (
      <View
        style={[
          styles.screen,
          styles.centered,
          { paddingTop: Math.max(insets.top, 16) + 10, paddingHorizontal: 20 },
        ]}
      >
        <Text style={styles.title}>Reset password</Text>
        <Text style={styles.errorText}>
          Invalid or expired reset link. Please request a new one.
        </Text>
        <Pressable style={styles.primaryBtn} onPress={() => router.replace("/login")}>
          <Text style={styles.primaryBtnText}>Back to sign in</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : "height"}>
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
        <Text style={styles.title}>Set new password</Text>
        <Text style={styles.lead}>Choose a new password for your account.</Text>

        <View style={styles.card}>
          <Text style={styles.fieldLabel}>New password</Text>
          <TextInput
            style={styles.input}
            placeholder={`At least ${PASSWORD_MIN_LEN} characters`}
            placeholderTextColor="rgba(255,255,255,0.35)"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            value={newPassword}
            onChangeText={setNewPassword}
          />

          <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Confirm password</Text>
          <TextInput
            style={styles.input}
            placeholder="Re-enter password"
            placeholderTextColor="rgba(255,255,255,0.35)"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            onSubmitEditing={() => void submitNewPassword()}
          />

          <Pressable
            style={[styles.primaryBtn, !canSubmit && styles.disabled]}
            disabled={!canSubmit}
            onPress={() => void submitNewPassword()}
          >
            {busy ? <ActivityIndicator color="#0a0a0a" /> : <Text style={styles.primaryBtnText}>Save password</Text>}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0a0a0a" },
  centered: { justifyContent: "center", alignItems: "stretch" },
  content: { paddingHorizontal: 20 },
  title: { fontSize: 32, fontWeight: "900", color: "#fff", letterSpacing: -0.6, lineHeight: 36 },
  lead: { marginTop: 10, color: "rgba(255,255,255,0.62)", fontSize: 15.5, lineHeight: 22 },
  errorText: {
    marginTop: 14,
    color: "rgba(255,255,255,0.72)",
    fontSize: 15.5,
    lineHeight: 22,
  },
  card: {
    marginTop: 18,
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: "rgba(255,255,255,0.55)" },
  fieldLabelSpaced: { marginTop: 14 },
  input: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 16,
    color: "#fff",
    backgroundColor: "rgba(0,0,0,0.28)",
  },
  primaryBtn: {
    marginTop: 24,
    backgroundColor: "#a3e635",
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: "center",
  },
  primaryBtnText: { color: "#0a0a0a", fontWeight: "900", fontSize: 16 },
  disabled: { opacity: 0.5 },
});
