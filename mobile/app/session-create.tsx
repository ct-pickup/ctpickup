import { useAuth } from "@/context/AuthContext";
import { siteOrigin } from "@/lib/env";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";

const LIME = "#a3e635";

const PLAYER_LIMITS = [6, 8, 10, 12, 14, 16];
const FORMATS = ["5v5", "6v6", "7v7", "Open"];
const SKILL_LEVELS = [
  { value: "all", label: "All levels" },
  { value: "bronze", label: "Bronze+" },
  { value: "silver", label: "Silver+" },
  { value: "gold", label: "Gold+" },
  { value: "platinum", label: "Platinum+" },
  { value: "diamond", label: "Diamond only" },
];

type Step = 1 | 2 | 3;

export default function SessionCreateScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const [step, setStep] = useState<Step>(1);

  // Step 1
  const [location, setLocation] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [playerLimit, setPlayerLimit] = useState(10);
  const [skillLevel, setSkillLevel] = useState("all");
  const [format, setFormat] = useState("Open");

  // Step 2
  const [isPaid, setIsPaid] = useState(false);
  const [buyIn, setBuyIn] = useState("");

  // Step 3
  const [isInviteOnly, setIsInviteOnly] = useState(false);
  const [publishing, setPublishing] = useState(false);

  function validateStep1(): string | null {
    if (!location.trim()) return "Please enter a location.";
    if (!date.trim()) return "Please enter a date (YYYY-MM-DD).";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) return "Date must be YYYY-MM-DD format.";
    if (!time.trim()) return "Please enter a time (e.g. 18:00).";
    if (!/^\d{1,2}:\d{2}$/.test(time.trim())) return "Time must be HH:MM format.";
    return null;
  }

  function validateStep2(): string | null {
    if (isPaid) {
      const amount = parseFloat(buyIn);
      if (!buyIn.trim() || isNaN(amount) || amount < 1) return "Enter a valid buy-in amount (min $1).";
      if (amount > 500) return "Buy-in cannot exceed $500.";
    }
    return null;
  }

  function nextStep() {
    if (step === 1) {
      const err = validateStep1();
      if (err) { Alert.alert("Missing info", err); return; }
      setStep(2);
    } else if (step === 2) {
      const err = validateStep2();
      if (err) { Alert.alert("Invalid", err); return; }
      setStep(3);
    }
  }

  function buyInCents(): number {
    if (!isPaid) return 0;
    return Math.round(parseFloat(buyIn) * 100);
  }

  function hostRakeCents(): number {
    const total = buyInCents() * playerLimit;
    return Math.round(total * 0.9);
  }

  async function publish() {
    if (publishing) return;
    const token = session?.access_token;
    if (!token) { Alert.alert("Not signed in"); return; }
    const origin = siteOrigin();
    if (!origin) { Alert.alert("Config error", "Missing site URL."); return; }

    setPublishing(true);
    try {
      const startAt = `${date.trim()}T${time.trim()}:00`;
      const body = {
        location_text: location.trim(),
        start_at: startAt,
        capacity: playerLimit,
        min_tier: skillLevel === "all" ? null : skillLevel,
        format,
        fee_cents: buyInCents(),
        invite_only: isInviteOnly,
      };

      const r = await fetch(`${origin}/api/sessions/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string; run_id?: string } | null;

      if (!r.ok || !j?.ok) {
        Alert.alert("Error", j?.error ?? "Failed to create session.");
        return;
      }

      Alert.alert("Session created!", "Your session is now live on the map.", [
        { text: "View map", onPress: () => router.replace("/session-map") },
        { text: "Done", onPress: () => router.back() },
      ]);
    } catch (e) {
      Alert.alert("Error", "Network error. Please try again.");
    } finally {
      setPublishing(false);
    }
  }

  const stepTitles = ["The basics", "Pricing", "Review & publish"];

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView style={s.root} contentContainerStyle={{ paddingBottom: 60 }}>
        {/* Header */}
        <View style={s.header}>
          <Pressable onPress={() => step === 1 ? router.back() : setStep((step - 1) as Step)} hitSlop={10}>
            <FontAwesome name="chevron-left" size={16} color="rgba(255,255,255,0.6)" />
          </Pressable>
          <Text style={s.headerTitle}>Host a Session</Text>
          <View style={{ width: 20 }} />
        </View>

        {/* Step indicator */}
        <View style={s.stepRow}>
          {[1, 2, 3].map((n) => (
            <View key={n} style={[s.stepDot, step >= n && s.stepDotActive]} />
          ))}
        </View>
        <Text style={s.stepLabel}>{stepTitles[step - 1]}</Text>

        {/* ── STEP 1 ── */}
        {step === 1 && (
          <View style={s.card}>
            <Text style={s.fieldLabel}>LOCATION</Text>
            <TextInput
              style={s.input} value={location} onChangeText={setLocation}
              placeholder="Field name or address" placeholderTextColor="rgba(255,255,255,0.3)"
              autoCorrect={false}
            />

            <Text style={[s.fieldLabel, { marginTop: 16 }]}>DATE</Text>
            <TextInput
              style={s.input} value={date} onChangeText={setDate}
              placeholder="YYYY-MM-DD" placeholderTextColor="rgba(255,255,255,0.3)"
              keyboardType="numeric"
            />

            <Text style={[s.fieldLabel, { marginTop: 16 }]}>KICKOFF TIME (ET)</Text>
            <TextInput
              style={s.input} value={time} onChangeText={setTime}
              placeholder="18:00" placeholderTextColor="rgba(255,255,255,0.3)"
              keyboardType="numeric"
            />

            <Text style={[s.fieldLabel, { marginTop: 16 }]}>PLAYER LIMIT</Text>
            <View style={s.chipRow}>
              {PLAYER_LIMITS.map((n) => (
                <Pressable key={n} onPress={() => setPlayerLimit(n)}
                  style={[s.chip, playerLimit === n && s.chipActive]}>
                  <Text style={[s.chipText, playerLimit === n && s.chipTextActive]}>{n}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={[s.fieldLabel, { marginTop: 16 }]}>FORMAT</Text>
            <View style={s.chipRow}>
              {FORMATS.map((f) => (
                <Pressable key={f} onPress={() => setFormat(f)}
                  style={[s.chip, format === f && s.chipActive]}>
                  <Text style={[s.chipText, format === f && s.chipTextActive]}>{f}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={[s.fieldLabel, { marginTop: 16 }]}>MINIMUM SKILL LEVEL</Text>
            {SKILL_LEVELS.map((sl) => (
              <Pressable key={sl.value} onPress={() => setSkillLevel(sl.value)}
                style={[s.radioRow, skillLevel === sl.value && s.radioRowActive]}>
                <View style={[s.radio, skillLevel === sl.value && s.radioActive]} />
                <Text style={s.radioLabel}>{sl.label}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* ── STEP 2 ── */}
        {step === 2 && (
          <View style={s.card}>
            <Text style={s.fieldLabel}>SESSION TYPE</Text>
            <View style={s.toggleRow}>
              <Pressable onPress={() => setIsPaid(false)}
                style={[s.toggleBtn, !isPaid && s.toggleBtnActive]}>
                <Text style={[s.toggleBtnText, !isPaid && s.toggleBtnTextActive]}>Free</Text>
              </Pressable>
              <Pressable onPress={() => setIsPaid(true)}
                style={[s.toggleBtn, isPaid && s.toggleBtnActive]}>
                <Text style={[s.toggleBtnText, isPaid && s.toggleBtnTextActive]}>Paid</Text>
              </Pressable>
            </View>

            {isPaid && (
              <>
                <Text style={[s.fieldLabel, { marginTop: 20 }]}>BUY-IN PER PLAYER ($)</Text>
                <TextInput
                  style={s.input} value={buyIn} onChangeText={setBuyIn}
                  placeholder="e.g. 10" placeholderTextColor="rgba(255,255,255,0.3)"
                  keyboardType="decimal-pad"
                />
                {buyIn && !isNaN(parseFloat(buyIn)) && (
                  <View style={s.payoutCard}>
                    <View style={s.payoutRow}>
                      <Text style={s.payoutLabel}>Total collected ({playerLimit} players)</Text>
                      <Text style={s.payoutValue}>${(parseFloat(buyIn) * playerLimit).toFixed(2)}</Text>
                    </View>
                    <View style={s.payoutRow}>
                      <Text style={s.payoutLabel}>CT Pickup rake (10%)</Text>
                      <Text style={s.payoutValue}>−${(parseFloat(buyIn) * playerLimit * 0.1).toFixed(2)}</Text>
                    </View>
                    <View style={[s.payoutRow, { borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.1)", paddingTop: 10, marginTop: 4 }]}>
                      <Text style={[s.payoutLabel, { color: "#fff", fontWeight: "700" }]}>You take home</Text>
                      <Text style={[s.payoutValue, { color: LIME, fontWeight: "800" }]}>${(hostRakeCents() / 100).toFixed(2)}</Text>
                    </View>
                  </View>
                )}
                <Text style={s.hint}>Players pay when they RSVP. You get paid out after the session ends.</Text>
              </>
            )}

            {!isPaid && (
              <Text style={s.hint}>Free sessions are open to all eligible players at no cost.</Text>
            )}
          </View>
        )}

        {/* ── STEP 3 ── */}
        {step === 3 && (
          <View style={s.card}>
            <Text style={s.reviewTitle}>Session summary</Text>

            <View style={s.reviewRow}>
              <Text style={s.reviewLabel}>Location</Text>
              <Text style={s.reviewValue}>{location}</Text>
            </View>
            <View style={s.reviewRow}>
              <Text style={s.reviewLabel}>Date & time</Text>
              <Text style={s.reviewValue}>{date} at {time}</Text>
            </View>
            <View style={s.reviewRow}>
              <Text style={s.reviewLabel}>Players</Text>
              <Text style={s.reviewValue}>{playerLimit} max</Text>
            </View>
            <View style={s.reviewRow}>
              <Text style={s.reviewLabel}>Format</Text>
              <Text style={s.reviewValue}>{format}</Text>
            </View>
            <View style={s.reviewRow}>
              <Text style={s.reviewLabel}>Skill level</Text>
              <Text style={s.reviewValue}>{SKILL_LEVELS.find(s => s.value === skillLevel)?.label}</Text>
            </View>
            <View style={s.reviewRow}>
              <Text style={s.reviewLabel}>Pricing</Text>
              <Text style={s.reviewValue}>{isPaid ? `$${buyIn} buy-in` : "Free"}</Text>
            </View>

            <View style={[s.reviewRow, { marginTop: 20, alignItems: "center" }]}>
              <Text style={s.reviewLabel}>Invite only</Text>
              <Pressable onPress={() => setIsInviteOnly(!isInviteOnly)}
                style={[s.toggleBtn, isInviteOnly && s.toggleBtnActive, { minWidth: 80 }]}>
                <Text style={[s.toggleBtnText, isInviteOnly && s.toggleBtnTextActive]}>
                  {isInviteOnly ? "Yes" : "No"}
                </Text>
              </Pressable>
            </View>
            <Text style={s.hint}>
              {isInviteOnly ? "Only players you invite can join." : "Anyone who meets the skill level can join."}
            </Text>

            <Pressable onPress={() => void publish()}
              disabled={publishing}
              style={[s.publishBtn, publishing && { opacity: 0.5 }]}>
              {publishing
                ? <ActivityIndicator color="#0a0a0a" />
                : <Text style={s.publishBtnText}>Publish session →</Text>}
            </Pressable>
          </View>
        )}

        {/* Next button for steps 1 and 2 */}
        {step < 3 && (
          <Pressable onPress={nextStep} style={s.nextBtn}>
            <Text style={s.nextBtnText}>Continue →</Text>
          </Pressable>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0a0a0a", padding: 20 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 16, marginBottom: 24 },
  headerTitle: { color: "#fff", fontSize: 17, fontWeight: "700" },
  stepRow: { flexDirection: "row", gap: 8, marginBottom: 6 },
  stepDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.15)" },
  stepDotActive: { backgroundColor: LIME },
  stepLabel: { color: "rgba(255,255,255,0.45)", fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 20 },
  card: { backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", padding: 18, marginBottom: 16 },
  fieldLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 1.2, color: "rgba(255,255,255,0.45)", marginBottom: 8, textTransform: "uppercase" },
  input: { backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", color: "#fff", paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", backgroundColor: "rgba(255,255,255,0.04)" },
  chipActive: { borderColor: LIME, backgroundColor: "rgba(163,230,53,0.12)" },
  chipText: { color: "rgba(255,255,255,0.55)", fontWeight: "600", fontSize: 14 },
  chipTextActive: { color: LIME },
  radioRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 4, borderRadius: 8 },
  radioRowActive: { backgroundColor: "rgba(163,230,53,0.06)" },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: "rgba(255,255,255,0.3)" },
  radioActive: { borderColor: LIME, backgroundColor: LIME },
  radioLabel: { color: "#fff", fontSize: 15, fontWeight: "500" },
  toggleRow: { flexDirection: "row", gap: 10 },
  toggleBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", alignItems: "center" },
  toggleBtnActive: { borderColor: LIME, backgroundColor: "rgba(163,230,53,0.12)" },
  toggleBtnText: { color: "rgba(255,255,255,0.5)", fontWeight: "700", fontSize: 15 },
  toggleBtnTextActive: { color: LIME },
  payoutCard: { marginTop: 16, backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 10, padding: 14, gap: 8 },
  payoutRow: { flexDirection: "row", justifyContent: "space-between" },
  payoutLabel: { color: "rgba(255,255,255,0.5)", fontSize: 13 },
  payoutValue: { color: "#fff", fontSize: 13, fontWeight: "600" },
  hint: { color: "rgba(255,255,255,0.35)", fontSize: 12, marginTop: 12, lineHeight: 18 },
  reviewTitle: { fontSize: 17, fontWeight: "700", color: "#fff", marginBottom: 16 },
  reviewRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)" },
  reviewLabel: { color: "rgba(255,255,255,0.45)", fontSize: 14 },
  reviewValue: { color: "#fff", fontSize: 14, fontWeight: "600", maxWidth: "60%", textAlign: "right" },
  nextBtn: { backgroundColor: LIME, borderRadius: 14, paddingVertical: 16, alignItems: "center", marginTop: 4 },
  nextBtnText: { color: "#0a0a0a", fontWeight: "800", fontSize: 16 },
  publishBtn: { backgroundColor: LIME, borderRadius: 14, paddingVertical: 16, alignItems: "center", marginTop: 24 },
  publishBtnText: { color: "#0a0a0a", fontWeight: "800", fontSize: 16 },
});
EOFcat > /Users/omeedpooya/Desktop/ctpickup/mobile/app/session-create.tsx << 'EOF'
import { useAuth } from "@/context/AuthContext";
import { siteOrigin } from "@/lib/env";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";

const LIME = "#a3e635";

const PLAYER_LIMITS = [6, 8, 10, 12, 14, 16];
const FORMATS = ["5v5", "6v6", "7v7", "Open"];
const SKILL_LEVELS = [
  { value: "all", label: "All levels" },
  { value: "bronze", label: "Bronze+" },
  { value: "silver", label: "Silver+" },
  { value: "gold", label: "Gold+" },
  { value: "platinum", label: "Platinum+" },
  { value: "diamond", label: "Diamond only" },
];

type Step = 1 | 2 | 3;

export default function SessionCreateScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const [step, setStep] = useState<Step>(1);

  // Step 1
  const [location, setLocation] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [playerLimit, setPlayerLimit] = useState(10);
  const [skillLevel, setSkillLevel] = useState("all");
  const [format, setFormat] = useState("Open");

  // Step 2
  const [isPaid, setIsPaid] = useState(false);
  const [buyIn, setBuyIn] = useState("");

  // Step 3
  const [isInviteOnly, setIsInviteOnly] = useState(false);
  const [publishing, setPublishing] = useState(false);

  function validateStep1(): string | null {
    if (!location.trim()) return "Please enter a location.";
    if (!date.trim()) return "Please enter a date (YYYY-MM-DD).";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) return "Date must be YYYY-MM-DD format.";
    if (!time.trim()) return "Please enter a time (e.g. 18:00).";
    if (!/^\d{1,2}:\d{2}$/.test(time.trim())) return "Time must be HH:MM format.";
    return null;
  }

  function validateStep2(): string | null {
    if (isPaid) {
      const amount = parseFloat(buyIn);
      if (!buyIn.trim() || isNaN(amount) || amount < 1) return "Enter a valid buy-in amount (min $1).";
      if (amount > 500) return "Buy-in cannot exceed $500.";
    }
    return null;
  }

  function nextStep() {
    if (step === 1) {
      const err = validateStep1();
      if (err) { Alert.alert("Missing info", err); return; }
      setStep(2);
    } else if (step === 2) {
      const err = validateStep2();
      if (err) { Alert.alert("Invalid", err); return; }
      setStep(3);
    }
  }

  function buyInCents(): number {
    if (!isPaid) return 0;
    return Math.round(parseFloat(buyIn) * 100);
  }

  function hostRakeCents(): number {
    const total = buyInCents() * playerLimit;
    return Math.round(total * 0.9);
  }

  async function publish() {
    if (publishing) return;
    const token = session?.access_token;
    if (!token) { Alert.alert("Not signed in"); return; }
    const origin = siteOrigin();
    if (!origin) { Alert.alert("Config error", "Missing site URL."); return; }

    setPublishing(true);
    try {
      const startAt = `${date.trim()}T${time.trim()}:00`;
      const body = {
        location_text: location.trim(),
        start_at: startAt,
        capacity: playerLimit,
        min_tier: skillLevel === "all" ? null : skillLevel,
        format,
        fee_cents: buyInCents(),
        invite_only: isInviteOnly,
      };

      const r = await fetch(`${origin}/api/sessions/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string; run_id?: string } | null;

      if (!r.ok || !j?.ok) {
        Alert.alert("Error", j?.error ?? "Failed to create session.");
        return;
      }

      Alert.alert("Session created!", "Your session is now live on the map.", [
        { text: "View map", onPress: () => router.replace("/session-map") },
        { text: "Done", onPress: () => router.back() },
      ]);
    } catch (e) {
      Alert.alert("Error", "Network error. Please try again.");
    } finally {
      setPublishing(false);
    }
  }

  const stepTitles = ["The basics", "Pricing", "Review & publish"];

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView style={s.root} contentContainerStyle={{ paddingBottom: 60 }}>
        {/* Header */}
        <View style={s.header}>
          <Pressable onPress={() => step === 1 ? router.back() : setStep((step - 1) as Step)} hitSlop={10}>
            <FontAwesome name="chevron-left" size={16} color="rgba(255,255,255,0.6)" />
          </Pressable>
          <Text style={s.headerTitle}>Host a Session</Text>
          <View style={{ width: 20 }} />
        </View>

        {/* Step indicator */}
        <View style={s.stepRow}>
          {[1, 2, 3].map((n) => (
            <View key={n} style={[s.stepDot, step >= n && s.stepDotActive]} />
          ))}
        </View>
        <Text style={s.stepLabel}>{stepTitles[step - 1]}</Text>

        {/* ── STEP 1 ── */}
        {step === 1 && (
          <View style={s.card}>
            <Text style={s.fieldLabel}>LOCATION</Text>
            <TextInput
              style={s.input} value={location} onChangeText={setLocation}
              placeholder="Field name or address" placeholderTextColor="rgba(255,255,255,0.3)"
              autoCorrect={false}
            />

            <Text style={[s.fieldLabel, { marginTop: 16 }]}>DATE</Text>
            <TextInput
              style={s.input} value={date} onChangeText={setDate}
              placeholder="YYYY-MM-DD" placeholderTextColor="rgba(255,255,255,0.3)"
              keyboardType="numeric"
            />

            <Text style={[s.fieldLabel, { marginTop: 16 }]}>KICKOFF TIME (ET)</Text>
            <TextInput
              style={s.input} value={time} onChangeText={setTime}
              placeholder="18:00" placeholderTextColor="rgba(255,255,255,0.3)"
              keyboardType="numeric"
            />

            <Text style={[s.fieldLabel, { marginTop: 16 }]}>PLAYER LIMIT</Text>
            <View style={s.chipRow}>
              {PLAYER_LIMITS.map((n) => (
                <Pressable key={n} onPress={() => setPlayerLimit(n)}
                  style={[s.chip, playerLimit === n && s.chipActive]}>
                  <Text style={[s.chipText, playerLimit === n && s.chipTextActive]}>{n}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={[s.fieldLabel, { marginTop: 16 }]}>FORMAT</Text>
            <View style={s.chipRow}>
              {FORMATS.map((f) => (
                <Pressable key={f} onPress={() => setFormat(f)}
                  style={[s.chip, format === f && s.chipActive]}>
                  <Text style={[s.chipText, format === f && s.chipTextActive]}>{f}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={[s.fieldLabel, { marginTop: 16 }]}>MINIMUM SKILL LEVEL</Text>
            {SKILL_LEVELS.map((sl) => (
              <Pressable key={sl.value} onPress={() => setSkillLevel(sl.value)}
                style={[s.radioRow, skillLevel === sl.value && s.radioRowActive]}>
                <View style={[s.radio, skillLevel === sl.value && s.radioActive]} />
                <Text style={s.radioLabel}>{sl.label}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* ── STEP 2 ── */}
        {step === 2 && (
          <View style={s.card}>
            <Text style={s.fieldLabel}>SESSION TYPE</Text>
            <View style={s.toggleRow}>
              <Pressable onPress={() => setIsPaid(false)}
                style={[s.toggleBtn, !isPaid && s.toggleBtnActive]}>
                <Text style={[s.toggleBtnText, !isPaid && s.toggleBtnTextActive]}>Free</Text>
              </Pressable>
              <Pressable onPress={() => setIsPaid(true)}
                style={[s.toggleBtn, isPaid && s.toggleBtnActive]}>
                <Text style={[s.toggleBtnText, isPaid && s.toggleBtnTextActive]}>Paid</Text>
              </Pressable>
            </View>

            {isPaid && (
              <>
                <Text style={[s.fieldLabel, { marginTop: 20 }]}>BUY-IN PER PLAYER ($)</Text>
                <TextInput
                  style={s.input} value={buyIn} onChangeText={setBuyIn}
                  placeholder="e.g. 10" placeholderTextColor="rgba(255,255,255,0.3)"
                  keyboardType="decimal-pad"
                />
                {buyIn && !isNaN(parseFloat(buyIn)) && (
                  <View style={s.payoutCard}>
                    <View style={s.payoutRow}>
                      <Text style={s.payoutLabel}>Total collected ({playerLimit} players)</Text>
                      <Text style={s.payoutValue}>${(parseFloat(buyIn) * playerLimit).toFixed(2)}</Text>
                    </View>
                    <View style={s.payoutRow}>
                      <Text style={s.payoutLabel}>CT Pickup rake (10%)</Text>
                      <Text style={s.payoutValue}>−${(parseFloat(buyIn) * playerLimit * 0.1).toFixed(2)}</Text>
                    </View>
                    <View style={[s.payoutRow, { borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.1)", paddingTop: 10, marginTop: 4 }]}>
                      <Text style={[s.payoutLabel, { color: "#fff", fontWeight: "700" }]}>You take home</Text>
                      <Text style={[s.payoutValue, { color: LIME, fontWeight: "800" }]}>${(hostRakeCents() / 100).toFixed(2)}</Text>
                    </View>
                  </View>
                )}
                <Text style={s.hint}>Players pay when they RSVP. You get paid out after the session ends.</Text>
              </>
            )}

            {!isPaid && (
              <Text style={s.hint}>Free sessions are open to all eligible players at no cost.</Text>
            )}
          </View>
        )}

        {/* ── STEP 3 ── */}
        {step === 3 && (
          <View style={s.card}>
            <Text style={s.reviewTitle}>Session summary</Text>

            <View style={s.reviewRow}>
              <Text style={s.reviewLabel}>Location</Text>
              <Text style={s.reviewValue}>{location}</Text>
            </View>
            <View style={s.reviewRow}>
              <Text style={s.reviewLabel}>Date & time</Text>
              <Text style={s.reviewValue}>{date} at {time}</Text>
            </View>
            <View style={s.reviewRow}>
              <Text style={s.reviewLabel}>Players</Text>
              <Text style={s.reviewValue}>{playerLimit} max</Text>
            </View>
            <View style={s.reviewRow}>
              <Text style={s.reviewLabel}>Format</Text>
              <Text style={s.reviewValue}>{format}</Text>
            </View>
            <View style={s.reviewRow}>
              <Text style={s.reviewLabel}>Skill level</Text>
              <Text style={s.reviewValue}>{SKILL_LEVELS.find(s => s.value === skillLevel)?.label}</Text>
            </View>
            <View style={s.reviewRow}>
              <Text style={s.reviewLabel}>Pricing</Text>
              <Text style={s.reviewValue}>{isPaid ? `$${buyIn} buy-in` : "Free"}</Text>
            </View>

            <View style={[s.reviewRow, { marginTop: 20, alignItems: "center" }]}>
              <Text style={s.reviewLabel}>Invite only</Text>
              <Pressable onPress={() => setIsInviteOnly(!isInviteOnly)}
                style={[s.toggleBtn, isInviteOnly && s.toggleBtnActive, { minWidth: 80 }]}>
                <Text style={[s.toggleBtnText, isInviteOnly && s.toggleBtnTextActive]}>
                  {isInviteOnly ? "Yes" : "No"}
                </Text>
              </Pressable>
            </View>
            <Text style={s.hint}>
              {isInviteOnly ? "Only players you invite can join." : "Anyone who meets the skill level can join."}
            </Text>

            <Pressable onPress={() => void publish()}
              disabled={publishing}
              style={[s.publishBtn, publishing && { opacity: 0.5 }]}>
              {publishing
                ? <ActivityIndicator color="#0a0a0a" />
                : <Text style={s.publishBtnText}>Publish session →</Text>}
            </Pressable>
          </View>
        )}

        {/* Next button for steps 1 and 2 */}
        {step < 3 && (
          <Pressable onPress={nextStep} style={s.nextBtn}>
            <Text style={s.nextBtnText}>Continue →</Text>
          </Pressable>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0a0a0a", padding: 20 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 16, marginBottom: 24 },
  headerTitle: { color: "#fff", fontSize: 17, fontWeight: "700" },
  stepRow: { flexDirection: "row", gap: 8, marginBottom: 6 },
  stepDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.15)" },
  stepDotActive: { backgroundColor: LIME },
  stepLabel: { color: "rgba(255,255,255,0.45)", fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 20 },
  card: { backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", padding: 18, marginBottom: 16 },
  fieldLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 1.2, color: "rgba(255,255,255,0.45)", marginBottom: 8, textTransform: "uppercase" },
  input: { backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", color: "#fff", paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", backgroundColor: "rgba(255,255,255,0.04)" },
  chipActive: { borderColor: LIME, backgroundColor: "rgba(163,230,53,0.12)" },
  chipText: { color: "rgba(255,255,255,0.55)", fontWeight: "600", fontSize: 14 },
  chipTextActive: { color: LIME },
  radioRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 4, borderRadius: 8 },
  radioRowActive: { backgroundColor: "rgba(163,230,53,0.06)" },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: "rgba(255,255,255,0.3)" },
  radioActive: { borderColor: LIME, backgroundColor: LIME },
  radioLabel: { color: "#fff", fontSize: 15, fontWeight: "500" },
  toggleRow: { flexDirection: "row", gap: 10 },
  toggleBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", alignItems: "center" },
  toggleBtnActive: { borderColor: LIME, backgroundColor: "rgba(163,230,53,0.12)" },
  toggleBtnText: { color: "rgba(255,255,255,0.5)", fontWeight: "700", fontSize: 15 },
  toggleBtnTextActive: { color: LIME },
  payoutCard: { marginTop: 16, backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 10, padding: 14, gap: 8 },
  payoutRow: { flexDirection: "row", justifyContent: "space-between" },
  payoutLabel: { color: "rgba(255,255,255,0.5)", fontSize: 13 },
  payoutValue: { color: "#fff", fontSize: 13, fontWeight: "600" },
  hint: { color: "rgba(255,255,255,0.35)", fontSize: 12, marginTop: 12, lineHeight: 18 },
  reviewTitle: { fontSize: 17, fontWeight: "700", color: "#fff", marginBottom: 16 },
  reviewRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)" },
  reviewLabel: { color: "rgba(255,255,255,0.45)", fontSize: 14 },
  reviewValue: { color: "#fff", fontSize: 14, fontWeight: "600", maxWidth: "60%", textAlign: "right" },
  nextBtn: { backgroundColor: LIME, borderRadius: 14, paddingVertical: 16, alignItems: "center", marginTop: 4 },
  nextBtnText: { color: "#0a0a0a", fontWeight: "800", fontSize: 16 },
  publishBtn: { backgroundColor: LIME, borderRadius: 14, paddingVertical: 16, alignItems: "center", marginTop: 24 },
  publishBtnText: { color: "#0a0a0a", fontWeight: "800", fontSize: 16 },
});
