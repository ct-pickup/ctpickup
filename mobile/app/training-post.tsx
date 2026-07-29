import { useAuth } from "@/context/AuthContext";
import { siteOrigin } from "@/lib/env";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Stack, useRouter } from "expo-router";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";

const LIME = "#a3e635";
const SPOTS_MIN = 0;
const SPOTS_MAX = 20;

type PhotonResult = { place_id: number; display_name: string; lat: string; lon: string };

function fmt12Hour(date: Date): string {
  let h = date.getHours();
  const m = date.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
}

export default function TrainingPostScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();

  const [fieldQuery, setFieldQuery] = useState("");
  const [fieldSuggestions, setFieldSuggestions] = useState<PhotonResult[]>([]);
  const [fieldSelected, setFieldSelected] = useState<PhotonResult | null>(null);
  const [fieldSearching, setFieldSearching] = useState(false);

  const [workingOn, setWorkingOn] = useState("");
  const [spotsText, setSpotsText] = useState("2");

  // Default start time to now (player can backdate up to 2 hours on the server).
  const [startedAt, setStartedAt] = useState<Date>(() => new Date());
  const [showStartPicker, setShowStartPicker] = useState(false);

  const [untilEnabled, setUntilEnabled] = useState(true);
  // Default the end time to exactly two hours from now (computed once at mount).
  const [trainingUntil, setTrainingUntil] = useState<Date>(() => new Date(Date.now() + 2 * 60 * 60 * 1000));
  const [showTimePicker, setShowTimePicker] = useState(false);

  const [notes, setNotes] = useState("");
  const [publishing, setPublishing] = useState(false);

  async function searchField(q: string) {
    setFieldQuery(q);
    setFieldSelected(null);
    if (q.trim().length < 3) {
      setFieldSuggestions([]);
      return;
    }
    setFieldSearching(true);
    try {
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5&bbox=-79.76,36.85,-71.79,45.01`;
      const r = await fetch(url, { headers: { "Accept-Language": "en", "User-Agent": "CTPickup/1.0" } });
      const json = (await r.json()) as {
        features: {
          properties: { name?: string; street?: string; city?: string; state?: string; osm_id: number };
          geometry: { coordinates: [number, number] };
        }[];
      };
      const data: PhotonResult[] = (json.features ?? []).map((f) => ({
        place_id: f.properties.osm_id,
        display_name: [f.properties.name, f.properties.street, f.properties.city, f.properties.state]
          .filter(Boolean)
          .join(", "),
        lat: String(f.geometry.coordinates[1]),
        lon: String(f.geometry.coordinates[0]),
      }));
      setFieldSuggestions(data);
    } catch {
      setFieldSuggestions([]);
    } finally {
      setFieldSearching(false);
    }
  }

  function selectField(item: PhotonResult) {
    setFieldSelected(item);
    setFieldQuery(item.display_name);
    setFieldSuggestions([]);
  }

  async function goLive() {
    if (publishing) return;
    const token = session?.access_token;
    if (!token) {
      Alert.alert("Not signed in");
      return;
    }
    const origin = siteOrigin();
    if (!origin) {
      Alert.alert("Config error", "Missing site URL.");
      return;
    }
    if (!fieldSelected && !fieldQuery.trim()) {
      Alert.alert("Missing info", "Please enter the field you're training at.");
      return;
    }
    if (!fieldSelected) {
      Alert.alert("Pick a field", "Choose a field from the search suggestions so others can find you on the map.");
      return;
    }

    const spotsParsed = Number.parseInt(spotsText.trim(), 10);
    if (!Number.isFinite(spotsParsed) || spotsParsed < SPOTS_MIN || spotsParsed > SPOTS_MAX) {
      Alert.alert("Spots available", `Enter a number between ${SPOTS_MIN} and ${SPOTS_MAX}.`);
      return;
    }

    setPublishing(true);
    try {
      const body = {
        field_name: fieldSelected.display_name,
        latitude: parseFloat(fieldSelected.lat),
        longitude: parseFloat(fieldSelected.lon),
        started_at: startedAt.toISOString(),
        training_until: untilEnabled ? trainingUntil.toISOString() : null,
        what_im_working_on: workingOn.trim() || null,
        spots_available: spotsParsed,
        notes: notes.trim() || null,
      };
      const r = await fetch(`${origin}/api/training/post`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string; post_id?: string } | null;
      if (!r.ok || !j?.ok || !j.post_id) {
        Alert.alert("Error", j?.error ?? "Failed to start training.");
        return;
      }
      router.replace(`/training/${j.post_id}`);
    } catch {
      Alert.alert("Error", "Network error. Please try again.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={[s.root, { paddingTop: insets.top + 16 }]}
        contentContainerStyle={{ paddingBottom: 80 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={s.header}>
          <Text style={s.headerTitle}>Start Training</Text>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <FontAwesome name="times" size={20} color="rgba(255,255,255,0.6)" />
          </Pressable>
        </View>

        <View style={s.card}>
          <Text style={s.fieldLabel}>FIELD NAME</Text>
          <TextInput
            style={s.input}
            value={fieldQuery}
            onChangeText={(t) => void searchField(t)}
            placeholder="Search field name or address…"
            placeholderTextColor="rgba(255,255,255,0.3)"
            autoCorrect={false}
            returnKeyType="search"
          />
          {fieldSearching && <ActivityIndicator color={LIME} style={{ marginTop: 8 }} />}
          {fieldSuggestions.length > 0 && (
            <View style={s.suggestBox}>
              {fieldSuggestions.map((item) => (
                <Pressable key={item.place_id} onPress={() => selectField(item)} style={s.suggestRow}>
                  <FontAwesome name="map-marker" size={13} color={LIME} style={{ marginTop: 2 }} />
                  <Text style={s.suggestText} numberOfLines={2}>
                    {item.display_name}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          {fieldSelected && (
            <View style={s.selectedBadge}>
              <FontAwesome name="check-circle" size={13} color={LIME} />
              <Text style={s.selectedText} numberOfLines={1}>
                {fieldSelected.display_name}
              </Text>
            </View>
          )}

          <Text style={[s.fieldLabel, { marginTop: 20 }]}>START TIME</Text>
          <Pressable onPress={() => setShowStartPicker(true)} style={s.pickerBtn}>
            <FontAwesome name="clock-o" size={15} color={LIME} />
            <Text style={s.pickerBtnText}>{fmt12Hour(startedAt)}</Text>
          </Pressable>
          {showStartPicker && (
            <DateTimePicker
              value={startedAt}
              mode="time"
              is24Hour={false}
              display="spinner"
              themeVariant="dark"
              onChange={(_, t) => {
                if (t) {
                  // Keep today's date; only apply the picked clock time.
                  const next = new Date(startedAt);
                  next.setHours(t.getHours(), t.getMinutes(), 0, 0);
                  setStartedAt(next);
                }
                setShowStartPicker(false);
              }}
            />
          )}

          <Text style={[s.fieldLabel, { marginTop: 20 }]}>WHAT ARE YOU WORKING ON</Text>
          <TextInput
            style={s.input}
            value={workingOn}
            onChangeText={setWorkingOn}
            placeholder="e.g. Finishing, Defensive shape, 1v1…"
            placeholderTextColor="rgba(255,255,255,0.3)"
          />

          <Text style={[s.fieldLabel, { marginTop: 20 }]}>SPOTS AVAILABLE</Text>
          <Text style={s.fieldHint}>0 = solo training, up to 30</Text>
          <TextInput
            style={s.input}
            value={spotsText}
            onChangeText={(t) => setSpotsText(t.replace(/[^\d]/g, ""))}
            placeholder="0"
            placeholderTextColor="rgba(255,255,255,0.3)"
            keyboardType="number-pad"
            maxLength={2}
          />

          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 20 }}>
            <Text style={[s.fieldLabel, { marginBottom: 0 }]}>TRAINING UNTIL</Text>
            <Pressable
              onPress={() => setUntilEnabled((v) => !v)}
              style={[s.toggleBtn, untilEnabled && s.toggleBtnActive, { minWidth: 90, paddingVertical: 8 }]}
            >
              <Text style={[s.toggleBtnText, untilEnabled && s.toggleBtnTextActive]}>
                {untilEnabled ? "Set" : "Open-ended"}
              </Text>
            </Pressable>
          </View>
          {untilEnabled && (
            <>
              <Pressable
                onPress={() => setShowTimePicker(true)}
                style={[s.pickerBtn, { marginTop: 10 }]}
              >
                <FontAwesome name="clock-o" size={15} color={LIME} />
                <Text style={s.pickerBtnText}>{fmt12Hour(trainingUntil)}</Text>
              </Pressable>
              {showTimePicker && (
                <DateTimePicker
                  value={trainingUntil}
                  mode="time"
                  is24Hour={false}
                  display="spinner"
                  themeVariant="dark"
                  onChange={(_, t) => {
                    if (t) setTrainingUntil(t);
                    setShowTimePicker(false);
                  }}
                />
              )}
            </>
          )}

          <Text style={[s.fieldLabel, { marginTop: 20 }]}>NOTES (OPTIONAL)</Text>
          <TextInput
            style={[s.input, { minHeight: 72, textAlignVertical: "top" }]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Anything else people should know…"
            placeholderTextColor="rgba(255,255,255,0.3)"
            multiline
          />
        </View>

        <Pressable onPress={() => void goLive()} disabled={publishing} style={[s.goLiveBtn, publishing && { opacity: 0.5 }]}>
          {publishing ? <ActivityIndicator color="#0a0a0a" /> : <Text style={s.goLiveBtnText}>GO LIVE →</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0a0a0a", padding: 20 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 24 },
  headerTitle: { color: "#fff", fontSize: 20, fontWeight: "800" },
  card: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    padding: 18,
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: "rgba(255,255,255,0.45)",
    marginBottom: 8,
    textTransform: "uppercase",
  },
  fieldHint: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 12,
    marginTop: -4,
    marginBottom: 8,
  },
  input: {
    backgroundColor: "rgba(255,255,255,0.07)",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    color: "#fff",
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  suggestBox: {
    marginTop: 6,
    backgroundColor: "#1a1a1a",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    overflow: "hidden",
  },
  suggestRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  suggestText: { flex: 1, color: "#fff", fontSize: 13, lineHeight: 18 },
  selectedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    padding: 10,
    backgroundColor: "rgba(163,230,53,0.08)",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.2)",
  },
  selectedText: { flex: 1, color: LIME, fontSize: 13 },
  pickerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  pickerBtnText: { color: "#fff", fontSize: 16, fontWeight: "500" },
  toggleBtn: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
  },
  toggleBtnActive: { borderColor: LIME, backgroundColor: "rgba(163,230,53,0.12)" },
  toggleBtnText: { color: "rgba(255,255,255,0.5)", fontWeight: "700", fontSize: 14 },
  toggleBtnTextActive: { color: LIME },
  goLiveBtn: { backgroundColor: LIME, borderRadius: 14, paddingVertical: 16, alignItems: "center", marginTop: 4 },
  goLiveBtnText: { color: "#0a0a0a", fontWeight: "800", fontSize: 16, letterSpacing: 0.5 },
});
