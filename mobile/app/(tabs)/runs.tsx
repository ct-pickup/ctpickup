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
import { siteOrigin } from "@/lib/env";
import {
  fmtPickupDateEt,
  fmtPickupDateFromDateOnlyStartAt,
  fmtPickupTimeEt,
  isPickupRunDateOnlyStartAt,
  isPickupRunTimeTbd,
} from "@/lib/pickupPublic";
import { isPublicPickupRunType, isSelectPickupRunType } from "@/lib/pickupRunType";
import { pickupPlayerRefundEligibleClient } from "@/lib/pickupRefundEligibility";
import { fetchPickupRegionRuns, fetchPickupStanding } from "@/lib/siteApi";
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

type PickupCreditItem = {
  id: string;
  reason: string;
  amount_cents: number | null;
  discount_pct: number | null;
  awarded_at: string;
  expires_at: string;
  used_at: string | null;
  is_expired: boolean;
  is_used: boolean;
};

function fmtUsdCents(cents: number): string {
  const c = Math.max(0, Math.round(Number(cents) || 0));
  return `$${(c / 100).toFixed(2)}`;
}

function bestActiveCredit(credits: PickupCreditItem[]): PickupCreditItem | null {
  const active = credits.filter((c) => !c.is_used && !c.is_expired);
  return active[0] ?? null;
}

function creditAmountCents(credit: PickupCreditItem): number {
  const amt =
    typeof credit.amount_cents === "number" && Number.isFinite(credit.amount_cents)
      ? Math.round(credit.amount_cents)
      : 0;
  return Math.max(0, amt);
}

function creditDiscountPct(credit: PickupCreditItem): number {
  const pct =
    typeof credit.discount_pct === "number" && Number.isFinite(credit.discount_pct)
      ? Math.round(credit.discount_pct)
      : 0;
  return Math.max(0, pct);
}

/** Matches server pickup credit math for checkout preview (see lib/pickup/pickupCredits.ts). */
function feeCentsAfterCredit(feeCents: number, credit: PickupCreditItem | null): number {
  if (!credit || feeCents <= 0) return feeCents;
  const amt = creditAmountCents(credit);
  const pct = creditDiscountPct(credit);
  if (amt > 0) return Math.max(0, Math.round(feeCents) - amt);
  if (pct > 0) return Math.max(0, Math.round(feeCents * (1 - pct / 100)));
  return 0;
}

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

type RegionRunListItem = {
  id: string;
  title: string | null;
  status: string;
  start_at: string | null;
  run_type: string | null;
  capacity: number;
  fee_cents: number;
  confirmed_count: number;
  final_slot_id: string | null;
  distance_miles: number | null;
  drive_minutes: number | null;
};

function parseDriveMinutesField(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

function formatRunDistanceAway(
  driveMinutes: number | null,
  distanceMiles: number | null,
): string | null {
  if (driveMinutes != null && Number.isFinite(driveMinutes) && driveMinutes > 0) {
    return `~${Math.round(driveMinutes)} min with traffic now`;
  }
  if (distanceMiles != null && Number.isFinite(distanceMiles)) {
    const miles =
      distanceMiles % 1 === 0 ? `${Math.round(distanceMiles)}` : distanceMiles.toFixed(1);
    return `${miles} mi away`;
  }
  return null;
}

/** Planning / likely_on before a slot is locked — poll lives on the list, not in the modal. */
function isInlinePlanningRun(row: RegionRunListItem): boolean {
  const st = row.status;
  if (st !== "planning" && st !== "likely_on") return false;
  return row.final_slot_id == null;
}

function opensRunDetailModal(row: RegionRunListItem): boolean {
  return !isInlinePlanningRun(row);
}

function runTitleFromRow(row: {
  title?: string | null;
  location_text?: string | null;
}): string {
  if (typeof row.title === "string" && row.title.trim()) return row.title.trim();
  if (typeof row.location_text === "string" && row.location_text.trim()) {
    return row.location_text.split(/\r?\n/)[0]?.trim() ?? "Pickup run";
  }
  return "Pickup run";
}

function runVenueFromRow(row: {
  title?: string | null;
  location_text?: string | null;
}): string {
  if (typeof row.location_text === "string" && row.location_text.trim()) {
    return row.location_text.split(/\r?\n/)[0]?.trim() ?? runTitleFromRow(row);
  }
  return runTitleFromRow(row);
}

function RunSummaryCard({
  row,
  onPress,
  showChevron = true,
  embedded = false,
  inlinePlanning = false,
}: {
  row: RegionRunListItem | Record<string, unknown>;
  onPress?: () => void;
  showChevron?: boolean;
  embedded?: boolean;
  /** Planning runs on the list show the poll below — no tap hint. */
  inlinePlanning?: boolean;
}) {
  const runStatus = typeof row.status === "string" ? row.status : null;
  const finalSlotId =
    typeof (row as RegionRunListItem).final_slot_id === "string"
      ? (row as RegionRunListItem).final_slot_id
      : null;
  const timeTbd = isPickupRunTimeTbd(runStatus, finalSlotId);
  const showTypeLabel = isPublicPickupRunType(row.run_type) || isSelectPickupRunType(row.run_type);
  const typeLabel = isPublicPickupRunType(row.run_type)
    ? "Public"
    : isSelectPickupRunType(row.run_type)
      ? "Select"
      : "";
  const title = runTitleFromRow(row);
  const venue = runVenueFromRow(row);
  const feeCents = typeof row.fee_cents === "number" ? row.fee_cents : 0;
  const isFree = feeCents <= 0;
  const capacity = Number(row.capacity ?? 0) || 0;
  const confirmed =
    typeof (row as RegionRunListItem).confirmed_count === "number"
      ? (row as RegionRunListItem).confirmed_count
      : 0;
  const fillRatio = capacity > 0 ? Math.min(1, confirmed / capacity) : 0;
  const startAt = typeof row.start_at === "string" ? row.start_at : null;
  const distanceMiles =
    typeof (row as RegionRunListItem).distance_miles === "number"
      ? (row as RegionRunListItem).distance_miles
      : null;
  const driveMinutes = parseDriveMinutesField((row as RegionRunListItem).drive_minutes);
  const distanceAwayLabel = formatRunDistanceAway(driveMinutes, distanceMiles);

  const inner = (
    <>
      <View style={styles.cardHeader}>
        <View style={styles.titleBlock}>
          <View style={styles.titleRow}>
            <Text style={styles.cardTitle} numberOfLines={2}>
              {title}
            </Text>
            {showTypeLabel && typeLabel ? <Text style={styles.typeLabel}>{typeLabel}</Text> : null}
          </View>
        </View>
        <View style={styles.cardHeaderRight}>
          <View style={styles.statusPill}>
            <Text style={styles.statusPillText}>{runStatusPillLabel(runStatus)}</Text>
          </View>
          {showChevron ? <FontAwesome name="chevron-right" size={14} color="rgba(255,255,255,0.35)" /> : null}
        </View>
      </View>

      <CardDivider />

      <View style={styles.dateTimeRow}>
        {timeTbd ? (
          <>
            <Text style={styles.datePlanning}>
              {isPickupRunDateOnlyStartAt(startAt)
                ? fmtPickupDateFromDateOnlyStartAt(startAt)
                : fmtPickupDateEt(startAt)}
            </Text>
            <Text style={styles.planningTimeHint}>
              {inlinePlanning ? "Time TBD — vote below" : "Time TBD — tap for details"}
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.dateEt}>{fmtPickupDateEt(startAt)}</Text>
            <Text style={styles.timeEt}>{fmtPickupTimeEt(startAt)} ET</Text>
          </>
        )}
      </View>

      <CardDivider />

      <View style={styles.locationRow}>
        <FontAwesome name="map-marker" size={14} color="rgba(255,255,255,0.35)" style={styles.locationIcon} />
        <View style={styles.locationTextBlock}>
          <Text style={styles.venue} numberOfLines={2}>
            {venue}
          </Text>
          {distanceAwayLabel ? (
            <Text style={styles.distanceAway}>{distanceAwayLabel}</Text>
          ) : null}
        </View>
      </View>

      <CardDivider />

      <View style={styles.feeSpotsRow}>
        <Text style={styles.fee}>{isFree ? "Free" : `$${(feeCents / 100).toFixed(2)} per player`}</Text>
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
    </>
  );

  if (embedded) return <>{inner}</>;

  if (onPress) {
    return (
      <AnimatedPressScale
        accessibilityRole="button"
        accessibilityLabel="Open run details"
        pressedScale={0.98}
        hapticOnPress
        onPress={onPress}
        style={[styles.card, inlinePlanning && styles.cardInlinePlanning]}
      >
        {inner}
      </AnimatedPressScale>
    );
  }

  return <View style={[styles.card, inlinePlanning && styles.cardInlinePlanning]}>{inner}</View>;
}

function InlinePlanningPoll({
  runId,
  token,
  listRun,
  onListRefresh,
  refreshNonce,
}: {
  runId: string;
  token: string | null;
  listRun: RegionRunListItem;
  onListRefresh: () => void;
  refreshNonce: number;
}) {
  const { loading, error, data, run, invitedNow, load } = usePickupPublic(token, {
    focusRunId: runId,
    skipFeatured: true,
  });

  useEffect(() => {
    if (refreshNonce > 0) void load();
  }, [refreshNonce, load]);

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

  const runStatus = typeof run?.status === "string" ? run.status : listRun.status;
  const runIdFromPayload = run && typeof run.id === "string" ? run.id : null;
  const runIdMatchesFocus = !runId || runIdFromPayload === runId;
  const isPublicRun = isPublicPickupRunType(run?.run_type ?? listRun.run_type);
  const isSelectRun = isSelectPickupRunType(run?.run_type ?? listRun.run_type);
  const showPoll =
    !!run &&
    invitedNow &&
    (isPublicRun || isSelectRun) &&
    (runStatus === "planning" || runStatus === "likely_on") &&
    run.final_slot_id == null &&
    !hasDeclinedAvailability;

  // #region agent log
  useEffect(() => {
    if (loading) return;
    const slotCount = Array.isArray(run?.pickup_run_time_slots)
      ? (run.pickup_run_time_slots as unknown[]).length
      : 0;
    const payload = {
      sessionId: "b75987",
      hypothesisId: "A-E",
      location: "runs.tsx:InlinePlanningPoll",
      message: "inline poll gate",
      data: {
        focusRunId: runId,
        runIdFromPayload,
        runIdMatchesFocus,
        invitedNow,
        isPublicRun,
        isSelectRun,
        runStatus,
        listRunStatus: listRun.status,
        finalSlotId: run?.final_slot_id ?? listRun.final_slot_id,
        hasDeclinedAvailability,
        showPoll,
        loading,
        error: error ?? null,
        slotCount,
        hasPlanning: planning != null,
      },
      timestamp: Date.now(),
    };
    console.log("[debug InlinePlanningPoll]", payload.data);
    fetch("http://127.0.0.1:7577/ingest/cb3f3382-e909-4cce-999a-8534dacee8c7", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "b75987" },
      body: JSON.stringify(payload),
    }).catch(() => {});
  }, [
    loading,
    runId,
    runIdFromPayload,
    runIdMatchesFocus,
    invitedNow,
    isPublicRun,
    isSelectRun,
    runStatus,
    listRun.status,
    listRun.final_slot_id,
    run?.final_slot_id,
    hasDeclinedAvailability,
    showPoll,
    error,
    run?.pickup_run_time_slots,
    planning,
  ]);
  // #endregion

  if (loading && !run) {
    return (
      <View style={styles.inlinePoll}>
        <Text style={styles.inlinePollLoading}>Loading availability…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.inlinePoll}>
        <Text style={styles.inlinePollError}>{error}</Text>
        <Pressable onPress={() => void load()} style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.9 }]}>
          <Text style={styles.retryBtnText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  if (!invitedNow && isSelectPickupRunType(listRun.run_type)) {
    return (
      <View style={styles.inlinePoll}>
        <Text style={styles.hint}>Invite only — you will see voting here once you are invited.</Text>
      </View>
    );
  }

  if (!showPoll) return null;

  return (
    <View style={styles.inlinePoll}>
      <AvailabilityPoll
        run={run}
        planning={planning}
        onSubmit={() => {
          void load();
          onListRefresh();
        }}
      />
    </View>
  );
}

export default function RunsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const { region, setRegion, ready: regionReady } = useSelectedRegion();
  const [showStatePicker, setShowStatePicker] = useState(true);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [regionRuns, setRegionRuns] = useState<RegionRunListItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [reliabilityScore, setReliabilityScore] = useState<number | null>(null);
  const [listRefreshNonce, setListRefreshNonce] = useState(0);
  const [listFilterZip, setListFilterZip] = useState<string | null>(null);
  const [listFilterMaxDriveMinutes, setListFilterMaxDriveMinutes] = useState<number | null>(null);
  const autoOpenedFromDeepLinkRef = useRef(false);
  const [pickupCredits, setPickupCredits] = useState<PickupCreditItem[]>([]);
  const [pickupCreditsLoading, setPickupCreditsLoading] = useState(false);
  const [creditAppliedPreview, setCreditAppliedPreview] = useState(false);

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

  const detailRunId = detailOpen ? selectedRunId : focusRunIdParam;
  const { loading: detailLoading, error: detailError, data, run, counts, myStatus, myWaitlistExpiresAt, invitedNow, load } =
    usePickupPublic(token, {
      focusRunId: detailRunId,
      skipFeatured: !detailRunId,
    });

  const loadRegionRuns = useCallback(async () => {
    if (!regionReady) return;
    setListLoading(true);
    setListError(null);
    try {
      const r = await fetchPickupRegionRuns(region, token);
      if (r.ok && r.json && typeof r.json === "object") {
        const body = r.json as {
          runs?: unknown;
          filter?: {
            zip?: string | null;
            max_drive_minutes?: number | null;
            region?: string | null;
            include_nearby_regions?: boolean;
          };
        };
        const filter = body.filter;
        setListFilterZip(typeof filter?.zip === "string" ? filter.zip : null);
        setListFilterMaxDriveMinutes(
          typeof filter?.max_drive_minutes === "number" && Number.isFinite(filter.max_drive_minutes)
            ? filter.max_drive_minutes
            : null,
        );
        const rows = body.runs;
        if (Array.isArray(rows)) {
          const parsed: RegionRunListItem[] = rows
            .map((row) => {
              if (!row || typeof row !== "object") return null;
              const o = row as Record<string, unknown>;
              const id = typeof o.id === "string" ? o.id : null;
              if (!id) return null;
              return {
                id,
                title: typeof o.title === "string" ? o.title : null,
                status: typeof o.status === "string" ? o.status : "planning",
                start_at: typeof o.start_at === "string" ? o.start_at : null,
                run_type: typeof o.run_type === "string" ? o.run_type : null,
                capacity: Number(o.capacity ?? 0) || 0,
                fee_cents: Number(o.fee_cents ?? 0) || 0,
                confirmed_count: Number(o.confirmed_count ?? 0) || 0,
                final_slot_id:
                  typeof o.final_slot_id === "string" && o.final_slot_id.trim()
                    ? o.final_slot_id.trim()
                    : null,
                distance_miles:
                  typeof o.distance_miles === "number" && Number.isFinite(o.distance_miles)
                    ? o.distance_miles
                    : null,
                drive_minutes: parseDriveMinutesField(o.drive_minutes),
              };
            })
            .filter((x): x is RegionRunListItem => x != null);
          setRegionRuns(parsed);
          setListError(null);
        } else {
          setRegionRuns([]);
        }
      } else {
        const msg =
          r.json && typeof r.json === "object" && typeof (r.json as { error?: string }).error === "string"
            ? String((r.json as { error: string }).error)
            : "Could not load runs.";
        setListError(msg);
        setRegionRuns([]);
      }
    } catch {
      setListError("Network error. Pull down to retry.");
      setRegionRuns([]);
    }
    setListLoading(false);
  }, [region, regionReady, token]);

  useEffect(() => {
    if (showStatePicker || !regionReady) return;
    void loadRegionRuns();
  }, [showStatePicker, regionReady, loadRegionRuns]);
  const [countdownTick, setCountdownTick] = useState(0);
  const { joinBusy, joinPickup, payBusy, payPickup, declineBusy, declinePickup, availabilityBusy, recordCantMakeIt } =
    usePickupJoin();

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
  const showCreditPreview = !!token && !!runId && !isFree;
  const creditPreview = useMemo(() => bestActiveCredit(pickupCredits), [pickupCredits]);
  const feeAfterCreditPreview = useMemo(
    () => (creditPreview ? feeCentsAfterCredit(feeCents, creditPreview) : feeCents),
    [creditPreview, feeCents],
  );
  const loadPickupCredits = useCallback(async () => {
    const origin = siteOrigin();
    if (!origin || !token) {
      setPickupCredits([]);
      return;
    }
    setPickupCreditsLoading(true);
    try {
      const r = await fetch(`${origin}/api/pickup/credits`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        cache: "no-store",
      });
      const j = (await r.json().catch(() => null)) as { credits?: PickupCreditItem[] } | null;
      if (r.ok && j && Array.isArray(j.credits)) {
        setPickupCredits(j.credits);
      } else {
        setPickupCredits([]);
      }
    } catch {
      setPickupCredits([]);
    } finally {
      setPickupCreditsLoading(false);
    }
  }, [token]);

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

  const showPayForFriend =
    !!run &&
    !!token &&
    !runLocked &&
    myStatus === "confirmed" &&
    spotsLeft != null &&
    spotsLeft > 0;

  const runServiceRegion = useMemo(() => {
    const sr = run?.service_region;
    return typeof sr === "string" ? sr.trim().toUpperCase() : "";
  }, [run?.service_region]);

  const publicRunJoinable =
    isPublicPickupRunType(run?.run_type) &&
    (invitedNow || (runServiceRegion.length > 0 && runServiceRegion === region));

  const eligibleToJoin =
    !!token &&
    !!runId &&
    !runLocked &&
    (myStatus == null || myStatus === "declined") &&
    (publicRunJoinable ||
      (isSelectPickupRunType(run?.run_type) && invitedNow && run?.final_slot_id != null));

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
        void loadRegionRuns();
        if (detailRunId) void load();
      }
    });
    return () => sub.remove();
  }, [load, loadRegionRuns, detailRunId]);

  useEffect(() => {
    if (!detailOpen) return;
    if (!showCreditPreview) return;
    void loadPickupCredits();
  }, [detailOpen, showCreditPreview, loadPickupCredits]);

  useEffect(() => {
    if (!detailOpen) setCreditAppliedPreview(false);
  }, [detailOpen]);

  useEffect(() => {
    setCreditAppliedPreview(false);
  }, [selectedRunId, creditPreview?.id]);

  const rsvpMessage = rsvpStatusMessage(myStatus, waitlistMinutesLeft);

  const showCancelMySpot = myStatus === "confirmed" && !runLocked;

  const cancelSpotRefundEligible = useMemo(() => {
    if (!run) return false;
    const startAt = typeof run.start_at === "string" ? run.start_at : null;
    const cancellationDeadline =
      typeof run.cancellation_deadline === "string" ? run.cancellation_deadline : null;
    return pickupPlayerRefundEligibleClient({
      start_at: startAt,
      cancellation_deadline: cancellationDeadline,
    });
  }, [run]);

  const cancelSpotLabel = cancelSpotRefundEligible
    ? "Cancel spot — get credit for amount paid"
    : "Cancel spot — no refund available";

  const onRefresh = useCallback(() => {
    void loadRegionRuns();
    setListRefreshNonce((n) => n + 1);
    if (detailRunId) void load();
    if (detailOpen && showCreditPreview) void loadPickupCredits();
  }, [loadRegionRuns, load, detailRunId]);

  const openRunDetail = useCallback((id: string) => {
    void hapticTap();
    setSelectedRunId(id);
    setDetailOpen(true);
  }, []);

  const closeRunDetail = useCallback(() => {
    setDetailOpen(false);
  }, []);

  useEffect(() => {
    if (!focusRunIdParam || showStatePicker || autoOpenedFromDeepLinkRef.current) return;
    autoOpenedFromDeepLinkRef.current = true;
    const match = regionRuns.find((r) => r.id === focusRunIdParam);
    if (match && isInlinePlanningRun(match)) return;
    setSelectedRunId(focusRunIdParam);
    setDetailOpen(true);
  }, [focusRunIdParam, showStatePicker, regionRuns]);

  const detailVenue = run ? runVenueFromRow(run) : "Pickup run";

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
        void loadRegionRuns();
        void hapticGoal();
      },
      { venueName: detailVenue },
    );
  }, [token, runId, joinPickup, load, loadRegionRuns, detailVenue]);

  const onCantMakeIt = useCallback(() => {
    if (!token || !runId) {
      Alert.alert("Sign in required", "Sign in to respond to this run.");
      return;
    }
    void hapticTap();
    void recordCantMakeIt(token, runId, runStatus, run?.final_slot_id, async () => {
      await load();
      void loadRegionRuns();
    });
  }, [token, runId, runStatus, run?.final_slot_id, recordCantMakeIt, load, loadRegionRuns]);

  const onCompletePayment = useCallback(() => {
    if (!token || !runId) return;
    void hapticTap();
    void payPickup(token, runId, async () => {
      await load();
      void loadRegionRuns();
    }, { venueName: detailVenue });
  }, [token, runId, payPickup, load, loadRegionRuns, detailVenue]);

  const onConfirmSpot = useCallback(() => {
    if (!token || !runId) {
      Alert.alert("Sign in required", "Sign in to confirm your spot.");
      return;
    }
    void hapticTap();
    if (myStatus === "pending_confirm" && feeCents > 0) {
      void payPickup(token, runId, async () => {
        await load();
        void loadRegionRuns();
      }, { venueName: detailVenue });
      return;
    }
    void joinPickup(
      token,
      runId,
      async () => {
        await load();
        void loadRegionRuns();
        void hapticGoal();
      },
      { venueName: detailVenue },
    );
  }, [token, runId, myStatus, feeCents, payPickup, joinPickup, load, loadRegionRuns, detailVenue]);

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

  const onCancelMySpot = useCallback(() => {
    if (!token || !runId) {
      Alert.alert("Sign in required", "Sign in to cancel your spot.");
      return;
    }
    void hapticTap();
    const startAt = typeof run?.start_at === "string" ? run.start_at : null;
    const cancellationDeadline =
      typeof run?.cancellation_deadline === "string" ? run.cancellation_deadline : null;
    void declinePickup(
      token,
      runId,
      { start_at: startAt, cancellation_deadline: cancellationDeadline },
      async () => {
        await load();
        void loadRegionRuns();
      },
    );
  }, [token, runId, run?.start_at, run?.cancellation_deadline, declinePickup, load, loadRegionRuns]);

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
        refreshControl={
          <RefreshControl refreshing={listLoading || detailLoading} onRefresh={onRefresh} tintColor={LIME} />
        }
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
        <Text style={styles.regionSub}>
          {listFilterZip && listFilterMaxDriveMinutes != null
            ? `${serviceRegionName(region)} (${region}) runs + nearby within ${listFilterMaxDriveMinutes >= 90 ? "90+" : listFilterMaxDriveMinutes} min drive of ${listFilterZip}`
            : `Pickup runs in ${serviceRegionName(region)} (${region})`}
        </Text>

        {listLoading && regionRuns.length === 0 ? (
          <View style={styles.runsList}>
            <SkeletonCard />
          </View>
        ) : listError ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Could not load runs</Text>
            <Text style={styles.emptyBody}>{listError}</Text>
            <Pressable onPress={onRefresh} style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.9 }]}>
              <Text style={styles.retryBtnText}>Try again</Text>
            </Pressable>
          </View>
        ) : regionRuns.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>
              {listFilterZip && listFilterMaxDriveMinutes != null
                ? `No runs in ${serviceRegionName(region)} or within your max drive time right now. Increase max drive time in your Profile.`
                : `No runs scheduled for ${serviceRegionName(region)} right now. Check back soon.`}
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.runsList}>
              {regionRuns.map((listRun) =>
                isInlinePlanningRun(listRun) ? (
                  <View key={listRun.id} style={styles.runBlock}>
                    <RunSummaryCard row={listRun} showChevron={false} inlinePlanning />
                    <InlinePlanningPoll
                      runId={listRun.id}
                      token={token}
                      listRun={listRun}
                      refreshNonce={listRefreshNonce}
                      onListRefresh={() => void loadRegionRuns()}
                    />
                  </View>
                ) : (
                  <RunSummaryCard
                    key={listRun.id}
                    row={listRun}
                    onPress={opensRunDetailModal(listRun) ? () => openRunDetail(listRun.id) : undefined}
                  />
                ),
              )}
            </View>

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
                    {detailLoading && !run ? (
                      <SkeletonCard />
                    ) : detailError ? (
                      <View style={styles.empty}>
                        <Text style={styles.emptyTitle}>Could not load run</Text>
                        <Text style={styles.emptyBody}>{detailError}</Text>
                      </View>
                    ) : !run ? (
                      <View style={styles.empty}>
                        <Text style={styles.emptyTitle}>Run unavailable</Text>
                        <Text style={styles.emptyBody}>This run may have ended or is no longer visible.</Text>
                      </View>
                    ) : !invitedNow && isSelectPickupRunType(run.run_type) ? (
                      <View style={styles.empty}>
                        <Text style={styles.emptyTitle}>Invite only</Text>
                        <Text style={styles.emptyBody}>
                          This is a select run. Open it after you receive an invite.
                        </Text>
                      </View>
                    ) : (
                    <View style={styles.card}>
                      <RunSummaryCard
                        row={{
                          ...run,
                          capacity,
                          fee_cents: feeCents,
                          confirmed_count: confirmed,
                        }}
                        embedded
                        showChevron={false}
                      />

                      {showCreditPreview ? (
                        <>
                          <CardDivider />
                          <View style={styles.creditPreviewRow}>
                            <Text style={styles.creditPreviewTitle}>Credits</Text>
                            {pickupCreditsLoading ? (
                              <Text style={styles.creditPreviewBody}>Loading credits…</Text>
                            ) : creditPreview ? (
                              creditAppliedPreview ? (
                                <Text style={styles.creditPreviewBody}>
                                  You&apos;ll pay {fmtUsdCents(feeAfterCreditPreview)} after credit
                                </Text>
                              ) : (
                                <View style={styles.creditApplyRow}>
                                  <Text style={styles.creditPreviewBody}>
                                    {creditAmountCents(creditPreview) > 0
                                      ? `You have ${fmtUsdCents(creditAmountCents(creditPreview))} credit — apply to this run?`
                                      : creditDiscountPct(creditPreview) > 0
                                        ? `You have ${creditDiscountPct(creditPreview)}% off credit — apply to this run?`
                                        : "You have a free run credit — apply to this run?"}
                                  </Text>
                                  <Pressable
                                    onPress={() => {
                                      void hapticTap();
                                      setCreditAppliedPreview(true);
                                    }}
                                    style={({ pressed }) => [
                                      styles.creditApplyBtn,
                                      pressed && { opacity: 0.9 },
                                    ]}
                                  >
                                    <Text style={styles.creditApplyBtnText}>Apply</Text>
                                  </Pressable>
                                </View>
                              )
                            ) : (
                              <Text style={styles.creditPreviewBody}>
                                No active credits right now — full price will be charged.
                              </Text>
                            )}
                          </View>
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
                        void loadRegionRuns();
                      }}
                    />
                  ) : null}
                  {showCancelMySpot ? (
                    <Pressable
                      disabled={declineBusy}
                      onPress={onCancelMySpot}
                      accessibilityRole="button"
                      accessibilityLabel="Cancel my spot"
                      style={({ pressed }) => [
                        styles.destructiveBtn,
                        pressed && !declineBusy && { opacity: 0.9 },
                        declineBusy && styles.btnDisabled,
                      ]}
                    >
                      <Text style={styles.destructiveBtnText}>
                        {declineBusy ? "Canceling…" : cancelSpotLabel}
                      </Text>
                    </Pressable>
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
                    )}
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
  runsList: { gap: 12 },
  runBlock: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.03)",
    overflow: "hidden",
  },
  inlinePoll: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: DIVIDER,
    gap: 12,
  },
  inlinePollLoading: { color: "rgba(255,255,255,0.45)", fontSize: 14 },
  inlinePollError: { color: "rgba(255,255,255,0.55)", fontSize: 14, lineHeight: 20 },
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
  cardInlinePlanning: {
    borderWidth: 0,
    borderRadius: 0,
    backgroundColor: "transparent",
    marginBottom: 0,
  },
  divider: { height: 1, backgroundColor: DIVIDER, marginVertical: -4 },
  creditPreviewRow: { gap: 6 },
  creditPreviewTitle: { color: "rgba(255,255,255,0.65)", fontWeight: "800", fontSize: 12, letterSpacing: 0.2 },
  creditPreviewBody: { color: "rgba(255,255,255,0.75)", lineHeight: 20, fontSize: 14, flex: 1 },
  creditApplyRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  creditApplyBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.45)",
    backgroundColor: "rgba(163,230,53,0.1)",
    flexShrink: 0,
  },
  creditApplyBtnText: { color: LIME, fontWeight: "800", fontSize: 14 },
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
  locationTextBlock: { flex: 1, gap: 4 },
  venue: { color: "rgba(255,255,255,0.75)", fontSize: 15, lineHeight: 22 },
  distanceAway: { color: "rgba(163,230,53,0.85)", fontSize: 13, fontWeight: "600" },
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
