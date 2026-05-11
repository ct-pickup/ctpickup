import { PickupScorePill } from "@/components/PickupScorePill";
import { RegionsPickerPanel } from "@/components/RegionsPickerPanel";
import { useAuth } from "@/context/AuthContext";
import { useRunsPickerBridge } from "@/context/RunsPickerBridge";
import { useSelectedRegion } from "@/context/SelectedRegionContext";
import { usePickupJoin } from "@/hooks/usePickupJoin";
import { usePickupPublic } from "@/hooks/usePickupPublic";
import { usePickupStandingScore } from "@/hooks/usePickupStandingScore";
import { isPublicPickupRunType, isSelectPickupRunType } from "@/lib/pickupRunType";
import { fetchPickupFindPlayer } from "@/lib/siteApi";
import { siteOrigin } from "@/lib/env";
import { hapticGoal, hapticKick, hapticTap } from "@/lib/haptics";
import { fmtPickupDt } from "@/lib/pickupPublic";
import { serviceRegionName, type ServiceRegionCode } from "@/lib/serviceRegions";
import { getNearestVenuesFromApi } from "@/lib/venueDistance";
import { serviceRegionForVenueName } from "@/lib/venueServiceRegion";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useRouter } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const LIME = "#a3e635";

/** Strip legacy internal grouping tokens from admin-authored run text so players only see neutral copy. */
function stripLegacyGroupingTokensFromRunText(s: string): string {
  return s
    .replace(/\b[Tt]ier\s*\d+[A-Za-z]?\b/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

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
  const { session, supabase } = useAuth();
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
    commitAvailabilitySlots,
    pendingSlotKey,
  } = usePickupJoin();
  const { loading: scoreLoading, scorePct, trackedPickups, attendedPickups } = usePickupStandingScore();

  const [showStatePicker, setShowStatePicker] = useState(true);
  const [selectedSlotLabels, setSelectedSlotLabels] = useState<string[]>([]);
  const [availabilitySubmittedBanner, setAvailabilitySubmittedBanner] = useState(false);
  const [skipPreselectAfterChange, setSkipPreselectAfterChange] = useState(false);
  const [profileZipDigits, setProfileZipDigits] = useState<string | null>(null);
  const [runVenueDriveMinutes, setRunVenueDriveMinutes] = useState<number | null>(null);

  const [friendModalOpen, setFriendModalOpen] = useState(false);
  const [friendQuery, setFriendQuery] = useState("");
  const [friendSearchBusy, setFriendSearchBusy] = useState(false);
  const [friendFound, setFriendFound] = useState<{ user_id: string; full_name: string; username: string | null } | null>(
    null,
  );
  const [friendLookupDone, setFriendLookupDone] = useState(false);

  useLayoutEffect(() => {
    registerReset(() => setShowStatePicker(true));
    return () => registerReset(null);
  }, [registerReset]);

  useEffect(() => {
    if (!supabase || !session?.user?.id) {
      setProfileZipDigits(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.from("profiles").select("zip_code").eq("id", session.user.id).maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setProfileZipDigits(null);
        return;
      }
      const z = typeof data.zip_code === "string" ? data.zip_code.replace(/\D/g, "").slice(0, 5) : "";
      setProfileZipDigits(z.length === 5 ? z : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, session?.user?.id]);

  useEffect(() => {
    const origin = siteOrigin();
    const srRaw = run?.service_region;
    const sr =
      typeof srRaw === "string" && srRaw.trim().length > 0 ? srRaw.trim().toUpperCase() : "";
    const startRaw = run?.start_at;
    const startAt = typeof startRaw === "string" && startRaw.length > 0 ? startRaw : null;

    if (!profileZipDigits || !origin || !sr || !startAt || run == null) {
      setRunVenueDriveMinutes(null);
      return;
    }

    const ms = new Date(startAt).getTime();
    if (!Number.isFinite(ms)) {
      setRunVenueDriveMinutes(null);
      return;
    }
    const departureSecs = Math.floor(ms / 1000);

    let cancelled = false;
    void (async () => {
      const rows = await getNearestVenuesFromApi(profileZipDigits, origin, token, departureSecs);
      if (cancelled) return;
      const forRegion = rows.filter((r) => serviceRegionForVenueName(r.venue) === sr);
      if (forRegion.length === 0) {
        setRunVenueDriveMinutes(null);
        return;
      }
      forRegion.sort((a, b) => a.estimatedMinutes - b.estimatedMinutes);
      setRunVenueDriveMinutes(forRegion[0]!.estimatedMinutes);
    })();

    return () => {
      cancelled = true;
    };
  }, [profileZipDigits, token, run?.service_region, run?.start_at]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: showStatePicker ? "Pickup by state" : "Runs",
      tabBarLabel: "Pickup",
    });
  }, [navigation, showStatePicker]);

  const runId = typeof run?.id === "string" ? run.id : undefined;
  const joinDisabled = joinBusy || !runId;
  const payDisabled = payBusy || !runId;

  const resetFriendPayModal = useCallback(() => {
    setFriendQuery("");
    setFriendFound(null);
    setFriendLookupDone(false);
    setFriendSearchBusy(false);
  }, []);

  const openFriendPayModal = useCallback(() => {
    void hapticTap();
    resetFriendPayModal();
    setFriendModalOpen(true);
  }, [resetFriendPayModal]);

  const closeFriendPayModal = useCallback(() => {
    setFriendModalOpen(false);
    resetFriendPayModal();
  }, [resetFriendPayModal]);

  const onLookupFriend = useCallback(async () => {
    if (!token) {
      Alert.alert("Session required", "Sign in on this device, then try again.");
      return;
    }
    const q = friendQuery.trim();
    if (!q) {
      Alert.alert("Look up player", "Enter a username or email.");
      return;
    }
    Keyboard.dismiss();
    setFriendSearchBusy(true);
    setFriendFound(null);
    setFriendLookupDone(false);
    try {
      const r = await fetchPickupFindPlayer(token, q);
      setFriendLookupDone(true);
      if (r.ok && r.data) setFriendFound(r.data);
      else if (r.status !== 404) {
        Alert.alert("Look up failed", "Could not search right now. Try again.");
      }
    } catch {
      setFriendLookupDone(true);
      Alert.alert("Look up failed", "Network error. Try again.");
    } finally {
      setFriendSearchBusy(false);
    }
  }, [token, friendQuery]);

  const onConfirmPayForFriend = useCallback(async () => {
    if (!friendFound || !runId || !token) return;
    if (friendFound.user_id === session?.user?.id) {
      Alert.alert("That’s you", "Use “Request a spot” to join for yourself.");
      return;
    }
    setFriendModalOpen(false);
    await joinPickup(token, runId, load, {
      friendUserId: friendFound.user_id,
      friendDisplayName: friendFound.full_name,
    });
    resetFriendPayModal();
  }, [friendFound, runId, token, session?.user?.id, joinPickup, load, resetFriendPayModal]);

  const statusLabel = useMemo(() => {
    const st = run?.status;
    if (!st || typeof st !== "string") return "NO RUN ANNOUNCED";
    if (st === "planning") return "PLANNING";
    if (st === "likely_on") return "LIKELY ON";
    if (st === "active") return "CONFIRMED / ACTIVE";
    return st.toUpperCase();
  }, [run]);

  const runTypeLabel = useMemo(() => {
    if (!run) return "";
    return isSelectPickupRunType(run.run_type) ? "SELECT PICKUP" : "PUBLIC PICKUP";
  }, [run]);

  // Surfaces from the raw payload that the typed wrapper doesn't expose yet
  // (planning poll, attendees, location, updates). All optional and defensively typed.
  const dataObj = useMemo(
    () => (data && typeof data === "object" ? (data as Record<string, unknown>) : {}),
    [data],
  );

  const myWaitlistPosition: number | null = useMemo(() => {
    const v = (dataObj as Record<string, unknown>)?.my_waitlist_position;
    if (v === null || v === undefined) return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  }, [dataObj]);

  const updateMessages = useMemo(() => {
    const out: { key: string; text: string }[] = [];
    const pick = (raw: unknown): string | null => {
      if (!raw || typeof raw !== "object") return null;
      const m = (raw as { message?: unknown }).message;
      return typeof m === "string" && m.trim().length > 0 ? m : null;
    };
    const g = pick(dataObj.globalUpdate);
    if (g) {
      const t = stripLegacyGroupingTokensFromRunText(g);
      if (t.length > 0) out.push({ key: "global", text: t });
    }
    const r = pick(dataObj.runUpdate);
    if (r) {
      const t = stripLegacyGroupingTokensFromRunText(r);
      if (t.length > 0) out.push({ key: "run", text: t });
    }
    return out;
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
    if (typeof v !== "string" || v.trim().length === 0) return null;
    const cleaned = stripLegacyGroupingTokensFromRunText(v);
    return cleaned.length > 0 ? cleaned : null;
  }, [dataObj]);

  const cancellationDeadline = useMemo(() => {
    const v = run?.cancellation_deadline;
    return typeof v === "string" && v.length > 0 ? v : null;
  }, [run]);

  /** From `/api/pickup/public` `me` — used for public-run RSVP during planning (no availability poll). */
  const meApproved = useMemo(() => {
    const me = dataObj.me;
    if (!me || typeof me !== "object") return false;
    return (me as { approved?: unknown }).approved === true;
  }, [dataObj]);

  /** Poll chip / submit enabled when the server says the user is in the current invite wave. */
  const availabilityPollInvited = invitedNow;

  const showAvailabilityPoll = useMemo(() => {
    // Availability poll is for select runs only.
    if (isPublicPickupRunType(run?.run_type)) return false;
    const st = run?.status;
    if (st !== "planning" && st !== "likely_on") return false;
    if (run?.final_slot_id != null) return false;
    if (isSelectPickupRunType(run?.run_type) && !availabilityPollInvited) return false;
    return true;
  }, [run, availabilityPollInvited]);

  /** Open-signup runs skip the poll; approved signed-in users RSVP directly during planning / likely_on. */
  const showPublicPlanningJoin = useMemo(() => {
    if (!isPublicPickupRunType(run?.run_type)) return false;
    const st = run?.status;
    if (st !== "planning" && st !== "likely_on") return false;
    return Boolean(token) && meApproved;
  }, [run, token, meApproved]);

  const allowedSlotLabelSet = useMemo(
    () => new Set<string>(FIXED_AVAILABILITY_RANGES.map((r) => r.slot_label)),
    [],
  );

  /** Server `planning.my_availability` may be an array (multi-slot) or a legacy single object. */
  const preselectedSlotLabels = useMemo(() => {
    const raw = dataObj.planning;
    if (!raw || typeof raw !== "object") return [] as string[];
    const p = raw as Record<string, unknown>;
    const ma = p.my_availability;
    const out: string[] = [];
    const pushIfAllowed = (slotLabel: unknown, state: unknown) => {
      if (state !== "available") return;
      if (typeof slotLabel !== "string" || !allowedSlotLabelSet.has(slotLabel)) return;
      if (!out.includes(slotLabel)) out.push(slotLabel);
    };
    if (Array.isArray(ma)) {
      for (const entry of ma) {
        if (!entry || typeof entry !== "object") continue;
        const o = entry as Record<string, unknown>;
        pushIfAllowed(o.slot_label, o.state);
      }
    } else if (ma && typeof ma === "object") {
      const o = ma as Record<string, unknown>;
      pushIfAllowed(o.slot_label, o.state);
    }
    return out;
  }, [dataObj, allowedSlotLabelSet]);

  const preselectSig = useMemo(() => [...preselectedSlotLabels].sort().join("|"), [preselectedSlotLabels]);

  useEffect(() => {
    setAvailabilitySubmittedBanner(false);
    setSkipPreselectAfterChange(false);
  }, [runId]);

  useEffect(() => {
    if (!runId || !showAvailabilityPoll) return;
    if (availabilitySubmittedBanner) return;
    if (skipPreselectAfterChange) return;
    setSelectedSlotLabels([...preselectedSlotLabels]);
  }, [
    runId,
    showAvailabilityPoll,
    preselectSig,
    preselectedSlotLabels,
    availabilitySubmittedBanner,
    skipPreselectAfterChange,
  ]);

  const onToggleSlotChip = useCallback(
    (slotLabel: string) => {
      void hapticTap();
      if (!availabilityPollInvited || availabilityBusy) return;
      setSelectedSlotLabels((prev) =>
        prev.includes(slotLabel) ? prev.filter((l) => l !== slotLabel) : [...prev, slotLabel],
      );
    },
    [availabilityPollInvited, availabilityBusy],
  );

  const onSubmitAvailability = useCallback(async () => {
    if (!runId || !token || selectedSlotLabels.length === 0) return;
    const labels = [...selectedSlotLabels].sort();
    void hapticKick();
    const ok = await commitAvailabilitySlots(token, runId, labels, load);
    if (ok) setAvailabilitySubmittedBanner(true);
  }, [runId, token, selectedSlotLabels, commitAvailabilitySlots, load]);

  const onChangeAvailability = useCallback(() => {
    setAvailabilitySubmittedBanner(false);
    setSkipPreselectAfterChange(true);
    setSelectedSlotLabels([]);
  }, []);

  const attendanceVisible = visibility?.attendanceVisible === true;

  /** Invite / exclusive-run hints only use neutral copy (no internal grouping names). */
  const waveMessage = useMemo<{ text: string; color: string } | null>(() => {
    if (invitedNow) {
      return { text: "You're invited — request your spot now", color: "#a3e635" };
    }
    if (isSelectPickupRunType(run?.run_type)) {
      return {
        text: "Exclusive pickup: selected players are invited first. Check back if you're waiting on an invite.",
        color: "rgba(255,255,255,0.72)",
      };
    }
    return null;
  }, [invitedNow, run?.run_type]);

  const runTitleDisplay = useMemo(() => {
    const raw = typeof run?.title === "string" && run.title ? run.title : "Pickup run";
    const cleaned = stripLegacyGroupingTokensFromRunText(raw);
    return cleaned.length > 0 ? cleaned : "Pickup run";
  }, [run]);

  const countChips = useMemo(() => {
    const c = counts ?? {};
    const items: { key: string; label: string }[] = [];
    if (typeof c.confirmed === "number") items.push({ key: "confirmed", label: `${c.confirmed} confirmed` });
    if (typeof c.standby === "number") items.push({ key: "standby", label: `${c.standby} standby` });
    if (typeof c.waitlist === "number") items.push({ key: "waitlist", label: `${c.waitlist} waitlist` });
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
    <>
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
            </View>
            <Text style={styles.cardTitle}>{runTitleDisplay}</Text>
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
            {(() => {
              const fc = run?.fee_cents;
              if (typeof fc !== "number" || !Number.isFinite(fc) || fc <= 0) return null;
              const dollars = (fc / 100).toFixed(2);
              return (
                <View style={styles.feeBlock}>
                  <Text style={styles.feeLine}>
                    Field fee: <Text style={styles.feeAmount}>${dollars}</Text> per person
                  </Text>
                  <Text style={styles.feeNote}>
                    Final fee is based on confirmed attendance up to the session cap. If fewer players confirm, the fee may
                    be higher. Refunds available if canceled before 10:00 PM the night before.
                  </Text>
                </View>
              );
            })()}
            {(() => {
              const raw = typeof run?.location_text === "string" ? run.location_text.trim() : "";
              if (!raw) return null;
              const loc = stripLegacyGroupingTokensFromRunText(raw);
              if (!loc) return null;
              return <Text style={styles.row}>Location: {loc}</Text>;
            })()}
            {runVenueDriveMinutes != null ? (
              <Text style={styles.driveEstimate}>🚗 ~{runVenueDriveMinutes} min drive</Text>
            ) : null}
            {waveMessage ? (
              <Text style={[styles.hint, { color: waveMessage.color }]}>{waveMessage.text}</Text>
            ) : null}

            {showAvailabilityPoll ? (
              <View style={styles.pollSection}>
                <Text style={styles.pollHeading}>Availability poll</Text>
                <View style={styles.pollChipRow}>
                  {FIXED_AVAILABILITY_RANGES.map((range) => {
                    const selected = selectedSlotLabels.includes(range.slot_label);
                    const chipDisabled = !availabilityPollInvited || availabilityBusy;
                    return (
                      <Pressable
                        key={range.slot_label}
                        disabled={chipDisabled}
                        onPress={() => onToggleSlotChip(range.slot_label)}
                        style={({ pressed }) => [
                          styles.availChip,
                          selected && styles.availChipSelected,
                          chipDisabled && styles.availChipDisabled,
                          pressed && !chipDisabled && { opacity: 0.88 },
                        ]}
                        accessibilityRole="button"
                        accessibilityState={{ selected, disabled: chipDisabled }}
                        accessibilityLabel={`${range.display}${selected ? ", selected" : ""}`}
                      >
                        <Text
                          style={[styles.availChipText, selected && styles.availChipTextSelected]}
                          numberOfLines={1}
                        >
                          {range.display}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Pressable
                  disabled={
                    !availabilityPollInvited ||
                    availabilityBusy ||
                    !runId ||
                    selectedSlotLabels.length === 0
                  }
                  onPress={() => void onSubmitAvailability()}
                  style={({ pressed }) => [
                    styles.submitAvailabilityBtn,
                    (!availabilityPollInvited ||
                      availabilityBusy ||
                      !runId ||
                      selectedSlotLabels.length === 0) &&
                      styles.submitAvailabilityBtnDisabled,
                    pressed &&
                      availabilityPollInvited &&
                      !availabilityBusy &&
                      selectedSlotLabels.length > 0 && {
                      opacity: 0.9,
                    },
                  ]}
                >
                  {availabilityBusy && pendingSlotKey === "multi" ? (
                    <ActivityIndicator color="#111" size="small" />
                  ) : (
                    <Text style={styles.submitAvailabilityBtnText}>Submit availability</Text>
                  )}
                </Pressable>
                {availabilitySubmittedBanner ? (
                  <View style={styles.submittedAvailBanner}>
                    <FontAwesome name="check-circle" size={18} color="#bbf7d0" />
                    <Text style={styles.submittedAvailBannerText} numberOfLines={2}>
                      Availability submitted
                    </Text>
                    <Pressable
                      onPress={onChangeAvailability}
                      style={({ pressed }) => [styles.changeAvailabilityBtn, pressed && { opacity: 0.85 }]}
                      accessibilityRole="button"
                      accessibilityLabel="Change availability selection"
                    >
                      <Text style={styles.changeAvailabilityBtnText}>Change</Text>
                    </Pressable>
                  </View>
                ) : null}
                <Pressable
                  disabled={!availabilityPollInvited || availabilityBusy || !runId}
                  onPress={() => void commitAvailability(token, runId, "declined", null, load)}
                  style={({ pressed }) => [
                    styles.declineSlotButton,
                    (!availabilityPollInvited || availabilityBusy || !runId) &&
                      styles.declineSlotButtonDisabled,
                    pressed && availabilityPollInvited && !availabilityBusy && { opacity: 0.85 },
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
            ) : myStatus === "waitlist" ? (
              <View style={styles.standbyBanner}>
                <FontAwesome name="list-ol" size={16} color="#fcd34d" />
                <Text style={styles.standbyBannerText}>
                  You&apos;re #{myWaitlistPosition ?? "—"} on waitlist.
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
            ) : (!showAvailabilityPoll && run?.status !== "planning") || showPublicPlanningJoin ? (
              <View style={styles.joinActions}>
                <Pressable
                  style={[styles.primaryJoin, joinDisabled && styles.primaryJoinDisabled]}
                  disabled={joinDisabled}
                  onPress={() => {
                    void hapticGoal();
                    void joinPickup(token, runId, load);
                  }}
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
                <Pressable
                  style={[styles.payFriendBtn, (!token || joinBusy || !runId) && styles.payFriendBtnDisabled]}
                  disabled={!token || joinBusy || !runId}
                  onPress={openFriendPayModal}
                >
                  <FontAwesome name="user-plus" size={15} color="#a3e635" />
                  <Text style={styles.payFriendBtnText}> Pay for a friend</Text>
                </Pressable>
              </View>
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

    <Modal
      visible={friendModalOpen}
      animationType="fade"
      transparent
      onRequestClose={closeFriendPayModal}
    >
      <KeyboardAvoidingView
        style={styles.modalBackdrop}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable style={styles.modalBackdropPress} onPress={closeFriendPayModal} accessibilityRole="button" accessibilityLabel="Dismiss" />
        <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Pay for a friend</Text>
            <Text style={styles.modalHint}>Enter their CT Pickup username or email.</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Username or email"
              placeholderTextColor="rgba(255,255,255,0.4)"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              value={friendQuery}
              onChangeText={(t) => {
                setFriendQuery(t);
                setFriendFound(null);
                setFriendLookupDone(false);
              }}
              editable={!friendSearchBusy && !joinBusy}
            />
            <Pressable
              style={[styles.modalSearchBtn, (friendSearchBusy || joinBusy) && styles.modalSearchBtnDisabled]}
              disabled={friendSearchBusy || joinBusy}
              onPress={() => void onLookupFriend()}
            >
              {friendSearchBusy ? (
                <ActivityIndicator color="#111" size="small" />
              ) : (
                <Text style={styles.modalSearchBtnText}>Look up player</Text>
              )}
            </Pressable>
            {friendFound ? (
              friendFound.user_id === session?.user?.id ? (
                <Text style={styles.modalNotFound}>That’s you — use “Request a spot” for yourself.</Text>
              ) : (
                <Text style={styles.modalFound}>
                  Found: <Text style={styles.modalFoundName}>{friendFound.full_name}</Text>
                </Text>
              )
            ) : friendLookupDone && !friendSearchBusy ? (
              <Text style={styles.modalNotFound}>Player not found</Text>
            ) : null}
            {friendFound && friendFound.user_id !== session?.user?.id ? (
              <Pressable
                style={[styles.modalConfirmPay, joinBusy && styles.modalConfirmPayDisabled]}
                disabled={joinBusy}
                onPress={() => void onConfirmPayForFriend()}
              >
                {joinBusy ? (
                  <ActivityIndicator color="#111" size="small" />
                ) : (
                  <Text style={styles.modalConfirmPayText}>Pay for {friendFound.full_name}</Text>
                )}
              </Pressable>
            ) : null}
            <Pressable onPress={closeFriendPayModal} style={styles.modalCloseBtn}>
              <Text style={styles.modalCloseBtnText}>Close</Text>
            </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
    </>
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
  pollSection: { marginTop: 18, gap: 12 },
  pollHeading: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    color: "rgba(255,255,255,0.8)",
    textTransform: "uppercase",
  },
  pollChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  availChip: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(20,20,20,0.95)",
  },
  availChipSelected: {
    borderColor: LIME,
    backgroundColor: LIME,
  },
  availChipDisabled: { opacity: 0.45 },
  availChipText: { color: "rgba(255,255,255,0.92)", fontSize: 13, fontWeight: "700" },
  availChipTextSelected: { color: "#111" },
  submitAvailabilityBtn: {
    alignSelf: "stretch",
    marginTop: 4,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: LIME,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  submitAvailabilityBtnDisabled: { opacity: 0.42 },
  submitAvailabilityBtnText: { color: "#111", fontWeight: "800", fontSize: 15 },
  submittedAvailBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    alignSelf: "stretch",
    marginTop: 4,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(16,185,129,0.45)",
    backgroundColor: "rgba(16,185,129,0.2)",
  },
  submittedAvailBannerText: {
    flex: 1,
    color: "#bbf7d0",
    fontWeight: "700",
    fontSize: 14,
    minWidth: 0,
  },
  changeAvailabilityBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(187,247,208,0.45)",
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  changeAvailabilityBtnText: { color: "#ecfccb", fontSize: 13, fontWeight: "800" },
  declineSlotButton: {
    alignSelf: "flex-start",
    marginTop: 6,
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
  driveEstimate: {
    marginTop: 4,
    fontSize: 12,
    color: "rgba(255,255,255,0.55)",
    lineHeight: 16,
  },
  feeBlock: { marginTop: 10 },
  feeLine: { color: "rgba(255,255,255,0.85)", fontSize: 15, lineHeight: 22 },
  feeAmount: { color: LIME, fontWeight: "700" },
  feeNote: {
    marginTop: 6,
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    lineHeight: 17,
  },
  hint: { marginTop: 14, color: "rgba(255,255,255,0.55)", fontSize: 14, lineHeight: 20 },
  joinActions: { marginTop: 18, gap: 10, alignSelf: "stretch" },
  primaryJoin: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "#a3e635",
  },
  payFriendBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.45)",
    backgroundColor: "rgba(163,230,53,0.08)",
  },
  payFriendBtnDisabled: { opacity: 0.45 },
  payFriendBtnText: { color: "#a3e635", fontWeight: "800", fontSize: 15 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  modalBackdropPress: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  modalCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "#141414",
    padding: 20,
    gap: 12,
  },
  modalTitle: { fontSize: 18, fontWeight: "800", color: "#fff" },
  modalHint: { fontSize: 14, color: "rgba(255,255,255,0.65)", lineHeight: 20 },
  modalInput: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#fff",
    fontSize: 16,
  },
  modalSearchBtn: {
    alignSelf: "stretch",
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: LIME,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  modalSearchBtnDisabled: { opacity: 0.5 },
  modalSearchBtnText: { color: "#111", fontWeight: "800", fontSize: 15 },
  modalFound: { fontSize: 15, color: "rgba(255,255,255,0.85)" },
  modalFoundName: { fontWeight: "800", color: LIME },
  modalNotFound: { fontSize: 15, color: "#fca5a5", fontWeight: "600" },
  modalConfirmPay: {
    alignSelf: "stretch",
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: LIME,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  modalConfirmPayDisabled: { opacity: 0.5 },
  modalConfirmPayText: { color: "#111", fontWeight: "800", fontSize: 15 },
  modalCloseBtn: { alignSelf: "center", paddingVertical: 8, paddingHorizontal: 12 },
  modalCloseBtnText: { color: "rgba(255,255,255,0.7)", fontSize: 15, fontWeight: "700" },
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
