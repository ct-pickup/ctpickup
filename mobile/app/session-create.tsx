import { useAuth } from "@/context/AuthContext";
import { siteOrigin } from "@/lib/env";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
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

type NominatimResult = { place_id: number; display_name: string; lat: string; lon: string };
type Step = 1 | 2 | 3;

function fmt12Hour(date: Date): string {
  let h = date.getHours();
  const m = date.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
}

function fmtDate(date: Date): string {
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

export default function SessionCreateScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const [step, setStep] = useState<Step>(1);

  // Location
  const [locationQuery, setLocationQuery] = useState("");
  const [locationSuggestions, setLocationSuggestions] = useState<NominatimResult[]>([]);
  const [locationSelected, setLocationSelected] = useState<NominatimResult | null>(null);
  const [locationSearching, setLocationSearching] = useState(false);

  // Date & time
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(18, 0, 0, 0);
  const [sessionDate, setSessionDate] = useState<Date>(tomorrow);
  const [sessionTime, setSessionTime] = useState<Date>(tomorrow);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  // Step 1
  const [playerLimit, setPlayerLimit] = useState(10);
  const [skillLevel, setSkillLevel] = useState("all");
  const [format, setFormat] = useState("Open");

  // Step 2
  const [isPaid, setIsPaid] = useState(false);
  const [tieredPricing, setTieredPricing] = useState(false);
  const [buyIn, setBuyIn] = useState("");

  // Step 3
  const [isInviteOnly, setIsInviteOnly] = useState(false);
  const [publishing, setPublishing] = useState(false);

  async function searchLocation(q: string) {
    setLocationQuery(q);
    setLocationSelected(null);
    if (q.trim().length < 3) { setLocationSuggestions([]); return; }
    setLocationSearching(true);
    try {
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5&bbox=-79.76,36.85,-71.79,45.01`;
      const r = await fetch(url, { headers: { "Accept-Language": "en", "User-Agent": "CTPickup/1.0" } });
      const json = await r.json() as { features: { properties: { name?: string; street?: string; city?: string; state?: string; osm_id: number }; geometry: { coordinates: [number, number] } }[] };
      const data: NominatimResult[] = (json.features ?? []).map((f) => ({
        place_id: f.properties.osm_id,
        display_name: [f.properties.name, f.properties.street, f.properties.city, f.properties.state].filter(Boolean).join(", "),
        lat: String(f.geometry.coordinates[1]),
        lon: String(f.geometry.coordinates[0]),
      }));
      setLocationSuggestions(data);
    } catch {
      setLocationSuggestions([]);
    } finally {
      setLocationSearching(false);
    }
  }

  function selectLocation(item: NominatimResult) {
    setLocationSelected(item);
    setLocationQuery(item.display_name);
    setLocationSuggestions([]);
  }

  function validateStep1(): string | null {
    if (!locationSelected && !locationQuery.trim()) return "Please enter a location.";
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
    return Math.round(buyInCents() * playerLimit * 0.9);
  }

  function combinedDateTime(): Date {
    const d = new Date(sessionDate);
    d.setHours(sessionTime.getHours(), sessionTime.getMinutes(), 0, 0);
    return d;
  }

  async function publish() {
    if (publishing) return;
    const token = session?.access_token;
    if (!token) { Alert.alert("Not signed in"); return; }
    const origin = siteOrigin();
    if (!origin) { Alert.alert("Config error", "Missing site URL."); return; }

    setPublishing(true);
    try {
      const dt = combinedDateTime();
      if (dt <= new Date()) { Alert.alert("Invalid time", "Session must be in the future."); return; }

      const body = {
        location_text: locationSelected?.display_name ?? locationQuery.trim(),
        latitude: locationSelected ? parseFloat(locationSelected.lat) : null,
        longitude: locationSelected ? parseFloat(locationSelected.lon) : null,
        start_at: dt.toISOString(),
        capacity: playerLimit,
        min_tier: skillLevel === "all" ? null : skillLevel,
        format,
        fee_cents: buyInCents(),
        invite_only: isInviteOnly,
        tiered_pricing: tieredPricing,
      };

      const r = await fetch(`${origin}/api/sessions/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
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
    } catch {
      Alert.alert("Error", "Network error. Please try again.");
    } finally {
      setPublishing(false);
    }
  }

  const stepTitles = ["The basics", "Pricing", "Review & publish"];

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView style={s.root} contentContainerStyle={{ paddingBottom: 80 }} keyboardShouldPersistTaps="handled">

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
              style={s.input}
              value={locationQuery}
              onChangeText={(t) => void searchLocation(t)}
              placeholder="Search field name or address…"
              placeholderTextColor="rgba(255,255,255,0.3)"
              autoCorrect={false}
              returnKeyType="search"
            />
            {locationSearching && <ActivityIndicator color={LIME} style={{ marginTop: 8 }} />}
            {locationSuggestions.length > 0 && (
              <View style={s.suggestBox}>
                {locationSuggestions.map((item) => (
                  <Pressable key={item.place_id} onPress={() => selectLocation(item)} style={s.suggestRow}>
                    <FontAwesome name="map-marker" size={13} color={LIME} style={{ marginTop: 2 }} />
                    <Text style={s.suggestText} numberOfLines={2}>{item.display_name}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            {locationSelected && (
              <View style={s.selectedBadge}>
                <FontAwesome name="check-circle" size={13} color={LIME} />
                <Text style={s.selectedText} numberOfLines={1}>{locationSelected.display_name}</Text>
              </View>
            )}

            <Text style={[s.fieldLabel, { marginTop: 20 }]}>DATE</Text>
            <Pressable onPress={() => { setShowDatePicker(true); setShowTimePicker(false); }} style={s.pickerBtn}>
              <FontAwesome name="calendar" size={15} color={LIME} />
              <Text style={s.pickerBtnText}>{fmtDate(sessionDate)}</Text>
            </Pressable>
            {showDatePicker && (
              <DateTimePicker
                value={sessionDate}
                mode="date"
                minimumDate={new Date()}
                display="inline"
                themeVariant="dark"
                onChange={(_, d) => { if (d) setSessionDate(d); setShowDatePicker(false); }}
              />
            )}

            <Text style={[s.fieldLabel, { marginTop: 16 }]}>KICKOFF TIME</Text>
            <Pressable onPress={() => { setShowTimePicker(true); setShowDatePicker(false); }} style={s.pickerBtn}>
              <FontAwesome name="clock-o" size={15} color={LIME} />
              <Text style={s.pickerBtnText}>{fmt12Hour(sessionTime)}</Text>
            </Pressable>
            {showTimePicker && (
              <DateTimePicker
                value={sessionTime}
                mode="time"
                is24Hour={false}
                display="spinner"
                themeVariant="dark"
                onChange={(_, t) => { if (t) setSessionTime(t); setShowTimePicker(false); }}
              />
            )}

            <Text style={[s.fieldLabel, { marginTop: 20 }]}>PLAYER LIMIT</Text>
            <View style={s.chipRow}>
              {PLAYER_LIMITS.map((n) => (
                <Pressable key={n} onPress={() => setPlayerLimit(n)} style={[s.chip, playerLimit === n && s.chipActive]}>
                  <Text style={[s.chipText, playerLimit === n && s.chipTextActive]}>{n}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={[s.fieldLabel, { marginTop: 20 }]}>FORMAT</Text>
            <View style={s.chipRow}>
              {FORMATS.map((f) => (
                <Pressable key={f} onPress={() => setFormat(f)} style={[s.chip, format === f && s.chipActive]}>
                  <Text style={[s.chipText, format === f && s.chipTextActive]}>{f}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={[s.fieldLabel, { marginTop: 20 }]}>MINIMUM SKILL LEVEL</Text>
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
              <Pressable onPress={() => setIsPaid(false)} style={[s.toggleBtn, !isPaid && s.toggleBtnActive]}>
                <Text style={[s.toggleBtnText, !isPaid && s.toggleBtnTextActive]}>Free</Text>
              </Pressable>
              <Pressable onPress={() => setIsPaid(true)} style={[s.toggleBtn, isPaid && s.toggleBtnActive]}>
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
            {!isPaid && <Text style={s.hint}>Free sessions are open to all eligible players at no cost.</Text>}
          </View>
        )}

        {/* ── STEP 3 ── */}
        {step === 3 && (
          <View style={s.card}>
            <Text style={s.reviewTitle}>Session summary</Text>
            <View style={s.reviewRow}>
              <Text style={s.reviewLabel}>Location</Text>
              <Text style={s.reviewValue} numberOfLines={2}>{locationSelected?.display_name ?? locationQuery}</Text>
            </View>
            <View style={s.reviewRow}>
              <Text style={s.reviewLabel}>Date</Text>
              <Text style={s.reviewValue}>{fmtDate(sessionDate)}</Text>
            </View>
            <View style={s.reviewRow}>
              <Text style={s.reviewLabel}>Kickoff</Text>
              <Text style={s.reviewValue}>{fmt12Hour(sessionTime)}</Text>
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
              <Text style={s.reviewValue}>{SKILL_LEVELS.find((sl) => sl.value === skillLevel)?.label}</Text>
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

            <Pressable onPress={() => void publish()} disabled={publishing}
              style={[s.publishBtn, publishing && { opacity: 0.5 }]}>
              {publishing
                ? <ActivityIndicator color="#0a0a0a" />
                : <Text style={s.publishBtnText}>Publish session →</Text>}
            </Pressable>
          </View>
        )}

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
  suggestBox: { marginTop: 6, backgroundColor: "#1a1a1a", borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", overflow: "hidden" },
  suggestRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)" },
  suggestText: { flex: 1, color: "#fff", fontSize: 13, lineHeight: 18 },
  selectedBadge: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, padding: 10, backgroundColor: "rgba(163,230,53,0.08)", borderRadius: 8, borderWidth: 1, borderColor: "rgba(163,230,53,0.2)" },
  selectedText: { flex: 1, color: LIME, fontSize: 13 },
  pickerBtn: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", paddingHorizontal: 14, paddingVertical: 13 },
  pickerBtnText: { color: "#fff", fontSize: 16, fontWeight: "500" },
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
