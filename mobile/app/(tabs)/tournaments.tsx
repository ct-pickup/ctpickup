import { AnimatedPressScale } from "@/components/AnimatedPressScale";
import { FieldTournamentCard } from "@/components/FieldTournamentCard";
import { RegionsPickerPanel } from "@/components/RegionsPickerPanel";
import { useAuth } from "@/context/AuthContext";
import { useSelectedRegion } from "@/context/SelectedRegionContext";
import { useFieldTournament } from "@/hooks/useFieldTournament";
import { NO_NEARBY_VENUE_HUB_MSG } from "@/lib/playerLocationHints";
import { formatCacheAge } from "@/lib/offlineCache";
import { serviceRegionName, type ServiceRegionCode } from "@/lib/serviceRegions";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const LIME = "#a3e635";

export default function TournamentsScreen() {
  const router = useRouter();
  const { setRegion, region } = useSelectedRegion();
  const { session, supabase } = useAuth();
  const {
    loading: fieldLoading,
    error: fieldError,
    payload: fieldPayload,
    reload,
    netOffline,
    offlineNoCache,
    dataAsOfMs,
  } = useFieldTournament();
  const navigation = useNavigation();
  const [showStatePicker, setShowStatePicker] = useState(true);
  const [profileNearestVenue, setProfileNearestVenue] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      setShowStatePicker(true);
      void reload({ background: true });
    }, [reload]),
  );
  const [listRefreshing, setListRefreshing] = useState(false);

  const onTournamentRefresh = useCallback(async () => {
    setListRefreshing(true);
    try {
      await reload({ background: true });
    } finally {
      setListRefreshing(false);
    }
  }, [reload]);

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

  const showFieldOfflineBanner =
    netOffline && fieldPayload?.tournament != null && dataAsOfMs != null;

  if (showStatePicker) {
    return (
      <SafeAreaView style={styles.pickerSafe} edges={["bottom"]}>
        <RegionsPickerPanel onSelectState={onPickState} variant="tournament" />
      </SafeAreaView>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={listRefreshing}
          onRefresh={() => void onTournamentRefresh()}
          tintColor={LIME}
        />
      }
    >
      <View>
      <View style={styles.titleRow}>
        <Text style={styles.title} numberOfLines={1}>
          Tournaments
        </Text>
        <AnimatedPressScale
          pressedScale={0.96}
          hapticOnPress
          onPress={() => setShowStatePicker(true)}
          style={styles.statesChip}
        >
          <FontAwesome name="map-marker" size={14} color="#a3e635" />
          <Text style={styles.statesChipText}> States</Text>
        </AnimatedPressScale>
      </View>
      <Text style={styles.sub}>
        {serviceRegionName(region)} · Outdoor
      </Text>
      {showFieldOfflineBanner ? (
        <View style={styles.offlineBanner} accessibilityRole="text">
          <MaterialCommunityIcons name="wifi-off" size={18} color="#fff" style={styles.offlineBannerIcon} />
          <Text style={styles.offlineBannerText}>
            Offline — last updated {formatCacheAge(Date.now() - dataAsOfMs)}
          </Text>
        </View>
      ) : null}
      {offlineNoCache && !fieldLoading ? (
        <Text style={styles.offlineNoCacheText}>
          No internet connection. Pull down to retry.
        </Text>
      ) : (
        <FieldTournamentCard
          loading={fieldLoading}
          error={fieldError}
          payload={fieldPayload}
          emptyAlternateMessage={tournamentEmptyAlternate}
          style={{ marginTop: 18, marginBottom: 8 }}
          onPress={() => router.push("/field-tournament")}
        />
      )}
      {fieldPayload?.tournament?.id ? (
        <AnimatedPressScale
          style={styles.bracketBtn}
          hapticOnPress
          onPress={() =>
            (router.push as (href: string) => void)(
              `/tournament-bracket-view?tournament_id=${encodeURIComponent(fieldPayload.tournament!.id)}`,
            )
          }
          accessibilityRole="button"
          accessibilityLabel="Live standings, bracket, and top scorers for this tournament"
        >
          <FontAwesome name="trophy" size={16} color="#111" style={{ marginRight: 8 }} />
          <Text style={styles.bracketBtnText}>View bracket & standings</Text>
        </AnimatedPressScale>
      ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pickerSafe: { flex: 1, backgroundColor: "#0a0a0a" },
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  scrollContent: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 40 },
  offlineBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginTop: 14,
    marginBottom: 4,
    backgroundColor: "#f59e0b",
  },
  offlineBannerIcon: { flexShrink: 0 },
  offlineBannerText: {
    flex: 1,
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
  offlineNoCacheText: {
    marginTop: 20,
    color: "rgba(255,255,255,0.72)",
    fontSize: 16,
    lineHeight: 22,
    textAlign: "center",
  },
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
  sub: { marginTop: 8, marginBottom: 4, color: "rgba(255,255,255,0.5)", fontSize: 13, lineHeight: 18 },
  bracketBtn: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: "#a3e635",
  },
  bracketBtnText: { color: "#111", fontWeight: "800", fontSize: 15 },
});
