import { useAppLock } from "@/context/AppLockContext";
import { useAuth } from "@/context/AuthContext";
import * as LocalAuthentication from "expo-local-authentication";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  isValidPinFormat,
  normalizePasscode,
  PASSCODE_MAX_LEN,
  PASSCODE_REQUIREMENTS,
} from "@/lib/appLock";

async function biometricLabel(): Promise<string> {
  const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return "Face ID";
  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return "Touch ID";
  return "Biometrics";
}

export function AppLockOverlay() {
  const { session, signOut } = useAuth();
  const { hasPin, isLocked, biometricsEnabled, biometricsAvailable, unlockWithPin, tryBiometricUnlock, savePin } =
    useAppLock();

  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bioLabel, setBioLabel] = useState("Face ID");
  const promptedRef = useRef(false);

  const [enrollA, setEnrollA] = useState("");
  const [enrollB, setEnrollB] = useState("");
  const [enrollErr, setEnrollErr] = useState<string | null>(null);
  const [enrollBusy, setEnrollBusy] = useState(false);

  const needsEnrollment = Boolean(session?.user) && !hasPin;
  const visible = hasPin && isLocked;

  useEffect(() => {
    if (!visible) {
      setPin("");
      setError(null);
      promptedRef.current = false;
      return;
    }
    void (async () => {
      setBioLabel(await biometricLabel());
    })();
  }, [visible]);

  useEffect(() => {
    if (!needsEnrollment) {
      setEnrollA("");
      setEnrollB("");
      setEnrollErr(null);
    }
  }, [needsEnrollment]);

  useEffect(() => {
    if (!visible || !biometricsEnabled || !biometricsAvailable || promptedRef.current) return;
    promptedRef.current = true;
    const t = setTimeout(() => {
      void (async () => {
        setBusy(true);
        await tryBiometricUnlock();
        setBusy(false);
      })();
    }, 400);
    return () => clearTimeout(t);
  }, [visible, biometricsEnabled, biometricsAvailable, tryBiometricUnlock]);

  async function onUnlock() {
    setError(null);
    setBusy(true);
    const ok = await unlockWithPin(pin);
    setBusy(false);
    if (!ok) {
      setError("Incorrect passcode.");
      setPin("");
    }
  }

  async function onBio() {
    setError(null);
    setBusy(true);
    const r = await tryBiometricUnlock();
    setBusy(false);
    if (!r.ok) {
      // Don't show scary errors for normal cancels.
      if (r.error === "user_cancel" || r.error === "system_cancel") return;
      setError(bioLabel === "Face ID" ? "Face ID didn’t unlock. Try again." : "Biometric unlock failed. Try again.");
    }
  }

  async function onEnrollSave() {
    setEnrollErr(null);
    const a = normalizePasscode(enrollA);
    const b = normalizePasscode(enrollB);
    if (!isValidPinFormat(a) || !isValidPinFormat(b)) {
      setEnrollErr(`${PASSCODE_REQUIREMENTS} Both entries must match these rules.`);
      return;
    }
    if (a !== b) {
      setEnrollErr("Passcodes don’t match.");
      return;
    }
    setEnrollBusy(true);
    try {
      await savePin(enrollA);
    } catch {
      setEnrollErr("Could not save passcode. Try again.");
    } finally {
      setEnrollBusy(false);
    }
  }

  if (needsEnrollment) {
    return (
      <Modal animationType="fade" visible transparent statusBarTranslucent>
        <KeyboardAvoidingView
          style={styles.backdrop}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <SafeAreaView style={styles.safe}>
            <View style={styles.card}>
              <Text style={styles.title}>Set your passcode</Text>
              <Text style={styles.sub}>
                {PASSCODE_REQUIREMENTS} You’ll use it when you return to the app; Face ID or Touch ID can be enabled under
                Account after setup.
              </Text>

              <Text style={styles.fieldLabel}>New passcode</Text>
              <TextInput
                style={styles.input}
                value={enrollA}
                onChangeText={(t) => setEnrollA(t.slice(0, PASSCODE_MAX_LEN))}
                maxLength={PASSCODE_MAX_LEN}
                secureTextEntry
                textContentType="newPassword"
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Anything you want"
                placeholderTextColor="rgba(255,255,255,0.35)"
                editable={!enrollBusy}
              />

              <Text style={styles.fieldLabel}>Confirm passcode</Text>
              <TextInput
                style={styles.input}
                value={enrollB}
                onChangeText={(t) => setEnrollB(t.slice(0, PASSCODE_MAX_LEN))}
                maxLength={PASSCODE_MAX_LEN}
                secureTextEntry
                textContentType="newPassword"
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Repeat it"
                placeholderTextColor="rgba(255,255,255,0.35)"
                editable={!enrollBusy}
                onSubmitEditing={() => void onEnrollSave()}
              />

              {enrollErr ? <Text style={styles.err}>{enrollErr}</Text> : null}

              <Pressable
                style={[styles.primary, enrollBusy && styles.disabled]}
                disabled={enrollBusy}
                onPress={() => void onEnrollSave()}
              >
                {enrollBusy ? (
                  <ActivityIndicator color="#111" />
                ) : (
                  <Text style={styles.primaryText}>Continue</Text>
                )}
              </Pressable>

              <Pressable style={styles.secondary} disabled={enrollBusy} onPress={() => void signOut()}>
                <Text style={styles.secondaryText}>Sign out instead</Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
    );
  }

  if (!visible) return null;

  const showBio = biometricsEnabled && biometricsAvailable;

  return (
    <Modal animationType="fade" visible transparent statusBarTranslucent>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <SafeAreaView style={styles.safe}>
          <View style={styles.card}>
            <View style={styles.iconWrap} accessibilityElementsHidden>
              <View style={styles.iconInner}>
                <FontAwesome name="lock" size={18} color="#0a0a0a" />
              </View>
            </View>
            <Text style={styles.title}>App locked</Text>
            <Text style={styles.sub}>Enter your passcode to continue.</Text>

            <TextInput
              style={styles.input}
              value={pin}
              onChangeText={(t) => setPin(t.slice(0, PASSCODE_MAX_LEN))}
              maxLength={PASSCODE_MAX_LEN}
              secureTextEntry
              textContentType="password"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              placeholder="Your passcode"
              placeholderTextColor="rgba(255,255,255,0.35)"
              editable={!busy}
              onSubmitEditing={() => void onUnlock()}
            />

            {error ? <Text style={styles.err}>{error}</Text> : null}

            <Pressable
              style={[styles.primary, busy && styles.disabled]}
              disabled={busy}
              onPress={() => void onUnlock()}
            >
              {busy ? <ActivityIndicator color="#111" /> : <Text style={styles.primaryText}>Unlock</Text>}
            </Pressable>

            {showBio ? (
              <>
                <Text style={styles.or}>OR</Text>
                <Pressable style={[styles.secondaryBtn, busy && styles.disabled]} disabled={busy} onPress={() => void onBio()}>
                  <View style={styles.secondaryBtnInner}>
                    <FontAwesome name="square-o" size={18} color="transparent" />
                    <View style={styles.faceIdIcon}>
                      {bioLabel === "Touch ID" ? (
                        <MaterialCommunityIcons name="fingerprint" size={18} color="#a3e635" />
                      ) : (
                        <MaterialCommunityIcons name="face-recognition" size={18} color="#a3e635" />
                      )}
                    </View>
                    <Text style={styles.secondaryBtnText}>{bioLabel}</Text>
                  </View>
                </Pressable>
              </>
            ) : null}
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.96)",
    justifyContent: "center",
  },
  safe: { flex: 1, justifyContent: "center", paddingHorizontal: 24 },
  card: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 360,
    padding: 22,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(18,18,18,0.92)",
    shadowColor: "#000",
    shadowOpacity: 0.55,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 18 },
    elevation: 18,
  },
  iconWrap: {
    alignSelf: "center",
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
    backgroundColor: "rgba(163,230,53,0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  iconInner: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#a3e635",
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 22, fontWeight: "700", color: "#fff", textAlign: "center" },
  sub: { marginTop: 10, fontSize: 15, color: "rgba(255,255,255,0.65)", textAlign: "center", lineHeight: 21 },
  fieldLabel: {
    alignSelf: "flex-start",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
    color: "rgba(255,255,255,0.45)",
    textTransform: "uppercase",
    marginTop: 16,
    marginBottom: 8,
  },
  input: {
    marginTop: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 17,
    color: "#fff",
    backgroundColor: "rgba(0,0,0,0.45)",
    textAlign: "left",
  },
  err: { marginTop: 12, color: "#fca5a5", fontSize: 14, textAlign: "center" },
  primary: {
    marginTop: 18,
    backgroundColor: "#a3e635",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryText: { color: "#0a0a0a", fontWeight: "900", fontSize: 16 },
  or: {
    marginTop: 14,
    textAlign: "center",
    color: "rgba(255,255,255,0.35)",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 2,
  },
  secondaryBtn: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(0,0,0,0.25)",
    alignItems: "center",
  },
  secondaryBtnInner: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  faceIdIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(163,230,53,0.06)",
  },
  secondaryBtnText: { color: "#a3e635", fontWeight: "900", fontSize: 16 },
  // Back-compat for enrollment screen buttons
  secondary: { marginTop: 14, paddingVertical: 12, alignItems: "center" },
  secondaryText: { color: "#93c5fd", fontWeight: "600", fontSize: 16 },
  disabled: { opacity: 0.55 },
});
