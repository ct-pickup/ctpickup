import StateShape from "@/components/StateShape";
import { AnimatedPressScale } from "@/components/AnimatedPressScale";
import { FieldTournamentCard } from "@/components/FieldTournamentCard";
import { useAuth } from "@/context/AuthContext";
import { useSelectedRegion } from "@/context/SelectedRegionContext";
import { useFieldTournament } from "@/hooks/useFieldTournament";
import { NO_NEARBY_VENUE_HUB_MSG } from "@/lib/playerLocationHints";
import { formatCacheAge } from "@/lib/offlineCache";
import { SERVICE_REGIONS, serviceRegionName, type ServiceRegionCode } from "@/lib/serviceRegions";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const LIME = "#a3e635";
const BG = "#0a0a0a";

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
  const [sessionCounts, setSessionCounts] = useState<Record<string, number>>({});

  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useFocusEffect(
    useCallback(() => {
      setShowStatePicker(true);
      void reloadRef.current({ background: true });
    }, []),
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

  /* Fetch active-session counts per service region for the state-picker badges */
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("pickup_runs")
        .select("service_region")
        .in("status", ["planning", "active"]);
      if (cancelled || error || !data) return;
      const counts: Record<string, number> = {};
      for (const row of data as { service_region?: unknown }[]) {
        const r = typeof row.service_region === "string" ? row.service_region : null;
        if (r) counts[r] = (counts[r] ?? 0) + 1;
      }
      setSessionCounts(counts);
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  useEffect(() => {
    navigation.setOptions?.({
      /* Hide native title on the state-picker; restore it on the tournament list */
      title: showStatePicker ? "" : "Tournaments",
      headerTitleAlign: "center",
      headerStyle: {
        backgroundColor: BG,
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

  /* ─── State picker ─────────────────────────────────────────────────────── */
  if (showStatePicker) {
    return (
      <SafeAreaView style={styles.pickerSafe} edges={["bottom"]}>
        <ScrollView
          style={styles.pickerScroll}
          contentContainerStyle={styles.pickerContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Custom header */}
          <Text style={styles.kicker}>TOURNAMENTS</Text>
          <Text style={styles.headline}>Where We Run</Text>

          {/* State cards */}
          <View style={styles.cardList}>
            {SERVICE_REGIONS.map((r) => {
              const count = sessionCounts[r.code] ?? 0;
              return (
                <AnimatedPressScale
                  key={r.code}
                  accessibilityRole="button"
                  accessibilityLabel={`${r.name} tournaments`}
                  hapticOnPress
                  pressedScale={0.985}
                  onPress={() => onPickState(r.code)}
                  style={styles.card}
                >
                  {/* Left lime accent stripe */}
                  <View style={styles.cardAccent} />

                  <View style={styles.cardInner}>
                    {/* State silhouette icon */}
                    <View style={styles.iconBadge}>
                      <StateShape
                        state={r.code as "CT" | "NY" | "NJ" | "MD"}
                        size={40}
                        active
                      />
                    </View>

                    {/* Text block */}
                    <View style={styles.cardBody}>
                      <Text style={styles.stateName}>{r.name}</Text>
                      <Text style={styles.stateHint}>Runs & RSVPs</Text>
                    </View>

                    {/* Active sessions badge */}
                    {count > 0 && (
                      <View style={styles.sessionBadge}>
                        <Text style={styles.sessionBadgeText}>{count}</Text>
                        <Text style={styles.sessionBadgeLabel}> active</Text>
                      </View>
                    )}

                    <FontAwesome
                      name="chevron-right"
                      size={14}
                      color="rgba(255,255,255,0.35)"
                      style={styles.chevron}
                    />
                  </View>
                </AnimatedPressScale>
              );
            })}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  /* ─── Tournament list (after state selected) ───────────────────────────── */
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
            <FontAwesome name="map-marker" size={14} color={LIME} />
            <Text style={styles.statesChipText}> States</Text>
          </AnimatedPressScale>
        </View>
        <Text style={styles.sub}>
          {serviceRegionName(region)} · Outdoor
        </Text>
        {showFieldOfflineBanner ? (
          <View style={styles.offlineBanner} accessibilityRole="text">
            <MaterialCommunityIcons
              name="wifi-off"
              size={18}
              color="#fff"
              style={styles.offlineBannerIcon}
            />
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
            <FontAwesome
              name="trophy"
              size={16}
              color="#111"
              style={{ marginRight: 8 }}
            />
            <Text style={styles.bracketBtnText}>View bracket & standings</Text>
          </AnimatedPressScale>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  /* ── Picker ── */
  pickerSafe: { flex: 1, backgroundColor: BG },
  pickerScroll: { flex: 1, backgroundColor: BG },
  pickerContent: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 48 },

  kicker: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
    color: "rgba(163,230,53,0.75)",
    marginBottom: 8,
    textTransform: "uppercase",
  },
  headline: {
    fontSize: 30,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: -0.6,
    marginBottom: 28,
  },

  cardList: { gap: 12 },

  card: {
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.04)",
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  cardAccent: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: LIME,
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
  },
  cardInner: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingLeft: 22,
    paddingRight: 16,
    gap: 0,
  },
  iconBadge: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: "rgba(163,230,53,0.1)",
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: { flex: 1, marginLeft: 16 },
  stateName: { fontSize: 18, fontWeight: "700", color: "#fff" },
  stateHint: { marginTop: 3, fontSize: 13, color: "rgba(255,255,255,0.45)" },

  sessionBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(163,230,53,0.15)",
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 10,
  },
  sessionBadgeText: {
    fontSize: 12,
    fontWeight: "800",
    color: LIME,
  },
  sessionBadgeLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "rgba(163,230,53,0.7)",
  },
  chevron: { marginLeft: 4 },

  /* ── Tournament list ── */
  container: { flex: 1, backgroundColor: BG },
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
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: -0.2,
    flex: 1,
    minWidth: 0,
  },
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
  statesChipText: { fontSize: 13, fontWeight: "800", color: LIME },
  sub: {
    marginTop: 8,
    marginBottom: 4,
    color: "rgba(255,255,255,0.5)",
    fontSize: 13,
    lineHeight: 18,
  },
  bracketBtn: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: LIME,
  },
  bracketBtnText: { color: "#111", fontWeight: "800", fontSize: 15 },
});
