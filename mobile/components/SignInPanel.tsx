import { useAuth } from "@/context/AuthContext";
import { CT_PICKUP_LIME } from "@/constants/Colors";
import {
  biometricSignInLabel,
  disableBiometricSignIn,
  enableBiometricSignIn,
  getBiometricSignInEmail,
  isBiometricSignInAvailable,
  isBiometricSignInEnabled,
  trySilentSignInWithStoredPassword,
  unlockBiometricSignInCredentials,
} from "@/lib/biometricSignIn";
import { hasSupabaseEnv, siteOrigin } from "@/lib/env";
import { checkEmailExistsResult } from "@/lib/siteApi";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  UIManager,
  View,
} from "react-native";

const LIME = CT_PICKUP_LIME;
const OTP_RESEND_COOLDOWN_SEC = 30;
const PASSWORD_MIN_LEN = 8;
/** Accounts older than this after OTP verify are treated as already registered (not brand-new). */
const EXISTING_ACCOUNT_CREATED_AT_MS = 5 * 60 * 1000;

const PANEL_ANIM_MS = 420;
const SEGMENT_ANIM_MS = 280;

type AuthMode = "login" | "signup";
type SignupStage = "email" | "code" | "password";

type Props = {
  /** Hide the “Sign in” section label (e.g. login screen has its own headline). */
  hideHeading?: boolean;
  /** A simpler login panel (no Returning/New segmented control). */
  variant?: "segmented" | "simple" | "premium";
};

function AuthTextInput({
  label,
  labelSpaced,
  ...inputProps
}: TextInputProps & { label: string; labelSpaced?: boolean }) {
  const [focused, setFocused] = useState(false);
  return (
    <>
      <Text style={[styles.fieldLabel, labelSpaced && styles.fieldLabelSpaced]}>{label}</Text>
      <TextInput
        {...inputProps}
        style={[styles.input, focused && styles.inputFocused]}
        placeholderTextColor={inputProps.placeholderTextColor ?? "rgba(255,255,255,0.32)"}
        onFocus={(e) => {
          setFocused(true);
          inputProps.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          inputProps.onBlur?.(e);
        }}
      />
    </>
  );
}

function PrimaryButton({
  label,
  busy,
  disabled,
  onPress,
}: {
  label: string;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.primaryBtn, disabled && styles.disabled]} disabled={disabled} onPress={onPress}>
      {busy ? (
        <ActivityIndicator color="#0a0a0a" />
      ) : (
        <View style={styles.primaryBtnRow}>
          <Text style={styles.primaryBtnText}>{label}</Text>
          <FontAwesome name="long-arrow-right" size={18} color="#0a0a0a" />
        </View>
      )}
    </Pressable>
  );
}

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
  const [segmentWidth, setSegmentWidth] = useState(0);
  /** True only while completing OTP from the "New here?" path (not login / Face ID). */
  const [newHereOtpFlow, setNewHereOtpFlow] = useState(false);

  const segmentSlide = useRef(new Animated.Value(authMode === "login" ? 1 : 0)).current;
  /** Set when "Send code" confirmed the email was not on file; cleared on flow reset. */
  const signupStartedAsNewEmailRef = useRef(false);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    if (UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  useEffect(() => {
    Animated.timing(segmentSlide, {
      toValue: authMode === "login" ? 1 : 0,
      duration: SEGMENT_ANIM_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [authMode, segmentSlide]);

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

  const segmentTabWidth = segmentWidth > 0 ? (segmentWidth - 8) / 2 : 0;
  const segmentIndicatorX = segmentSlide.interpolate({
    inputRange: [0, 1],
    outputRange: [4, 4 + segmentTabWidth],
  });

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
    setNewHereOtpFlow(false);
    signupStartedAsNewEmailRef.current = false;
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

  const accountLikelyHasPassword = useCallback((user: User | null | undefined): boolean => {
    if (!user?.created_at) return false;
    const createdMs = new Date(user.created_at).getTime();
    if (!Number.isFinite(createdMs)) return false;
    return Date.now() - createdMs > EXISTING_ACCOUNT_CREATED_AT_MS;
  }, []);

  /** After OTP on "New here?", skip set-password if the account already existed or device has stored password. */
  const shouldPromptNewUserPassword = useCallback(
    async (): Promise<boolean> => {
      if (authMode !== "signup" || !newHereOtpFlow || !signupStartedAsNewEmailRef.current || !supabase) {
        return false;
      }

      if (await trySilentSignInWithStoredPassword(supabase, emailClean)) {
        return false;
      }

      await refreshSession();
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) {
        console.warn("[auth] getUser after signup OTP failed", { error: userErr, email: emailClean });
        return true;
      }
      return !accountLikelyHasPassword(userData.user);
    },
    [authMode, newHereOtpFlow, supabase, emailClean, refreshSession, accountLikelyHasPassword],
  );

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
      setNewHereOtpFlow(true);
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
    signupStartedAsNewEmailRef.current = true;
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

      const promptPassword = await shouldPromptNewUserPassword();
      if (promptPassword) {
        animatePanel();
        setSignupStage("password");
        setPassword("");
        setMsg(null);
        setBusy(false);
        return;
      }

      setNewHereOtpFlow(false);
      signupStartedAsNewEmailRef.current = false;
      setMsg(null);
      await finishAuth();
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
      setNewHereOtpFlow(false);
      signupStartedAsNewEmailRef.current = false;
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
      const { error } = await supabase.auth.resetPasswordForEmail(emailClean, {
        redirectTo: "ctpickup://reset-password",
      });
      if (error) {
        const userMsg = "Could not send reset email. Please try again.";
        setMsg(userMsg);
        Alert.alert("Reset email", userMsg);
        console.error("[auth] resetPasswordForEmail failed", { error, email: emailClean });
        return;
      }
      Alert.alert("Reset email", `Password reset email sent to ${emailClean}`);
    } finally {
      setBusy(false);
    }
  }

  const showModeToggle = variant === "segmented" || variant === "premium";
  const isPremium = variant === "premium";

  return (
    <View style={styles.panelRoot}>
      {isPremium ? (
        <View style={styles.brandHeader}>
          <View style={styles.brandIconWrap}>
            <Image source={require("@/assets/images/icon.png")} style={styles.brandIcon} accessibilityLabel="CT Pickup" />
          </View>
          <Text style={styles.brandTitle}>CT Pickup</Text>
          <Text style={styles.brandTagline}>Community. Culture. Competitive.</Text>
        </View>
      ) : null}

      {!hideHeading ? <Text style={[styles.sectionTitle, styles.sectionAboveAuth]}>Sign in</Text> : null}

      {showModeToggle ? (
        <View
          style={[styles.segmentRow, isPremium && styles.segmentRowPremium]}
          onLayout={(e) => setSegmentWidth(e.nativeEvent.layout.width)}
        >
          {segmentTabWidth > 0 ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.segmentIndicator,
                {
                  width: segmentTabWidth,
                  transform: [{ translateX: segmentIndicatorX }],
                },
              ]}
            />
          ) : null}
          <Pressable
            accessibilityRole="button"
            style={styles.segmentTab}
            onPress={() => switchAuthMode("signup")}
          >
            <Text style={[styles.segmentTabText, authMode === "signup" && styles.segmentTabTextActive]}>New here?</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={styles.segmentTab}
            onPress={() => switchAuthMode("login")}
          >
            <Text style={[styles.segmentTabText, authMode === "login" && styles.segmentTabTextActive]}>
              Already have an account?
            </Text>
          </Pressable>
        </View>
      ) : null}

      <View style={[styles.card, isPremium && styles.cardPremium]}>
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
            {!isPremium ? <Text style={styles.trustLine}>Sign in with your password</Text> : null}
            <AuthTextInput
              label="Email"
              placeholder="you@example.com"
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

            <AuthTextInput
              label="Password"
              labelSpaced
              placeholder="Your password"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={() => void submitPasswordLogin()}
            />

            <PrimaryButton
              label="Sign in with password"
              busy={busy}
              disabled={!emailLooksValid || !passwordLooksValid || busy || !canSignIn}
              onPress={() => void submitPasswordLogin()}
            />

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
            {!isPremium ? <Text style={styles.trustLine}>We&apos;ll send an 8-digit code to verify your email</Text> : null}
            <AuthTextInput
              label="Email"
              placeholder="you@example.com"
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
            <PrimaryButton
              label="Send code"
              busy={busy}
              disabled={!emailLooksValid || busy || !canSignIn}
              onPress={() => void submitSignupSendCode()}
            />
            {showSendRetry ? (
              <Pressable style={styles.secondaryBtn} onPress={() => void submitSignupSendCode()}>
                <Text style={styles.secondaryBtnText}>Try again</Text>
              </Pressable>
            ) : null}
          </>
        ) : signupStage === "code" ? (
          <>
            <Text style={styles.trustLine}>Sent to {emailClean}</Text>
            <AuthTextInput
              label="8-digit code"
              placeholder="00000000"
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
            <PrimaryButton
              label="Verify"
              busy={busy}
              disabled={busy || !canSignIn}
              onPress={() => void verifySignupCode()}
            />
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
              <Text style={styles.textBtnLabelMuted}>Wrong email? Start over</Text>
            </Pressable>
          </>
        ) : signupStage === "password" && newHereOtpFlow ? (
          <>
            <Text style={styles.trustLine}>Set a password for faster sign-in next time</Text>
            <AuthTextInput
              label="Set a password"
              placeholder={`At least ${PASSWORD_MIN_LEN} characters`}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={() => void submitSignupPassword()}
            />
            <PrimaryButton
              label="Continue"
              busy={busy}
              disabled={!passwordLooksValid || busy || !canSignIn}
              onPress={() => void submitSignupPassword()}
            />
          </>
        ) : null}

        {msg ? <Text style={[styles.msg, styles.msgMuted]}>{msg}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panelRoot: { width: "100%" },
  brandHeader: {
    alignItems: "center",
    marginBottom: 28,
  },
  brandIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: "rgba(163,230,53,0.12)",
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.28)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    overflow: "hidden",
  },
  brandIcon: {
    width: 56,
    height: 56,
    borderRadius: 14,
  },
  brandTitle: {
    fontSize: 32,
    fontWeight: "900",
    color: "#fff",
    letterSpacing: -0.5,
  },
  brandTagline: {
    marginTop: 8,
    fontSize: 15,
    color: "rgba(255,255,255,0.45)",
    textAlign: "center",
  },
  sectionTitle: { marginTop: 28, fontSize: 18, fontWeight: "700", color: "#fff" },
  sectionAboveAuth: { marginTop: 20 },
  segmentRow: {
    flexDirection: "row",
    marginTop: 20,
    marginBottom: 4,
    padding: 4,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.04)",
    position: "relative",
    overflow: "hidden",
  },
  segmentRowPremium: {
    alignSelf: "center",
    width: "100%",
  },
  segmentIndicator: {
    position: "absolute",
    top: 4,
    bottom: 4,
    left: 0,
    borderRadius: 12,
    backgroundColor: LIME,
  },
  segmentTab: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  segmentTabText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },
  segmentTabTextActive: {
    color: "#0a0a0a",
    fontWeight: "900",
  },
  trustLine: {
    marginTop: 4,
    marginBottom: 12,
    fontSize: 13,
    color: "rgba(255,255,255,0.45)",
    lineHeight: 18,
  },
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
    marginTop: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
  },
  secondaryBtnText: { color: "#e5e5e5", fontWeight: "600", fontSize: 15 },
  card: {
    marginTop: 20,
    padding: 22,
    paddingLeft: 26,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderLeftWidth: 4,
    borderLeftColor: LIME,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  cardPremium: {
    padding: 24,
    paddingLeft: 28,
    borderRadius: 22,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.035)",
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: LIME,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 16,
    color: "#fff",
    backgroundColor: "#1a1a1a",
    marginBottom: 18,
  },
  fieldLabelSpaced: { marginTop: 4 },
  inputFocused: {
    borderColor: LIME,
    borderWidth: 1.5,
  },
  primaryBtn: {
    marginTop: 4,
    backgroundColor: LIME,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
  },
  primaryBtnRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 8,
  },
  primaryBtnText: { color: "#0a0a0a", fontWeight: "900", fontSize: 16 },
  bioBtn: {
    marginTop: 14,
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
  createAccountRow: { marginTop: 18, alignItems: "center" },
  createAccountText: { color: "rgba(255,255,255,0.75)", fontSize: 15, fontWeight: "500" },
  createAccountStrong: { color: "#fff", fontSize: 15, fontWeight: "700" },
  textBtn: { marginTop: 16, alignItems: "center" },
  textBtnLabelStrong: { color: LIME, fontSize: 14.5, fontWeight: "700" },
  textBtnLabelMuted: { color: "rgba(255,255,255,0.55)", fontSize: 14.5, fontWeight: "700" },
  msg: { marginTop: 16, color: "#fca5a5", fontSize: 14, textAlign: "center" },
  msgMuted: { color: "rgba(252,211,212,0.92)" },
});
