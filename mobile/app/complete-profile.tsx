import { useProfileCompletionGate } from "@/context/ProfileCompletionContext";
import { useAuth } from "@/context/AuthContext";
import { useWaiver } from "@/context/WaiverContext";
import { CT_PICKUP_LIME } from "@/constants/Colors";
import { Redirect, useRouter, type Href } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
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

const GENDER_OPTIONS = [
  { value: "male" as const, label: "Male" },
  { value: "female" as const, label: "Female" },
  { value: "other" as const, label: "Other" },
  { value: "prefer_not_to_say" as const, label: "Prefer not to say" },
];

const PLATFORM_OPTIONS = [
  { value: "ps5" as const, label: "PS5" },
  { value: "xbox" as const, label: "Xbox" },
  { value: "pc" as const, label: "PC" },
];

type GenderValue = (typeof GENDER_OPTIONS)[number]["value"];
type PlatformValue = (typeof PLATFORM_OPTIONS)[number]["value"];

type FieldKey =
  | "first_name"
  | "last_name"
  | "gender"
  | "playing_position"
  | "username"
  | "esports_interest"
  | "esports_platform"
  | "esports_console"
  | "esports_online_id";

function labelFor<T extends { value: string; label: string }>(options: readonly T[], value: string | null): string {
  if (!value) return "";
  return options.find((o) => o.value === value)?.label ?? value;
}

type SelectModalProps<T extends string> = {
  visible: boolean;
  title: string;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onSelect: (v: T) => void;
  onClose: () => void;
};

function SelectModal<T extends string>({ visible, title, options, value, onSelect, onClose }: SelectModalProps<T>) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} accessibilityLabel="Close picker" />
        <View style={styles.modalCardWrap} pointerEvents="box-none">
          <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{title}</Text>
          {options.map((opt) => {
            const selected = value === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => {
                  onSelect(opt.value);
                  onClose();
                }}
                style={({ pressed }) => [
                  styles.modalRow,
                  selected && styles.modalRowSelected,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text style={[styles.modalRowText, selected && styles.modalRowTextSelected]}>{opt.label}</Text>
              </Pressable>
            );
          })}
          <Pressable onPress={onClose} style={({ pressed }) => [styles.modalCancel, pressed && { opacity: 0.85 }]}>
            <Text style={styles.modalCancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </View>
    </Modal>
  );
}

export default function CompleteProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, supabase, isReady } = useAuth();
  const { waiverAccepted, waiverLoading } = useWaiver();
  const { refreshProfileCompletion, profileGateLoading, profileNeedsCompletion } = useProfileCompletionGate();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [gender, setGender] = useState<GenderValue | null>(null);
  const [playingPosition, setPlayingPosition] = useState("");
  const [username, setUsername] = useState("");
  const [esportsInterest, setEsportsInterest] = useState<boolean | null>(null);
  const [esportsPlatform, setEsportsPlatform] = useState<PlatformValue | null>(null);
  const [esportsConsole, setEsportsConsole] = useState("");
  const [esportsOnlineId, setEsportsOnlineId] = useState("");

  const [genderPickerOpen, setGenderPickerOpen] = useState(false);
  const [platformPickerOpen, setPlatformPickerOpen] = useState(false);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signedEmail = session?.user?.email ?? "";

  const canContinue = useMemo(() => {
    if (!firstName.trim() || !lastName.trim() || !gender || !playingPosition.trim() || !username.trim()) return false;
    if (esportsInterest === null) return false;
    if (esportsInterest === true) {
      if (!esportsPlatform || !esportsConsole.trim() || !esportsOnlineId.trim()) return false;
    }
    return true;
  }, [
    firstName,
    lastName,
    gender,
    playingPosition,
    username,
    esportsInterest,
    esportsPlatform,
    esportsConsole,
    esportsOnlineId,
  ]);

  const liveErrors = useMemo((): Partial<Record<FieldKey, string>> => {
    const e: Partial<Record<FieldKey, string>> = {};
    if (!firstName.trim()) e.first_name = "Required";
    if (!lastName.trim()) e.last_name = "Required";
    if (!gender) e.gender = "Required";
    if (!playingPosition.trim()) e.playing_position = "Required";
    if (!username.trim()) e.username = "Required";
    if (esportsInterest === null) e.esports_interest = "Required";
    if (esportsInterest === true) {
      if (!esportsPlatform) e.esports_platform = "Required";
      if (!esportsConsole.trim()) e.esports_console = "Required";
      if (!esportsOnlineId.trim()) e.esports_online_id = "Required";
    }
    return e;
  }, [
    firstName,
    lastName,
    gender,
    playingPosition,
    username,
    esportsInterest,
    esportsPlatform,
    esportsConsole,
    esportsOnlineId,
  ]);

  const onContinue = useCallback(async () => {
    setSubmitError(null);
    if (!canContinue) return;

    const fn = firstName.trim();
    const ln = lastName.trim();
    const pos = playingPosition.trim();
    const un = username.trim();
    const userId = session?.user?.id;

    if (!supabase || !userId) {
      setSubmitError("Session expired. Please sign in again.");
      return;
    }

    const esportsYes = esportsInterest === true;
    const payload: Record<string, unknown> = {
      first_name: fn,
      last_name: ln,
      gender,
      playing_position: pos,
      username: un,
      email: signedEmail,
      esports_interest: esportsYes ? "yes" : "no",
      updated_at: new Date().toISOString(),
    };

    if (esportsYes) {
      payload.esports_platform = esportsPlatform;
      payload.esports_console = esportsConsole.trim();
      payload.esports_online_id = esportsOnlineId.trim();
    } else {
      payload.esports_platform = null;
      payload.esports_console = null;
      payload.esports_online_id = null;
    }

    setBusy(true);
    const { error } = await supabase.from("profiles").update(payload).eq("id", userId);
    setBusy(false);

    if (error) {
      const code = (error as { code?: string }).code;
      const dup =
        code === "23505" ||
        /profiles_username_lower_unique|duplicate key/i.test(error.message ?? "");
      setSubmitError(dup ? "That username is already taken. Try another." : error.message);
      return;
    }

    refreshProfileCompletion();
    (router.replace as (href: string) => void)("/(tabs)");
  }, [
    canContinue,
    firstName,
    lastName,
    gender,
    playingPosition,
    username,
    esportsInterest,
    esportsPlatform,
    esportsConsole,
    esportsOnlineId,
    signedEmail,
    session?.user?.id,
    supabase,
    router,
    refreshProfileCompletion,
  ]);

  function setInterest(next: boolean) {
    setEsportsInterest(next);
    if (!next) {
      setEsportsPlatform(null);
      setEsportsConsole("");
      setEsportsOnlineId("");
    }
  }

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

  const btnLocked = !canContinue || busy;

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
              style={[styles.input, liveErrors.first_name ? styles.inputErr : null]}
              placeholder="First name"
              placeholderTextColor="rgba(255,255,255,0.35)"
              value={firstName}
              onChangeText={setFirstName}
              autoCapitalize="words"
              autoCorrect
            />
            {liveErrors.first_name ? <Text style={styles.errText}>{liveErrors.first_name}</Text> : null}
          </View>

          <View style={styles.fieldBlock}>
            <Text style={styles.label}>Last name</Text>
            <TextInput
              style={[styles.input, liveErrors.last_name ? styles.inputErr : null]}
              placeholder="Last name"
              placeholderTextColor="rgba(255,255,255,0.35)"
              value={lastName}
              onChangeText={setLastName}
              autoCapitalize="words"
              autoCorrect
            />
            {liveErrors.last_name ? <Text style={styles.errText}>{liveErrors.last_name}</Text> : null}
          </View>

          <View style={styles.fieldBlock}>
            <Text style={styles.label}>Email</Text>
            <View style={styles.readonlyBox}>
              <Text style={styles.readonlyText}>{signedEmail}</Text>
            </View>
          </View>

          <View style={styles.fieldBlock}>
            <Text style={styles.label}>Gender</Text>
            <Pressable
              onPress={() => setGenderPickerOpen(true)}
              style={[styles.input, styles.selectTrigger, liveErrors.gender ? styles.inputErr : null]}
            >
              <Text style={gender ? styles.selectValue : styles.selectPlaceholder}>
                {gender ? labelFor(GENDER_OPTIONS, gender) : "Choose…"}
              </Text>
              <Text style={styles.selectChevron}>▾</Text>
            </Pressable>
            {liveErrors.gender ? <Text style={styles.errText}>{liveErrors.gender}</Text> : null}
          </View>

          <View style={styles.fieldBlock}>
            <Text style={styles.label}>Playing position</Text>
            <TextInput
              style={[styles.input, liveErrors.playing_position ? styles.inputErr : null]}
              placeholder="e.g. CM, ST, CB"
              placeholderTextColor="rgba(255,255,255,0.35)"
              value={playingPosition}
              onChangeText={setPlayingPosition}
              autoCapitalize="words"
            />
            {liveErrors.playing_position ? <Text style={styles.errText}>{liveErrors.playing_position}</Text> : null}
          </View>

          <View style={styles.fieldBlock}>
            <Text style={styles.label}>Username</Text>
            <TextInput
              style={[styles.input, liveErrors.username ? styles.inputErr : null]}
              placeholder="Public handle"
              placeholderTextColor="rgba(255,255,255,0.35)"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {liveErrors.username ? <Text style={styles.errText}>{liveErrors.username}</Text> : null}
          </View>

          <View style={styles.fieldBlock}>
            <Text style={styles.label}>Esports interest</Text>
            <View style={styles.toggleRow}>
              <Pressable
                onPress={() => setInterest(true)}
                style={({ pressed }) => [
                  styles.toggleBtn,
                  esportsInterest === true && styles.toggleBtnOn,
                  pressed && { opacity: 0.88 },
                ]}
              >
                <Text style={[styles.toggleBtnText, esportsInterest === true && styles.toggleBtnTextOn]}>Yes</Text>
              </Pressable>
              <Pressable
                onPress={() => setInterest(false)}
                style={({ pressed }) => [
                  styles.toggleBtn,
                  esportsInterest === false && styles.toggleBtnOn,
                  pressed && { opacity: 0.88 },
                ]}
              >
                <Text style={[styles.toggleBtnText, esportsInterest === false && styles.toggleBtnTextOn]}>No</Text>
              </Pressable>
            </View>
            {liveErrors.esports_interest ? <Text style={styles.errText}>{liveErrors.esports_interest}</Text> : null}
          </View>

          {esportsInterest === true ? (
            <>
              <View style={styles.fieldBlock}>
                <Text style={styles.label}>Esports platform</Text>
                <Pressable
                  onPress={() => setPlatformPickerOpen(true)}
                  style={[styles.input, styles.selectTrigger, liveErrors.esports_platform ? styles.inputErr : null]}
                >
                  <Text style={esportsPlatform ? styles.selectValue : styles.selectPlaceholder}>
                    {esportsPlatform ? labelFor(PLATFORM_OPTIONS, esportsPlatform) : "Choose…"}
                  </Text>
                  <Text style={styles.selectChevron}>▾</Text>
                </Pressable>
                {liveErrors.esports_platform ? <Text style={styles.errText}>{liveErrors.esports_platform}</Text> : null}
              </View>

              <View style={styles.fieldBlock}>
                <Text style={styles.label}>Esports console</Text>
                <TextInput
                  style={[styles.input, liveErrors.esports_console ? styles.inputErr : null]}
                  placeholder="Console or hardware"
                  placeholderTextColor="rgba(255,255,255,0.35)"
                  value={esportsConsole}
                  onChangeText={setEsportsConsole}
                  autoCapitalize="sentences"
                />
                {liveErrors.esports_console ? <Text style={styles.errText}>{liveErrors.esports_console}</Text> : null}
              </View>

              <View style={styles.fieldBlock}>
                <Text style={styles.label}>Esports online ID</Text>
                <TextInput
                  style={[styles.input, liveErrors.esports_online_id ? styles.inputErr : null]}
                  placeholder="Gamertag, PSN ID, etc."
                  placeholderTextColor="rgba(255,255,255,0.35)"
                  value={esportsOnlineId}
                  onChangeText={setEsportsOnlineId}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {liveErrors.esports_online_id ? <Text style={styles.errText}>{liveErrors.esports_online_id}</Text> : null}
              </View>
            </>
          ) : null}

          <SelectModal<GenderValue>
            visible={genderPickerOpen}
            title="Gender"
            options={GENDER_OPTIONS}
            value={gender}
            onSelect={setGender}
            onClose={() => setGenderPickerOpen(false)}
          />
          <SelectModal<PlatformValue>
            visible={platformPickerOpen}
            title="Esports platform"
            options={PLATFORM_OPTIONS}
            value={esportsPlatform}
            onSelect={setEsportsPlatform}
            onClose={() => setPlatformPickerOpen(false)}
          />

          {submitError ? <Text style={styles.submitErr}>{submitError}</Text> : null}

          <Pressable
            style={[styles.primaryBtn, btnLocked && styles.primaryBtnDisabled]}
            onPress={() => void onContinue()}
            disabled={btnLocked}
          >
            {busy ? (
              <ActivityIndicator color="#111" />
            ) : (
              <Text style={[styles.primaryBtnText, btnLocked && styles.primaryBtnTextDisabled]}>Continue</Text>
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
  readonlyBox: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "rgba(0,0,0,0.22)",
  },
  readonlyText: {
    fontSize: 16,
    color: "rgba(255,255,255,0.45)",
  },
  selectTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  selectPlaceholder: {
    fontSize: 16,
    color: "rgba(255,255,255,0.35)",
  },
  selectValue: {
    fontSize: 16,
    color: "#fff",
  },
  selectChevron: {
    fontSize: 14,
    color: LIME,
    marginLeft: 8,
  },
  toggleRow: {
    marginTop: 10,
    flexDirection: "row",
    gap: 12,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  toggleBtnOn: {
    borderColor: LIME,
    backgroundColor: "rgba(163,230,53,0.12)",
  },
  toggleBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: "rgba(255,255,255,0.55)",
  },
  toggleBtnTextOn: {
    color: LIME,
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
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  primaryBtnText: {
    color: "#111",
    fontWeight: "800",
    fontSize: 16,
  },
  primaryBtnTextDisabled: {
    color: "rgba(255,255,255,0.35)",
  },
  modalRoot: {
    flex: 1,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.65)",
  },
  modalCardWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  modalCard: {
    backgroundColor: "#141414",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.25)",
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: LIME,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  modalRow: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginHorizontal: 4,
  },
  modalRowSelected: {
    backgroundColor: "rgba(163,230,53,0.12)",
  },
  modalRowText: {
    fontSize: 16,
    color: "rgba(255,255,255,0.85)",
  },
  modalRowTextSelected: {
    color: LIME,
    fontWeight: "700",
  },
  modalCancel: {
    marginTop: 4,
    paddingVertical: 14,
    alignItems: "center",
  },
  modalCancelText: {
    fontSize: 15,
    fontWeight: "600",
    color: "rgba(255,255,255,0.45)",
  },
});
