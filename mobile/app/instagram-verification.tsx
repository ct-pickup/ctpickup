import FontAwesome from "@expo/vector-icons/FontAwesome";
import * as Clipboard from "expo-clipboard";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { useAuth } from "@/context/AuthContext";
import { INSTAGRAM_VERIFICATION_HANDLE } from "@/lib/brand";
import { fetchInstagramVerification, requestInstagramCode, setShowInstagram } from "@/lib/instagramVerifyApi";
import { headline, themeColor, useThemedStyles } from "@/theme";
import {
  INSTAGRAM_HANDLE_MAX,
  instagramProfileUrls,
  normalizeInstagramHandle,
  verificationDmInstruction,
  type InstagramVerificationState,
} from "@shared/instagramVerification";

const DM_URLS = instagramProfileUrls(INSTAGRAM_VERIFICATION_HANDLE);

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

async function openVerificationInstagram() {
  try {
    await Linking.openURL(DM_URLS.app);
  } catch {
    await Linking.openURL(DM_URLS.web).catch(() => undefined);
  }
}

export default function InstagramVerificationScreen() {
  useThemedStyles(publish_s);
  const { session } = useAuth();
  const token = session?.access_token ?? null;

  const [state, setState] = useState<InstagramVerificationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [handleInput, setHandleInput] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [toggleBusy, setToggleBusy] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const res = await fetchInstagramVerification(token);
    if (res.ok) {
      setState(res.data);
      setLoadError(null);
    } else {
      setLoadError(res.error);
    }
    setLoading(false);
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function submit() {
    if (!token || busy) return;
    const handle = normalizeInstagramHandle(handleInput);
    if (!handle) {
      setFormError("Use letters, numbers, periods and underscores, up to 30 characters.");
      return;
    }
    setBusy(true);
    setFormError(null);
    const res = await requestInstagramCode(token, handle);
    setBusy(false);
    if (res.ok) {
      setState(res.data);
      setRetrying(false);
      setCopied(false);
    } else if (res.status === 409) {
      setFormError(res.error);
      void load();
    } else {
      setFormError(res.error);
    }
  }

  async function copyCode(code: string) {
    await Clipboard.setStringAsync(code);
    setCopied(true);
  }

  async function toggleShow(next: boolean) {
    if (!token || toggleBusy) return;
    setToggleBusy(true);
    setToggleError(null);
    const res = await setShowInstagram(token, next);
    setToggleBusy(false);
    if (res.ok) setState((s) => (s ? { ...s, show_instagram: res.data.show_instagram } : s));
    else setToggleError(res.error);
  }

  if (loading && !state && !loadError) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={themeColor().pitchText} />
      </View>
    );
  }

  if (!state) {
    return (
      <View style={s.center}>
        <Text style={s.body}>{loadError ?? "Couldn't load verification."}</Text>
        <Pressable onPress={() => void load()} style={s.secondaryBtn}>
          <Text style={s.secondaryBtnText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  const showForm =
    !state.verified &&
    !state.verified_other &&
    (state.status === "none" || state.status === "expired" || (state.status === "rejected" && retrying));

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={s.title}>Verify with Instagram</Text>
        <Text style={s.body}>
          Send us a DM from your Instagram account to confirm it’s you. Your handle stays private unless you choose to show it.
        </Text>

        {state.verified_other ? (
          <View style={s.card}>
            <Text style={s.cardTitle}>Verified</Text>
            <Text style={s.body}>Your profile is already verified.</Text>
          </View>
        ) : null}

        {state.verified ? (
          <View style={s.card}>
            <View style={s.statusRow}>
              <FontAwesome name="check-circle" size={18} color={themeColor().pitchText} />
              <Text style={s.cardTitle}>Verified</Text>
            </View>
            {state.handle ? <Text style={s.body}>@{state.handle}</Text> : null}
            <View style={s.toggleRow}>
              <Text style={s.toggleLabel}>Show Instagram on my profile</Text>
              <Switch
                value={state.show_instagram}
                onValueChange={(v) => void toggleShow(v)}
                disabled={toggleBusy}
                trackColor={{ false: themeColor().overlayStrong, true: themeColor().pitch }}
                thumbColor={themeColor().text}
              />
            </View>
            {toggleError ? <Text style={s.error}>{toggleError}</Text> : null}
          </View>
        ) : null}

        {!state.verified && state.status === "pending" ? (
          <View style={s.card}>
            <View style={s.statusRow}>
              <FontAwesome name="clock-o" size={18} color={themeColor().muted} />
              <Text style={s.cardTitle}>Pending review</Text>
            </View>
            {state.code ? (
              <>
                <Text style={s.body} selectable>
                  {verificationDmInstruction(INSTAGRAM_VERIFICATION_HANDLE, state.handle ?? "", state.code)}
                </Text>
                <Text style={s.code} selectable>
                  {state.code}
                </Text>
                <View style={s.actions}>
                  <Pressable onPress={() => void openVerificationInstagram()} style={s.primaryBtn}>
                    <FontAwesome name="instagram" size={16} color={themeColor().onPitch} />
                    <Text style={s.primaryBtnText}>Open Instagram</Text>
                  </Pressable>
                  <Pressable onPress={() => void copyCode(state.code!)} style={s.secondaryBtn}>
                    <Text style={s.secondaryBtnText}>{copied ? "Copied" : "Copy code"}</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <Text style={s.muted}>Your code couldn’t be shown. Contact support if this keeps happening.</Text>
            )}
            {formatDate(state.expires_at) ? (
              <Text style={s.muted}>The code works until {formatDate(state.expires_at)}. We’ll review it after your DM arrives.</Text>
            ) : null}
          </View>
        ) : null}

        {!state.verified && state.status === "rejected" && !retrying ? (
          <View style={s.card}>
            <View style={s.statusRow}>
              <FontAwesome name="times-circle" size={18} color={themeColor().coralText} />
              <Text style={s.cardTitle}>Not approved</Text>
            </View>
            {state.reject_reason ? <Text style={s.body}>{state.reject_reason}</Text> : null}
            <Pressable
              onPress={() => {
                setRetrying(true);
                setHandleInput(state.handle ?? "");
              }}
              style={s.primaryBtn}
            >
              <Text style={s.primaryBtnText}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        {showForm ? (
          <View style={s.card}>
            {state.status === "expired" ? <Text style={s.muted}>Your last code expired. Request a new one.</Text> : null}
            <Text style={s.label}>Instagram username</Text>
            <TextInput
              value={handleInput}
              onChangeText={setHandleInput}
              placeholder="@yourhandle"
              placeholderTextColor={themeColor().muted}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={INSTAGRAM_HANDLE_MAX + 1}
              style={s.input}
              editable={!busy}
              onSubmitEditing={() => void submit()}
            />
            {formError ? <Text style={s.error}>{formError}</Text> : null}
            <Pressable onPress={() => void submit()} disabled={busy} style={[s.primaryBtn, busy && s.disabled]}>
              {busy ? (
                <ActivityIndicator color={themeColor().onPitch} />
              ) : (
                <Text style={s.primaryBtnText}>Get my code</Text>
              )}
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function make_s() {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: themeColor().bg },
    content: { padding: 20, paddingBottom: 60, gap: 16 },
    center: { flex: 1, backgroundColor: themeColor().bg, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
    title: { color: themeColor().text, fontSize: 24, ...headline },
    body: { color: themeColor().text, fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 21 },
    muted: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
    card: {
      backgroundColor: themeColor().card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: themeColor().line,
      padding: 16,
      gap: 12,
    },
    statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    cardTitle: { color: themeColor().text, fontSize: 17, fontFamily: "Inter_700Bold", fontWeight: "700" },
    code: { color: themeColor().text, fontSize: 30, ...headline, textAlign: "center", paddingVertical: 8 },
    actions: { flexDirection: "row", gap: 8 },
    primaryBtn: {
      flex: 1,
      flexDirection: "row",
      gap: 8,
      paddingVertical: 12,
      borderRadius: 10,
      backgroundColor: themeColor().pitch,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryBtnText: { color: themeColor().onPitch, fontSize: 15, fontFamily: "Inter_700Bold", fontWeight: "700" },
    secondaryBtn: {
      flex: 1,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: themeColor().line,
      alignItems: "center",
      justifyContent: "center",
    },
    secondaryBtnText: { color: themeColor().text, fontSize: 15, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    label: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    input: {
      borderWidth: 1,
      borderColor: themeColor().line,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: themeColor().text,
      fontSize: 16,
      fontFamily: "Inter_400Regular",
      backgroundColor: themeColor().bg,
    },
    error: { color: themeColor().coralText, fontSize: 13, fontFamily: "Inter_500Medium" },
    toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
    toggleLabel: { flex: 1, color: themeColor().text, fontSize: 15, fontFamily: "Inter_500Medium", fontWeight: "500" },
    disabled: { opacity: 0.6 },
  });
}
let s = make_s();
function publish_s() {
  s = make_s();
}
