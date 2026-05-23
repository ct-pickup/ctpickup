import { AnimatedPressScale } from "@/components/AnimatedPressScale";
import { AvailabilityPoll, type PickupPlanningAvailability } from "@/components/pickup/AvailabilityPoll";
import { PayForFriendButton } from "@/components/pickup/PayForFriendButton";
import { RegionsPickerPanel } from "@/components/RegionsPickerPanel";
import { useAuth } from "@/context/AuthContext";
import { useSelectedRegion } from "@/context/SelectedRegionContext";
import { usePickupJoin } from "@/hooks/usePickupJoin";
import { usePickupPublic } from "@/hooks/usePickupPublic";
import { useTeamChatAccess } from "@/hooks/useTeamChat";
import { hapticGoal, hapticTap } from "@/lib/haptics";
import { fmtPickupDateEt, fmtPickupTimeEt } from "@/lib/pickupPublic";
import { isPublicPickupRunType, isSelectPickupRunType } from "@/lib/pickupRunType";
import { fetchPickupStanding } from "@/lib/siteApi";
import { useUserChatRooms } from "@/lib/teamChat";
import { serviceRegionName, type ServiceRegionCode } from "@/lib/serviceRegions";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

const BG = "#0a0a0a";
const LIME = "#a3e635";
const DIVIDER = "rgba(255,255,255,0.06)";

function SkeletonCard() {
  return (
    <View style={styles.skeletonCard}>
      <View style={[styles.skelLine, { width: "35%", height: 12 }]} />
      <View style={[styles.skelLine, { width: "90%", height: 28, marginTop: 14 }]} />
      <View style={[styles.skelLine, { width: "70%", marginTop: 12 }]} />
      <View style={[styles.skelLine, { width: "50%", marginTop: 12 }]} />
      <View style={[styles.skelBtn, { marginTop: 20 }]} />
    </View>
  );
}

function runStatusPillLabel(st: string | null | undefined): string {
  if (!st) return "Upcoming";
  if (st === "planning") return "Planning";
  if (st === "likely_on") return "Confirmed";
  if (st === "active") return "Open";
  if (st === "in_progress") return "Live";
  if (st === "completed") return "Completed";
  if (st === "canceled") return "Canceled";
  return st.replace(/_/g, " ");
}

function rsvpStatusMessage(myStatus: string | null, waitlistMinutesLeft: number | null): string | null {
  if (myStatus === "confirmed") return "You're confirmed for this run.";
  if (myStatus === "pending_payment") return "Finish payment to secure your spot.";
  if (myStatus === "pending_confirm") {
    if (waitlistMinutesLeft != null && waitlistMinutesLeft > 0) {
      return `You have ${waitlistMinutesLeft} minute${waitlistMinutesLeft === 1 ? "" : "s"} to confirm your spot.`;
    }
    return "A spot opened — confirm now before your offer expires.";
  }
  if (myStatus === "standby" || myStatus === "waitlist") return "You're on the waitlist — we'll notify you if a spot opens.";
  return null;
}

function CardDivider() {
  return <View style={styles.divider} />;
}

export default function RunsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const { region, setRegion } = useSelectedRegion();
  const [showStatePicker, setShowStatePicker] = useState(true);
  const [detailOpen, setDetailOpen] = useState(false);
  const [reliabilityScore, setReliabilityScore] = useState<number | null>(null);
  const autoOpenedFromDeepLinkRef = useRef(false);

  const { run_id: rawRunIdParam } = useLocalSearchParams<{ run_id?: string | string[] }>();
  const focusRunIdParam = useMemo(() => {
    const raw = rawRunIdParam;
    if (typeof raw === "string" && raw.trim()) return raw.trim();
    if (Array.isArray(raw) && typeof raw[0] === "string" && raw[0].trim()) return raw[0].trim();
    return null;
  }, [rawRunIdParam]);

  useFocusEffect(
    useCallback(() => {
      setShowStatePicker(true);
    }, []),
  );

  useEffect(() => {
    navigation.setOptions?.({
      title: showStatePicker ? "Pickup by state" : "Pickup",
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

  useEffect(() => {
    if (!token) {
      setReliabilityScore(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const r = await fetchPickupStanding(token);
      if (cancelled) return;
      const scorePct = r.data?.reliability?.score_pct;
      if (r.ok && r.data?.ok && scorePct != null) {
        setReliabilityScore(Math.round(Number(scorePct)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const onPickState = useCallback(
    (code: ServiceRegionCode) => {
      void setRegion(code);
      setShowStatePicker(false);
    },
    [setRegion],
  );

  const { allowed: chatAllowed } = useTeamChatAccess();

  const { loading, error, data, run, counts, myStatus, myWaitlistExpiresAt, invitedNow, noFeaturedRun, load } =
    usePickupPublic(token, { focusRunId: focusRunIdParam });
  const [countdownTick, setCountdownTick] = useState(0);
  const { joinBusy, joinPickup, payBusy, payPickup, availabilityBusy, recordCantMakeIt } = usePickupJoin();

  const chatEnabled = !!session?.user?.id && chatAllowed === true;
  const { rooms } = useUserChatRooms(chatEnabled);

  const runId = typeof run?.id === "string" ? run.id : null;
  const runStatus = typeof run?.status === "string" ? run.status : null;
  const runLocked = runStatus === "in_progress";

  const banterRoomId = useMemo(() => {
    if (!runId) return null;
    const room = rooms.find((r) => r.room_type === "run_banter" && r.run_id === runId);
    return room?.id ?? null;
  }, [rooms, runId]);

  const capacity = Number(run?.capacity ?? 0) || 0;
  const confirmed = Number(counts?.confirmed ?? 0) || 0;
  const spotsLeft = capacity > 0 ? Math.max(0, capacity - confirmed) : null;
  const fillRatio = capacity > 0 ? Math.min(1, confirmed / capacity) : 0;

  const feeCents = typeof run?.fee_cents === "number" ? run.fee_cents : 0;
  const isFree = feeCents <= 0;

  const showTypeLabel = run ? isPublicPickupRunType(run.run_type) || isSelectPickupRunType(run.run_type) : false;
  const typeLabel = run
    ? isPublicPickupRunType(run.run_type)
      ? "Public"
      : isSelectPickupRunType(run.run_type)
        ? "Select"
        : ""
    : "";

  const title =
    typeof run?.title === "string" && run.title.trim()
      ? run.title.trim()
      : typeof run?.location_text === "string" && run.location_text.trim()
        ? run.location_text.split(/\r?\n/)[0]?.trim() ?? "Pickup run"
        : "Pickup run";

  const venue =
    typeof run?.location_text === "string" && run.location_text.trim()
      ? run.location_text.split(/\r?\n/)[0]?.trim()
      : title;

  const planning = useMemo((): PickupPlanningAvailability | null => {
    if (!data || typeof data !== "object") return null;
    const p = (data as Record<string, unknown>).planning;
    if (!p || typeof p !== "object") return null;
    return p as PickupPlanningAvailability;
  }, [data]);

  const hasDeclinedAvailability = useMemo(() => {
    const ma = planning?.my_availability;
    if (!Array.isArray(ma)) return false;
    return ma.some((entry) => entry?.state === "declined");
  }, [planning]);

  const showAvailabilityPoll =
    !!run &&
    invitedNow &&
    !runLocked &&
    isPublicPickupRunType(run.run_type) &&
    (runStatus === "planning" || runStatus === "likely_on") &&
    run.final_slot_id == null &&
    !hasDeclinedAvailability;

  const showPayForFriend =
    !!run &&
    !!token &&
    !runLocked &&
    myStatus === "confirmed" &&
    spotsLeft != null &&
    spotsLeft > 0;

  const eligibleToJoin =
    !!token &&
    !!runId &&
    !runLocked &&
    invitedNow &&
    (myStatus == null || myStatus === "declined") &&
    (isPublicPickupRunType(run?.run_type) ||
      (isSelectPickupRunType(run?.run_type) && run?.final_slot_id != null));

  const timeFinalized = runStatus === "active" || runStatus === "likely_on";
  const showImIn = eligibleToJoin && timeFinalized;
  const showCantMakeIt =
    eligibleToJoin &&
    (timeFinalized || runStatus === "planning") &&
    myStatus !== "declined" &&
    !hasDeclinedAvailability;
  const isPlanning = runStatus === "planning";

  const hasRsvp =
    myStatus === "confirmed" ||
    myStatus === "standby" ||
    myStatus === "waitlist" ||
    myStatus === "pending_payment" ||
    myStatus === "pending_confirm";

  const waitlistMinutesLeft = useMemo(() => {
    void countdownTick;
    if (myStatus !== "pending_confirm" || !myWaitlistExpiresAt) return null;
    const expiresMs = Date.parse(myWaitlistExpiresAt);
    if (!Number.isFinite(expiresMs)) return null;
    const diffMs = expiresMs - Date.now();
    if (diffMs <= 0) return 0;
    return Math.max(1, Math.ceil(diffMs / 60_000));
  }, [myStatus, myWaitlistExpiresAt, countdownTick]);

  useEffect(() => {
    if (myStatus !== "pending_confirm") return;
    const id = setInterval(() => setCountdownTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, [myStatus]);

  useEffect(() => {
    const sub = Linking.addEventListener("url", (event) => {
      const u = event.url || "";
      if (u.startsWith("ctpickup://pickup")) {
        void load();
      }
    });
    return () => sub.remove();
  }, [load]);

  const rsvpMessage = rsvpStatusMessage(myStatus, waitlistMinutesLeft);

  const onRefresh = useCallback(() => {
    void load();
  }, [load]);

  const openRunDetail = useCallback(() => {
    console.log("[runs] run card pressed");
    // #region agent log
    fetch("http://127.0.0.1:7868/ingest/78e6354c-1d0e-4ef4-8b99-968b7592c0e3", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "525a8d" },
      body: JSON.stringify({
        sessionId: "525a8d",
        runId: "pre-fix",
        hypothesisId: "A",
        location: "runs.tsx:openRunDetail",
        message: "run card onPress fired",
        data: { runId, hadDetailOpen: detailOpen },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    void hapticTap();
    setDetailOpen(true);
  }, [detailOpen, runId]);

  const closeRunDetail = useCallback(() => {
    setDetailOpen(false);
  }, []);

  useEffect(() => {
    if (!focusRunIdParam || !run || showStatePicker || autoOpenedFromDeepLinkRef.current) return;
    autoOpenedFromDeepLinkRef.current = true;
    setDetailOpen(true);
    // #region agent log
    fetch("http://127.0.0.1:7868/ingest/78e6354c-1d0e-4ef4-8b99-968b7592c0e3", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "525a8d" },
      body: JSON.stringify({
        sessionId: "525a8d",
        runId: "pre-fix",
        hypothesisId: "E",
        location: "runs.tsx:autoOpenDeepLink",
        message: "auto-opened detail from run_id param",
        data: { focusRunIdParam },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  }, [focusRunIdParam, run, showStatePicker]);

  useEffect(() => {
    // #region agent log
    fetch("http://127.0.0.1:7868/ingest/78e6354c-1d0e-4ef4-8b99-968b7592c0e3", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "525a8d" },
      body: JSON.stringify({
        sessionId: "525a8d",
        runId: "pre-fix",
        hypothesisId: "B",
        location: "runs.tsx:detailOpenEffect",
        message: "detailOpen state changed",
        data: { detailOpen, hasRun: !!run },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  }, [detailOpen, run]);

  const onImIn = useCallback(() => {
    if (!token || !runId) {
      Alert.alert("Sign in required", "Sign in to join this run.");
      return;
    }
    void hapticTap();
    void joinPickup(
      token,
      runId,
      async () => {
        await load();
        void hapticGoal();
      },
      { venueName: venue },
    );
  }, [token, runId, joinPickup, load, venue]);

  const onCantMakeIt = useCallback(() => {
    if (!token || !runId) {
      Alert.alert("Sign in required", "Sign in to respond to this run.");
      return;
    }
    void hapticTap();
    void recordCantMakeIt(token, runId, runStatus, run?.final_slot_id, async () => {
      await load();
    });
  }, [token, runId, runStatus, run?.final_slot_id, recordCantMakeIt, load]);

  const onCompletePayment = useCallback(() => {
    if (!token || !runId) return;
    void hapticTap();
    void payPickup(token, runId, load, { venueName: venue });
  }, [token, runId, payPickup, load, venue]);

  const onConfirmSpot = useCallback(() => {
    if (!token || !runId) {
      Alert.alert("Sign in required", "Sign in to confirm your spot.");
      return;
    }
    void hapticTap();
    if (myStatus === "pending_confirm" && feeCents > 0) {
      void payPickup(token, runId, load, { venueName: venue });
      return;
    }
    void joinPickup(
      token,
      runId,
      async () => {
        await load();
        void hapticGoal();
      },
      { venueName: venue },
    );
  }, [token, runId, myStatus, feeCents, payPickup, joinPickup, load, venue]);

  const onOpenChat = useCallback(() => {
    if (banterRoomId) {
      void hapticTap();
      router.push({ pathname: "/(tabs)/messages/thread", params: { id: banterRoomId } });
      return;
    }
    Alert.alert(
      "Chat not ready yet",
      "Run chat opens once you're confirmed and the room is set up. Check Messages in a moment.",
    );
  }, [banterRoomId, router]);

  if (showStatePicker) {
    return (
      <SafeAreaView style={styles.pickerSafe} edges={["bottom"]}>
        <RegionsPickerPanel onSelectState={onPickState} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor={LIME} />}
      >
        <View style={styles.header}>
          <Text style={styles.h1} numberOfLines={1}>
            Runs
          </Text>
          <View style={styles.headerRight}>
            {reliabilityScore != null ? (
              <Animated.View entering={FadeIn.duration(500).delay(200)} style={styles.reliabilityPill}>
                <Text style={styles.reliabilityScoreText}>{reliabilityScore}</Text>
              </Animated.View>
            ) : null}
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
        </View>
        <Text style={styles.regionSub}>Featured pickup for {serviceRegionName(region)} ({region}).</Text>

        {loading && !run ? (
          <SkeletonCard />
        ) : error ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Could not load runs</Text>
            <Text style={styles.emptyBody}>{error}</Text>
            <Pressable onPress={onRefresh} style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.9 }]}>
              <Text style={styles.retryBtnText}>Try again</Text>
            </Pressable>
          </View>
        ) : noFeaturedRun || !run ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No runs yet. Check back soon!</Text>
            <Text style={styles.emptyBody}>
              When admin posts a pickup in {serviceRegionName(region)}, it will show up here.
            </Text>
          </View>
        ) : !invitedNow && isSelectPickupRunType(run.run_type) ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Invite only</Text>
            <Text style={styles.emptyBody}>
              This is a select run. You will see it here once you are invited.
            </Text>
          </View>
        ) : (
          <>
            <AnimatedPressScale
              accessibilityRole="button"
              accessibilityLabel="Open run details"
              pressedScale={0.98}
              hapticOnPress
              onPress={openRunDetail}
              style={styles.card}
            >
              <View style={styles.cardHeader}>
                <View style={styles.titleBlock}>
                  <View style={styles.titleRow}>
                    <Text style={styles.cardTitle} numberOfLines={2}>
                      {title}
                    </Text>
                    {showTypeLabel && typeLabel ? (
                      <Text style={styles.typeLabel}>{typeLabel}</Text>
                    ) : null}
                  </View>
                </View>
                <View style={styles.cardHeaderRight}>
                  <View style={styles.statusPill}>
                    <Text style={styles.statusPillText}>{runStatusPillLabel(runStatus)}</Text>
                  </View>
                  <FontAwesome name="chevron-right" size={14} color="rgba(255,255,255,0.35)" />
                </View>
              </View>

              <CardDivider />

              <View style={styles.dateTimeRow}>
                {isPlanning ? (
                  <>
                    <Text style={styles.datePlanning}>
                      {fmtPickupDateEt(typeof run.start_at === "string" ? run.start_at : null)}
                    </Text>
                    <Text style={styles.planningTimeHint}>Time TBD — tap for details</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.dateEt}>
                      {fmtPickupDateEt(typeof run.start_at === "string" ? run.start_at : null)}
                    </Text>
                    <Text style={styles.timeEt}>
                      {fmtPickupTimeEt(typeof run.start_at === "string" ? run.start_at : null)} ET
                    </Text>
                  </>
                )}
              </View>

              <CardDivider />

              <View style={styles.locationRow}>
                <FontAwesome name="map-marker" size={14} color="rgba(255,255,255,0.35)" style={styles.locationIcon} />
                <Text style={styles.venue} numberOfLines={2}>
                  {venue}
                </Text>
              </View>

              <CardDivider />

              <View style={styles.feeSpotsRow}>
                <Text style={styles.fee}>
                  {isFree ? "Free" : `$${(feeCents / 100).toFixed(2)} per player`}
                </Text>
                {capacity > 0 ? (
                  <View style={styles.spotsBlock}>
                    <View style={styles.progressTrack}>
                      <View style={[styles.progressFill, { width: `${fillRatio * 100}%` }]} />
                    </View>
                    <Text style={styles.spotsLabel}>
                      {confirmed} / {capacity} spot{capacity === 1 ? "" : "s"}
                    </Text>
                  </View>
                ) : null}
              </View>
            </AnimatedPressScale>

            <Modal visible={detailOpen} animationType="slide" transparent onRequestClose={closeRunDetail}>
              <View style={styles.modalRoot}>
                <Pressable style={styles.modalBackdrop} onPress={closeRunDetail} accessibilityLabel="Close run details" />
                <View style={[styles.detailSheet, { paddingBottom: insets.bottom + 16 }]}>
                  <View style={styles.sheetHeader}>
                    <Text style={styles.sheetTitle}>Run details</Text>
                    <Pressable onPress={closeRunDetail} hitSlop={12} accessibilityLabel="Close">
                      <FontAwesome name="times" size={20} color="#fff" />
                    </Pressable>
                  </View>
                  <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetScroll}>
                    <View style={styles.card}>
                      <View style={styles.cardHeader}>
                        <View style={styles.titleBlock}>
                          <View style={styles.titleRow}>
                            <Text style={styles.cardTitle} numberOfLines={3}>
                              {title}
                            </Text>
                            {showTypeLabel && typeLabel ? (
                              <Text style={styles.typeLabel}>{typeLabel}</Text>
                            ) : null}
                          </View>
                        </View>
                        <View style={styles.statusPill}>
                          <Text style={styles.statusPillText}>{runStatusPillLabel(runStatus)}</Text>
                        </View>
                      </View>

                      <CardDivider />

                      <View style={styles.dateTimeRow}>
                        {isPlanning ? (
                          <>
                            <Text style={styles.datePlanning}>
                              {fmtPickupDateEt(typeof run.start_at === "string" ? run.start_at : null)}
                            </Text>
                            <Text style={styles.planningTimeHint}>Time TBD — vote below</Text>
                          </>
                        ) : (
                          <>
                            <Text style={styles.dateEt}>
                              {fmtPickupDateEt(typeof run.start_at === "string" ? run.start_at : null)}
                            </Text>
                            <Text style={styles.timeEt}>
                              {fmtPickupTimeEt(typeof run.start_at === "string" ? run.start_at : null)} ET
                            </Text>
                          </>
                        )}
                      </View>

                      <CardDivider />

                      <View style={styles.locationRow}>
                        <FontAwesome
                          name="map-marker"
                          size={14}
                          color="rgba(255,255,255,0.35)"
                          style={styles.locationIcon}
                        />
                        <Text style={styles.venue}>{venue}</Text>
                      </View>

                      <CardDivider />

                      <View style={styles.feeSpotsRow}>
                        <Text style={styles.fee}>
                          {isFree ? "Free" : `$${(feeCents / 100).toFixed(2)} per player`}
                        </Text>
                        {capacity > 0 ? (
                          <View style={styles.spotsBlock}>
                            <View style={styles.progressTrack}>
                              <View style={[styles.progressFill, { width: `${fillRatio * 100}%` }]} />
                            </View>
                            <Text style={styles.spotsLabel}>
                              {confirmed} / {capacity} spot{capacity === 1 ? "" : "s"}
                            </Text>
                          </View>
                        ) : null}
                      </View>

            {showAvailabilityPoll ? (
              <>
                <CardDivider />
                <AvailabilityPoll
                  run={run}
                  planning={planning}
                  onSubmit={() => {
                    void load();
                  }}
                />
              </>
            ) : null}

            {hasRsvp && rsvpMessage ? (
              <>
                <CardDivider />
                <View style={styles.rsvpBlock}>
                  <Text style={styles.rsvpStatus}>{rsvpMessage}</Text>
                  {myStatus === "pending_confirm" && !runLocked ? (
                    <>
                      {waitlistMinutesLeft != null && waitlistMinutesLeft > 0 ? (
                        <Text style={styles.countdown}>
                          You have {waitlistMinutesLeft} minute{waitlistMinutesLeft === 1 ? "" : "s"} to confirm your
                          spot
                        </Text>
                      ) : null}
                      <Pressable
                        disabled={joinBusy || payBusy}
                        onPress={onConfirmSpot}
                        style={({ pressed }) => [
                          styles.primaryBtn,
                          pressed && { opacity: 0.9 },
                          (joinBusy || payBusy) && styles.btnDisabled,
                        ]}
                      >
                        <Text style={styles.primaryBtnText}>
                          {joinBusy || payBusy ? "Opening checkout…" : "Confirm spot now"}
                        </Text>
                      </Pressable>
                    </>
                  ) : null}
                  {myStatus === "pending_payment" && !runLocked ? (
                    <Pressable
                      disabled={payBusy}
                      onPress={onCompletePayment}
                      style={({ pressed }) => [
                        styles.primaryBtn,
                        pressed && { opacity: 0.9 },
                        payBusy && styles.btnDisabled,
                      ]}
                    >
                      <Text style={styles.primaryBtnText}>
                        {payBusy ? "Opening checkout…" : "Complete payment"}
                      </Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    onPress={onRefresh}
                    style={({ pressed }) => [styles.refreshStatusBtn, pressed && { opacity: 0.9 }]}
                  >
                    <Text style={styles.refreshStatusBtnText}>Refresh my status</Text>
                  </Pressable>
                  {(myStatus === "confirmed" || myStatus === "standby" || myStatus === "waitlist") && (
                    <Pressable
                      onPress={onOpenChat}
                      style={({ pressed }) => [styles.chatBtn, pressed && { opacity: 0.9 }]}
                    >
                      <FontAwesome name="comments" size={16} color={LIME} />
                      <Text style={styles.chatBtnText}> Open run chat</Text>
                    </Pressable>
                  )}
                  {showPayForFriend ? (
                    <PayForFriendButton
                      run={run}
                      onSuccess={() => {
                        void load();
                      }}
                    />
                  ) : null}
                </View>
              </>
            ) : showImIn || showCantMakeIt ? (
              <>
                <CardDivider />
                <View style={styles.ctaBlock}>
                  {showImIn ? (
                    <Pressable
                      disabled={joinBusy}
                      onPress={onImIn}
                      style={({ pressed }) => [
                        styles.primaryBtn,
                        pressed && !joinBusy && { opacity: 0.9 },
                        joinBusy && styles.btnDisabled,
                      ]}
                    >
                      <Text style={styles.primaryBtnText}>{joinBusy ? "Joining…" : "I'm In"}</Text>
                    </Pressable>
                  ) : null}
                  {showCantMakeIt ? (
                    <Pressable
                      disabled={availabilityBusy}
                      onPress={onCantMakeIt}
                      style={({ pressed }) => [
                        styles.destructiveBtn,
                        pressed && !availabilityBusy && { opacity: 0.9 },
                        availabilityBusy && styles.btnDisabled,
                      ]}
                    >
                      <Text style={styles.destructiveBtnText}>
                        {availabilityBusy ? "Updating…" : "Can't make it?"}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </>
            ) : isSelectPickupRunType(run.run_type) && !run.final_slot_id ? (
              <>
                <CardDivider />
                <Text style={styles.hint}>Time not finalized yet — check back when admin confirms the slot.</Text>
              </>
            ) : runLocked ? (
              <>
                <CardDivider />
                <Text style={styles.hint}>This run is live — joining is closed.</Text>
              </>
            ) : null}
                    </View>
                  </ScrollView>
                </View>
              </View>
            </Modal>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  pickerSafe: { flex: 1, backgroundColor: BG },
  screen: { flex: 1, backgroundColor: BG },
  content: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 },
  h1: { fontSize: 28, fontWeight: "900", color: "#ffffff", flex: 1, minWidth: 0 },
  reliabilityPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
    backgroundColor: "rgba(163,230,53,0.06)",
  },
  reliabilityScoreText: { color: LIME, fontWeight: "900", fontSize: 15 },
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
  regionSub: { color: "rgba(255,255,255,0.45)", marginTop: 4, marginBottom: 20, fontSize: 14 },
  empty: {
    padding: 24,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  emptyTitle: { color: "#fff", fontSize: 18, fontWeight: "800" },
  emptyBody: { color: "rgba(255,255,255,0.55)", marginTop: 8, lineHeight: 22 },
  retryBtn: {
    marginTop: 16,
    alignSelf: "flex-start",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.4)",
  },
  retryBtnText: { color: LIME, fontWeight: "700" },
  card: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.03)",
    gap: 20,
  },
  divider: { height: 1, backgroundColor: DIVIDER, marginVertical: -4 },
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.65)" },
  detailSheet: {
    maxHeight: "92%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: "#111",
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  sheetTitle: { color: "#fff", fontSize: 18, fontWeight: "800" },
  sheetScroll: { paddingBottom: 24 },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  cardHeaderRight: { flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 0 },
  titleBlock: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", gap: 8 },
  cardTitle: { color: "#ffffff", fontSize: 22, fontWeight: "900", lineHeight: 28 },
  typeLabel: {
    color: "rgba(255,255,255,0.35)",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.04)",
    flexShrink: 0,
  },
  statusPillText: { color: "rgba(255,255,255,0.65)", fontSize: 11, fontWeight: "700", letterSpacing: 0.2 },
  dateTimeRow: { gap: 6 },
  dateEt: { color: "#ffffff", fontSize: 18, fontWeight: "700", letterSpacing: -0.2 },
  datePlanning: { color: "#ffffff", fontSize: 18, fontWeight: "700", letterSpacing: -0.2 },
  planningTimeHint: { color: LIME, fontSize: 14, fontWeight: "500", lineHeight: 20 },
  timeEt: { color: LIME, fontSize: 16, fontWeight: "700" },
  locationRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingTop: 2,
  },
  locationIcon: { marginTop: 3 },
  venue: { flex: 1, color: "rgba(255,255,255,0.75)", fontSize: 15, lineHeight: 22 },
  feeSpotsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  fee: { color: LIME, fontWeight: "800", fontSize: 15, flexShrink: 0 },
  spotsBlock: { flex: 1, maxWidth: 160, gap: 6, alignItems: "flex-end" },
  progressTrack: {
    width: "100%",
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: LIME,
    minWidth: 0,
  },
  spotsLabel: {
    color: LIME,
    fontSize: 12,
    fontWeight: "600",
  },
  rsvpBlock: { gap: 12 },
  rsvpStatus: { color: "rgba(255,255,255,0.75)", lineHeight: 20, fontSize: 14 },
  countdown: { color: LIME, fontWeight: "800", fontSize: 15, lineHeight: 22 },
  refreshStatusBtn: {
    paddingVertical: 12,
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  refreshStatusBtnText: { color: "rgba(255,255,255,0.65)", fontWeight: "600", fontSize: 14 },
  ctaBlock: { gap: 10, alignItems: "center" },
  primaryBtn: {
    width: "100%",
    backgroundColor: LIME,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  primaryBtnText: { color: "#111", fontWeight: "800", fontSize: 17 },
  btnDisabled: { opacity: 0.65 },
  destructiveBtn: {
    width: "100%",
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#ef4444",
  },
  destructiveBtnText: { color: "#ef4444", fontWeight: "800", fontSize: 17 },
  chatBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
    backgroundColor: "rgba(163,230,53,0.06)",
  },
  chatBtnText: { color: LIME, fontWeight: "700", fontSize: 15 },
  hint: { color: "rgba(255,255,255,0.45)", lineHeight: 20, fontSize: 14 },
  skeletonCard: {
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  skelLine: { height: 14, borderRadius: 6, backgroundColor: "rgba(255,255,255,0.08)" },
  skelBtn: { height: 48, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.06)" },
});
