import { useAccountIntroReplay } from "@/context/AccountIntroReplayContext";
import { useReplayOpeningTheme } from "@/context/ReplayOpeningThemeContext";
import { useAdminMode } from "@/context/AdminModeContext";
import { useAuth } from "@/context/AuthContext";
import { useAppLock } from "@/context/AppLockContext";
import {
  isValidPinFormat,
  normalizePasscode,
  PASSCODE_MAX_LEN,
  PASSCODE_REQUIREMENTS,
} from "@/lib/appLock";
import * as LocalAuthentication from "expo-local-authentication";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";

export default function AccountScreen() {
  const { replay: replayAccountIntro } = useAccountIntroReplay();
  const replayOpeningThemeCtx = useReplayOpeningTheme();
  const { session, isReady, signOut } = useAuth();
  const { enabled: adminModeEnabled, isReady: adminModeReady, setEnabled: setAdminModeEnabled } = useAdminMode();
  const {
    hasPin,
    changePin,
    biometricsEnabled,
    biometricsAvailable,
    setBiometricsEnabled,
    refreshBiometricAvailability,
    lockNow,
  } = useAppLock();

  const [lockUi, setLockUi] = useState<"idle" | "change">("idle");
  const [changeOld, setChangeOld] = useState("");
  const [changeNewA, setChangeNewA] = useState("");
  const [changeNewB, setChangeNewB] = useState("");
  const [lockBusy, setLockBusy] = useState(false);
  const [lockMsg, setLockMsg] = useState<string | null>(null);

  useEffect(() => {
    void refreshBiometricAvailability();
  }, [refreshBiometricAvailability]);

  async function onToggleBiometrics(next: boolean) {
    setLockMsg(null);
    if (!next) {
      await setBiometricsEnabled(false);
      return;
    }
    if (!biometricsAvailable) {
      setLockMsg("Biometrics aren’t available on this device.");
      return;
    }
    const r = await LocalAuthentication.authenticateAsync({
      promptMessage: "Turn on Face ID for CT Pickup",
      cancelLabel: "Cancel",
    });
    if (r.success) await setBiometricsEnabled(true);
  }

  if (!isReady) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  const signedEmail = session?.user?.email;
  if (!signedEmail) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  const isOmeed = signedEmail.toLowerCase() === "omeedpooya@gmail.com";

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Account</Text>
        <Text style={styles.sub}>
          Email sign-in, push, and your device passcode{"\n"}
          (same one-time email code Supabase sends you).
        </Text>

        <View style={[styles.card, styles.cardLime]}>
          <Text style={styles.signedLabel}>SIGNED IN</Text>
          <Text style={styles.email}>{signedEmail}</Text>
          <Text style={styles.signedAssist}>You&apos;re signed in on this device. Push reminders use your account.</Text>
          <Pressable style={styles.outlineBtnLime} onPress={() => void signOut()}>
            <Text style={styles.outlineBtnLimeText}>Sign out</Text>
          </Pressable>
        </View>

        {isOmeed ? (
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.fieldLabelStrong}>Admin Mode</Text>
                <Text style={styles.bioHint}>Show the Admin tab and pages on this device.</Text>
              </View>
              <Switch
                value={adminModeEnabled}
                onValueChange={(v) => void setAdminModeEnabled(v)}
                disabled={!adminModeReady}
                trackColor={{ false: "rgba(255,255,255,0.18)", true: LIME }}
                thumbColor="#f4f4f5"
              />
            </View>
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>App passcode</Text>
        <Text style={styles.sectionSub}>
          A passcode is required on this device when you’re{"\n"}
          signed in. {PASSCODE_REQUIREMENTS} It locks the app when you leave;{"\n"}
          Face ID or Touch ID can unlock instead.
        </Text>

        {!hasPin ? (
          <Text style={styles.noteMuted}>
            You’ll be prompted to create your passcode after sign-in before using the app.
          </Text>
        ) : null}

        {hasPin && lockUi === "idle" ? (
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.fieldLabelStrong}>Face ID / Touch ID</Text>
                <Text style={styles.bioHint}>Unlock without typing your passcode.</Text>
              </View>
              <Switch
                value={biometricsEnabled}
                onValueChange={(v) => void onToggleBiometrics(v)}
                disabled={!biometricsAvailable && !biometricsEnabled}
                trackColor={{ false: "rgba(255,255,255,0.18)", true: LIME }}
                thumbColor="#f4f4f5"
              />
            </View>
            {!biometricsAvailable ? <Text style={styles.warn}>Set up Face ID or Touch ID in iOS Settings to use this.</Text> : null}
            <Pressable
              style={styles.secondaryBtn}
              onPress={() => {
                setLockUi("change");
                setLockMsg(null);
              }}
            >
              <Text style={styles.secondaryBtnText}>Change passcode</Text>
            </Pressable>
            <Pressable style={styles.textBtn} onPress={() => lockNow()}>
              <Text style={styles.textBtnLabel}>Lock app now</Text>
            </Pressable>
          </View>
        ) : null}

      {hasPin && lockUi === "change" ? (
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Current passcode</Text>
          <TextInput
            style={styles.input}
            maxLength={PASSCODE_MAX_LEN}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            value={changeOld}
            onChangeText={(t) => setChangeOld(t.slice(0, PASSCODE_MAX_LEN))}
            placeholderTextColor="rgba(255,255,255,0.35)"
          />
          <Text style={[styles.fieldLabel, { marginTop: 12 }]}>New passcode</Text>
          <TextInput
            style={styles.input}
            maxLength={PASSCODE_MAX_LEN}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            value={changeNewA}
            onChangeText={(t) => setChangeNewA(t.slice(0, PASSCODE_MAX_LEN))}
            placeholderTextColor="rgba(255,255,255,0.35)"
          />
          <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Confirm new</Text>
          <TextInput
            style={styles.input}
            maxLength={PASSCODE_MAX_LEN}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            value={changeNewB}
            onChangeText={(t) => setChangeNewB(t.slice(0, PASSCODE_MAX_LEN))}
            placeholderTextColor="rgba(255,255,255,0.35)"
          />
          <Pressable
            style={[styles.primaryBtn, lockBusy && styles.disabled]}
            disabled={lockBusy}
            onPress={() => {
              void (async () => {
                setLockMsg(null);
                if (!normalizePasscode(changeOld)) {
                  setLockMsg("Enter your current passcode.");
                  return;
                }
                if (!isValidPinFormat(changeNewA) || !isValidPinFormat(changeNewB)) {
                  setLockMsg(PASSCODE_REQUIREMENTS);
                  return;
                }
                if (normalizePasscode(changeNewA) !== normalizePasscode(changeNewB)) {
                  setLockMsg("New passcodes don’t match.");
                  return;
                }
                setLockBusy(true);
                const ok = await changePin(changeOld, changeNewA);
                setLockBusy(false);
                if (!ok) {
                  setLockMsg("Current passcode incorrect.");
                  return;
                }
                setChangeOld("");
                setChangeNewA("");
                setChangeNewB("");
                setLockUi("idle");
              })();
            }}
          >
            <Text style={styles.primaryBtnText}>Update passcode</Text>
          </Pressable>
          <Pressable style={styles.textBtn} onPress={() => { setLockUi("idle"); setLockMsg(null); }}>
            <Text style={styles.textBtnLabel}>Cancel</Text>
          </Pressable>
          {lockMsg ? <Text style={styles.msg}>{lockMsg}</Text> : null}
        </View>
      ) : null}

      {__DEV__ ? (
        <>
          <Pressable
            style={styles.devReplayRow}
            onPress={() => {
              void replayAccountIntro();
            }}
          >
            <Text style={styles.devReplayText}>Replay Account intro (dev only)</Text>
          </Pressable>
          <Pressable
            style={[styles.devReplayRow, styles.devReplayRowGap]}
            onPress={() => void replayOpeningThemeCtx?.replayOpeningTheme()}
          >
            <Text style={styles.devReplayText}>Replay opening theme (dev only)</Text>
          </Pressable>
        </>
      ) : null}
        <Pressable style={styles.aboutRow} onPress={() => {}}>
          <View style={styles.aboutLeft}>
            <View style={styles.aboutIconWrap}>
              <FontAwesome name="info-circle" size={18} color="rgba(255,255,255,0.75)" />
            </View>
            <Text style={styles.aboutText}>About this app</Text>
          </View>
          <FontAwesome name="chevron-right" size={14} color="rgba(255,255,255,0.35)" />
        </Pressable>
      </ScrollView>
    </View>
  );
}

const LIME = "#a3e635";

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0a0a0a" },
  scroll: { flex: 1, backgroundColor: "#0a0a0a" },
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, backgroundColor: "#0a0a0a", justifyContent: "center", alignItems: "center" },
  title: { fontSize: 36, fontWeight: "800", color: "#fff", letterSpacing: 0.2 },
  sub: { marginTop: 10, color: "rgba(255,255,255,0.6)", fontSize: 14, lineHeight: 20 },
  sectionTitle: { marginTop: 28, fontSize: 20, fontWeight: "800", color: "#fff" },
  sectionAboveAuth: { marginTop: 20 },
  sectionSub: { marginTop: 8, color: "rgba(255,255,255,0.55)", fontSize: 14, lineHeight: 20 },
  noteMuted: { marginTop: 14, color: "rgba(255,255,255,0.45)", fontSize: 14, lineHeight: 20 },
  infoBanner: {
    marginTop: 16,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(147,197,253,0.35)",
    backgroundColor: "rgba(59,130,246,0.12)",
  },
  infoBannerText: { color: "rgba(226,232,240,0.95)", fontSize: 14, lineHeight: 20 },
  segmentRow: { flexDirection: "row", marginTop: 12, gap: 10 },
  segmentChip: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  segmentChipActive: { borderColor: "rgba(255,255,255,0.32)", backgroundColor: "rgba(255,255,255,0.1)" },
  segmentChipText: { color: "rgba(255,255,255,0.5)", fontSize: 15, fontWeight: "600" },
  segmentChipTextActive: { color: "#fff" },
  signupExplainTitle: { fontSize: 17, fontWeight: "700", color: "#fff", marginBottom: 8 },
  mutedP: { color: "rgba(255,255,255,0.72)", fontSize: 14, lineHeight: 21, marginBottom: 16 },
  stepSubtitle: {
    marginBottom: 14,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: "rgba(255,255,255,0.45)",
  },
  trustLine: { marginTop: 6, fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 18 },
  configBox: {
    marginBottom: 16,
    padding: 14,
    borderRadius: 12,
    backgroundColor: "rgba(251,146,60,0.12)",
    borderWidth: 1,
    borderColor: "rgba(251,146,60,0.35)",
  },
  configBoxYellow: { marginBottom: 16 },
  configBoxTitle: { fontWeight: "700", color: "#fcd34d", marginBottom: 8, fontSize: 15 },
  configBoxBody: { color: "rgba(255,255,255,0.75)", fontSize: 14, lineHeight: 20 },
  configBody: { color: "rgba(255,255,255,0.82)", fontSize: 14, lineHeight: 20 },
  configMono: {
    marginTop: 10,
    marginBottom: 6,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: undefined }),
    fontSize: 13,
    color: "rgba(255,255,255,0.9)",
    lineHeight: 20,
  },
  outlineSignupBtn: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(147,197,253,0.55)",
    backgroundColor: "rgba(147,197,253,0.08)",
  },
  outlineSignupBtnText: { color: "#93c5fd", fontWeight: "600", fontSize: 15 },
  rowBetween: { flexDirection: "row", alignItems: "center", marginBottom: 16 },
  bioHint: { marginTop: 4, fontSize: 13, color: "rgba(255,255,255,0.5)" },
  warn: { marginTop: 8, fontSize: 13, color: "#fcd34d" },
  secondaryBtn: {
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
  },
  secondaryBtnText: { color: "#e5e5e5", fontWeight: "600", fontSize: 15 },
  devReplayRow: {
    marginTop: 20,
    paddingVertical: 12,
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "rgba(250,204,21,0.35)",
    backgroundColor: "rgba(250,204,21,0.06)",
  },
  devReplayText: { fontSize: 13, color: "rgba(253,224,71,0.85)", fontWeight: "600" },
  devReplayRowGap: { marginTop: 12 },
  card: {
    marginTop: 14,
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  cardLime: {
    borderColor: "rgba(163,230,53,0.25)",
    backgroundColor: "rgba(163,230,53,0.06)",
  },
  signedLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: LIME,
    letterSpacing: 1.2,
  },
  email: { marginTop: 10, fontSize: 18, fontWeight: "700", color: "#fff" },
  signedAssist: { marginTop: 10, fontSize: 14, color: "rgba(255,255,255,0.55)", lineHeight: 20 },
  fieldLabel: { fontSize: 13, fontWeight: "700", color: "rgba(255,255,255,0.55)" },
  fieldLabelStrong: { fontSize: 13, fontWeight: "800", color: "rgba(255,255,255,0.75)" },
  input: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: "#fff",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  primaryBtn: {
    marginTop: 16,
    backgroundColor: "#f5f5f5",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryBtnText: { color: "#111", fontWeight: "700", fontSize: 16 },
  disabled: { opacity: 0.5 },
  outlineBtnLime: {
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.55)",
    backgroundColor: "rgba(163,230,53,0.08)",
    alignItems: "center",
  },
  outlineBtnLimeText: { color: LIME, fontWeight: "700", fontSize: 15 },
  textBtn: { marginTop: 12, alignItems: "center" },
  textBtnLabel: { color: "rgba(255,255,255,0.55)", fontSize: 14 },
  textBtnLabelStrong: { color: "#93c5fd", fontSize: 15, fontWeight: "600" },
  msg: { marginTop: 14, color: "#fca5a5", fontSize: 14 },
  msgMuted: { color: "rgba(252,211,212,0.92)" },

  aboutRow: {
    marginTop: 16,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  aboutLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  aboutIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  aboutText: { fontSize: 15, fontWeight: "700", color: "rgba(255,255,255,0.9)" },
});
