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

function statusLabelFor(st: string | null | undefined, myStatus: string | null): string {
  if (myStatus === "confirmed") return "You're in";
  if (myStatus === "standby") return "Standby";
  if (myStatus === "waitlist") return "Waitlist";
  if (myStatus === "pending_payment") return "Payment pending";
  if (!st) return "Upcoming";
  if (st === "planning") return "Planning";
  if (st === "likely_on") return "Likely on";
  if (st === "active") return "Open";
  if (st === "in_progress") return "Live now";
  if (st === "completed") return "Completed";
  if (st === "canceled") return "Canceled";
  return st.replace(/_/g, " ");
}

export default function RunsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const { region } = useSelectedRegion();
  const { allowed: chatAllowed } = useTeamChatAccess();

  const { loading, error, data, run, counts, myStatus, invitedNow, noFeaturedRun, load } = usePickupPublic(token);
  const { joinBusy, joinPickup, payBusy, payPickup } = usePickupJoin();

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

  const feeCents = typeof run?.fee_cents === "number" ? run.fee_cents : 0;
  const isFree = feeCents <= 0;

  const typeBadge = run
    ? isPublicPickupRunType(run.run_type)
      ? "PUBLIC"
      : "SELECT"
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
              <Text style={styles.cardTitle} numberOfLines={2}>
                {title}
              </Text>
              <View style={styles.typeBadge}>
                <Text style={styles.typeBadgeText}>{typeBadge}</Text>
              </View>
            </View>

            <Text style={styles.dateEt}>{fmtPickupDateEt(typeof run.start_at === "string" ? run.start_at : null)}</Text>
            <Text style={styles.timeEt}>{fmtPickupTimeEt(typeof run.start_at === "string" ? run.start_at : null)} ET</Text>

            <Text style={styles.venue} numberOfLines={2}>
              {venue}
            </Text>

            <View style={styles.metaRow}>
              <Text style={styles.fee}>
                {isFree ? "Free" : `$${(feeCents / 100).toFixed(2)} per player`}
              </Text>
              {spotsLeft != null ? (
                <Text style={styles.spots}>
                  {spotsLeft === 0 ? "Full" : `${spotsLeft} spot${spotsLeft === 1 ? "" : "s"} left`}
                </Text>
              ) : null}
            </View>

            <View style={styles.statusBadge}>
              <Text style={styles.statusBadgeText}>{statusLabelFor(runStatus, myStatus)}</Text>
            </View>

            {showAvailabilityPoll ? (
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
            ) : null}

            {hasRsvp ? (
              <View style={styles.rsvpBlock}>
                <Text style={styles.rsvpStatus}>
                  {myStatus === "confirmed"
                    ? "You're confirmed for this run."
                    : myStatus === "pending_payment"
                      ? "Finish payment to secure your spot."
                      : myStatus === "standby"
                        ? "You're on standby — we'll notify you if a spot opens."
                        : myStatus === "waitlist"
                          ? "You're on the waitlist."
                          : "RSVP updated."}
                </Text>
                {myStatus === "pending_payment" && !runLocked ? (
                  <Pressable
                    disabled={payBusy}
                    onPress={onCompletePayment}
                    style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.9 }, payBusy && styles.btnDisabled]}
                  >
                    <Text style={styles.primaryBtnText}>{payBusy ? "Opening checkout…" : "Complete payment"}</Text>
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
            ) : showJoin ? (
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
            ) : isSelectPickupRunType(run.run_type) && !run.final_slot_id ? (
              <Text style={styles.hint}>Time not finalized yet — check back when admin confirms the slot.</Text>
            ) : runLocked ? (
              <Text style={styles.hint}>This run is live — joining is closed.</Text>
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
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  cardTitle: { flex: 1, color: "#fff", fontSize: 18, fontWeight: "800" },
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "rgba(163,230,53,0.12)",
  },
  typeBadgeText: { color: LIME, fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  dateEt: { color: "rgba(255,255,255,0.55)", fontSize: 14, marginTop: 14, fontWeight: "600" },
  timeEt: { color: LIME, fontSize: 28, fontWeight: "800", marginTop: 4 },
  venue: { color: "rgba(255,255,255,0.75)", fontSize: 15, marginTop: 12, lineHeight: 22 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 14, gap: 12 },
  fee: { color: "#fff", fontWeight: "700", fontSize: 15 },
  spots: { color: "rgba(255,255,255,0.5)", fontSize: 13, fontWeight: "600" },
  statusBadge: {
    alignSelf: "flex-start",
    marginTop: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  statusBadgeText: { color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: "700" },
  rsvpBlock: { marginTop: 16, gap: 10 },
  rsvpStatus: { color: "rgba(255,255,255,0.75)", lineHeight: 20, fontSize: 14 },
  primaryBtn: {
    marginTop: 16,
    backgroundColor: LIME,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  primaryBtnText: { color: "#111", fontWeight: "800", fontSize: 17 },
  btnDisabled: { opacity: 0.65 },
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
  hint: { color: "rgba(255,255,255,0.45)", marginTop: 16, lineHeight: 20, fontSize: 14 },
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
