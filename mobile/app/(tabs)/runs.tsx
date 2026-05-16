import { AvailabilityPoll, type PickupPlanningAvailability } from "@/components/pickup/AvailabilityPoll";
import { PayForFriendButton } from "@/components/pickup/PayForFriendButton";
import { useAuth } from "@/context/AuthContext";
import { useSelectedRegion } from "@/context/SelectedRegionContext";
import { usePickupJoin } from "@/hooks/usePickupJoin";
import { usePickupPublic } from "@/hooks/usePickupPublic";
import { useTeamChatAccess } from "@/hooks/useTeamChat";
import { hapticGoal, hapticTap } from "@/lib/haptics";
import { fmtPickupDateEt, fmtPickupTimeEt } from "@/lib/pickupPublic";
import { isPublicPickupRunType, isSelectPickupRunType } from "@/lib/pickupRunType";
import { useUserChatRooms } from "@/lib/teamChat";
import { serviceRegionName } from "@/lib/serviceRegions";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

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

function rsvpStatusMessage(myStatus: string | null): string | null {
  if (myStatus === "confirmed") return "You're confirmed for this run.";
  if (myStatus === "pending_payment") return "Finish payment to secure your spot.";
  if (myStatus === "standby") return "You're on standby — we'll notify you if a spot opens.";
  if (myStatus === "waitlist") return "You're on the waitlist.";
  return null;
}

function CardDivider() {
  return <View style={styles.divider} />;
}

export default function RunsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const { region } = useSelectedRegion();
  const { allowed: chatAllowed } = useTeamChatAccess();

  const { loading, error, data, run, counts, myStatus, invitedNow, noFeaturedRun, load } = usePickupPublic(token);
  const { joinBusy, joinPickup, payBusy, payPickup, availabilityBusy, commitAvailability } = usePickupJoin();

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

  const showAvailabilityPoll =
    !!run &&
    invitedNow &&
    !runLocked &&
    (runStatus === "planning" || runStatus === "likely_on") &&
    run.final_slot_id == null;

  const showPayForFriend =
    !!run &&
    !!token &&
    !runLocked &&
    myStatus === "confirmed" &&
    spotsLeft != null &&
    spotsLeft > 0;

  const showJoin =
    !!token &&
    !!runId &&
    !runLocked &&
    invitedNow &&
    (myStatus == null || myStatus === "declined") &&
    (isPublicPickupRunType(run?.run_type) ||
      (isSelectPickupRunType(run?.run_type) && run?.final_slot_id != null));

  const hasRsvp =
    myStatus === "confirmed" ||
    myStatus === "standby" ||
    myStatus === "waitlist" ||
    myStatus === "pending_payment";

  const rsvpMessage = rsvpStatusMessage(myStatus);

  const onRefresh = useCallback(() => {
    void load();
  }, [load]);

  const onImIn = useCallback(() => {
    if (!token || !runId) {
      Alert.alert("Sign in required", "Sign in to join this run.");
      return;
    }
    void hapticTap();
    void joinPickup(token, runId, async () => {
      await load();
      void hapticGoal();
    });
  }, [token, runId, joinPickup, load]);

  const onCantMakeIt = useCallback(() => {
    if (!token || !runId) {
      Alert.alert("Sign in required", "Sign in to respond to this run.");
      return;
    }
    void hapticTap();
    void commitAvailability(token, runId, "declined", null, async () => {
      await load();
    });
  }, [token, runId, commitAvailability, load]);

  const onCompletePayment = useCallback(() => {
    if (!token || !runId) return;
    void hapticTap();
    void payPickup(token, runId, load);
  }, [token, runId, payPickup, load]);

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

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor={LIME} />}
      >
        <View style={styles.header}>
          <Text style={styles.h1}>Runs</Text>
          <View style={styles.regionPill}>
            <Text style={styles.regionPillText}>{region}</Text>
          </View>
        </View>
        <Text style={styles.regionSub}>{serviceRegionName(region)}</Text>

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
          <View style={styles.card}>
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
              <View style={styles.statusPill}>
                <Text style={styles.statusPillText}>{runStatusPillLabel(runStatus)}</Text>
              </View>
            </View>

            <CardDivider />

            <View style={styles.dateTimeRow}>
              <Text style={styles.dateEt}>
                {fmtPickupDateEt(typeof run.start_at === "string" ? run.start_at : null)}
              </Text>
              <Text style={styles.timeEt}>
                {fmtPickupTimeEt(typeof run.start_at === "string" ? run.start_at : null)} ET
              </Text>
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

            {showAvailabilityPoll ? (
              <>
                <CardDivider />
                <AvailabilityPoll
                  run={run}
                  planning={planning}
                  onSubmit={() => {
                    void load();
                  }}
                  onDecline={() => {
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
                  {(myStatus === "confirmed" || myStatus === "standby") && (
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
            ) : showJoin ? (
              <>
                <CardDivider />
                <View style={styles.ctaBlock}>
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
                  <Pressable
                    disabled={availabilityBusy}
                    onPress={onCantMakeIt}
                    style={({ pressed }) => [styles.secondaryLinkBtn, pressed && { opacity: 0.75 }]}
                  >
                    <Text style={styles.secondaryLinkText}>Can&apos;t make it?</Text>
                  </Pressable>
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
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  content: { padding: 16, paddingBottom: 32 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  h1: { fontSize: 28, fontWeight: "800", color: "#fff" },
  regionPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.4)",
    backgroundColor: "rgba(163,230,53,0.1)",
  },
  regionPillText: { color: LIME, fontWeight: "800", fontSize: 13 },
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
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  titleBlock: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", gap: 8 },
  cardTitle: { color: "#fff", fontSize: 22, fontWeight: "800", lineHeight: 28 },
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
  dateEt: { color: "#fff", fontSize: 18, fontWeight: "700", letterSpacing: -0.2 },
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
  fee: { color: "#fff", fontWeight: "700", fontSize: 15, flexShrink: 0 },
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
    color: "rgba(255,255,255,0.45)",
    fontSize: 12,
    fontWeight: "600",
  },
  rsvpBlock: { gap: 12 },
  rsvpStatus: { color: "rgba(255,255,255,0.75)", lineHeight: 20, fontSize: 14 },
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
  secondaryLinkBtn: { paddingVertical: 6, paddingHorizontal: 12 },
  secondaryLinkText: { color: "rgba(255,255,255,0.38)", fontWeight: "500", fontSize: 14 },
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
