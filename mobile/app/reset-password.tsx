import { useAuth } from "@/context/AuthContext";
import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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

type RecoveryParams = {
  type?: string;
  access_token?: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
};

function parseRecoveryParams(url: string): RecoveryParams {
  // Supabase commonly returns tokens in the URL hash fragment, not the querystring.
  const out: RecoveryParams = {};
  const [beforeHash, hashPartRaw] = url.split("#");
  const queryPart = beforeHash.split("?")[1] ?? "";
  const hashPart = hashPartRaw ?? "";

  function fillFrom(part: string) {
    if (!part) return;
    const s = part.startsWith("?") ? part.slice(1) : part;
    const params = new URLSearchParams(s);
    for (const [k, v] of params.entries()) {
      (out as any)[k] = v;
    }
  }

  fillFrom(queryPart);
  fillFrom(hashPart);
  return out;
}

export default function ResetPasswordScreen() {
  const { supabase } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { email: emailFromQuery } = useLocalSearchParams<{ email?: string }>();

  const [mode, setMode] = useState<"request" | "set">("request");
  const [email, setEmail] = useState(typeof emailFromQuery === "string" ? emailFromQuery : "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [recoveryReady, setRecoveryReady] = useState(false);

  const emailClean = useMemo(() => email.trim().toLowerCase(), [email]);
  const emailLooksValid = useMemo(() => {
    if (emailClean.length < 6) return false;
    if (!emailClean.includes("@")) return false;
    const [a, b] = emailClean.split("@");
    if (!a || !b) return false;
    if (!b.includes(".")) return false;
    return true;
  }, [emailClean]);

  useEffect(() => {
    let sub: { remove: () => void } | null = null;

    async function handleUrl(url: string) {
      const p = parseRecoveryParams(url);
      if (p.error_description) {
        setMsg(p.error_description);
      }
      if (p.type !== "recovery") return;
      if (!p.access_token || !p.refresh_token) return;
      if (!supabase) {
        setMsg("Auth isn’t configured on this build yet.");
        return;
      }

      setBusy(true);
      setMsg(null);
      try {
        const { error } = await supabase.auth.setSession({
          access_token: p.access_token,
          refresh_token: p.refresh_token,
        });
        if (error) {
          setMsg(error.message);
          return;
        }
        setMode("set");
        setRecoveryReady(true);
      } finally {
        setBusy(false);
      }
    }

    void (async () => {
      const initial = await Linking.getInitialURL();
      if (initial) await handleUrl(initial);
    })();

    sub = Linking.addEventListener("url", (ev) => {
      void handleUrl(ev.url);
    });

    return () => {
      sub?.remove();
    };
  }, [supabase]);

  async function sendResetEmail() {
    if (!supabase) {
      setMsg("Auth isn’t configured on this build yet.");
      return;
    }
    if (!emailLooksValid || busy) {
      if (!emailLooksValid) setMsg("Enter a valid email address.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const redirectTo = Linking.createURL("reset-password");
      const { error } = await supabase.auth.resetPasswordForEmail(emailClean, { redirectTo });
      if (error) {
        setMsg(error.message);
        return;
      }
      setMsg("Check your email for the reset link.");
    } finally {
      setBusy(false);
    }
  }

  async function submitNewPassword() {
    if (!supabase) return;
    if (busy) return;
    if (!recoveryReady) {
      setMsg("Open the password reset link from your email on this device.");
      return;
    }
    if (password.length < 8) {
      setMsg("Password must be at least 8 characters.");
      return;
    }
    if (password !== password2) {
      setMsg("Passwords do not match.");
      return;
    }

    setBusy(true);
    setMsg(null);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setMsg(error.message);
        return;
      }
      setMsg("Password updated. You can return to sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top, 16) + 10, paddingBottom: Math.max(insets.bottom, 16) + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>{mode === "set" ? "Set a new password" : "Reset password"}</Text>
        <Text style={styles.lead}>
          {mode === "set"
            ? "Choose a new password for your account."
            : "We’ll email you a link. Open it on this device to set a new password."}
        </Text>

        <View style={styles.card}>
          {mode === "request" ? (
            <>
              <Text style={styles.fieldLabel}>Email</Text>
              <TextInput
                style={styles.input}
                placeholder="you@example.com"
                placeholderTextColor="rgba(255,255,255,0.35)"
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
              />

              <Pressable
                style={[styles.primaryBtn, (!emailLooksValid || busy) && styles.disabled]}
                disabled={!emailLooksValid || busy}
                onPress={() => void sendResetEmail()}
              >
                {busy ? <ActivityIndicator color="#0a0a0a" /> : <Text style={styles.primaryBtnText}>Send reset link</Text>}
              </Pressable>

              <Pressable style={styles.textBtn} onPress={() => router.back()}>
                <Text style={styles.textBtnLabel}>Back to sign in</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.fieldLabel}>New password</Text>
              <TextInput
                style={styles.input}
                placeholder="At least 8 characters"
                placeholderTextColor="rgba(255,255,255,0.35)"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />

              <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Confirm password</Text>
              <TextInput
                style={styles.input}
                placeholder="Re-enter password"
                placeholderTextColor="rgba(255,255,255,0.35)"
                secureTextEntry
                value={password2}
                onChangeText={setPassword2}
              />

              <Pressable style={[styles.primaryBtn, busy && styles.disabled]} disabled={busy} onPress={() => void submitNewPassword()}>
                {busy ? <ActivityIndicator color="#0a0a0a" /> : <Text style={styles.primaryBtnText}>Update password</Text>}
              </Pressable>

              <Pressable style={styles.textBtn} onPress={() => router.replace("/login")}>
                <Text style={styles.textBtnLabel}>Go to sign in</Text>
              </Pressable>
            </>
          )}

          {msg ? <Text style={styles.msg}>{msg}</Text> : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0a0a0a" },
  content: { paddingHorizontal: 20 },
  title: { fontSize: 32, fontWeight: "900", color: "#fff", letterSpacing: -0.6, lineHeight: 36 },
  lead: { marginTop: 10, color: "rgba(255,255,255,0.62)", fontSize: 15.5, lineHeight: 22 },
  card: {
    marginTop: 18,
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: "rgba(255,255,255,0.55)" },
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
    marginTop: 16,
    backgroundColor: "#a3e635",
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: "center",
  },
  primaryBtnText: { color: "#0a0a0a", fontWeight: "900", fontSize: 16 },
  disabled: { opacity: 0.5 },
  textBtn: { marginTop: 14, alignItems: "center" },
  textBtnLabel: { color: "rgba(255,255,255,0.65)", fontSize: 14.5, fontWeight: "700" },
  msg: { marginTop: 14, color: "rgba(252,211,212,0.92)", fontSize: 14, lineHeight: 20 },
});

