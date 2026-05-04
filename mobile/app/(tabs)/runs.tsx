import { PickupScorePill } from "@/components/PickupScorePill";
import { RegionsPickerPanel } from "@/components/RegionsPickerPanel";
import { useAuth } from "@/context/AuthContext";
import { useRunsPickerBridge } from "@/context/RunsPickerBridge";
import { useSelectedRegion } from "@/context/SelectedRegionContext";
import { usePickupJoin } from "@/hooks/usePickupJoin";
import { usePickupPublic } from "@/hooks/usePickupPublic";
import { usePickupStandingScore } from "@/hooks/usePickupStandingScore";
import { fmtPickupDt } from "@/lib/pickupPublic";
import { serviceRegionName, type ServiceRegionCode } from "@/lib/serviceRegions";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useRouter } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function RunsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { height: windowHeight } = useWindowDimensions();
  const { session } = useAuth();
  const { setRegion, region } = useSelectedRegion();
  const { registerReset } = useRunsPickerBridge();
  const token = session?.access_token ?? null;
  const { loading, error, run, noFeaturedRun, load, myStatus } = usePickupPublic(token);
  const { joinBusy, joinPickup } = usePickupJoin();
  const { loading: scoreLoading, scorePct, trackedPickups, attendedPickups } = usePickupStandingScore();

  const [showStatePicker, setShowStatePicker] = useState(true);

  useLayoutEffect(() => {
    registerReset(() => setShowStatePicker(true));
    return () => registerReset(null);
  }, [registerReset]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: showStatePicker ? "Pickup by state" : "Runs",
      tabBarLabel: "Pickup",
    });
  }, [navigation, showStatePicker]);

  const runId = typeof run?.id === "string" ? run.id : undefined;
  const joinDisabled = joinBusy || !runId;

  const statusLabel = useMemo(() => {
    const st = run?.status;
    if (!st || typeof st !== "string") return "NO RUN ANNOUNCED";
    if (st === "planning") return "PLANNING";
    if (st === "likely_on") return "LIKELY ON";
    if (st === "active") return "CONFIRMED / ACTIVE";
    return st.toUpperCase();
  }, [run]);

  const runTypeLabel = useMemo(() => {
    const rt = run?.run_type;
    if (!rt || typeof rt !== "string") return "";
    return rt === "select" ? "SELECT PICKUP" : "PUBLIC PICKUP";
  }, [run]);

  const myLine = useMemo(() => {
    if (!myStatus) return null;
    if (myStatus === "confirmed") return "Your status: confirmed";
    if (myStatus === "standby") return "Your status: standby";
    if (myStatus === "pending_payment") return "Your status: payment pending";
    return `Your status: ${myStatus}`;
  }, [myStatus]);

  const showEmpty = !loading && !error && noFeaturedRun;
  const emptyBlockMinHeight = Math.max(260, Math.round(windowHeight * 0.42));

  const onPickState = useCallback(
    (code: ServiceRegionCode) => {
      void setRegion(code);
      setShowStatePicker(false);
    },
    [setRegion],
  );

  if (showStatePicker) {
    return (
      <SafeAreaView style={styles.pickerSafe} edges={["bottom"]}>
        <View style={styles.pickerScoreRow}>
          <PickupScorePill
            loading={scoreLoading}
            scorePct={scorePct}
            trackedPickups={trackedPickups}
            attendedPickups={attendedPickups}
            onPress={() => router.push("/(tabs)/account")}
          />
        </View>
        <RegionsPickerPanel onSelectState={onPickState} />
      </SafeAreaView>
    );
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, showEmpty && styles.contentEmpty]}
    >
      <View style={styles.titleRow}>
        <Text style={styles.title} numberOfLines={1}>
          Runs
        </Text>
        <View style={styles.titleActions}>
          <PickupScorePill
            loading={scoreLoading}
            scorePct={scorePct}
            trackedPickups={trackedPickups}
            attendedPickups={attendedPickups}
            onPress={() => router.push("/(tabs)/account")}
          />
          <Pressable
            onPress={() => setShowStatePicker(true)}
            style={({ pressed }) => [styles.statesChip, pressed && { opacity: 0.85 }]}
          >
            <FontAwesome name="map-marker" size={14} color="#a3e635" />
            <Text style={styles.statesChipText}> States</Text>
          </Pressable>
        </View>
      </View>
      <Text style={styles.sub}>
        Featured pickup for {serviceRegionName(region)} ({region}) — same account everywhere.
      </Text>

      {loading ? (
        <ActivityIndicator size="large" color="#fff" style={{ marginTop: 24 }} />
      ) : error ? (
        <Text style={styles.err}>{error}</Text>
      ) : noFeaturedRun ? (
        <View style={[styles.emptyCenter, { minHeight: emptyBlockMinHeight }]}>
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No runs posted yet.</Text>
            <Text style={styles.emptyBody}>
              Check back soon. You&apos;ll see upcoming pickup runs here once published by admin.
            </Text>
          </View>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.cardEyebrow}>{runTypeLabel || "PICKUP"}</Text>
          <Text style={styles.cardTitle}>{typeof run?.title === "string" && run.title ? run.title : "Pickup run"}</Text>
          {myLine ? <Text style={styles.myStatus}>{myLine}</Text> : null}
          <View style={styles.pill}>
            <Text style={styles.pillText}>{statusLabel}</Text>
          </View>
          <Text style={styles.row}>Start: {fmtPickupDt(typeof run?.start_at === "string" ? run.start_at : null)}</Text>
          {typeof run?.location_text === "string" && run.location_text ? (
            <Text style={styles.row}>Location: {run.location_text}</Text>
          ) : null}
          <Text style={styles.hint}>
            Request a spot when final RSVP is open for your account — waiver, approval, and slot rules apply on the server.
          </Text>
          <Pressable
            style={[styles.primaryJoin, joinDisabled && styles.primaryJoinDisabled]}
            disabled={joinDisabled}
            onPress={() => void joinPickup(token, runId, load)}
          >
            {joinBusy ? (
              <ActivityIndicator color="#111" />
            ) : (
              <>
                <FontAwesome name="bolt" size={16} color="#111" />
                <Text style={styles.primaryJoinText}> Request a spot</Text>
              </>
            )}
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pickerSafe: { flex: 1, backgroundColor: "#0a0a0a" },
  pickerScoreRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 10,
  },
  scroll: { flex: 1, backgroundColor: "#0a0a0a" },
  content: { padding: 20, paddingBottom: 40 },
  contentEmpty: { flexGrow: 1 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  title: { fontSize: 28, fontWeight: "700", color: "#fff", letterSpacing: 0.5, flex: 1, minWidth: 0 },
  titleActions: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 },
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
  sub: { marginTop: 10, color: "rgba(255,255,255,0.72)", fontSize: 15, lineHeight: 22 },
  card: {
    marginTop: 20,
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  emptyCenter: {
    marginTop: 12,
    width: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  emptyCard: {
    width: "100%",
    maxWidth: 400,
    alignSelf: "center",
    paddingVertical: 28,
    paddingHorizontal: 22,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
  },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: "#fff", textAlign: "center" },
  emptyBody: {
    marginTop: 12,
    color: "rgba(255,255,255,0.65)",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  cardEyebrow: { fontSize: 12, fontWeight: "600", color: "rgba(255,255,255,0.55)", letterSpacing: 1 },
  cardTitle: { marginTop: 8, fontSize: 20, fontWeight: "600", color: "#fff" },
  myStatus: { marginTop: 10, fontSize: 14, fontWeight: "600", color: "#a3e635" },
  pill: {
    alignSelf: "flex-start",
    marginTop: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(16,185,129,0.2)",
    borderWidth: 1,
    borderColor: "rgba(16,185,129,0.35)",
  },
  pillText: { color: "#6ee7b7", fontWeight: "600", fontSize: 13 },
  row: { marginTop: 10, color: "rgba(255,255,255,0.85)", fontSize: 15 },
  hint: { marginTop: 14, color: "rgba(255,255,255,0.55)", fontSize: 14, lineHeight: 20 },
  primaryJoin: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    marginTop: 18,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "#a3e635",
  },
  primaryJoinDisabled: { opacity: 0.45 },
  primaryJoinText: { color: "#111", fontWeight: "800", fontSize: 15 },
  err: { marginTop: 16, color: "#fca5a5" },
});
