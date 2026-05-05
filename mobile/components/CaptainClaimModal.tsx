import { postTournamentCaptainSubmitClaim, postTournamentConsent } from "@/lib/siteApi";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

const LIME = "#a3e635";

const REFUND_NOTICE =
  "Tournament entry fees are non-refundable unless you request a refund more than 48 hours before the tournament begins. If your refund request is made within 48 hours of the tournament start time, no refund is issued. If the Organizer cancels the tournament before play begins, entry fees are refunded. Verified duplicate or erroneous charges will be corrected.";

type Step = "rules" | "form" | "success";

type PrelimEntry = { fullName: string; instagram: string };

type Props = {
  visible: boolean;
  accessToken: string | null;
  onClose: () => void;
  onClaimRecorded?: () => void;
  onProceedToPay: () => void | Promise<void>;
  payBusy: boolean;
};

function describeClaimError(status: number, error: string, fallback: string): { title: string; body: string } {
  const lower = error.toLowerCase();
  if (status === 409 && lower.includes("captain_slots_full")) {
    return { title: "Captain slots are full", body: "All captain claims for this tournament have been taken." };
  }
  if (status === 409 && lower.includes("instagram_already_on_active_team")) {
    return {
      title: "Instagram already on a team",
      body: "That Instagram is already on an active team for this tournament.",
    };
  }
  if (status === 403 && lower.includes("waiver_required")) {
    return { title: "Accept the waiver first", body: "You must accept the liability waiver before claiming a team." };
  }
  if (lower) {
    return { title: "Could not submit claim", body: error.replace(/_/g, " ") };
  }
  return { title: "Could not submit claim", body: fallback };
}

export function CaptainClaimModal({
  visible,
  accessToken,
  onClose,
  onClaimRecorded,
  onProceedToPay,
  payBusy,
}: Props) {
  const [step, setStep] = useState<Step>("rules");

  const [rulesRead, setRulesRead] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [consentBusy, setConsentBusy] = useState(false);

  const [captainName, setCaptainName] = useState("");
  const [captainIg, setCaptainIg] = useState("");
  const [teamName, setTeamName] = useState("");
  const [expectedPlayers, setExpectedPlayers] = useState("10");
  const [prelim, setPrelim] = useState<PrelimEntry[]>([]);
  const [submitBusy, setSubmitBusy] = useState(false);

  useEffect(() => {
    if (!visible) {
      setStep("rules");
      setRulesRead(false);
      setAgreed(false);
      setTypedName("");
      setCaptainName("");
      setCaptainIg("");
      setTeamName("");
      setExpectedPlayers("10");
      setPrelim([]);
      setConsentBusy(false);
      setSubmitBusy(false);
    }
  }, [visible]);

  const expectedPlayersNum = useMemo(() => {
    const n = Number(expectedPlayers);
    return Number.isFinite(n) ? Math.floor(n) : NaN;
  }, [expectedPlayers]);

  const submitClaimDisabled =
    submitBusy ||
    !captainName.trim() ||
    !captainIg.trim() ||
    !teamName.trim() ||
    !Number.isFinite(expectedPlayersNum) ||
    expectedPlayersNum < 5 ||
    expectedPlayersNum > 25;

  function onRulesScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const nearBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 12;
    if (nearBottom && !rulesRead) setRulesRead(true);
  }

  async function submitConsent() {
    const fullName = typedName.trim();
    if (!rulesRead || !agreed || !fullName) return;
    if (!accessToken) {
      Alert.alert("", "Sign in on this device, then try again.");
      return;
    }
    setConsentBusy(true);
    try {
      const r = await postTournamentConsent(accessToken, {
        full_name: fullName,
        signed_name: fullName,
        page: "/tournament",
        consent_version: "tournament_rules_v1",
      });
      if (!r.ok) {
        const j = (r.json ?? {}) as Record<string, unknown>;
        const msg =
          typeof j.error === "string" && j.error.trim()
            ? j.error.replace(/_/g, " ")
            : `Could not record consent (${r.status}).`;
        Alert.alert("", msg);
        return;
      }
      setCaptainName(fullName);
      setStep("form");
    } finally {
      setConsentBusy(false);
    }
  }

  function addPrelimRow() {
    setPrelim((rows) => (rows.length >= 12 ? rows : [...rows, { fullName: "", instagram: "" }]));
  }

  function removePrelim(i: number) {
    setPrelim((rows) => rows.filter((_, idx) => idx !== i));
  }

  function updatePrelim(i: number, key: keyof PrelimEntry, value: string) {
    setPrelim((rows) => rows.map((row, idx) => (idx === i ? { ...row, [key]: value } : row)));
  }

  async function submitClaim() {
    if (!accessToken) {
      Alert.alert("", "Sign in on this device, then try again.");
      return;
    }
    setSubmitBusy(true);
    try {
      const r = await postTournamentCaptainSubmitClaim(accessToken, {
        captainName: captainName.trim(),
        captainInstagram: captainIg.trim(),
        teamName: teamName.trim(),
        expectedPlayers: expectedPlayersNum,
        prelimRoster: prelim
          .map((p) => ({ fullName: p.fullName.trim(), instagram: p.instagram.trim() }))
          .filter((p) => p.fullName.length >= 2 && p.instagram.length >= 2),
      });
      if (!r.ok) {
        const j = (r.json ?? {}) as Record<string, unknown>;
        const errStr = typeof j.error === "string" ? j.error : "";
        const { title, body } = describeClaimError(r.status, errStr, `Could not submit claim (${r.status}).`);
        Alert.alert(title, body);
        return;
      }
      onClaimRecorded?.();
      setStep("success");
    } finally {
      setSubmitBusy(false);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker}>
              {step === "rules"
                ? "STEP 1 · RULES"
                : step === "form"
                  ? "STEP 2 · CLAIM"
                  : "STEP 3 · PAYMENT"}
            </Text>
            <Text style={styles.title}>
              {step === "rules"
                ? "Submission agreement"
                : step === "form"
                  ? "Claim your captain spot"
                  : "Captain interest recorded"}
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
            <FontAwesome name="times" size={20} color="rgba(255,255,255,0.7)" />
          </Pressable>
        </View>

        {step === "rules" ? (
          <RulesStep
            rulesRead={rulesRead}
            onRulesScroll={onRulesScroll}
            agreed={agreed}
            onToggleAgreed={() => setAgreed((v) => !v)}
            typedName={typedName}
            onChangeName={setTypedName}
            consentBusy={consentBusy}
            onSubmit={() => void submitConsent()}
          />
        ) : null}

        {step === "form" ? (
          <FormStep
            captainName={captainName}
            captainIg={captainIg}
            teamName={teamName}
            expectedPlayers={expectedPlayers}
            prelim={prelim}
            submitBusy={submitBusy}
            disabled={submitClaimDisabled}
            onChangeCaptainName={setCaptainName}
            onChangeCaptainIg={setCaptainIg}
            onChangeTeamName={setTeamName}
            onChangeExpectedPlayers={setExpectedPlayers}
            onAddPrelim={addPrelimRow}
            onRemovePrelim={removePrelim}
            onUpdatePrelim={updatePrelim}
            onSubmit={() => void submitClaim()}
          />
        ) : null}

        {step === "success" ? (
          <SuccessStep
            payBusy={payBusy}
            onProceedToPay={() => void onProceedToPay()}
            onClose={onClose}
          />
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

function RulesStep({
  rulesRead,
  onRulesScroll,
  agreed,
  onToggleAgreed,
  typedName,
  onChangeName,
  consentBusy,
  onSubmit,
}: {
  rulesRead: boolean;
  onRulesScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  agreed: boolean;
  onToggleAgreed: () => void;
  typedName: string;
  onChangeName: (v: string) => void;
  consentBusy: boolean;
  onSubmit: () => void;
}) {
  const submitDisabled = !rulesRead || !agreed || !typedName.trim() || consentBusy;
  return (
    <View style={styles.flex}>
      <ScrollView
        style={styles.rulesScroll}
        contentContainerStyle={styles.rulesContent}
        scrollEventThrottle={64}
        onScroll={onRulesScroll}
      >
        <Text style={styles.sectionHeading}>Entry timing</Text>
        <Text style={styles.body}>
          Captains and players must submit their entry at least 48 hours before the tournament start time.
        </Text>

        <Text style={styles.sectionHeading}>Entry fees and refunds</Text>
        <Text style={styles.body}>{REFUND_NOTICE}</Text>

        <Text style={styles.sectionHeading}>Team spots are limited</Text>
        <Text style={styles.body}>
          Once the maximum number of teams is reached, the tournament is considered full. The count can change as
          submissions are approved or removed. Once the tournament is full, additional teams will not be included.
        </Text>

        <Text style={styles.sectionHeading}>Minimum roster</Text>
        <Text style={styles.body}>
          A minimum roster size is required to submit a team. The goalkeeper does count toward your minimum player
          total.
        </Text>

        <Text style={styles.sectionHeading}>Captain claim does not confirm a team</Text>
        <Text style={styles.body}>
          Claiming a captain spot does not fully confirm your team. Final approval depends on payment, roster
          verification, eligibility, and admin review.
        </Text>

        <Text style={styles.sectionHeading}>Photo, video and online use</Text>
        <Text style={styles.body}>
          By participating in this tournament (and related CT Pickup activities), you confirm you have accepted the
          current Liability Waiver and Participation Agreement, including consent for CT Pickup to photograph, record
          audio and video, livestream, and publish your name, image, likeness, and voice online and in other media as
          described there. That consent is required and is not negotiable if you play.
        </Text>

        {!rulesRead ? (
          <Text style={styles.scrollHint}>Scroll to the end to continue.</Text>
        ) : (
          <Text style={[styles.scrollHint, styles.scrollHintDone]}>You&apos;ve read the rules.</Text>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          onPress={onToggleAgreed}
          style={styles.checkboxRow}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreed }}
        >
          <View style={[styles.checkbox, agreed && styles.checkboxChecked]}>
            {agreed ? <FontAwesome name="check" size={12} color="#0a0a0a" /> : null}
          </View>
          <Text style={styles.checkboxText}>I agree to the rules and media consent.</Text>
        </Pressable>

        <TextInput
          style={styles.input}
          value={typedName}
          onChangeText={onChangeName}
          placeholder="Type your full name"
          placeholderTextColor="rgba(255,255,255,0.35)"
          autoCapitalize="words"
          autoCorrect={false}
        />

        <Pressable
          onPress={onSubmit}
          disabled={submitDisabled}
          style={[styles.primaryBtn, submitDisabled && styles.primaryBtnDisabled]}
          accessibilityRole="button"
        >
          {consentBusy ? (
            <ActivityIndicator color="#0a0a0a" />
          ) : (
            <Text style={styles.primaryBtnText}>Submit</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

function FormStep({
  captainName,
  captainIg,
  teamName,
  expectedPlayers,
  prelim,
  submitBusy,
  disabled,
  onChangeCaptainName,
  onChangeCaptainIg,
  onChangeTeamName,
  onChangeExpectedPlayers,
  onAddPrelim,
  onRemovePrelim,
  onUpdatePrelim,
  onSubmit,
}: {
  captainName: string;
  captainIg: string;
  teamName: string;
  expectedPlayers: string;
  prelim: PrelimEntry[];
  submitBusy: boolean;
  disabled: boolean;
  onChangeCaptainName: (v: string) => void;
  onChangeCaptainIg: (v: string) => void;
  onChangeTeamName: (v: string) => void;
  onChangeExpectedPlayers: (v: string) => void;
  onAddPrelim: () => void;
  onRemovePrelim: (i: number) => void;
  onUpdatePrelim: (i: number, key: keyof PrelimEntry, value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
      <View style={styles.formCard}>
        <Text style={styles.formCardTitle}>Captain info</Text>
        <Text style={styles.label}>Full name</Text>
        <TextInput
          style={styles.input}
          value={captainName}
          onChangeText={onChangeCaptainName}
          placeholder="Captain name"
          placeholderTextColor="rgba(255,255,255,0.35)"
          autoCapitalize="words"
        />
        <Text style={styles.label}>Instagram handle</Text>
        <TextInput
          style={styles.input}
          value={captainIg}
          onChangeText={onChangeCaptainIg}
          placeholder="@yourhandle"
          placeholderTextColor="rgba(255,255,255,0.35)"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <View style={styles.formCard}>
        <Text style={styles.formCardTitle}>Team info</Text>
        <Text style={styles.label}>Team name</Text>
        <TextInput
          style={styles.input}
          value={teamName}
          onChangeText={onChangeTeamName}
          placeholder="Team name"
          placeholderTextColor="rgba(255,255,255,0.35)"
        />
        <Text style={styles.label}>Expected players (5–25)</Text>
        <TextInput
          style={styles.input}
          value={expectedPlayers}
          onChangeText={onChangeExpectedPlayers}
          keyboardType="number-pad"
          placeholderTextColor="rgba(255,255,255,0.35)"
        />
      </View>

      <View style={styles.formCard}>
        <Text style={styles.formCardTitle}>Preliminary roster (optional)</Text>
        <Text style={styles.fieldHint}>
          Early entries are not verified registration. You can add players later.
        </Text>

        {prelim.map((row, i) => (
          <View key={`prelim-${i}`} style={styles.prelimRow}>
            <View style={{ flex: 1, gap: 8 }}>
              <TextInput
                style={styles.input}
                value={row.fullName}
                onChangeText={(v) => onUpdatePrelim(i, "fullName", v)}
                placeholder="Full name"
                placeholderTextColor="rgba(255,255,255,0.35)"
                autoCapitalize="words"
              />
              <TextInput
                style={styles.input}
                value={row.instagram}
                onChangeText={(v) => onUpdatePrelim(i, "instagram", v)}
                placeholder="Instagram"
                placeholderTextColor="rgba(255,255,255,0.35)"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <Pressable
              onPress={() => onRemovePrelim(i)}
              style={styles.removeBtn}
              accessibilityRole="button"
              accessibilityLabel="Remove player"
            >
              <FontAwesome name="trash-o" size={16} color="rgba(255,255,255,0.75)" />
            </Pressable>
          </View>
        ))}

        <Pressable onPress={onAddPrelim} style={styles.addBtn} accessibilityRole="button">
          <FontAwesome name="plus" size={12} color={LIME} />
          <Text style={styles.addBtnText}>Add player</Text>
        </Pressable>
      </View>

      <Pressable
        onPress={onSubmit}
        disabled={disabled}
        style={[styles.primaryBtn, disabled && styles.primaryBtnDisabled]}
        accessibilityRole="button"
      >
        {submitBusy ? (
          <ActivityIndicator color="#0a0a0a" />
        ) : (
          <Text style={styles.primaryBtnText}>Claim Your Captain Spot</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

function SuccessStep({
  payBusy,
  onProceedToPay,
  onClose,
}: {
  payBusy: boolean;
  onProceedToPay: () => void;
  onClose: () => void;
}) {
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.formContent}>
      <View style={styles.successCard}>
        <FontAwesome name="check-circle" size={28} color={LIME} />
        <Text style={styles.successTitle}>Your captain interest has been recorded</Text>
        <Text style={styles.body}>
          Your team spot is not confirmed yet. Confirmation only happens after payment, eligibility review, roster
          verification, and final approval.
        </Text>
      </View>

      <View style={styles.refundCard}>
        <Text style={styles.refundTitle}>Before you pay</Text>
        <Text style={styles.refundBody}>{REFUND_NOTICE}</Text>
      </View>

      <Pressable
        onPress={onProceedToPay}
        disabled={payBusy}
        style={[styles.primaryBtn, payBusy && styles.primaryBtnDisabled]}
        accessibilityRole="button"
      >
        {payBusy ? (
          <ActivityIndicator color="#0a0a0a" />
        ) : (
          <Text style={styles.primaryBtnText}>Proceed to payment ($250)</Text>
        )}
      </Pressable>

      <Pressable onPress={onClose} style={styles.secondaryBtn} accessibilityRole="button">
        <Text style={styles.secondaryBtnText}>Close</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#0a0a0a" },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 16,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  kicker: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.4,
    color: "rgba(163,230,53,0.75)",
  },
  title: { marginTop: 6, fontSize: 18, fontWeight: "800", color: "#fff" },
  rulesScroll: { flex: 1 },
  rulesContent: { padding: 20, paddingBottom: 32, gap: 8 },
  sectionHeading: {
    marginTop: 14,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.8,
    color: "rgba(255,255,255,0.85)",
    textTransform: "uppercase",
  },
  body: { fontSize: 14, lineHeight: 21, color: "rgba(255,255,255,0.72)" },
  scrollHint: {
    marginTop: 18,
    fontSize: 12,
    color: "rgba(255,255,255,0.45)",
    textAlign: "center",
  },
  scrollHintDone: { color: LIME },
  footer: {
    padding: 20,
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.1)",
    backgroundColor: "#0a0a0a",
  },
  checkboxRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  checkboxChecked: { backgroundColor: LIME, borderColor: LIME },
  checkboxText: { flex: 1, fontSize: 14, color: "rgba(255,255,255,0.85)", lineHeight: 20 },
  input: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    color: "#fff",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  primaryBtn: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: LIME,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnText: { color: "#111", fontWeight: "800", fontSize: 15 },
  secondaryBtn: {
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnText: { color: "rgba(255,255,255,0.7)", fontWeight: "700", fontSize: 14 },
  formContent: { padding: 20, paddingBottom: 40, gap: 16 },
  formCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.03)",
    gap: 8,
  },
  formCardTitle: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.2,
    color: "rgba(255,255,255,0.85)",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  label: { marginTop: 4, fontSize: 12, fontWeight: "700", color: "rgba(255,255,255,0.55)" },
  fieldHint: { fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 18 },
  prelimRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  removeBtn: {
    width: 40,
    height: 88,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
    backgroundColor: "rgba(163,230,53,0.06)",
    alignSelf: "flex-start",
  },
  addBtnText: { color: LIME, fontWeight: "700", fontSize: 13 },
  successCard: {
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.3)",
    backgroundColor: "rgba(163,230,53,0.06)",
    gap: 10,
  },
  successTitle: { fontSize: 16, fontWeight: "800", color: "#fff", lineHeight: 22 },
  refundCard: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.32)",
    backgroundColor: "rgba(251,191,36,0.06)",
    gap: 8,
  },
  refundTitle: { fontSize: 13, fontWeight: "800", color: "rgba(251,191,36,0.95)", letterSpacing: 0.4 },
  refundBody: { fontSize: 13, lineHeight: 19, color: "rgba(255,255,255,0.78)" },
});
