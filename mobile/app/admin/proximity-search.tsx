import AdminVenuePicker from "@/components/AdminVenuePicker";
import { useAuth } from "@/context/AuthContext";
import { fetchAdminPlayersProximity, type ProximitySearchPlayer } from "@/lib/adminApi";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import Slider from "@react-native-community/slider";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const LIME = "#a3e635";
const BG = "#0a0a0a";
const MIN_MINUTES = 15;
const MAX_MINUTES = 90;
const SLIDER_STEP = 5;

function playerName(p: ProximitySearchPlayer): string {
  const n = `${String(p.first_name || "").trim()} ${String(p.last_name || "").trim()}`.trim();
  return n || "Player";
}

function tierBadgeLabel(tier: string | null, tierRank: number | null): string {
  if (tier && tier.trim()) return tier.trim();
  const r = tierRank ?? 6;
  if (r <= 1) return "Tier 1A";
  if (r === 2) return "Tier 1B";
  if (r === 3) return "Tier 2";
  if (r === 4) return "Tier 3";
  if (r === 5) return "Tier 4";
  return "Public";
}

function formatInstagram(handle: string | null): string {
  if (!handle) return "—";
  const raw = handle.trim();
  if (!raw) return "—";
  return raw.startsWith("@") ? raw : `@${raw}`;
}

export default function ProximitySearchScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const token = session?.access_token ?? null;

  const [venue, setVenue] = useState("");
  const [venueZip, setVenueZip] = useState("");
  const [maxMinutes, setMaxMinutes] = useState(60);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchedVenue, setSearchedVenue] = useState<string | null>(null);
  const [players, setPlayers] = useState<ProximitySearchPlayer[]>([]);

  const onSearch = useCallback(async () => {
    const venueTrim = venue.trim();
    const zip5 = venueZip.replace(/\D/g, "").slice(0, 5);
    if (!zip5 && !venueTrim) {
      setError("Enter a venue name or a 5-digit venue ZIP code.");
      return;
    }
    if (venueZip.trim() && zip5.length !== 5) {
      setError("Venue ZIP code must be 5 digits.");
      return;
    }
    if (!token) {
      setError("Not signed in.");
      return;
    }
    setLoading(true);
    setError(null);
    const r = await fetchAdminPlayersProximity(token, venueTrim, maxMinutes, zip5.length === 5 ? zip5 : null);
    setLoading(false);
    if (!r.ok) {
      setError(r.error);
      setPlayers([]);
      setSearchedVenue(null);
      return;
    }
    setSearchedVenue(r.data.venue);
    setPlayers(r.data.players || []);
  }, [venue, venueZip, maxMinutes, token]);

  const headerVenue =
    searchedVenue || (venueZip.replace(/\D/g, "").slice(0, 5) ? `ZIP ${venueZip.replace(/\D/g, "").slice(0, 5)}` : null) || venue.trim() || "venue";

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.85 }]}>
          <FontAwesome name="chevron-left" size={18} color="#fff" />
        </Pressable>
        <Text style={styles.topTitle}>Player Proximity Search</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <AdminVenuePicker
          label="Venue"
          value={venue}
          onChange={setVenue}
          hint="Select a venue or type a known CT Pickup venue name in the field below."
        />
        <View style={styles.venueInputWrap}>
          <Text style={styles.label}>Venue name</Text>
          <View style={styles.venueInputRow}>
            <FontAwesome name="map-marker" size={16} color={LIME} style={styles.venueInputIcon} />
            <TextInput
              style={styles.venueInput}
              value={venue}
              onChangeText={setVenue}
              placeholder="e.g. Sofive Meadowlands 5v5"
              placeholderTextColor="rgba(255,255,255,0.35)"
              autoCapitalize="words"
              autoCorrect={false}
            />
          </View>
        </View>

        <View style={styles.venueInputWrap}>
          <Text style={styles.label}>Venue ZIP code</Text>
          <View style={styles.venueInputRow}>
            <FontAwesome name="location-arrow" size={16} color={LIME} style={styles.venueInputIcon} />
            <TextInput
              style={styles.venueInput}
              value={venueZip}
              onChangeText={(text) => setVenueZip(text.replace(/\D/g, "").slice(0, 5))}
              placeholder="06880"
              placeholderTextColor="rgba(255,255,255,0.35)"
              keyboardType="number-pad"
              maxLength={5}
            />
          </View>
          <Text style={styles.zipHint}>When set, drive time is calculated from this ZIP instead of the venue name.</Text>
        </View>

        <View style={styles.sliderBlock}>
          <View style={styles.sliderHeader}>
            <Text style={styles.label}>Max drive time</Text>
            <Text style={styles.sliderValue}>{maxMinutes} min</Text>
          </View>
          <Slider
            style={styles.slider}
            minimumValue={MIN_MINUTES}
            maximumValue={MAX_MINUTES}
            step={SLIDER_STEP}
            value={maxMinutes}
            onValueChange={(v) => setMaxMinutes(Math.round(v / SLIDER_STEP) * SLIDER_STEP)}
            minimumTrackTintColor={LIME}
            maximumTrackTintColor="rgba(255,255,255,0.18)"
            thumbTintColor="#f4f4f5"
          />
          <View style={styles.sliderTicks}>
            <Text style={styles.sliderTick}>{MIN_MINUTES} min</Text>
            <Text style={styles.sliderTick}>{MAX_MINUTES} min</Text>
          </View>
        </View>

        <Pressable
          onPress={() => void onSearch()}
          disabled={loading}
          style={({ pressed }) => [styles.searchBtn, (pressed || loading) && { opacity: 0.88 }]}
        >
          {loading ? <ActivityIndicator color="#111" /> : <Text style={styles.searchBtnText}>Search</Text>}
        </Pressable>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {searchedVenue != null ? (
          <View style={styles.results}>
            <Text style={styles.countHeader}>
              {players.length} player{players.length === 1 ? "" : "s"} found within {maxMinutes} min of {headerVenue}
            </Text>
            {players.length === 0 ? (
              <Text style={styles.empty}>No players with a ZIP in range for this venue.</Text>
            ) : (
              players.map((p) => (
                <View key={p.id} style={styles.resultCard}>
                  <View style={styles.resultTop}>
                    <Text style={styles.resultName}>{playerName(p)}</Text>
                    <View style={styles.tierBadge}>
                      <Text style={styles.tierBadgeText}>{tierBadgeLabel(p.tier, p.tier_rank)}</Text>
                    </View>
                  </View>
                  <Text style={styles.resultMeta}>Instagram: {formatInstagram(p.instagram)}</Text>
                  <Text style={styles.resultMeta}>ZIP: {p.zip_code}</Text>
                  <Text style={styles.resultDrive}>{p.drive_minutes} min drive</Text>
                </View>
              ))
            )}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  backBtn: { padding: 8 },
  topTitle: { flex: 1, fontSize: 18, fontWeight: "800", color: "#fff" },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  label: { fontSize: 12, fontWeight: "700", color: "rgba(255,255,255,0.55)", textTransform: "uppercase" },
  venueInputWrap: { marginTop: 16 },
  venueInputRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.05)",
    gap: 10,
  },
  venueInputIcon: { marginTop: 1 },
  venueInput: { flex: 1, color: "#fff", fontSize: 15, padding: 0 },
  zipHint: { marginTop: 8, fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: 17 },
  sliderBlock: { marginTop: 24 },
  sliderHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sliderValue: { color: LIME, fontSize: 16, fontWeight: "800" },
  slider: { width: "100%", height: 40, marginTop: 8 },
  sliderTicks: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  sliderTick: { fontSize: 12, color: "rgba(255,255,255,0.45)" },
  searchBtn: {
    marginTop: 24,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: LIME,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  searchBtnText: { color: "#111", fontSize: 16, fontWeight: "800" },
  error: { marginTop: 14, color: "#f87171", fontSize: 14, lineHeight: 20 },
  results: { marginTop: 28 },
  countHeader: { color: LIME, fontSize: 15, fontWeight: "800", lineHeight: 22, marginBottom: 14 },
  empty: { color: "rgba(255,255,255,0.5)", fontSize: 14, fontStyle: "italic" },
  resultCard: {
    marginBottom: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  resultTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  resultName: { flex: 1, color: "#fff", fontSize: 16, fontWeight: "800" },
  tierBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: "rgba(163,230,53,0.15)",
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.3)",
  },
  tierBadgeText: { color: LIME, fontSize: 11, fontWeight: "800" },
  resultMeta: { marginTop: 6, color: "rgba(255,255,255,0.6)", fontSize: 13 },
  resultDrive: { marginTop: 8, color: "#fff", fontSize: 14, fontWeight: "700" },
});
