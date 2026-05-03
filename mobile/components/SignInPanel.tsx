import { useAuth } from "@/context/AuthContext";
import { hasSupabaseEnv, siteOrigin } from "@/lib/env";
import { checkEmailExistsResult } from "@/lib/siteApi";
import { useEffect, useMemo, useState } from "react";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import {
  ActivityIndicator,
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

type OtpFlow = "login" | "signup";

const PANEL_ANIM_MS = 420;

type Props = {
  /** Hide the “Sign in” section label (e.g. login screen has its own headline). */
  hideHeading?: boolean;
  /** A simpler login panel (no Returning/New segmented control). */
  variant?: "segmented" | "simple" | "premium";
};

export function SignInPanel({ hideHeading, variant = "segmented" }: Props) {
  const { supabase } = useAuth();

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [signupFlowChoice, setSignupFlowChoice] = useState<"returning" | "new">("returning");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showSendRetry, setShowSendRetry] = useState(false);
  const [resendCooldownSec, setResendCooldownSec] = useState(0);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    if (UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

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

  useEffect(() => {
    if (signupFlowChoice !== "new") return;
    animatePanel();
    setStage("email");
    setCode("");
    setResendCooldownSec(0);
    setMsg(null);
    setShowSendRetry(false);
  }, [signupFlowChoice]);

  function clearAuthHints() {
    setShowSendRetry(false);
  }

  function goWrongEmailStep() {
    animatePanel();
    setStage("email");
    setCode("");
    setResendCooldownSec(0);
    setMsg(null);
    clearAuthHints();
  }

  const emailLooksValid = useMemo(() => {
    if (emailClean.length < 6) return false;
    if (!emailClean.includes("@")) return false;
    const [a, b] = emailClean.split("@");
    if (!a || !b) return false;
    if (!b.includes(".")) return false;
    return true;
  }, [emailClean]);

  async function postSignInOtp(skipExistsGate: boolean, _flow: OtpFlow): Promise<boolean> {
    if (!supabase) return false;
    const { error } = await supabase.auth.signInWithOtp({
      email: emailClean,
    });
    if (error) {
      setMsg(error.message);
      return false;
    }
    if (!skipExistsGate) {
      animatePanel();
      setStage("code");
    }
    setResendCooldownSec(OTP_RESEND_COOLDOWN_SEC);
    setMsg(null);
    clearAuthHints();
    return true;
  }

  async function submitSendCode() {
    if (!emailLooksValid || busy || !supabase) {
      if (!emailLooksValid) setMsg("Enter a valid email address.");
      return;
    }
    setBusy(true);
    setMsg(null);
    clearAuthHints();
    const existsResult = await checkEmailExistsResult(emailClean);
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

    const isReturning = signupFlowChoice === "returning";
    if (isReturning && !existsResult.exists) {
      setBusy(false);
      setMsg('No account for this email yet. Tap "New here?" above to create one with an email code — all in this app.');
      return;
    }
    if (!isReturning && existsResult.exists) {
      setBusy(false);
      setMsg('This email already has an account. Tap "Returning" above and sign in.');
      return;
    }

    const flow: OtpFlow = isReturning ? "login" : "signup";
    const ok = await postSignInOtp(false, flow);
    setBusy(false);
    if (!ok) return;
  }

  async function resendCode() {
    if (busy || resendCooldownSec > 0 || !supabase) return;
    setBusy(true);
    setMsg(null);
    clearAuthHints();
    const flow: OtpFlow = signupFlowChoice === "new" ? "signup" : "login";
    const ok = await postSignInOtp(true, flow);
    setBusy(false);
    if (ok) {
      setMsg("We sent a new code.");
    }
  }

  async function verifyCode() {
    if (!code.trim() || busy || !supabase) return;
    setBusy(true);
    setMsg(null);
    const token = code.replace(/\D/g, "");
    if (token.length !== 8) {
      setBusy(false);
      setMsg("Enter the 8-digit code from your email.");
      return;
    }
    const { error } = await supabase.auth.verifyOtp({
      email: emailClean,
      token,
      type: "email",
    });
    setBusy(false);
    if (error) {
      setMsg(error.message);
      return;
    }
    animatePanel();
    setStage("email");
    setCode("");
    setEmail("");
    setResendCooldownSec(0);
    clearAuthHints();
  }

  function selectReturning(fromSegment = false) {
    if (signupFlowChoice !== "returning" || fromSegment) animatePanel();
    setSignupFlowChoice("returning");
    if (stage === "code" || fromSegment) {
      goWrongEmailStep();
    } else {
      setMsg(null);
      clearAuthHints();
    }
  }

  return (
    <>
      {!hideHeading ? <Text style={[styles.sectionTitle, styles.sectionAboveAuth]}>Sign in</Text> : null}
      {variant === "segmented" || variant === "premium" ? (
        <View style={styles.segmentRow}>
          <Pressable
            accessibilityRole="button"
            style={[styles.segmentChip, signupFlowChoice === "returning" && styles.segmentChipActive]}
            onPress={() => selectReturning(true)}
          >
            <Text style={[styles.segmentChipText, signupFlowChoice === "returning" && styles.segmentChipTextActive]}>Returning</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={[styles.segmentChip, signupFlowChoice === "new" && styles.segmentChipActive]}
            onPress={() => {
              animatePanel();
              setSignupFlowChoice("new");
              setMsg(null);
              clearAuthHints();
            }}
          >
            <Text style={[styles.segmentChipText, signupFlowChoice === "new" && styles.segmentChipTextActive]}>New here?</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={[styles.card, variant === "premium" && styles.cardPremium]}>
        {signupFlowChoice === "new" && variant === "segmented" ? (
          <Text style={styles.mutedP}>
            We&apos;ll email you a code to create your account without leaving the app. You can finish profile details from another
            CT Pickup client when you&apos;re ready.
          </Text>
        ) : null}

        {!canSignIn ? (
          <View style={styles.configBox}>
            <Text style={styles.configBoxTitle}>Sign-in isn&apos;t wired on this build yet</Text>
            <Text style={styles.configBoxBody}>Copy from the Next.js app:</Text>
            <Text style={styles.configMono}>EXPO_PUBLIC_SUPABASE_URL{"\n"}EXPO_PUBLIC_SUPABASE_ANON_KEY</Text>
            <Text style={styles.configBoxBody}>into mobile/.env, restart Expo Go or rebuild.</Text>
          </View>
        ) : null}
        {!siteOk ? (
          <View style={[styles.configBox, styles.configBoxYellow]}>
            <Text style={styles.configBody}>Add EXPO_PUBLIC_SITE_URL (your deployed site URL) so we can send login codes.</Text>
          </View>
        ) : null}

        {variant === "segmented" ? <Text style={styles.stepSubtitle}>{stage === "email" ? "Step 1 of 2" : "Step 2 of 2"}</Text> : null}
        {stage === "email" ? (
          <>
            {variant === "premium" ? (
              <View style={styles.premiumFieldLabelRow}>
                <FontAwesome name="envelope-o" size={14} color="rgba(255,255,255,0.55)" />
                <Text style={styles.premiumFieldLabel}>Email</Text>
              </View>
            ) : (
              <Text style={styles.fieldLabel}>Email</Text>
            )}
            {variant === "segmented" ? (
              <Text style={styles.trustLine}>
                {signupFlowChoice === "new"
                  ? "We'll send an 8-digit code to verify and start your account (no SMS)."
                  : "We'll send a one-time login code (no SMS)."}
              </Text>
            ) : null}
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
              onPress={() => void submitSendCode()}
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
            {variant === "simple" ? (
              <Pressable
                style={styles.createAccountRow}
                onPress={() => {
                  animatePanel();
                  setSignupFlowChoice("new");
                  setMsg(null);
                  clearAuthHints();
                }}
              >
                <Text style={styles.createAccountText}>
                  New to CT Pickup? <Text style={styles.createAccountStrong}>Create an account</Text>
                </Text>
              </Pressable>
            ) : null}
            {showSendRetry ? (
              <Pressable style={styles.secondaryBtn} onPress={() => void submitSendCode()}>
                <Text style={styles.secondaryBtnText}>Try again</Text>
              </Pressable>
            ) : null}

            {variant === "premium" ? (
              <View style={styles.premiumMetaRow}>
                <View style={styles.premiumMetaItem}>
                  <FontAwesome name="shield" size={12} color="rgba(255,255,255,0.35)" />
                  <Text style={styles.premiumMetaText}>Verified runs</Text>
                </View>
                <View style={styles.premiumMetaItem}>
                  <FontAwesome name="graduation-cap" size={12} color="rgba(255,255,255,0.35)" />
                  <Text style={styles.premiumMetaText}>College players</Text>
                </View>
                <View style={styles.premiumMetaItem}>
                  <FontAwesome name="trophy" size={12} color="rgba(255,255,255,0.35)" />
                  <Text style={styles.premiumMetaText}>Competitive pickup</Text>
                </View>
              </View>
            ) : null}
          </>
        ) : (
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
            />
            <Pressable style={[styles.primaryBtn, busy && styles.disabled]} disabled={busy || !canSignIn} onPress={() => void verifyCode()}>
              {busy ? <ActivityIndicator color="#111" /> : <Text style={styles.primaryBtnText}>Verify</Text>}
            </Pressable>
            <Pressable
              style={[styles.secondaryBtn, (busy || resendCooldownSec > 0 || !canSignIn) && styles.disabled]}
              disabled={busy || resendCooldownSec > 0 || !canSignIn}
              onPress={() => void resendCode()}
            >
              <Text style={styles.secondaryBtnText}>
                {resendCooldownSec > 0 ? `Resend code (${resendCooldownSec}s)` : "Resend code"}
              </Text>
            </Pressable>
            <Pressable style={styles.textBtn} onPress={() => goWrongEmailStep()}>
              <Text style={styles.textBtnLabelStrong}>Wrong email? Start over</Text>
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
  segmentChipText: { color: "rgba(255,255,255,0.62)", fontSize: 14.5, fontWeight: "700" },
  segmentChipTextActive: { color: "#fff" },
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
  premiumFieldLabelRow: { flexDirection: "row", alignItems: "center", gap: 10 },
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
  disabled: { opacity: 0.5 },
  createAccountRow: { marginTop: 14, alignItems: "center" },
  createAccountText: { color: "rgba(255,255,255,0.75)", fontSize: 15, fontWeight: "500" },
  createAccountStrong: { color: "#fff", fontSize: 15, fontWeight: "700" },
  textBtn: { marginTop: 12, alignItems: "center" },
  textBtnLabelStrong: { color: "rgba(255,255,255,0.65)", fontSize: 14.5, fontWeight: "700" },
  msg: { marginTop: 14, color: "#fca5a5", fontSize: 14 },
  msgMuted: { color: "rgba(252,211,212,0.92)" },
  premiumMetaRow: {
    marginTop: 18,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  premiumMetaItem: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
  premiumMetaText: { color: "rgba(255,255,255,0.42)", fontSize: 12.5, fontWeight: "700" },
});
