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
  const {
    loading,
    error,
    run,
    noFeaturedRun,
    load,
    myStatus,
    counts,
    invitedNow,
    tier,
    tierRank,
  } = usePickupPublic(token);
  const { joinBusy, joinPickup, payBusy, payPickup } = usePickupJoin();
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
  const payDisabled = payBusy || !runId;

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

  // Wave-specific messaging using API visibility + me fields.
  // tier_rank mapping (locked): 1A=1, 1B=2, 2=3, 3=4, 4=5, PUBLIC=6
  const waveMessage = useMemo<{ text: string; color: string } | null>(() => {
    if (invitedNow) {
      return { text: "Your wave is open — request your spot now", color: "#a3e635" };
    }
    if (typeof tierRank === "number") {
      if (tierRank <= 2) {
        return { text: "Your wave isn't open yet — check back soon", color: "rgba(255,255,255,0.72)" };
      }
      if (tierRank >= 3) {
        return { text: "Open tier pickup — all approved players welcome", color: "rgba(255,255,255,0.72)" };
      }
    }
    return null;
  }, [invitedNow, tierRank]);

  const tierBadgeLabel = useMemo(() => (tier ? `Tier ${tier}` : null), [tier]);

  const countChips = useMemo(() => {
    const c = counts ?? {};
    const items: { key: string; label: string }[] = [];
    if (typeof c.confirmed === "number") items.push({ key: "confirmed", label: `${c.confirmed} confirmed` });
    if (typeof c.standby === "number") items.push({ key: "standby", label: `${c.standby} standby` });
    if (typeof c.pending_payment === "number") items.push({ key: "pending", label: `${c.pending_payment} pending` });
    return items;
  }, [counts]);

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
          <View style={styles.cardEyebrowRow}>
            <Text style={styles.cardEyebrow}>{runTypeLabel || "PICKUP"}</Text>
            {tierBadgeLabel ? (
              <View style={styles.tierBadge}>
                <Text style={styles.tierBadgeText}>{tierBadgeLabel}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.cardTitle}>{typeof run?.title === "string" && run.title ? run.title : "Pickup run"}</Text>
          {myLine ? <Text style={styles.myStatus}>{myLine}</Text> : null}
          <View style={styles.pill}>
            <Text style={styles.pillText}>{statusLabel}</Text>
          </View>
          {countChips.length > 0 ? (
            <View style={styles.countChipsRow}>
              {countChips.map((chip) => (
                <View key={chip.key} style={styles.countChip}>
                  <Text style={styles.countChipText}>{chip.label}</Text>
                </View>
              ))}
            </View>
          ) : null}
          <Text style={styles.row}>Start: {fmtPickupDt(typeof run?.start_at === "string" ? run.start_at : null)}</Text>
          {typeof run?.location_text === "string" && run.location_text ? (
            <Text style={styles.row}>Location: {run.location_text}</Text>
          ) : null}
          {waveMessage ? (
            <Text style={[styles.hint, { color: waveMessage.color }]}>{waveMessage.text}</Text>
          ) : null}
          {myStatus === "confirmed" ? (
            <View style={styles.confirmedBanner}>
              <FontAwesome name="check-circle" size={18} color="#bbf7d0" />
              <Text style={styles.confirmedBannerText}>You&apos;re in! See you on the field.</Text>
            </View>
          ) : myStatus === "standby" ? (
            <View style={styles.standbyBanner}>
              <FontAwesome name="hourglass-half" size={16} color="#fcd34d" />
              <Text style={styles.standbyBannerText}>
                You&apos;re on standby — we&apos;ll notify you if a spot opens.
              </Text>
            </View>
          ) : myStatus === "pending_payment" ? (
            <Pressable
              style={[styles.primaryPay, payDisabled && styles.primaryJoinDisabled]}
              disabled={payDisabled}
              onPress={() => void payPickup(token, runId, load)}
            >
              {payBusy ? (
                <ActivityIndicator color="#111" />
              ) : (
                <>
                  <FontAwesome name="credit-card" size={16} color="#111" />
                  <Text style={styles.primaryJoinText}> Complete payment</Text>
                </>
              )}
            </Pressable>
          ) : (
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
          )}
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
  cardEyebrowRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  cardEyebrow: { fontSize: 12, fontWeight: "600", color: "rgba(255,255,255,0.55)", letterSpacing: 1 },
  tierBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
    backgroundColor: "rgba(163,230,53,0.12)",
  },
  tierBadgeText: { color: "#a3e635", fontSize: 12, fontWeight: "800", letterSpacing: 0.5 },
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
  countChipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
  },
  countChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  countChipText: { color: "rgba(255,255,255,0.78)", fontSize: 12, fontWeight: "600" },
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
  primaryPay: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
    width: "100%",
    marginTop: 18,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "#a3e635",
  },
  primaryJoinDisabled: { opacity: 0.45 },
  primaryJoinText: { color: "#111", fontWeight: "800", fontSize: 15 },
  confirmedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    alignSelf: "stretch",
    marginTop: 18,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(16,185,129,0.45)",
    backgroundColor: "rgba(16,185,129,0.18)",
  },
  confirmedBannerText: { color: "#bbf7d0", fontWeight: "700", fontSize: 15, flexShrink: 1 },
  standbyBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    alignSelf: "stretch",
    marginTop: 18,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.45)",
    backgroundColor: "rgba(245,158,11,0.18)",
  },
  standbyBannerText: { color: "#fcd34d", fontWeight: "600", fontSize: 14, flexShrink: 1, lineHeight: 20 },
  err: { marginTop: 16, color: "#fca5a5" },
});
