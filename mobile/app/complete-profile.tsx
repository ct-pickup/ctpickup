import { useProfileCompletionGate } from "@/context/ProfileCompletionContext";
import { useAuth } from "@/context/AuthContext";
import { useWaiver } from "@/context/WaiverContext";
import { CT_PICKUP_LIME } from "@/constants/Colors";
import { Redirect, useRouter, type Href } from "expo-router";
import { useCallback, useState } from "react";
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

const BG = "#0a0a0a";
const LIME = CT_PICKUP_LIME;

function cleanInstagram(s: string): string {
  return s.trim().replace(/^@/, "").replace(/\s+/g, "");
}

type FieldKey = "first_name" | "last_name" | "playing_position" | "instagram" | "phone";

export default function CompleteProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, supabase, isReady } = useAuth();
  const { waiverAccepted, waiverLoading } = useWaiver();
  const { refreshProfileCompletion, profileGateLoading, profileNeedsCompletion } = useProfileCompletionGate();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [playingPosition, setPlayingPosition] = useState("");
  const [instagram, setInstagram] = useState("");
  const [phone, setPhone] = useState("");
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onContinue = useCallback(async () => {
    setSubmitError(null);
    const fn = firstName.trim();
    const ln = lastName.trim();
    const pos = playingPosition.trim();
    const ig = cleanInstagram(instagram);
    const ph = phone.trim();

    const nextErrors: Partial<Record<FieldKey, string>> = {};
    if (!fn) nextErrors.first_name = "Required";
    if (!ln) nextErrors.last_name = "Required";
    if (!pos) nextErrors.playing_position = "Required";
    if (!ig) nextErrors.instagram = "Required";
    if (!ph) nextErrors.phone = "Required";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const userId = session?.user?.id;
    if (!supabase || !userId) {
      setSubmitError("Session expired. Please sign in again.");
      return;
    }

    setBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        first_name: fn,
        last_name: ln,
        playing_position: pos,
        instagram: ig,
        phone: ph,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);
    setBusy(false);

    if (error) {
      setSubmitError(error.message);
      return;
    }

    refreshProfileCompletion();
    (router.replace as (href: string) => void)("/(tabs)");
  }, [
    firstName,
    lastName,
    playingPosition,
    instagram,
    phone,
    session?.user?.id,
    supabase,
    router,
    refreshProfileCompletion,
  ]);

  if (!isReady) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  if (!session?.user?.email) {
    return <Redirect href="/login" />;
  }

  if (waiverLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  if (!waiverAccepted) {
    return <Redirect href="/waiver" />;
  }

  if (profileGateLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  if (!profileNeedsCompletion) {
    return <Redirect href={"/(tabs)" as Href} />;
  }

  return (
    <View style={styles.screen}>
      <View pointerEvents="none" style={styles.bgGlowA} />
      <View pointerEvents="none" style={styles.bgGlowB} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.content,
            {
              paddingTop: Math.max(insets.top, 16) + 12,
              paddingBottom: Math.max(insets.bottom, 24) + 24,
            },
          ]}
        >
          <Text style={styles.title}>Complete your profile</Text>
          <Text style={styles.subtitle}>We need a few details before you get started.</Text>

          <View style={styles.fieldBlock}>
            <Text style={styles.label}>First name</Text>
            <TextInput
              style={[styles.input, errors.first_name ? styles.inputErr : null]}
              placeholder="First name"
              placeholderTextColor="rgba(255,255,255,0.35)"
              value={firstName}
              onChangeText={(t) => {
                setFirstName(t);
                setErrors((e) => ({ ...e, first_name: undefined }));
              }}
              autoCapitalize="words"
              autoCorrect
            />
            {errors.first_name ? <Text style={styles.errText}>{errors.first_name}</Text> : null}
          </View>

          <View style={styles.fieldBlock}>
            <Text style={styles.label}>Last name</Text>
            <TextInput
              style={[styles.input, errors.last_name ? styles.inputErr : null]}
              placeholder="Last name"
              placeholderTextColor="rgba(255,255,255,0.35)"
              value={lastName}
              onChangeText={(t) => {
                setLastName(t);
                setErrors((e) => ({ ...e, last_name: undefined }));
              }}
              autoCapitalize="words"
              autoCorrect
            />
            {errors.last_name ? <Text style={styles.errText}>{errors.last_name}</Text> : null}
          </View>

          <View style={styles.fieldBlock}>
            <Text style={styles.label}>Playing position</Text>
            <TextInput
              style={[styles.input, errors.playing_position ? styles.inputErr : null]}
              placeholder="e.g. CM, ST, CB"
              placeholderTextColor="rgba(255,255,255,0.35)"
              value={playingPosition}
              onChangeText={(t) => {
                setPlayingPosition(t);
                setErrors((e) => ({ ...e, playing_position: undefined }));
              }}
              autoCapitalize="words"
            />
            {errors.playing_position ? <Text style={styles.errText}>{errors.playing_position}</Text> : null}
          </View>

          <View style={styles.fieldBlock}>
            <Text style={styles.label}>Instagram handle</Text>
            <TextInput
              style={[styles.input, errors.instagram ? styles.inputErr : null]}
              placeholder="@yourhandle"
              placeholderTextColor="rgba(255,255,255,0.35)"
              value={instagram}
              onChangeText={(t) => {
                setInstagram(t);
                setErrors((e) => ({ ...e, instagram: undefined }));
              }}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {errors.instagram ? <Text style={styles.errText}>{errors.instagram}</Text> : null}
          </View>

          <View style={styles.fieldBlock}>
            <Text style={styles.label}>Phone number</Text>
            <TextInput
              style={[styles.input, errors.phone ? styles.inputErr : null]}
              placeholder="Mobile number"
              placeholderTextColor="rgba(255,255,255,0.35)"
              value={phone}
              onChangeText={(t) => {
                setPhone(t);
                setErrors((e) => ({ ...e, phone: undefined }));
              }}
              keyboardType="phone-pad"
              autoCorrect={false}
            />
            {errors.phone ? <Text style={styles.errText}>{errors.phone}</Text> : null}
          </View>

          {submitError ? <Text style={styles.submitErr}>{submitError}</Text> : null}

          <Pressable
            style={[styles.primaryBtn, busy && styles.primaryBtnDisabled]}
            onPress={() => void onContinue()}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color="#111" />
            ) : (
              <Text style={styles.primaryBtnText}>Continue</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: BG },
  center: { flex: 1, backgroundColor: BG, justifyContent: "center", alignItems: "center" },
  bgGlowA: {
    position: "absolute",
    top: -200,
    left: -140,
    width: 380,
    height: 380,
    borderRadius: 380,
    backgroundColor: "rgba(163,230,53,0.10)",
  },
  bgGlowB: {
    position: "absolute",
    bottom: -240,
    right: -200,
    width: 480,
    height: 480,
    borderRadius: 480,
    backgroundColor: "rgba(163,230,53,0.06)",
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 22,
    maxWidth: 440,
    width: "100%",
    alignSelf: "center",
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: 0.2,
  },
  subtitle: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 22,
    color: "rgba(255,255,255,0.62)",
  },
  fieldBlock: {
    marginTop: 18,
  },
  label: {
    fontSize: 13,
    fontWeight: "700",
    color: "rgba(255,255,255,0.55)",
  },
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
  inputErr: {
    borderColor: "rgba(252,165,165,0.65)",
  },
  errText: {
    marginTop: 6,
    fontSize: 13,
    color: "#fca5a5",
  },
  submitErr: {
    marginTop: 16,
    fontSize: 14,
    color: "#fca5a5",
    lineHeight: 20,
  },
  primaryBtn: {
    marginTop: 28,
    backgroundColor: LIME,
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryBtnDisabled: {
    opacity: 0.65,
  },
  primaryBtnText: {
    color: "#111",
    fontWeight: "800",
    fontSize: 16,
  },
});
