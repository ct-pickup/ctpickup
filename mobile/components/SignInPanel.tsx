import { useAuth } from "@/context/AuthContext";
import {
  biometricSignInLabel,
  disableBiometricSignIn,
  enableBiometricSignIn,
  getBiometricSignInEmail,
  isBiometricSignInAvailable,
  isBiometricSignInEnabled,
  unlockBiometricSignInCredentials,
} from "@/lib/biometricSignIn";
import { hasSupabaseEnv, siteOrigin } from "@/lib/env";
import { checkEmailExistsResult } from "@/lib/siteApi";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from "react-native";

const OTP_RESEND_COOLDOWN_SEC = 30;
const PASSWORD_MIN_LEN = 8;

const PANEL_ANIM_MS = 420;

type AuthMode = "login" | "signup";
type SignupStage = "email" | "code" | "password";

type Props = {
  /** Hide the “Sign in” section label (e.g. login screen has its own headline). */
  hideHeading?: boolean;
  /** A simpler login panel (no Returning/New segmented control). */
  variant?: "segmented" | "simple" | "premium";
};

export function SignInPanel({ hideHeading, variant = "segmented" }: Props) {
  const router = useRouter();
  const { supabase, refreshSession } = useAuth();

  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [signupStage, setSignupStage] = useState<SignupStage>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showSendRetry, setShowSendRetry] = useState(false);
  const [resendCooldownSec, setResendCooldownSec] = useState(0);
  const [bioLabel, setBioLabel] = useState("Face ID");
  const [bioSignInReady, setBioSignInReady] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    if (UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const [label, enabled, available] = await Promise.all([
        biometricSignInLabel(),
        isBiometricSignInEnabled(),
        isBiometricSignInAvailable(),
      ]);
      setBioLabel(label);
      setBioSignInReady(enabled && available);
    })();
  }, [authMode]);

  function animatePanel() {
    LayoutAnimation.configureNext(
      LayoutAnimation.create(
        PANEL_ANIM_MS,
        LayoutAnimation.Types.easeInEaseOut,
        LayoutAnimation.Properties.opacity,
      ),
    );
  }

  const emailClean = useMemo(() => email.trim().toLowerCase(), [email]);
  const canSignIn = hasSupabaseEnv() && !!supabase;
  const siteOk = !!siteOrigin();

  useEffect(() => {
    if (resendCooldownSec <= 0) return;
    const id = setInterval(() => setResendCooldownSec((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [resendCooldownSec]);

  function clearAuthHints() {
    setShowSendRetry(false);
  }

  function resetSignupFlow() {
    animatePanel();
    setSignupStage("email");
    setCode("");
    setPassword("");
    setResendCooldownSec(0);
    setMsg(null);
    clearAuthHints();
  }

  function switchAuthMode(next: AuthMode) {
    if (next === authMode) return;
    animatePanel();
    setAuthMode(next);
    resetSignupFlow();
    if (next === "login") {
      setPassword("");
    }
  }

  const emailLooksValid = useMemo(() => {
    if (emailClean.length < 6) return false;
    if (!emailClean.includes("@")) return false;
    const [a, b] = emailClean.split("@");
    if (!a || !b) return false;
    if (!b.includes(".")) return false;
    return true;
  }, [emailClean]);

  const passwordLooksValid = password.length >= PASSWORD_MIN_LEN;

  async function finishAuth() {
    if (!supabase) return;
    const { data: sessionPayload, error: sessionErr } = await supabase.auth.getSession();
    if (sessionErr || !sessionPayload.session) {
      const userMsg = "Signed in, but couldn’t load your session. Please try again.";
      setMsg(userMsg);
      Alert.alert("Session error", userMsg);
      return;
    }
    await refreshSession();
    await Promise.resolve();
    router.replace("/(tabs)");
  }

  async function maybeOfferBiometricSignIn(loginPassword: string) {
    const [available, enabled] = await Promise.all([isBiometricSignInAvailable(), isBiometricSignInEnabled()]);
    if (!available || enabled) return;

    const label = await biometricSignInLabel();
    Alert.alert(
      `Enable ${label} for faster sign-in?`,
      `Use ${label} next time instead of typing your password.`,
      [
        { text: "Not now", style: "cancel" },
        {
          text: "Enable",
          onPress: () => {
            void enableBiometricSignIn(emailClean, loginPassword).then(() => {
              setBioSignInReady(true);
            });
          },
        },
      ],
    );
  }

  async function postSignInOtp(skipStageAdvance: boolean): Promise<boolean> {
    if (!supabase) {
      setMsg("Sign-in isn't ready yet on this build.");
      return false;
    }
    try {
      const { data, error } = await supabase.auth.signInWithOtp({
        email: emailClean,
        options: {
          emailRedirectTo: siteOrigin() ? `${siteOrigin()}/login` : undefined,
        },
      });

      if (error) {
        const userMsg =
          /rate limit/i.test(error.message ?? "") || (error as { status?: number }).status === 429
            ? "Too many requests. Please wait a moment and try again."
            : "We couldn’t send the code right now. Please try again.";
        setMsg(userMsg);
        Alert.alert("Couldn’t send code", userMsg);
        console.error("[auth] signInWithOtp error", { error, email: emailClean, hasData: !!data });
        return false;
      }
    } catch (e) {
      const userMsg = "We couldn’t send the code right now. Please try again.";
      setMsg(userMsg);
      Alert.alert("Couldn’t send code", userMsg);
      console.error("[auth] signInWithOtp threw", { error: e, email: emailClean });
      return false;
    }
    if (!skipStageAdvance) {
      animatePanel();
      setSignupStage("code");
    }
    setResendCooldownSec(OTP_RESEND_COOLDOWN_SEC);
    setMsg(null);
    clearAuthHints();
    return true;
  }

  async function submitSignupSendCode() {
    if (!emailLooksValid || busy || !supabase) {
      if (!emailLooksValid) setMsg("Enter a valid email address.");
      return;
    }
    setBusy(true);
    setMsg(null);
    clearAuthHints();
    let existsResult: Awaited<ReturnType<typeof checkEmailExistsResult>> | null = null;
    try {
      existsResult = await checkEmailExistsResult(emailClean);
    } catch (e) {
      setBusy(false);
      setShowSendRetry(true);
      const userMsg = "Could not reach CT Pickup. Check your connection and try again.";
      setMsg(userMsg);
      Alert.alert("Network error", userMsg);
      console.error("[auth] checkEmailExistsResult threw", { error: e, email: emailClean });
      return;
    }
    if (!existsResult.ok) {
      setBusy(false);
      const reason = existsResult.reason;
      setShowSendRetry(reason === "network");
      if (reason === "missing_site_url") {
        setMsg("Set EXPO_PUBLIC_SITE_URL in mobile/.env to your deployed API host (Next.js origin), then restart Expo.");
      } else if (reason === "network") {
        setMsg("Could not reach CT Pickup. Check your connection and try again.");
      } else {
        setMsg("Could not verify that email right now. Try again in a moment.");
      }
      return;
    }
    if (existsResult.exists) {
      setBusy(false);
      setMsg('This email already has an account. Tap "Already have an account?" above to sign in.');
      return;
    }

    const ok = await postSignInOtp(false);
    setBusy(false);
    if (!ok) return;
  }

  async function resendSignupCode() {
    if (busy || resendCooldownSec > 0 || !supabase) return;
    setBusy(true);
    setMsg(null);
    clearAuthHints();
    const ok = await postSignInOtp(true);
    setBusy(false);
    if (ok) setMsg("We sent a new code.");
  }

  async function verifySignupCode() {
    if (!code.trim() || busy || !supabase) return;
    setBusy(true);
    setMsg(null);
    const token = code.replace(/\D/g, "");
    if (token.length !== 8) {
      setBusy(false);
      setMsg("Enter the 8-digit code from your email.");
      return;
    }
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: emailClean,
        token,
        type: "email",
      });
      if (error) {
        const userMsg = /expired/i.test(error.message ?? "")
          ? "That code expired. Tap “Resend code” and try again."
          : "Invalid code. Please try again.";
        setBusy(false);
        setMsg(userMsg);
        Alert.alert("Couldn’t verify code", userMsg);
        return;
      }
      animatePanel();
      setSignupStage("password");
      setPassword("");
      setMsg(null);
      setBusy(false);
    } catch (e) {
      setBusy(false);
      const userMsg = "Something went wrong while verifying your code. Please try again.";
      setMsg(userMsg);
      Alert.alert("Verification error", userMsg);
      console.error("[auth] verify signup code threw", { error: e, email: emailClean });
    }
  }

  async function submitSignupPassword() {
    if (!supabase || busy) return;
    if (!passwordLooksValid) {
      setMsg(`Password must be at least ${PASSWORD_MIN_LEN} characters.`);
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setBusy(false);
        const userMsg = "Could not set your password. Please try again.";
        setMsg(userMsg);
        Alert.alert("Password error", userMsg);
        console.error("[auth] updateUser password after signup failed", { error, email: emailClean });
        return;
      }
      await finishAuth();
    } catch (e) {
      setBusy(false);
      const userMsg = "Something went wrong. Please try again.";
      setMsg(userMsg);
      Alert.alert("Sign-up error", userMsg);
      console.error("[auth] signup password threw", { error: e, email: emailClean });
      return;
    } finally {
      setBusy(false);
    }
  }

  async function submitPasswordLogin() {
    if (!supabase || busy) return;
    if (!emailLooksValid) {
      setMsg("Enter a valid email address.");
      return;
    }
    if (!passwordLooksValid) {
      setMsg(`Enter your password (at least ${PASSWORD_MIN_LEN} characters).`);
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: emailClean,
        password,
      });
      if (error) {
        setBusy(false);
        const userMsg = /invalid login credentials/i.test(error.message ?? "")
          ? "Incorrect email or password."
          : "Could not sign in. Please try again.";
        setMsg(userMsg);
        console.error("[auth] signInWithPassword failed", { error, email: emailClean });
        return;
      }
      const storedEmail = await getBiometricSignInEmail();
      if (storedEmail && storedEmail !== emailClean) {
        await disableBiometricSignIn();
        setBioSignInReady(false);
      }
      await finishAuth();
      void maybeOfferBiometricSignIn(password);
    } catch (e) {
      setBusy(false);
      const userMsg = "Something went wrong while signing in. Please try again.";
      setMsg(userMsg);
      Alert.alert("Sign-in error", userMsg);
      console.error("[auth] password login threw", { error: e, email: emailClean });
    } finally {
      setBusy(false);
    }
  }

  async function submitBiometricLogin() {
    if (!supabase || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const unlock = await unlockBiometricSignInCredentials();
      if (!unlock.ok) {
        setBusy(false);
        if (unlock.error === "user_cancel" || unlock.error === "system_cancel") return;
        if (unlock.error === "disabled" || unlock.error === "missing_credentials") {
          setBioSignInReady(false);
          setMsg("Biometric sign-in is not set up. Sign in with your password.");
          return;
        }
        setMsg("Biometric sign-in failed. Try your password instead.");
        return;
      }
      const { email: storedEmail, password: storedPassword } = unlock.credentials;
      setEmail(storedEmail);
      const { error } = await supabase.auth.signInWithPassword({
        email: storedEmail,
        password: storedPassword,
      });
      if (error) {
        await disableBiometricSignIn();
        setBioSignInReady(false);
        setBusy(false);
        setMsg("Stored sign-in expired. Enter your password and sign in again.");
        console.error("[auth] biometric signInWithPassword failed", { error, email: storedEmail });
        return;
      }
      await finishAuth();
    } catch (e) {
      setBusy(false);
      setMsg("Biometric sign-in failed. Try your password instead.");
      console.error("[auth] biometric login threw", { error: e });
    } finally {
      setBusy(false);
    }
  }

  async function submitForgotPassword() {
    if (!supabase || busy) return;
    if (!emailLooksValid) {
      setMsg("Enter your email address first.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const redirectTo = Linking.createURL("reset-password");
      const { error } = await supabase.auth.resetPasswordForEmail(emailClean, { redirectTo });
      if (error) {
        setMsg("Could not send reset email. Please try again.");
        console.error("[auth] resetPasswordForEmail failed", { error, email: emailClean });
        return;
      }
      setMsg("Check your email for a password reset link.");
    } finally {
      setBusy(false);
    }
  }

  const showModeToggle = variant === "segmented" || variant === "premium";

  return (
    <>
      {!hideHeading ? <Text style={[styles.sectionTitle, styles.sectionAboveAuth]}>Sign in</Text> : null}
      {showModeToggle ? (
        <View style={[styles.segmentRow, variant === "premium" && styles.segmentRowPremium]}>
          <Pressable
            accessibilityRole="button"
            style={[styles.segmentChip, authMode === "signup" && styles.segmentChipActive]}
            onPress={() => switchAuthMode("signup")}
          >
            <Text style={[styles.segmentChipText, authMode === "signup" && styles.segmentChipTextActive]}>New here?</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={[styles.segmentChip, authMode === "login" && styles.segmentChipActive]}
            onPress={() => switchAuthMode("login")}
          >
            <Text style={[styles.segmentChipText, authMode === "login" && styles.segmentChipTextActive]}>
              Already have an account?
            </Text>
          </Pressable>
        </View>
      ) : null}

      <View style={[styles.card, variant === "premium" && styles.cardPremium]}>
        {!canSignIn ? (
          <View style={styles.configBox}>
            <Text style={styles.configBoxTitle}>Sign-in isn&apos;t wired on this build yet</Text>
            <Text style={styles.configBoxBody}>Copy from the Next.js app</Text>
            <Text style={styles.configMono}>EXPO_PUBLIC_SUPABASE_URL{"\n"}EXPO_PUBLIC_SUPABASE_ANON_KEY</Text>
            <Text style={styles.configBoxBody}>into mobile/.env, restart Expo Go or rebuild.</Text>
          </View>
        ) : null}
        {!siteOk ? (
          <View style={[styles.configBox, styles.configBoxYellow]}>
            <Text style={styles.configBody}>Add EXPO_PUBLIC_SITE_URL (your deployed site URL) for account checks.</Text>
          </View>
        ) : null}

        {authMode === "login" ? (
          <>
            {variant === "premium" ? (
              <View style={[styles.premiumFieldLabelRow, styles.premiumFieldLabelRowCenter]}>
                <FontAwesome name="envelope-o" size={14} color="rgba(255,255,255,0.55)" />
                <Text style={styles.premiumFieldLabel}>Email</Text>
              </View>
            ) : (
              <Text style={styles.fieldLabel}>Email</Text>
            )}
            {variant !== "premium" ? <Text style={styles.trustLine}>Sign in with your password</Text> : null}
            <TextInput
              style={[styles.input, variant === "premium" && styles.inputPremium]}
              placeholder="you@example.com"
              placeholderTextColor={variant === "premium" ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.35)"}
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onBlur={() =>
                setEmail((v) => {
                  const t = v.trim().toLowerCase();
                  return t === v ? v : t;
                })
              }
              onChangeText={setEmail}
            />

            <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Password</Text>
            <TextInput
              style={[styles.input, variant === "premium" && styles.inputPremium]}
              placeholder="Your password"
              placeholderTextColor={variant === "premium" ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.35)"}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={() => void submitPasswordLogin()}
            />

            <Pressable
              style={[styles.primaryBtn, (!emailLooksValid || !passwordLooksValid || busy || !canSignIn) && styles.disabled]}
              disabled={!emailLooksValid || !passwordLooksValid || busy || !canSignIn}
              onPress={() => void submitPasswordLogin()}
            >
              {busy ? (
                <ActivityIndicator color="#0a0a0a" />
              ) : (
                <View style={styles.primaryBtnRow}>
                  <Text style={styles.primaryBtnText}>Sign in with password</Text>
                  {variant === "premium" ? <FontAwesome name="chevron-right" size={14} color="#0a0a0a" /> : null}
                </View>
              )}
            </Pressable>

            {bioSignInReady ? (
              <Pressable
                style={[styles.bioBtn, busy && styles.disabled]}
                disabled={busy || !canSignIn}
                onPress={() => void submitBiometricLogin()}
              >
                <FontAwesome
                  name={bioLabel === "Touch ID" ? "hand-o-up" : "user-circle-o"}
                  size={18}
                  color="#e5e5e5"
                />
                <Text style={styles.bioBtnText}>Sign in with {bioLabel}</Text>
              </Pressable>
            ) : null}

            <Pressable style={styles.textBtn} disabled={busy || !canSignIn} onPress={() => void submitForgotPassword()}>
              <Text style={styles.textBtnLabelStrong}>Forgot password?</Text>
            </Pressable>

            {variant === "simple" ? (
              <Pressable style={styles.createAccountRow} onPress={() => switchAuthMode("signup")}>
                <Text style={styles.createAccountText}>
                  New to CT Pickup? <Text style={styles.createAccountStrong}>Create an account</Text>
                </Text>
              </Pressable>
            ) : null}
          </>
        ) : signupStage === "email" ? (
          <>
            {variant === "premium" ? (
              <View style={[styles.premiumFieldLabelRow, styles.premiumFieldLabelRowCenter]}>
                <FontAwesome name="envelope-o" size={14} color="rgba(255,255,255,0.55)" />
                <Text style={styles.premiumFieldLabel}>Email</Text>
              </View>
            ) : (
              <Text style={styles.fieldLabel}>Email</Text>
            )}
            {variant !== "premium" ? <Text style={styles.trustLine}>We&apos;ll send an 8-digit code to verify your email</Text> : null}
            <TextInput
              style={[styles.input, variant === "premium" && styles.inputPremium]}
              placeholder="you@example.com"
              placeholderTextColor={variant === "premium" ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.35)"}
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onBlur={() =>
                setEmail((v) => {
                  const t = v.trim().toLowerCase();
                  return t === v ? v : t;
                })
              }
              onChangeText={setEmail}
            />
            <Pressable
              style={[styles.primaryBtn, (!emailLooksValid || busy || !canSignIn) && styles.disabled]}
              disabled={!emailLooksValid || busy || !canSignIn}
              onPress={() => void submitSignupSendCode()}
            >
              {busy ? (
                <ActivityIndicator color="#0a0a0a" />
              ) : (
                <View style={styles.primaryBtnRow}>
                  <Text style={styles.primaryBtnText}>Send code</Text>
                  {variant === "premium" ? <FontAwesome name="chevron-right" size={14} color="#0a0a0a" /> : null}
                </View>
              )}
            </Pressable>
            {showSendRetry ? (
              <Pressable style={styles.secondaryBtn} onPress={() => void submitSignupSendCode()}>
                <Text style={styles.secondaryBtnText}>Try again</Text>
              </Pressable>
            ) : null}
          </>
        ) : signupStage === "code" ? (
          <>
            <Text style={styles.fieldLabel}>8-digit code</Text>
            <Text style={styles.trustLine}>Sent to {emailClean}</Text>
            <TextInput
              style={[styles.input, variant === "premium" && styles.inputPremium]}
              placeholder="00000000"
              placeholderTextColor={variant === "premium" ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.35)"}
              keyboardType="number-pad"
              maxLength={12}
              value={code}
              onChangeText={setCode}
              autoCorrect={false}
              autoCapitalize="none"
              spellCheck={false}
              textContentType={Platform.OS === "ios" ? "oneTimeCode" : undefined}
              autoComplete={Platform.OS === "android" ? "sms-otp" : "one-time-code"}
              blurOnSubmit={false}
            />
            <Pressable style={[styles.primaryBtn, busy && styles.disabled]} disabled={busy || !canSignIn} onPress={() => void verifySignupCode()}>
              {busy ? <ActivityIndicator color="#111" /> : <Text style={styles.primaryBtnText}>Verify</Text>}
            </Pressable>
            <Pressable
              style={[styles.secondaryBtn, (busy || resendCooldownSec > 0 || !canSignIn) && styles.disabled]}
              disabled={busy || resendCooldownSec > 0 || !canSignIn}
              onPress={() => void resendSignupCode()}
            >
              <Text style={styles.secondaryBtnText}>
                {resendCooldownSec > 0 ? `Resend code (${resendCooldownSec}s)` : "Resend code"}
              </Text>
            </Pressable>
            <Pressable style={styles.textBtn} onPress={() => resetSignupFlow()}>
              <Text style={styles.textBtnLabelStrong}>Wrong email? Start over</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.fieldLabel}>Set a password</Text>
            <Text style={styles.trustLine}>Set a password for faster sign-in next time</Text>
            <TextInput
              style={[styles.input, variant === "premium" && styles.inputPremium]}
              placeholder={`At least ${PASSWORD_MIN_LEN} characters`}
              placeholderTextColor={variant === "premium" ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.35)"}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={() => void submitSignupPassword()}
            />
            <Pressable
              style={[styles.primaryBtn, (!passwordLooksValid || busy || !canSignIn) && styles.disabled]}
              disabled={!passwordLooksValid || busy || !canSignIn}
              onPress={() => void submitSignupPassword()}
            >
              {busy ? <ActivityIndicator color="#0a0a0a" /> : <Text style={styles.primaryBtnText}>Continue</Text>}
            </Pressable>
          </>
        )}

        {msg ? <Text style={[styles.msg, styles.msgMuted]}>{msg}</Text> : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { marginTop: 28, fontSize: 18, fontWeight: "700", color: "#fff" },
  sectionAboveAuth: { marginTop: 20 },
  segmentRow: {
    flexDirection: "row",
    marginTop: 14,
    gap: 10,
    padding: 4,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  segmentRowPremium: {
    alignSelf: "center",
    width: "100%",
  },
  segmentChip: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "transparent",
    backgroundColor: "transparent",
  },
  segmentChipActive: { borderColor: "rgba(163,230,53,0.35)", backgroundColor: "rgba(163,230,53,0.14)" },
  segmentChipText: { color: "rgba(255,255,255,0.62)", fontSize: 13, fontWeight: "700", textAlign: "center" },
  segmentChipTextActive: { color: "#fff" },
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
  card: {
    marginTop: 14,
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  cardPremium: {
    padding: 22,
    borderRadius: 22,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.035)",
  },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: "rgba(255,255,255,0.55)" },
  fieldLabelSpaced: { marginTop: 14 },
  premiumFieldLabelRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  premiumFieldLabelRowCenter: { justifyContent: "center" },
  premiumFieldLabel: { fontSize: 15, fontWeight: "800", color: "rgba(255,255,255,0.9)" },
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
  inputPremium: {
    marginTop: 12,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(0,0,0,0.22)",
    textAlign: "center",
  },
  primaryBtn: {
    marginTop: 16,
    backgroundColor: "#a3e635",
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: "center",
  },
  primaryBtnRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  primaryBtnText: { color: "#0a0a0a", fontWeight: "900", fontSize: 16 },
  bioBtn: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  bioBtnText: { color: "#e5e5e5", fontWeight: "700", fontSize: 15 },
  disabled: { opacity: 0.5 },
  createAccountRow: { marginTop: 14, alignItems: "center" },
  createAccountText: { color: "rgba(255,255,255,0.75)", fontSize: 15, fontWeight: "500" },
  createAccountStrong: { color: "#fff", fontSize: 15, fontWeight: "700" },
  textBtn: { marginTop: 12, alignItems: "center" },
  textBtnLabelStrong: { color: "rgba(255,255,255,0.65)", fontSize: 14.5, fontWeight: "700" },
  msg: { marginTop: 14, color: "#fca5a5", fontSize: 14, textAlign: "center" },
  msgMuted: { color: "rgba(252,211,212,0.92)" },
});
