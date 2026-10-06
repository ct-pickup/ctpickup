import { goBack } from "@/lib/goBack";
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

import { headline, themeColor, useThemedStyles } from "@/theme";
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
  useThemedStyles(publish_s);

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
          <Pressable onPress={() => goBack(router, "/(tabs)/sessions")} hitSlop={10}>
            <FontAwesome name="times" size={20} color={themeColor().muted} />
          </Pressable>
        </View>

        <View style={s.card}>
          <Text style={s.fieldLabel}>FIELD NAME</Text>
          <TextInput
            style={s.input}
            value={fieldQuery}
            onChangeText={(t) => void searchField(t)}
            placeholder="Search field name or address…"
            placeholderTextColor={themeColor().muted}
            autoCorrect={false}
            returnKeyType="search"
          />
          {fieldSearching && <ActivityIndicator color={themeColor().pitchText} style={{ marginTop: 8 }} />}
          {fieldSuggestions.length > 0 && (
            <View style={s.suggestBox}>
              {fieldSuggestions.map((item) => (
                <Pressable key={item.place_id} onPress={() => selectField(item)} style={s.suggestRow}>
                  <FontAwesome name="map-marker" size={13} color={themeColor().pitchText} style={{ marginTop: 4 }} />
                  <Text style={s.suggestText} numberOfLines={2}>
                    {item.display_name}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          {fieldSelected && (
            <View style={s.selectedBadge}>
              <FontAwesome name="check-circle" size={13} color={themeColor().pitchText} />
              <Text style={s.selectedText} numberOfLines={1}>
                {fieldSelected.display_name}
              </Text>
            </View>
          )}

          <Text style={[s.fieldLabel, { marginTop: 20 }]}>START TIME</Text>
          <Pressable onPress={() => setShowStartPicker(true)} style={s.pickerBtn}>
            <FontAwesome name="clock-o" size={15} color={themeColor().pitchText} />
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
            placeholderTextColor={themeColor().muted}
          />

          <Text style={[s.fieldLabel, { marginTop: 20 }]}>SPOTS AVAILABLE</Text>
          <Text style={s.fieldHint}>0 = solo training, up to 30</Text>
          <TextInput
            style={s.input}
            value={spotsText}
            onChangeText={(t) => setSpotsText(t.replace(/[^\d]/g, ""))}
            placeholder="0"
            placeholderTextColor={themeColor().muted}
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
                style={[s.pickerBtn, { marginTop: 8 }]}
              >
                <FontAwesome name="clock-o" size={15} color={themeColor().pitchText} />
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
            placeholderTextColor={themeColor().muted}
            multiline
          />
        </View>

        <Pressable onPress={() => void goLive()} disabled={publishing} style={[s.goLiveBtn, publishing && { opacity: 0.5 }]}>
          {publishing ? <ActivityIndicator color={themeColor().onPitch} /> : <Text style={s.goLiveBtnText}>GO LIVE →</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function make_s() {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: themeColor().bg, padding: 20 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 24 },
  headerTitle: { color: themeColor().text, fontSize: 20, ...headline },
  card: {
    backgroundColor: themeColor().card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().line,
    padding: 16,
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 13, fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: themeColor().muted,
    marginBottom: 8,
  },
  fieldHint: {
    color: themeColor().muted,
    fontSize: 13, fontFamily: "Inter_400Regular",
    marginTop: -4,
    marginBottom: 8,
  },
  input: {
    backgroundColor: themeColor().overlay,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: themeColor().line,
    color: themeColor().text,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16, fontFamily: "Inter_400Regular",
  },
  suggestBox: {
    marginTop: 4,
    backgroundColor: themeColor().card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: themeColor().line,
    overflow: "hidden",
  },
  suggestRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: themeColor().line,
  },
  suggestText: { flex: 1, color: themeColor().text, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  selectedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    padding: 8,
    backgroundColor: themeColor().pitchPanel,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: themeColor().pitch,
  },
  selectedText: { flex: 1, color: themeColor().pitchText, fontSize: 13, fontFamily: "Inter_400Regular" },
  pickerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: themeColor().overlay,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: themeColor().line,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  pickerBtnText: { color: themeColor().text, fontSize: 16, fontFamily: "Inter_500Medium", fontWeight: "500" },
  toggleBtn: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: themeColor().line,
    alignItems: "center",
  },
  toggleBtnActive: { borderColor: themeColor().pitch, backgroundColor: themeColor().pitchPanel },
  toggleBtnText: { color: themeColor().muted, fontWeight: "700", fontSize: 14, fontFamily: "Inter_700Bold" },
  toggleBtnTextActive: { color: themeColor().pitchText },
  goLiveBtn: { backgroundColor: themeColor().pitch, borderRadius: 12, paddingVertical: 16, alignItems: "center", marginTop: 4 },
  goLiveBtnText: { color: themeColor().onPitch, fontWeight: "800", fontSize: 16, fontFamily: "Inter_700Bold",},
});
}
let s = make_s();
function publish_s() {
  s = make_s();
}

