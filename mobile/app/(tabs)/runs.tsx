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

/**
 * Fixed availability ranges shown during the planning poll. The `slot_label`
 * value is what gets sent to (and matched against) `/api/pickup/commit` —
 * the server creates a `pickup_run_time_slots` row with that label on first
 * use and reuses it for subsequent commits.
 */
const FIXED_AVAILABILITY_RANGES = [
  { display: "10am – 12pm", slot_label: "10am-12pm" },
  { display: "3pm – 5pm", slot_label: "3pm-5pm" },
  { display: "7pm – 10pm", slot_label: "7pm-10pm" },
] as const;

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
    data,
    run,
    noFeaturedRun,
    load,
    myStatus,
    counts,
    visibility,
    invitedNow,
    tier,
    tierRank,
  } = usePickupPublic(token);
  const {
    joinBusy,
    joinPickup,
    payBusy,
    payPickup,
    declineBusy,
    declinePickup,
    availabilityBusy,
    commitAvailability,
    pendingSlotKey,
  } = usePickupJoin();
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

  // Surfaces from the raw payload that the typed wrapper doesn't expose yet
  // (planning poll, attendees, location, updates). All optional and defensively typed.
  const dataObj = useMemo(
    () => (data && typeof data === "object" ? (data as Record<string, unknown>) : {}),
    [data],
  );

  const updateMessages = useMemo(() => {
    const out: { key: string; text: string }[] = [];
    const pick = (raw: unknown): string | null => {
      if (!raw || typeof raw !== "object") return null;
      const m = (raw as { message?: unknown }).message;
      return typeof m === "string" && m.trim().length > 0 ? m : null;
    };
    const g = pick(dataObj.globalUpdate);
    if (g) out.push({ key: "global", text: g });
    const r = pick(dataObj.runUpdate);
    if (r) out.push({ key: "run", text: r });
    return out;
  }, [dataObj]);

  type MyAvailability = {
    slot_id: string | null;
    slot_label: string | null;
    state: string | null;
  };

  const planning = useMemo<{ myAvailability: MyAvailability | null }>(() => {
    const raw = dataObj.planning;
    if (!raw || typeof raw !== "object") return { myAvailability: null };
    const p = raw as Record<string, unknown>;

    let myAvailability: MyAvailability | null = null;
    if (p.my_availability && typeof p.my_availability === "object") {
      const m = p.my_availability as Record<string, unknown>;
      myAvailability = {
        slot_id: typeof m.slot_id === "string" ? m.slot_id : null,
        slot_label: typeof m.slot_label === "string" ? m.slot_label : null,
        state: typeof m.state === "string" ? m.state : null,
      };
    }
    return { myAvailability };
  }, [dataObj]);

  type Attendee = { full_name: string; instagram: string | null };
  const attendees = useMemo<Attendee[]>(() => {
    const raw = dataObj.attendees;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const a = entry as Record<string, unknown>;
        const name = typeof a.full_name === "string" && a.full_name.trim().length > 0 ? a.full_name : "Player";
        const instagram = typeof a.instagram === "string" && a.instagram.length > 0 ? a.instagram : null;
        return { full_name: name, instagram } satisfies Attendee;
      })
      .filter((a): a is Attendee => a !== null);
  }, [dataObj]);

  const locationText = useMemo(() => {
    const v = dataObj.location;
    return typeof v === "string" && v.trim().length > 0 ? v : null;
  }, [dataObj]);

  const cancellationDeadline = useMemo(() => {
    const v = run?.cancellation_deadline;
    return typeof v === "string" && v.length > 0 ? v : null;
  }, [run]);

  const showAvailabilityPoll = useMemo(() => {
    const st = run?.status;
    if (st !== "planning" && st !== "likely_on") return false;
    return run?.final_slot_id == null;
  }, [run]);

  const attendanceVisible = visibility?.attendanceVisible === true;

  // Wave-specific messaging using API visibility + me fields.
  // tier_rank mapping (locked): 1A=1, 1B=2, 2=3, 3=4, 4=5, PUBLIC=6
  const waveMessage = useMemo<{ text: string; color: string } | null>(() => {
    if (invitedNow) {
      return { text: "Your wave is open request your spot now", color: "#a3e635" };
    }
    if (typeof tierRank === "number") {
      if (tierRank <= 2) {
        return { text: "Your wave isn't open yet check back soon", color: "rgba(255,255,255,0.72)" };
      }
      if (tierRank >= 3) {
        return { text: "Open tier pickup all approved players welcome", color: "rgba(255,255,255,0.72)" };
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
        Featured pickup for {serviceRegionName(region)} ({region}) same account everywhere.
      </Text>
      <View style={styles.linkRow}>
        <Pressable
          onPress={() => (router.push as (href: string) => void)("/how-pickup-works")}
          style={({ pressed }) => [styles.howItWorksRow, pressed && { opacity: 0.7 }]}
          accessibilityRole="link"
          accessibilityLabel="How it works"
        >
          <FontAwesome name="info-circle" size={14} color="#a3e635" />
          <Text style={styles.howItWorksText}>How it works</Text>
          <FontAwesome name="angle-right" size={16} color="rgba(163,230,53,0.7)" />
        </Pressable>
        <Pressable
          onPress={() => (router.push as (href: string) => void)("/pickup-status")}
          style={({ pressed }) => [styles.howItWorksRow, pressed && { opacity: 0.7 }]}
          accessibilityRole="link"
          accessibilityLabel="Pickup status"
        >
          <FontAwesome name="bullhorn" size={14} color="#a3e635" />
          <Text style={styles.howItWorksText}>Pickup status</Text>
          <FontAwesome name="angle-right" size={16} color="rgba(163,230,53,0.7)" />
        </Pressable>
      </View>

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
        <>
          {updateMessages.length > 0 ? (
            <View style={styles.updatesCard}>
              {updateMessages.map((u) => (
                <View key={u.key} style={styles.updateBlock}>
                  <Text style={styles.cardEyebrow}>UPDATE</Text>
                  <Text style={styles.updateText}>{u.text}</Text>
                </View>
              ))}
            </View>
          ) : null}

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

            {showAvailabilityPoll ? (
              <View style={styles.pollSection}>
                <Text style={styles.pollHeading}>Availability poll</Text>
                <View style={styles.pollSlotList}>
                  {FIXED_AVAILABILITY_RANGES.map((range) => {
                    const picked =
                      planning.myAvailability?.state === "available" &&
                      planning.myAvailability?.slot_label === range.slot_label;
                    const slotDisabled = !invitedNow || availabilityBusy || !runId;
                    const showSpinner =
                      availabilityBusy && pendingSlotKey === range.slot_label;
                    return (
                      <Pressable
                        key={range.slot_label}
                        disabled={slotDisabled}
                        onPress={() =>
                          void commitAvailability(
                            token,
                            runId,
                            "available",
                            null,
                            load,
                            range.slot_label,
                          )
                        }
                        style={({ pressed }) => [
                          styles.slotButton,
                          picked && styles.slotButtonPicked,
                          slotDisabled && styles.slotButtonDisabled,
                          pressed && !slotDisabled && { opacity: 0.85 },
                        ]}
                      >
                        <View style={styles.slotButtonRow}>
                          <Text
                            style={[styles.slotTime, picked && styles.slotTimePicked]}
                            numberOfLines={1}
                          >
                            {range.display}
                          </Text>
                          {showSpinner ? (
                            <ActivityIndicator color="#a3e635" size="small" />
                          ) : null}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
                <Pressable
                  disabled={!invitedNow || availabilityBusy || !runId}
                  onPress={() =>
                    void commitAvailability(token, runId, "declined", null, load)
                  }
                  style={({ pressed }) => [
                    styles.declineSlotButton,
                    (!invitedNow || availabilityBusy || !runId) && styles.declineSlotButtonDisabled,
                    pressed && invitedNow && !availabilityBusy && { opacity: 0.85 },
                  ]}
                >
                  <Text style={styles.declineSlotText}>Decline</Text>
                </Pressable>
              </View>
            ) : null}

            {myStatus === "confirmed" ? (
              <>
                <View style={styles.confirmedBanner}>
                  <FontAwesome name="check-circle" size={18} color="#bbf7d0" />
                  <Text style={styles.confirmedBannerText}>You&apos;re in. See you on the field.</Text>
                </View>
                <Pressable
                  disabled={declineBusy || !runId}
                  onPress={() => void declinePickup(token, runId, load)}
                  style={({ pressed }) => [
                    styles.cancelSpotButton,
                    (declineBusy || !runId) && styles.cancelSpotButtonDisabled,
                    pressed && !declineBusy && runId && { opacity: 0.85 },
                  ]}
                >
                  {declineBusy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.cancelSpotText}>Cancel spot</Text>
                  )}
                </Pressable>
              </>
            ) : myStatus === "standby" ? (
              <View style={styles.standbyBanner}>
                <FontAwesome name="hourglass-half" size={16} color="#fcd34d" />
                <Text style={styles.standbyBannerText}>
                  You&apos;re on standby we&apos;ll notify you if a spot opens.
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
            ) : !showAvailabilityPoll ? (
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
            ) : null}

            {cancellationDeadline ? (
              <Text style={styles.deadlineText}>
                Cancellation deadline: {fmtPickupDt(cancellationDeadline)}
              </Text>
            ) : null}
          </View>

          {attendanceVisible ? (
            <View style={styles.subCard}>
              <Text style={styles.subCardHeading}>Attendance</Text>
              {attendees.length === 0 ? (
                <Text style={styles.subCardBody}>No confirmed players shown yet.</Text>
              ) : (
                <View style={styles.attendeeList}>
                  {attendees.map((a, idx) => (
                    <Text key={`${a.full_name}-${idx}`} style={styles.attendeeRow}>
                      {a.full_name}
                      {a.instagram ? (
                        <Text style={styles.attendeeHandle}> (@{a.instagram})</Text>
                      ) : null}
                    </Text>
                  ))}
                </View>
              )}
            </View>
          ) : null}

          {locationText ? (
            <View style={styles.subCard}>
              <Text style={styles.subCardHeading}>Location</Text>
              <Text style={styles.subCardBody}>{locationText}</Text>
            </View>
          ) : null}
        </>
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
  linkRow: {
    marginTop: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
  },
  howItWorksRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
    backgroundColor: "rgba(163,230,53,0.08)",
  },
  howItWorksText: { color: "#a3e635", fontSize: 13, fontWeight: "800" },
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
  updatesCard: {
    marginTop: 20,
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(0,0,0,0.4)",
    gap: 14,
  },
  updateBlock: { gap: 6 },
  updateText: { color: "#fff", fontSize: 14, lineHeight: 21 },
  subCard: {
    marginTop: 16,
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  subCardHeading: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    color: "rgba(255,255,255,0.7)",
    textTransform: "uppercase",
  },
  subCardBody: {
    marginTop: 8,
    color: "rgba(255,255,255,0.85)",
    fontSize: 14,
    lineHeight: 21,
  },
  attendeeList: { marginTop: 10, gap: 6 },
  attendeeRow: { color: "rgba(255,255,255,0.85)", fontSize: 14, lineHeight: 20 },
  attendeeHandle: { color: "rgba(255,255,255,0.55)" },
  pollSection: { marginTop: 18, gap: 10 },
  pollHeading: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    color: "rgba(255,255,255,0.8)",
    textTransform: "uppercase",
  },
  pollSlotList: { gap: 8 },
  slotButton: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  slotButtonPicked: {
    borderColor: "#a3e635",
    backgroundColor: "rgba(163,230,53,0.12)",
  },
  slotButtonDisabled: { opacity: 0.5 },
  slotButtonRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  slotTime: { color: "#fff", fontSize: 15, fontWeight: "600", flexShrink: 1 },
  slotTimePicked: { color: "#a3e635" },
  declineSlotButton: {
    alignSelf: "flex-start",
    marginTop: 4,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  declineSlotButtonDisabled: { opacity: 0.45 },
  declineSlotText: { color: "rgba(255,255,255,0.85)", fontSize: 13, fontWeight: "700" },
  cancelSpotButton: {
    alignSelf: "flex-start",
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  cancelSpotButtonDisabled: { opacity: 0.45 },
  cancelSpotText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  deadlineText: {
    marginTop: 14,
    color: "rgba(255,255,255,0.65)",
    fontSize: 13,
    lineHeight: 19,
  },
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
