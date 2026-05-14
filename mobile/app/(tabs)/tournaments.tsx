import { FieldTournamentCard } from "@/components/FieldTournamentCard";
import { RegionsPickerPanel } from "@/components/RegionsPickerPanel";
import { useAuth } from "@/context/AuthContext";
import { useSelectedRegion } from "@/context/SelectedRegionContext";
import { useFieldTournament } from "@/hooks/useFieldTournament";
import { NO_NEARBY_VENUE_HUB_MSG } from "@/lib/playerLocationHints";
import { serviceRegionName, type ServiceRegionCode } from "@/lib/serviceRegions";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function TournamentsScreen() {
  const router = useRouter();
  const { setRegion, region } = useSelectedRegion();
  const { session, supabase } = useAuth();
  const { loading: fieldLoading, error: fieldError, payload: fieldPayload } = useFieldTournament();
  const navigation = useNavigation();
  const [showStatePicker, setShowStatePicker] = useState(true);
  const [profileNearestVenue, setProfileNearestVenue] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase || !session?.user?.id) {
      setProfileNearestVenue(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("nearest_venue")
        .eq("id", session.user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setProfileNearestVenue(null);
        return;
      }
      const nvRaw = (data as { nearest_venue?: unknown }).nearest_venue;
      setProfileNearestVenue(typeof nvRaw === "string" && nvRaw.trim() ? nvRaw.trim() : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, session?.user?.id]);

  useEffect(() => {
    navigation.setOptions?.({
      title: showStatePicker ? "Tournament by state" : "Tournaments",
      headerTitleAlign: "center",
      headerStyle: {
        backgroundColor: "#0a0a0a",
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: "rgba(255,255,255,0.08)",
      },
      headerTintColor: "#fff",
      headerShadowVisible: false,
    });
  }, [navigation, showStatePicker]);

  const onPickState = useCallback(
    (code: ServiceRegionCode) => {
      void setRegion(code);
      setShowStatePicker(false);
    },
    [setRegion],
  );

  const tournamentEmptyAlternate =
    !fieldLoading &&
    !fieldError &&
    fieldPayload?.tournament == null &&
    Boolean(session?.user?.id) &&
    !String(profileNearestVenue ?? "").trim()
      ? NO_NEARBY_VENUE_HUB_MSG
      : null;

  const body = useMemo(
    () => (
      <>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            Tournaments
          </Text>
          <Pressable
            onPress={() => setShowStatePicker(true)}
            style={({ pressed }) => [styles.statesChip, pressed && { opacity: 0.85 }]}
          >
            <FontAwesome name="map-marker" size={14} color="#a3e635" />
            <Text style={styles.statesChipText}> States</Text>
          </Pressable>
        </View>
        <Text style={styles.sub}>
          Outdoor / in-person bracket for {serviceRegionName(region)} ({region}). Online esports lives in its own tab.
        </Text>
        <FieldTournamentCard
          loading={fieldLoading}
          error={fieldError}
          payload={fieldPayload}
          emptyAlternateMessage={tournamentEmptyAlternate}
          style={{ marginTop: 18, marginBottom: 8 }}
          onPress={() => router.push("/field-tournament")}
        />
        {fieldPayload?.tournament?.id ? (
          <Pressable
            style={({ pressed }) => [styles.bracketBtn, pressed && { opacity: 0.9 }]}
            onPress={() =>
              (router.push as (href: string) => void)(
                `/tournament-bracket-view?tournament_id=${encodeURIComponent(fieldPayload.tournament!.id)}`,
              )
            }
            accessibilityRole="button"
            accessibilityLabel="Live standings, bracket, and top scorers for this tournament"
          >
            <FontAwesome name="sitemap" size={16} color="#111" style={{ marginRight: 8 }} />
            <Text style={styles.bracketBtnText}>Standings · bracket · scorers</Text>
          </Pressable>
        ) : null}
      </>
    ),
    [
      fieldLoading,
      fieldError,
      fieldPayload,
      region,
      router,
      session?.user?.id,
      profileNearestVenue,
      tournamentEmptyAlternate,
    ],
  );

  if (showStatePicker) {
    return (
      <SafeAreaView style={styles.pickerSafe} edges={["bottom"]}>
        <RegionsPickerPanel onSelectState={onPickState} />
      </SafeAreaView>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      {body}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pickerSafe: { flex: 1, backgroundColor: "#0a0a0a" },
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  scrollContent: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 40 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 4,
  },
  title: { fontSize: 28, fontWeight: "800", color: "#fff", letterSpacing: -0.2, flex: 1, minWidth: 0 },
  statesChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
    backgroundColor: "rgba(163,230,53,0.08)",
  },
  statesChipText: { fontSize: 13, fontWeight: "800", color: "#a3e635" },
  sub: { marginTop: 10, marginBottom: 4, color: "rgba(255,255,255,0.6)", fontSize: 15, lineHeight: 22 },
  bracketBtn: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "#a3e635",
  },
  bracketBtnText: { color: "#111", fontWeight: "800", fontSize: 15 },
});
