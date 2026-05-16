import { useAuth } from "@/context/AuthContext";
import * as Sentry from "@sentry/react-native";
import AdminVenuePicker from "@/components/AdminVenuePicker";
import DateTimePicker, { formatDateTimePickerEtLabel, isScheduleWallMidnightEt } from "@/components/DateTimePicker";
import {
  adminVenueLocationPreset,
  serviceRegionForAdminVenueName,
} from "@/lib/adminCtPickupVenues";
import {
  fetchAdminTierSuggestions,
  postAdminRunTierSuggestionAlgorithm,
  fetchAdminPickupSwitchDetail,
  fetchAdminPickupSwitchList,
  type PickupSwitchDetailResponse,
  postAdminAssignPickupTeams,
  postAdminCancelRun,
  postAdminCreateRun,
  postAdminEndRun,
  postAdminLateCancel,
  postAdminConfirmPickupFromAvailability,
  deleteAdminPickupRunAvailability,
  postAdminMarkAttendance,
  postAdminPickupSwitch,
  postAdminPromote,
  postAdminSetHubPickup,
} from "@/lib/adminApi";
import { fmtPickupDateEt, fmtPickupDt, fmtPickupTimeEt } from "@/lib/pickupPublic";
import { isPublicPickupRunType } from "@/lib/pickupRunType";
import {
  derivePickupLifecycleStage,
  isPastTerminalPickupRun,
  pickupLifecycleStageLabel,
  showEditSettingsButton,
  showEndRunButton,
  showFinalizeTimeButton,
  showInvitePlayersButton,
  showPostResultsForPast,
  showPromoteToHubButton,
  showStartRunNowButton,
  showViewResultsForPast,
} from "@/lib/pickupRunLifecycle";
import { SERVICE_REGIONS, serviceRegionName, type ServiceRegionCode } from "@/lib/serviceRegions";
import { getMobileSupabaseClient } from "@/lib/supabase";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

const LIME = "#a3e635";

type PickupTeamLetter = "A" | "B" | "C";
const TEAMS_2: PickupTeamLetter[] = ["A", "B"];
const TEAMS_3: PickupTeamLetter[] = ["A", "B", "C"];

type TeamAssignPlayer = { id: string; full_name: string | null; playing_position: string | null };

function labelPickupTeam(t: PickupTeamLetter) {
  return `Team ${t}`;
}

function generateTeamsByPosition(players: TeamAssignPlayer[], numTeams: number): Record<string, PickupTeamLetter> {
  const positions = ["Goalkeeper", "Defender", "Midfielder", "Attacker"];
  const grouped: Record<string, TeamAssignPlayer[]> = {};
  for (const pos of positions) grouped[pos] = [];
  const unassigned: TeamAssignPlayer[] = [];
  for (const p of players) {
    const pos = p.playing_position || "";
    if (positions.includes(pos)) grouped[pos].push(p);
    else unassigned.push(p);
  }
  for (const pos of positions) grouped[pos].sort(() => Math.random() - 0.5);
  unassigned.sort(() => Math.random() - 0.5);
  const allOrdered = [
    ...grouped["Goalkeeper"],
    ...grouped["Defender"],
    ...grouped["Midfielder"],
    ...grouped["Attacker"],
    ...unassigned,
  ];
  const teamLabels: PickupTeamLetter[] = numTeams === 3 ? ["A", "B", "C"] : ["A", "B"];
  const result: Record<string, PickupTeamLetter> = {};
  allOrdered.forEach((p, i) => {
    result[p.id] = teamLabels[i % numTeams]!;
  });
  return result;
}

function clampTeamMapToTotal(cur: Record<string, PickupTeamLetter>, total: 2 | 3): Record<string, PickupTeamLetter> {
  const out: Record<string, PickupTeamLetter> = { ...cur };
  for (const k of Object.keys(out)) {
    const t = out[k];
    if (total === 2 && t === "C") out[k] = "A";
  }
  return out;
}

const LOCATION_PRESETS = {
  new_haven: `New Haven SoccerRoof
1018 Sherman Ave, Hamden, CT 06514

Parking
Parking lot directly outside the building on Sherman Ave (in front of the facility entrance).

Field Number
Leave blank.`,
  new_rochelle: `New Rochelle SoccerRoof
29 LeCount Pl, 3rd Floor, New Rochelle, NY 10801

Parking
New Roc City Garage - parking garage attached to the New Roc City complex next to the facility.

Field Number
Leave blank.`,
} as const;

type LocationPresetKey = keyof typeof LOCATION_PRESETS | "other" | "";

type VenueFeePreset = {
  id: string;
  label: string;
  region: ServiceRegionCode;
  /** Whole dollars; 0 means do not auto-fill field cost (manual entry). */
  priceDollars: number;
  address: string;
};

const VENUE_FEE_PRESETS: VenueFeePreset[] = [
  { id: "nj_meadow_5v5", label: "Sofive Meadowlands 5v5", region: "NJ", priceDollars: 162, address: "2 Palmer Terrace, Carlstadt, NJ 07072" },
  { id: "nj_meadow_7v7", label: "Sofive Meadowlands 7v7", region: "NJ", priceDollars: 338, address: "2 Palmer Terrace, Carlstadt, NJ 07072" },
  { id: "nj_cherry_5v5", label: "Sofive Cherry Hill 5v5", region: "NJ", priceDollars: 192, address: "650 Kresson Rd, Cherry Hill, NJ 08034" },
  { id: "nj_cherry_7v7", label: "Sofive Cherry Hill 7v7", region: "NJ", priceDollars: 338, address: "650 Kresson Rd, Cherry Hill, NJ 08034" },
  { id: "ny_brooklyn", label: "Sofive Brooklyn", region: "NY", priceDollars: 173, address: "2015 Pitkin Ave, Brooklyn, NY 11207" },
  { id: "ny_hudson", label: "Hudson Sports", region: "NY", priceDollars: 131, address: "Warwick, NY" },
  { id: "ny_rochelle", label: "New Rochelle SoccerRoof", region: "NY", priceDollars: 278, address: "29 LeCount Pl, New Rochelle, NY" },
  { id: "md_rockville", label: "Sofive Rockville", region: "MD", priceDollars: 165, address: "1008 Westmore Ave, Rockville, MD 20850" },
  { id: "md_jessup", label: "SoccerDome Jessup", region: "MD", priceDollars: 113, address: "7330 Montevideo Road, Jessup, MD 20794" },
  { id: "md_harmans", label: "SoccerDome Harmans", region: "MD", priceDollars: 113, address: "7447 Shipley Avenue, Harmans, MD 21077" },
  { id: "ct_nh", label: "New Haven SoccerRoof", region: "CT", priceDollars: 150, address: "1018 Sherman Ave, Hamden, CT" },
];

function s(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

type AdminPickupWorkflowTab = "planning" | "active" | "past";

function isPastPickupRun(row: Record<string, unknown>): boolean {
  if (row.is_completed === true) return true;
  const st = s(row.status).trim();
  return st === "completed" || st === "canceled";
}

function defaultAdminPickupTab(counts: Record<AdminPickupWorkflowTab, number>): AdminPickupWorkflowTab {
  if (counts.active > 0) return "active";
  return "planning";
}

/** Run start in Eastern Time for admin past-run cards. */
function fmtPickupDtEt(dt: string | null | undefined): string {
  if (!dt) return "TBD";
  try {
    return new Date(dt).toLocaleString("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "TBD";
  }
}

/** First line of staff location, else title. */
function venueLineFromRun(row: Record<string, unknown>): string {
  const loc = s(row.location_private).trim();
  if (loc) {
    const first = loc.split(/\r?\n/)[0]?.trim();
    if (first) return first;
  }
  const title = s(row.title).trim();
  return title || "Venue TBD";
}

/** Staff override wins out when set (including 0); otherwise use computed stats from API. */
function displayPickupStat(override: unknown, statsFallback: unknown): number {
  if (override != null && override !== "") {
    const n = Number(override);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  const f = Number(statsFallback);
  return Number.isFinite(f) ? Math.trunc(f) : 0;
}

function listCountsFromRow(row: Record<string, unknown>): {
  confirmed: number;
  standby: number;
  invites: number;
  pending_payment: number;
  waitlist: number;
} {
  const raw = row.list_counts;
  if (!raw || typeof raw !== "object") {
    return { confirmed: 0, standby: 0, invites: 0, pending_payment: 0, waitlist: 0 };
  }
  const o = raw as Record<string, unknown>;
  return {
    confirmed: Number(o.confirmed ?? 0) || 0,
    standby: Number(o.standby ?? 0) || 0,
    invites: Number(o.invites ?? 0) || 0,
    pending_payment: Number(o.pending_payment ?? 0) || 0,
    waitlist: Number(o.waitlist ?? 0) || 0,
  };
}

function detectPreset(locationPrivate: string): LocationPresetKey {
  const t = locationPrivate.trim();
  if (!t) return "";
  if (t === LOCATION_PRESETS.new_haven.trim()) return "new_haven";
  if (t === LOCATION_PRESETS.new_rochelle.trim()) return "new_rochelle";
  return "other";
}

function feeCentsFromCalculator(fieldCostDollars: number, myEarningsDollars: number, expectedPlayers: number): number {
  if (
    !Number.isFinite(fieldCostDollars) ||
    !Number.isFinite(myEarningsDollars) ||
    !Number.isFinite(expectedPlayers) ||
    expectedPlayers <= 0 ||
    !Number.isInteger(expectedPlayers)
  ) {
    return 0;
  }
  return Math.ceil(((fieldCostDollars + myEarningsDollars) / expectedPlayers) * 100);
}

type PickupFeePreview = {
  feeCents: number;
  perPlayer: number;
  fieldTotal: number;
  cutTotal: number;
};

function pickupFeePreview(
  fieldCostDollars: number,
  myEarningsDollars: number,
  expectedPlayers: number,
): PickupFeePreview | null {
  if (!Number.isFinite(fieldCostDollars) || fieldCostDollars < 0) return null;
  if (!Number.isFinite(myEarningsDollars) || myEarningsDollars < 0) return null;
  if (!Number.isFinite(expectedPlayers) || expectedPlayers <= 0 || !Number.isInteger(expectedPlayers)) return null;
  const feeCents = feeCentsFromCalculator(fieldCostDollars, myEarningsDollars, expectedPlayers);
  return {
    feeCents,
    perPlayer: feeCents / 100,
    fieldTotal: fieldCostDollars,
    cutTotal: myEarningsDollars,
  };
}

export default function AdminPickupOpsScreen() {
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const router = useRouter();

  const [region, setRegion] = useState<ServiceRegionCode>("CT");
  const [runs, setRuns] = useState<Record<string, unknown>[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [workflowTabOverride, setWorkflowTabOverride] = useState<AdminPickupWorkflowTab | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editSectionExpanded, setEditSectionExpanded] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  /** Keeps run id across async saves if modal state is cleared mid-flight. */
  const selectedRunIdRef = useRef<string | null>(null);
  const [detail, setDetail] = useState<PickupSwitchDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [editTitle, setEditTitle] = useState("");
  const [editRunType, setEditRunType] = useState<"select" | "public">("select");
  const [createRunType, setCreateRunType] = useState<"select" | "public">("select");
  const [editCapacity, setEditCapacity] = useState("18");
  const [editFieldCost, setEditFieldCost] = useState("");
  const [editMyEarnings, setEditMyEarnings] = useState("0");
  const [editHours, setEditHours] = useState("1.5");
  const [editExpectedPlayers, setEditExpectedPlayers] = useState("18");
  const [editLocationPrivate, setEditLocationPrivate] = useState("");
  const [editLocConfirmedOnly, setEditLocConfirmedOnly] = useState(true);
  const [locationPreset, setLocationPreset] = useState<LocationPresetKey>("");

  const [slotStart, setSlotStart] = useState("");
  const [slotLabel, setSlotLabel] = useState("");
  const slotLabelRef = useRef(slotLabel);
  slotLabelRef.current = slotLabel;

  const [createStartAt, setCreateStartAt] = useState("");
  const [createTitle, setCreateTitle] = useState("");
  const [createCapacity, setCreateCapacity] = useState("24");
  const [createFieldCost, setCreateFieldCost] = useState("");
  const [createMyEarnings, setCreateMyEarnings] = useState("0");
  const [createHours, setCreateHours] = useState("1.5");
  const [createExpectedPlayers, setCreateExpectedPlayers] = useState("24");
  const [createLocationText, setCreateLocationText] = useState("");
  const [createVenueName, setCreateVenueName] = useState("");
  const [createSelectedVenueFeePresetId, setCreateSelectedVenueFeePresetId] = useState<string | null>(null);
  const [editSelectedVenueFeePresetId, setEditSelectedVenueFeePresetId] = useState<string | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [tierBadge, setTierBadge] = useState<number>(0);

  const [teamAssignOpen, setTeamAssignOpen] = useState(false);
  const [teamAssignRunId, setTeamAssignRunId] = useState<string | null>(null);
  const [teamAssignLoading, setTeamAssignLoading] = useState(false);
  const [teamAssignBusy, setTeamAssignBusy] = useState(false);
  const [teamAssignPlayers, setTeamAssignPlayers] = useState<TeamAssignPlayer[]>([]);
  const [teamAssignTotal, setTeamAssignTotal] = useState<2 | 3>(2);
  const [teamAssignByUser, setTeamAssignByUser] = useState<Record<string, PickupTeamLetter>>({});
  const [teamAssignPickUserId, setTeamAssignPickUserId] = useState<string | null>(null);

  const venueFeePresetsForRegion = useMemo(() => VENUE_FEE_PRESETS.filter((p) => p.region === region), [region]);
  const [createRegion, setCreateRegion] = useState<ServiceRegionCode>("CT");

  const workflowTabCounts = useMemo(() => {
    const c: Record<AdminPickupWorkflowTab, number> = { planning: 0, active: 0, past: 0 };
    for (const row of runs) {
      if (isPastPickupRun(row)) {
        c.past += 1;
        continue;
      }
      const st = s(row.status).trim();
      if (st === "planning") c.planning += 1;
      else if (st === "likely_on" || st === "active" || st === "in_progress") c.active += 1;
    }
    return c;
  }, [runs]);

  useEffect(() => {
    setCreateSelectedVenueFeePresetId(null);
    setEditSelectedVenueFeePresetId(null);
  }, [region]);

  const loadRuns = useCallback(async () => {
    console.log("[loadRuns] region:", region);
    console.log("[loadRuns] token exists:", Boolean(token));
    if (!token) {
      setListError("Not signed in.");
      setRuns([]);
      return;
    }
    setListLoading(true);
    setListError(null);
    const r = await fetchAdminPickupSwitchList(token, { region });
    console.log("[loadRuns] r.ok:", r.ok);
    console.log("[loadRuns] runs count:", r.ok ? r.data.runs?.length : undefined);
    console.log("[loadRuns] error:", r.ok ? undefined : r.error);
    console.log("[loadRuns] runs:", r.ok ? JSON.stringify(r.data.runs?.slice(0, 2)) : undefined);
    setListLoading(false);
    if (!r.ok) {
      setListError(r.error);
      setRuns([]);
      return;
    }
    setRuns(r.data.runs || []);
  }, [token, region]);

  const loadTierBadge = useCallback(async () => {
    if (!token) {
      setTierBadge(0);
      return;
    }
    const r = await fetchAdminTierSuggestions(token);
    if (!r.ok) {
      setTierBadge(0);
      return;
    }
    setTierBadge(Number(r.data.pending_count || 0));
  }, [token]);

  const loadDetail = useCallback(async () => {
    if (!token || !selectedRunId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    setDetailError(null);
    const r = await fetchAdminPickupSwitchDetail(token, selectedRunId, { region });
    setDetailLoading(false);
    if (!r.ok) {
      setDetailError(r.error);
      setDetail(null);
      return;
    }
    setDetail(r.data);
    setEditSelectedVenueFeePresetId(null);
    const run = r.data.run;
    if (run && typeof run === "object") {
      setEditTitle(s(run.title) || "CT Pickup Run");
      setEditRunType(run.run_type === "public" ? "public" : "select");
      const cap = Number(run.capacity ?? 18);
      setEditCapacity(String(cap));
      const cents = Number(run.fee_cents ?? 0);
      const adminCentsRaw = Number((run as { admin_fee_cents?: unknown }).admin_fee_cents ?? 0);
      const adminCents = Number.isFinite(adminCentsRaw) && adminCentsRaw >= 0 ? Math.round(adminCentsRaw) : 0;
      setEditExpectedPlayers(String(cap));
      const totalFromPlayersCents = Number.isFinite(cents) && cap > 0 ? Math.round(cents * cap) : NaN;
      const fieldTotalCents = Number.isFinite(totalFromPlayersCents) ? Math.max(0, totalFromPlayersCents - adminCents) : NaN;
      setEditFieldCost(
        Number.isFinite(fieldTotalCents) ? String(fieldTotalCents / 100) : "",
      );
      setEditMyEarnings(String(adminCents / 100));
      setEditHours("1.5");
      const loc = s(run.location_private);
      setEditLocationPrivate(loc);
      setLocationPreset(detectPreset(loc));
      setEditLocConfirmedOnly(run.show_location_to_confirmed_only !== false);
    }
  }, [token, selectedRunId, region]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    const supabase = getMobileSupabaseClient();
    if (!supabase) return;
    const channel = supabase
      .channel("admin-pickup-runs")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pickup_runs" },
        () => {
          void loadRuns();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [region, loadRuns]);

  useEffect(() => {
    void loadTierBadge();
  }, [loadTierBadge]);

  useEffect(() => {
    if (!selectedRunId) return;
    setSlotStart("");
    setSlotLabel("");
  }, [selectedRunId]);

  useEffect(() => {
    if (!modalOpen || !selectedRunId) return;
    void loadDetail();
  }, [modalOpen, selectedRunId, loadDetail]);

  const selectedRun = detail?.run ?? null;
  const selectedRunStageLabel = useMemo(() => {
    if (!selectedRun || typeof selectedRun !== "object") return "";
    const stage = derivePickupLifecycleStage({
      status: s((selectedRun as Record<string, unknown>).status),
      is_current: (selectedRun as Record<string, unknown>).is_current === true,
      outreach_started_at: s((selectedRun as Record<string, unknown>).outreach_started_at) || null,
      is_completed: (selectedRun as Record<string, unknown>).is_completed === true,
      has_result: (selectedRun as Record<string, unknown>).has_result === true,
    });
    return pickupLifecycleStageLabel(stage);
  }, [selectedRun]);

  const detailKickoffActions = useMemo(() => {
    if (!selectedRunId || !selectedRun || typeof selectedRun !== "object") {
      return { showStart: false, showEnd: false, showPost: false, showView: false };
    }
    const sr = selectedRun as Record<string, unknown>;
    const status = s(sr.status);
    const is_completed = sr.is_completed === true;
    const has_result = sr.has_result === true;
    const start_at = s(sr.start_at) || null;
    return {
      showStart: showStartRunNowButton({ status, is_completed, start_at }),
      showEnd: showEndRunButton({ status, is_completed }),
      showPost: showPostResultsForPast({ status, is_completed, has_result }),
      showView:
        showViewResultsForPast({ has_result }) &&
        isPastTerminalPickupRun({ status, is_completed }),
    };
  }, [selectedRunId, selectedRun]);
  const slots = useMemo(() => (Array.isArray(detail?.slots) ? detail!.slots : []) as Record<string, unknown>[], [detail]);
  const counts = detail?.counts;
  const confirmed = useMemo(() => (Array.isArray(detail?.confirmed) ? detail!.confirmed : []), [detail]);
  const standby = useMemo(() => (Array.isArray(detail?.standby) ? detail!.standby : []), [detail]);
  const auto = detail?.auto_status;

  const createFeePreview = useMemo(
    () => pickupFeePreview(Number(createFieldCost), Number(createMyEarnings), Number(createExpectedPlayers)),
    [createFieldCost, createMyEarnings, createExpectedPlayers],
  );
  const editFeePreview = useMemo(
    () => pickupFeePreview(Number(editFieldCost), Number(editMyEarnings), Number(editExpectedPlayers)),
    [editFieldCost, editMyEarnings, editExpectedPlayers],
  );

  async function requireToken(): Promise<string | null> {
    if (!token) {
      Alert.alert("Not signed in", "Sign in again.");
      return null;
    }
    return token;
  }

  function openRun(id: string) {
    selectedRunIdRef.current = id;
    setSelectedRunId(id);
    setEditSectionExpanded(false);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    selectedRunIdRef.current = null;
    setSelectedRunId(null);
    setDetail(null);
    setDetailError(null);
    setSlotStart("");
    setSlotLabel("");
    setEditSectionExpanded(false);
  }

  function applyPreset(key: LocationPresetKey) {
    setEditSelectedVenueFeePresetId(null);
    setLocationPreset(key);
    if (key === "new_haven") setEditLocationPrivate(LOCATION_PRESETS.new_haven);
    else if (key === "new_rochelle") setEditLocationPrivate(LOCATION_PRESETS.new_rochelle);
    else if (key === "other") setEditLocationPrivate("");
  }

  async function onSaveRun() {
    const t = await requireToken();
    if (!t || !selectedRunId) return;
    setBusy("save");
    const fc = Number(editFieldCost);
    const me = Number(editMyEarnings);
    const ep = Number(editExpectedPlayers);
    if (!Number.isFinite(fc) || fc < 0) {
      setBusy(null);
      return Alert.alert("Invalid field cost", "Enter a valid number for field cost ($).");
    }
    if (!Number.isFinite(me) || me < 0) {
      setBusy(null);
      return Alert.alert("Invalid earnings", "Enter a valid number for my earnings ($), zero or more.");
    }
    if (!Number.isFinite(ep) || ep <= 0 || !Number.isInteger(ep)) {
      setBusy(null);
      return Alert.alert("Invalid expected players", "Enter a positive whole number of players splitting the cost.");
    }
    const fee_cents = feeCentsFromCalculator(fc, me, ep);
    const admin_fee_cents = Math.round(me * 100);
    const r = await postAdminPickupSwitch(t, {
      action: "edit_run",
      run_id: selectedRunId,
      title: editTitle.trim(),
      capacity: Number(editCapacity || 18),
      fee_cents,
      admin_fee_cents,
      currency: "usd",
      location_private: editLocationPrivate.trim() || null,
      show_location_to_confirmed_only: editLocConfirmedOnly,
      run_type: editRunType,
    });
    setBusy(null);
    if (!r.ok) return Alert.alert("Update failed", r.error);
    Alert.alert("Saved", "Run details updated.");
    void loadRuns();
    void loadDetail();
  }

  async function persistKickoffSlot(start_at: string): Promise<boolean> {
    const runId = selectedRunIdRef.current ?? selectedRunId;
    if (!runId) {
      Alert.alert("No run selected", "Open a run again, then set the kickoff time.");
      return false;
    }
    const t = await requireToken();
    if (!t) return false;
    const trimmed = start_at.trim();
    if (!trimmed) {
      Alert.alert("Missing time", "Pick a kickoff time in Eastern Time, then confirm.");
      return false;
    }
    setBusy("slot");
    const body = {
      action: "add_slot" as const,
      run_id: runId,
      start_at: trimmed,
      label: slotLabelRef.current.trim() || null,
    };
    const r = await postAdminPickupSwitch(t, body);
    setBusy(null);
    if (!r.ok) {
      Alert.alert("Add slot failed", r.error);
      return false;
    }
    setSlotStart("");
    setSlotLabel("");
    void loadDetail();
    void loadRuns();
    return true;
  }

  async function onAddSlot() {
    await persistKickoffSlot(slotStart);
  }

  /** DateTimePicker’s Confirm calls `onChange` only; we persist the slot here (same as “Add slot”). */
  function onKickoffSlotDateTimeConfirmed(iso: string) {
    setSlotStart(iso);
    void persistKickoffSlot(iso);
  }

  async function onFinalizeSlot(slotId: string) {
    const t = await requireToken();
    if (!t || !selectedRunId) return;
    Alert.alert("Finalize this slot?", "Sets run start, opens RSVP timing, and marks run active.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Finalize",
        onPress: () => {
          void (async () => {
            try {
              setBusy("finalize");
              const r = await postAdminPickupSwitch(t, {
                action: "finalize_slot",
                run_id: selectedRunId,
                slot_id: slotId,
              });
              if (!r.ok) return Alert.alert("Finalize failed", r.error);
              void loadDetail();
              void loadRuns();
            } catch (e) {
              console.warn("[admin pickup] action failed", e);
              Sentry.captureException(e);
              Alert.alert("Something went wrong", "Please try again.");
            } finally {
              setBusy(null);
            }
          })();
        },
      },
    ]);
  }

  async function onPromoteHub(opts?: { runId: string }) {
    const t = await requireToken();
    const runId = opts?.runId ?? selectedRunId;
    if (!t || !runId) return;
    Alert.alert("Promote to hub?", "This run becomes the featured pickup on the public site for its region.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Promote",
        onPress: () => {
          void (async () => {
            try {
              setBusy("hub");
              const r = await postAdminSetHubPickup(t, runId);
              if (!r.ok) return Alert.alert("Promote failed", r.error);
              void loadRuns();
              void loadDetail();
            } catch (e) {
              console.warn("[admin pickup] action failed", e);
              Sentry.captureException(e);
              Alert.alert("Something went wrong", "Please try again.");
            } finally {
              setBusy(null);
            }
          })();
        },
      },
    ]);
  }

  async function onCreateRun() {
    const t = await requireToken();
    if (!t) return;
    const start_at = createStartAt.trim();
    if (!start_at) {
      Alert.alert("Select a date", "Please select a start date and time.");
      return;
    }
    if (isScheduleWallMidnightEt(start_at)) {
      Alert.alert("Please select a time for the run");
      return;
    }
    if (new Date(start_at) <= new Date()) {
      Alert.alert("Invalid date", "Start time must be in the future.");
      return;
    }
    const fc = Number(createFieldCost);
    const me = Number(createMyEarnings);
    const ep = Number(createExpectedPlayers);
    if (!Number.isFinite(fc) || fc < 0) {
      return Alert.alert("Invalid field cost", "Enter a valid number for field cost ($).");
    }
    if (!Number.isFinite(me) || me < 0) {
      return Alert.alert("Invalid earnings", "Enter a valid number for my earnings ($), zero or more.");
    }
    if (!Number.isFinite(ep) || ep <= 0 || !Number.isInteger(ep)) {
      return Alert.alert("Invalid expected players", "Enter a positive whole number of players splitting the cost.");
    }
    if (!createVenueName.trim() && !createLocationText.trim()) {
      return Alert.alert("Venue required", "Select a venue or enter a staff location.");
    }
    const fee_cents = feeCentsFromCalculator(fc, me, ep);
    const admin_fee_cents = Math.round(me * 100);
    setBusy("create");
    try {
      const r = await postAdminCreateRun(t, {
        start_at,
        title: createTitle.trim() || undefined,
        service_region: createRegion,
        capacity: Number(createCapacity || 24),
        fee_cents,
        admin_fee_cents,
        location_private: createLocationText.trim() || undefined,
        run_type: createRunType,
      });
      if (!r.ok) return Alert.alert("Create failed", r.error);
      const created = r.data.run as { id?: string } | undefined;
      const newId = typeof created?.id === "string" ? created.id : "";
      const buttons =
        createRunType === "select" && newId
          ? [
              {
                text: "Invite players",
                onPress: () =>
                  (router.push as (href: string) => void)(
                    `/admin/invite-players?run_id=${encodeURIComponent(newId)}`,
                  ),
              },
              { text: "OK", style: "cancel" as const },
            ]
          : [{ text: "OK", style: "cancel" as const }];
      Alert.alert(
        "Created",
        createRunType === "select"
          ? "Select runs are invite-only. Invite players so they can see the run and respond."
          : "Run created.",
        buttons,
      );
      setCreateStartAt("");
      setCreateTitle("");
      setCreateFieldCost("");
      setCreateMyEarnings("0");
      setCreateHours("1.5");
      setCreateExpectedPlayers(createCapacity.trim() || "24");
      setCreateLocationText("");
      setCreateVenueName("");
      setCreateSelectedVenueFeePresetId(null);
      setCreateModalOpen(false);
      setRegion(createRegion);
      setWorkflowTabOverride("planning");
      setTimeout(() => void loadRuns(), 300);
    } catch (e) {
      console.warn("[onCreateRun] request failed", e);
      Sentry.captureException(e);
      Alert.alert("Something went wrong", "Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function onCancelRun() {
    if (!selectedRunId) return;
    const t = await requireToken();
    if (!t) return;
    Alert.alert("Cancel run?", "This will cancel the run and attempt refunds if needed.", [
      { text: "Nevermind", style: "cancel" },
      {
        text: "Cancel run",
        style: "destructive",
        onPress: () => {
          void (async () => {
            try {
              setBusy("cancel");
              const r = await postAdminCancelRun(t, { run_id: selectedRunId, reason: "Canceled from mobile admin" });
              if (!r.ok) return Alert.alert("Cancel failed", r.error);
              Alert.alert("Canceled", "Run canceled.");
              closeModal();
              void loadRuns();
            } catch (e) {
              console.warn("[admin pickup] action failed", e);
              Sentry.captureException(e);
              Alert.alert("Something went wrong", "Please try again.");
            } finally {
              setBusy(null);
            }
          })();
        },
      },
    ]);
  }

  async function onEndRun(runId: string) {
    const t = await requireToken();
    if (!t) return;
    Alert.alert("End this pickup run? You can mark results after.", "", [
      { text: "Cancel", style: "cancel" },
      {
        text: "End run",
        style: "destructive",
        onPress: () => {
          void (async () => {
            try {
              setBusy(`end:${runId}`);
              const r = await postAdminEndRun(t, { run_id: runId });
              if (!r.ok) return Alert.alert("End run failed", r.error);
              setWorkflowTabOverride("past");
              setRuns((prev) =>
                prev.map((row) => (s(row.id) === runId ? { ...row, status: "completed", is_completed: true } : row)),
              );
              void loadRuns();
              if (selectedRunId === runId) void loadDetail();
            } catch (e) {
              console.warn("[admin pickup] action failed", e);
              Sentry.captureException(e);
              Alert.alert("Something went wrong", "Please try again.");
            } finally {
              setBusy(null);
            }
          })();
        },
      },
    ]);
  }

  async function openTeamAssignAfterStart(runId: string) {
    const t = await requireToken();
    if (!t) return;
    setTeamAssignRunId(runId);
    setTeamAssignPickUserId(null);
    setTeamAssignOpen(true);
    setTeamAssignLoading(true);
    setTeamAssignPlayers([]);
    setTeamAssignByUser({});
    try {
      const d = await fetchAdminPickupSwitchDetail(t, runId, { region });
      if (!d.ok) {
        Alert.alert("Couldn’t load roster", d.error);
        setTeamAssignOpen(false);
        setTeamAssignRunId(null);
        return;
      }
      const list = Array.isArray(d.data.confirmed) ? d.data.confirmed : [];
      const players: TeamAssignPlayer[] = list.map((row) => {
        const o = row as { id?: unknown; full_name?: unknown; playing_position?: unknown };
        const id = typeof o.id === "string" ? o.id : "";
        const full_name = typeof o.full_name === "string" ? o.full_name : null;
        const playing_position = typeof o.playing_position === "string" ? o.playing_position : null;
        return { id, full_name, playing_position };
      }).filter((p) => p.id);
      setTeamAssignPlayers(players);
      setTeamAssignTotal(2);
      const initial: Record<string, PickupTeamLetter> = {};
      players.forEach((p, idx) => {
        initial[p.id] = idx % 2 === 0 ? "A" : "B";
      });
      setTeamAssignByUser(initial);
    } catch (e) {
      console.warn("[admin pickup] action failed", e);
      Sentry.captureException(e);
      Alert.alert("Something went wrong", "Please try again.");
      setTeamAssignOpen(false);
      setTeamAssignRunId(null);
    } finally {
      setTeamAssignLoading(false);
    }
  }

  function resetTeamAssignState() {
    setTeamAssignOpen(false);
    setTeamAssignRunId(null);
    setTeamAssignLoading(false);
    setTeamAssignBusy(false);
    setTeamAssignPlayers([]);
    setTeamAssignByUser({});
    setTeamAssignPickUserId(null);
    setTeamAssignTotal(2);
  }

  function requestCloseTeamAssignModal() {
    Alert.alert("Teams not saved", "Teams not saved. Assign teams before the run starts.", [
      { text: "Keep editing", style: "cancel" },
      {
        text: "Close anyway",
        style: "destructive",
        onPress: () => resetTeamAssignState(),
      },
    ]);
  }

  async function onLockTeamAssign() {
    const t = await requireToken();
    if (!t || !teamAssignRunId) return;
    if (teamAssignPlayers.length === 0) {
      return Alert.alert("No players", "There are no confirmed players to assign.");
    }
    const missing = teamAssignPlayers.filter((p) => !teamAssignByUser[p.id]);
    if (missing.length) {
      return Alert.alert("Incomplete", "Assign every player to a team before locking.");
    }
    setTeamAssignBusy(true);
    const r = await postAdminAssignPickupTeams(t, {
      run_id: teamAssignRunId,
      total_teams: teamAssignTotal,
      team_assignments: teamAssignPlayers.map((p) => ({ user_id: p.id, team: teamAssignByUser[p.id]! })),
    });
    setTeamAssignBusy(false);
    if (!r.ok) return Alert.alert("Save failed", r.error);
    resetTeamAssignState();
  }

  async function onStartRunNow(runId: string) {
    const t = await requireToken();
    if (!t) return;
    Alert.alert(
      "Begin pickup now?",
      "This locks the roster — no new players will be able to join this run.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Begin pickup",
          onPress: () => {
            void (async () => {
              try {
                setBusy(`start:${runId}`);
                const r = await postAdminPickupSwitch(t, { action: "start_run_now", run_id: runId });
                if (!r.ok) return Alert.alert("Couldn’t start run", r.error);
                const nowIso = new Date().toISOString();
                setRuns((prev) =>
                  prev.map((row) =>
                    s(row.id) === runId ? { ...row, status: "in_progress", locked_at: nowIso } : row,
                  ),
                );
                void loadRuns();
                if (selectedRunId === runId) void loadDetail();
                await openTeamAssignAfterStart(runId);
              } catch (e) {
                console.warn("[admin pickup] action failed", e);
                Sentry.captureException(e);
                Alert.alert("Something went wrong", "Please try again.");
              } finally {
                setBusy(null);
              }
            })();
          },
        },
      ],
    );
  }

  async function onPromote(userId: string) {
    if (!selectedRunId) return;
    const t = await requireToken();
    if (!t) return;
    setBusy(`promote:${userId}`);
    const r = await postAdminPromote(t, { run_id: selectedRunId, promote_user_id: userId });
    setBusy(null);
    if (!r.ok) return Alert.alert("Promote failed", r.error);
    void loadDetail();
  }

  async function onMarkAttendance(userId: string, attended: boolean) {
    if (!selectedRunId) return;
    const t = await requireToken();
    if (!t) return;
    setBusy(`att:${userId}`);
    const r = await postAdminMarkAttendance(t, { run_id: selectedRunId, attendance: [{ user_id: userId, attended }] });
    setBusy(null);
    if (!r.ok) return Alert.alert("Save failed", r.error);
    void loadDetail();
  }

  async function onLateCancel(userId: string) {
    if (!selectedRunId) return;
    const t = await requireToken();
    if (!t) return;
    setBusy(`late:${userId}`);
    const r = await postAdminLateCancel(t, { run_id: selectedRunId, user_id: userId, note: "Late cancel (mobile admin)" });
    setBusy(null);
    if (!r.ok) return Alert.alert("Late cancel failed", r.error);
    Alert.alert("Recorded", "Late cancel recorded.");
    void loadDetail();
  }

  async function onConfirmFromAvailability(userId: string) {
    if (!selectedRunId) return;
    const t = await requireToken();
    if (!t) return;
    setBusy(`avail-confirm:${userId}`);
    const r = await postAdminConfirmPickupFromAvailability(t, { run_id: selectedRunId, user_id: userId });
    setBusy(null);
    if (!r.ok) return Alert.alert("Confirm failed", r.error);
    void loadDetail();
    void loadRuns();
  }

  function onDeclineAvailability(userId: string) {
    if (!selectedRunId) return;
    Alert.alert("Remove availability?", "This removes their time slot response for this run.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          void (async () => {
            try {
              const t = await requireToken();
              if (!t) return;
              setBusy(`avail-decline:${userId}`);
              const r = await deleteAdminPickupRunAvailability(t, { run_id: selectedRunId, user_id: userId });
              if (!r.ok) return Alert.alert("Remove failed", r.error);
              void loadDetail();
            } catch (e) {
              console.warn("[admin pickup] action failed", e);
              Sentry.captureException(e);
              Alert.alert("Something went wrong", "Please try again.");
            } finally {
              setBusy(null);
            }
          })();
        },
      },
    ]);
  }

  async function onRunPromotionAlgorithm() {
    const t = await requireToken();
    if (!t) return;
    Alert.alert("Run promotion algorithm?", "Scans last 30 days and creates tier review suggestions.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Run",
        onPress: () => {
          void (async () => {
            try {
              setBusy("tierAlgo");
              const r = await postAdminRunTierSuggestionAlgorithm(t);
              if (!r.ok) return Alert.alert("Run failed", r.error);
              Alert.alert("Done", `${r.data.inserted} suggestions created.`);
              void loadTierBadge();
            } catch (e) {
              console.warn("[admin pickup] action failed", e);
              Sentry.captureException(e);
              Alert.alert("Something went wrong", "Please try again.");
            } finally {
              setBusy(null);
            }
          })();
        },
      },
    ]);
  }

  const workflowTab = workflowTabOverride ?? defaultAdminPickupTab(workflowTabCounts);

  const filteredRuns = useMemo(() => {
    const base = runs.filter((row) => {
      if (workflowTab === "past") return isPastPickupRun(row);
      if (isPastPickupRun(row)) return false;
      const st = s(row.status).trim();
      if (workflowTab === "planning") return st === "planning";
      if (workflowTab === "active") return st === "likely_on" || st === "active" || st === "in_progress";
      return false;
    });
    if (workflowTab !== "past") return base;
    return [...base].sort((a, b) => {
      const ta = Date.parse(s(a.start_at)) || 0;
      const tb = Date.parse(s(b.start_at)) || 0;
      return tb - ta;
    });
  }, [runs, workflowTab]);

  const createRunHasStart = createStartAt.trim().length > 0;
  const createRunBusy = busy === "create";
  const createRunDisabled = !createRunHasStart || createRunBusy;

  const createForm = (
    <>
      <View style={styles.createRunScheduleBlock}>
        <Text style={styles.createRunScheduleTitle}>Run start (required)</Text>
        <Text style={styles.createRunScheduleHint}>Pick date & time in Eastern Time. Must be in the future.</Text>
        <DateTimePicker
          label="Schedule"
          value={createStartAt}
          onChange={setCreateStartAt}
          enforceFuture
          prominent
        />
        {createRunHasStart ? (
          <Text style={styles.createRunVerified}>Selected: {formatDateTimePickerEtLabel(createStartAt.trim())}</Text>
        ) : (
          <Text style={styles.createRunScheduleWarn}>Choose a start time before creating the run.</Text>
        )}
      </View>
      <Text style={styles.fieldHint}>New run uses API defaults; refine in the detail sheet after creation.</Text>
      <Text style={styles.label}>Service region</Text>
      <View style={styles.presetRow}>
        {SERVICE_REGIONS.map(({ code }) => {
          const active = createRegion === code;
          return (
            <Pressable
              key={code}
              onPress={() => setCreateRegion(code)}
              style={({ pressed }) => [styles.presetChip, active && styles.presetChipActive, pressed && { opacity: 0.9 }]}
            >
              <Text style={[styles.presetChipText, active && styles.presetChipTextActive]}>{code}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.label}>Capacity</Text>
      <TextInput
        style={styles.input}
        value={createCapacity}
        onChangeText={setCreateCapacity}
        keyboardType="number-pad"
        placeholder="24"
        placeholderTextColor="rgba(255,255,255,0.35)"
      />
      <AdminVenuePicker
        value={createVenueName}
        onChange={(name) => {
          setCreateVenueName(name);
          const region = serviceRegionForAdminVenueName(name);
          if (region) setCreateRegion(region);
          const locationPreset = adminVenueLocationPreset(name);
          if (locationPreset) setCreateLocationText(locationPreset);
          setCreateSelectedVenueFeePresetId(null);
        }}
        hint="Service region and staff location fill in from the venue you pick."
      />
      <Text style={styles.label}>Field cost ($)</Text>
      <TextInput
        style={styles.input}
        value={createFieldCost}
        onChangeText={(v) => {
          setCreateFieldCost(v);
          setCreateSelectedVenueFeePresetId(null);
        }}
        keyboardType="decimal-pad"
        placeholder="0"
        placeholderTextColor="rgba(255,255,255,0.35)"
      />
      <Text style={styles.label}>My earnings ($)</Text>
      <TextInput
        style={styles.input}
        value={createMyEarnings}
        onChangeText={setCreateMyEarnings}
        keyboardType="decimal-pad"
        placeholder="0"
        placeholderTextColor="rgba(255,255,255,0.35)"
      />
      <Text style={styles.fieldHint}>Added to field cost and split among players</Text>
      <Text style={styles.label}>Hours</Text>
      <TextInput
        style={styles.input}
        value={createHours}
        onChangeText={setCreateHours}
        keyboardType="number-pad"
        placeholder="1.5"
        placeholderTextColor="rgba(255,255,255,0.35)"
      />
      <Text style={styles.label}>Expected players</Text>
      <TextInput
        style={styles.input}
        value={createExpectedPlayers}
        onChangeText={setCreateExpectedPlayers}
        keyboardType="number-pad"
        placeholder={createCapacity.trim() || "24"}
        placeholderTextColor="rgba(255,255,255,0.35)"
      />
      <Text style={styles.feePerPlayerLine}>
        Each player pays:{" "}
        <Text style={createFeePreview != null ? styles.feePerPlayerValue : styles.feePerPlayerPlaceholder}>
          {createFeePreview != null ? `$${createFeePreview.perPlayer.toFixed(2)}` : "—"}
        </Text>
      </Text>
      <Text style={styles.feeBreakdownLine}>
        {createFeePreview != null
          ? `Field: $${createFeePreview.fieldTotal.toFixed(2)} · Your cut: $${createFeePreview.cutTotal.toFixed(
              2,
            )} · Per player: $${createFeePreview.perPlayer.toFixed(2)}`
          : "Field: — · Your cut: — · Per player: —"}
      </Text>
      <Text style={styles.label}>Location (staff)</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        value={createLocationText}
        onChangeText={(v) => {
          setCreateLocationText(v);
          setCreateSelectedVenueFeePresetId(null);
        }}
        placeholder="Address and venue notes"
        placeholderTextColor="rgba(255,255,255,0.35)"
        multiline
      />
      <Text style={styles.label}>Title (optional)</Text>
      <TextInput
        style={styles.input}
        value={createTitle}
        onChangeText={setCreateTitle}
        placeholder="CT Pickup Run"
        placeholderTextColor="rgba(255,255,255,0.35)"
      />
      <Text style={styles.label}>Run type</Text>
      <Text style={styles.fieldHint}>
        Public: first come first served for approved players in this region. Select: invite-only — use Invite players after you create the run.
      </Text>
      <View style={{ flexDirection: "row", gap: 10, marginBottom: 12 }}>
        <Pressable
          onPress={() => setCreateRunType("select")}
          style={[styles.typeChip, createRunType === "select" && styles.typeChipActive]}
        >
          <Text style={[styles.typeChipText, createRunType === "select" && styles.typeChipTextActive]}>Select</Text>
        </Pressable>
        <Pressable
          onPress={() => setCreateRunType("public")}
          style={[styles.typeChip, createRunType === "public" && styles.typeChipActive]}
        >
          <Text style={[styles.typeChipText, createRunType === "public" && styles.typeChipTextActive]}>Public</Text>
        </Pressable>
      </View>
      <Pressable
        onPress={() => void onCreateRun()}
        disabled={createRunDisabled}
        style={({ pressed }) => [
          styles.primary,
          pressed && !createRunDisabled && { opacity: 0.9 },
          createRunDisabled && styles.disabled,
        ]}
      >
        <Text style={styles.primaryText}>
          {createRunBusy ? "Creating…" : !createRunHasStart ? "Select a date first" : "Create run"}
        </Text>
      </Pressable>
    </>
  );

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 200 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.rowBetween}>
          <Text style={styles.h1}>Pickup ops</Text>
          <Pressable onPress={() => void loadRuns()} style={({ pressed }) => [styles.chip, pressed && { opacity: 0.85 }]}>
            <Text style={styles.chipText}>Refresh</Text>
          </Pressable>
        </View>

        <Text style={styles.lead}>Runs in {serviceRegionName(region)} — open a card for roster, slots, and invites.</Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.toolbarScroll}
          contentContainerStyle={styles.toolbarScrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Pressable
            onPress={() => router.push("/admin/analytics")}
            style={({ pressed }) => [styles.toolbarChip, pressed && { opacity: 0.9 }]}
          >
            <FontAwesome name="bar-chart" size={13} color={LIME} />
            <Text style={styles.toolbarChipText}>Analytics</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push("/admin/tier-suggestions")}
            style={({ pressed }) => [styles.toolbarChip, pressed && { opacity: 0.9 }]}
          >
            <FontAwesome name="level-up" size={13} color={LIME} />
            <Text style={styles.toolbarChipText}>Tier Suggestions</Text>
            {tierBadge > 0 ? (
              <View style={styles.toolbarBadge}>
                <Text style={styles.toolbarBadgeText}>{tierBadge > 99 ? "99+" : tierBadge}</Text>
              </View>
            ) : null}
          </Pressable>
          <Pressable
            onPress={() => void onRunPromotionAlgorithm()}
            disabled={busy === "tierAlgo"}
            style={({ pressed }) => [styles.toolbarChip, pressed && { opacity: 0.9 }, busy === "tierAlgo" && styles.disabled]}
          >
            <FontAwesome name="play" size={12} color={LIME} />
            <Text style={styles.toolbarChipText}>Run promotion</Text>
          </Pressable>
        </ScrollView>

        <Text style={styles.segmentLabel}>STATE</Text>
        <View style={styles.segmentRow}>
          {SERVICE_REGIONS.map(({ code }) => {
            const active = region === code;
            return (
              <Pressable
                key={code}
                onPress={() => {
                  setRegion(code);
                  setWorkflowTabOverride(null);
                  if (modalOpen) closeModal();
                }}
                style={({ pressed }) => [styles.segment, active && styles.segmentActive, pressed && { opacity: 0.9 }]}
              >
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{code}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.segmentLabel}>WORKFLOW</Text>
        <View style={styles.workflowTabRow}>
          {(
            [
              ["planning", "Planning"],
              ["active", "Active"],
              ["past", "Past"],
            ] as [AdminPickupWorkflowTab, string][]
          ).map(([key, label]) => {
            const active = workflowTab === key;
            const n = workflowTabCounts[key];
            return (
              <Pressable
                key={key}
                onPress={() => setWorkflowTabOverride(key)}
                style={({ pressed }) => [styles.workflowTab, active && styles.workflowTabActive, pressed && { opacity: 0.9 }]}
              >
                <Text style={[styles.workflowTabText, active && styles.workflowTabTextActive]} numberOfLines={1}>
                  {label} ({n})
                </Text>
              </Pressable>
            );
          })}
        </View>

        {listLoading ? <ActivityIndicator color="#fff" style={{ marginTop: 16 }} /> : null}
        {listError ? <Text style={styles.err}>{listError}</Text> : null}

        {!listLoading && runs.length === 0 && !listError ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No runs in this state.</Text>
            <Text style={styles.emptyBody}>Use + to create a run or switch state.</Text>
          </View>
        ) : null}

        {!listLoading && runs.length > 0 && filteredRuns.length === 0 && !listError ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Nothing in this stage.</Text>
            <Text style={styles.emptyBody}>Try another workflow tab.</Text>
          </View>
        ) : null}

        {filteredRuns.map((row) => {
          const id = s(row.id);
          if (!id) return null;
          const reg = s(row.service_region).trim().toUpperCase();
          const regionLabel = reg && SERVICE_REGIONS.some((r) => r.code === reg) ? reg : region;
          const lc = listCountsFromRow(row);
          const hasResult = row.has_result === true;
          const runTypeLabel = row.run_type === "public" ? "Public" : "Select";

          if (workflowTab === "past") {
            return (
              <Pressable
                key={id}
                onPress={() => openRun(id)}
                style={({ pressed }) => [styles.runCard, pressed && { opacity: 0.92 }]}
              >
                <Text style={styles.runPastEtLine}>{fmtPickupDtEt(s(row.start_at))}</Text>
                <Text style={styles.runVenueLine} numberOfLines={3}>
                  {venueLineFromRun(row)}
                </Text>
                <Text style={styles.runPastMetaLine}>Run type · {runTypeLabel}</Text>
                <Text style={styles.runPastMetaLine}>Final confirmed · {lc.confirmed}</Text>
                <View style={styles.runBadgesRow}>
                  <View style={styles.regionBadge}>
                    <Text style={styles.regionBadgeText}>{regionLabel}</Text>
                  </View>
                </View>
                <Text style={hasResult ? styles.pastResultPosted : styles.pastResultMissing}>
                  {hasResult ? "Results posted ✓" : "No result posted"}
                </Text>
                <View style={styles.cardActionRow}>
                  {!hasResult ? (
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation();
                        (router.push as (href: string) => void)(`/admin/run-result?run_id=${encodeURIComponent(id)}`);
                      }}
                      style={({ pressed }) => [styles.cardBtnLime, pressed && { opacity: 0.9 }]}
                    >
                      <Text style={styles.cardBtnLimeText}>Post Results</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation();
                        (router.push as (href: string) => void)(
                          `/admin/run-result?run_id=${encodeURIComponent(id)}&readonly=true`,
                        );
                      }}
                      style={({ pressed }) => [styles.cardBtnLime, pressed && { opacity: 0.9 }]}
                    >
                      <Text style={styles.cardBtnLimeText}>View Results</Text>
                    </Pressable>
                  )}
                </View>
                <Pressable
                  onPress={(e) => {
                    e.stopPropagation();
                    openRun(id);
                  }}
                  style={styles.detailsChevronRow}
                >
                  <Text style={styles.runTapHint}>Details</Text>
                  <FontAwesome name="chevron-right" size={12} color="rgba(255,255,255,0.35)" />
                </Pressable>
              </Pressable>
            );
          }

          const lcStage = derivePickupLifecycleStage({
            status: s(row.status),
            is_current: row.is_current === true,
            outreach_started_at: s(row.outreach_started_at) || null,
            is_completed: row.is_completed === true,
            has_result: row.has_result === true,
          });
          const stageLabel = pickupLifecycleStageLabel(lcStage);

          return (
            <Pressable
              key={id}
              onPress={() => openRun(id)}
              style={({ pressed }) => [styles.runCard, pressed && { opacity: 0.92 }]}
            >
              <Text style={styles.runTitle}>{s(row.title) || "Pickup run"}</Text>
              <Text style={styles.runDateLine}>{fmtPickupDateEt(s(row.start_at))}</Text>
              <Text style={styles.runTimeLine}>{s(row.start_at) ? `${fmtPickupTimeEt(s(row.start_at))} ET` : "No time set yet"}</Text>

              <View style={styles.runBadgesRow}>
                <View style={styles.regionBadge}>
                  <Text style={styles.regionBadgeText}>{regionLabel}</Text>
                </View>
                <View style={styles.workflowPill}>
                  <Text style={styles.workflowPillText}>{isPublicPickupRunType(row.run_type) ? "Public" : "Select"}</Text>
                </View>
                <View style={styles.workflowPill}>
                  <Text style={styles.workflowPillText}>{stageLabel}</Text>
                </View>
              </View>

              <View style={styles.quickStatsRow}>
                <View style={styles.quickStat}>
                  <Text style={styles.quickStatVal}>{lc.confirmed}</Text>
                  <Text style={styles.quickStatLbl}>Confirmed</Text>
                </View>
                <View style={styles.quickStat}>
                  <Text style={styles.quickStatVal}>{lc.standby}</Text>
                  <Text style={styles.quickStatLbl}>Standby</Text>
                </View>
                <View style={styles.quickStat}>
                  <Text style={styles.quickStatVal}>{lc.waitlist}</Text>
                  <Text style={styles.quickStatLbl}>Waitlist</Text>
                </View>
                <View style={styles.quickStat}>
                  <Text style={styles.quickStatVal}>{lc.invites}</Text>
                  <Text style={styles.quickStatLbl}>Invites</Text>
                </View>
                <View style={styles.quickStat}>
                  <Text style={styles.quickStatVal}>{lc.pending_payment}</Text>
                  <Text style={styles.quickStatLbl}>Pending $</Text>
                </View>
              </View>

              <View style={styles.cardActionRow}>
                {showPromoteToHubButton({
                  status: s(row.status),
                  is_current: row.is_current === true,
                  is_completed: row.is_completed === true,
                }) ? (
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation();
                      void onPromoteHub({ runId: id });
                    }}
                    disabled={busy === "hub"}
                    style={({ pressed }) => [styles.cardBtnSecondary, pressed && { opacity: 0.9 }, busy === "hub" && styles.disabled]}
                  >
                    <FontAwesome name="bullhorn" size={12} color={LIME} />
                    <Text style={styles.cardBtnSecondaryText}>Promote to Hub</Text>
                  </Pressable>
                ) : null}
                {showInvitePlayersButton({
                  status: s(row.status),
                  run_type: row.run_type,
                  is_completed: row.is_completed === true,
                }) ? (
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation();
                      (router.push as (href: string) => void)(
                        `/admin/invite-players?run_id=${encodeURIComponent(id)}`,
                      );
                    }}
                    style={({ pressed }) => [styles.cardBtnSecondary, pressed && { opacity: 0.9 }]}
                  >
                    <FontAwesome name="user-plus" size={12} color={LIME} />
                    <Text style={styles.cardBtnSecondaryText}>Invite players</Text>
                  </Pressable>
                ) : null}
                {showFinalizeTimeButton({
                  status: s(row.status),
                  is_completed: row.is_completed === true,
                  final_slot_id: s(row.final_slot_id) || null,
                }) ? (
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation();
                      openRun(id);
                    }}
                    style={({ pressed }) => [styles.cardBtnSecondary, pressed && { opacity: 0.9 }]}
                  >
                    <FontAwesome name="clock-o" size={12} color={LIME} />
                    <Text style={styles.cardBtnSecondaryText}>Finalize time</Text>
                  </Pressable>
                ) : null}
                {showEditSettingsButton({ status: s(row.status), is_completed: row.is_completed === true }) ? (
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation();
                      openRun(id);
                    }}
                    style={({ pressed }) => [styles.cardBtnSecondary, pressed && { opacity: 0.9 }]}
                  >
                    <FontAwesome name="pencil" size={12} color={LIME} />
                    <Text style={styles.cardBtnSecondaryText}>Edit settings</Text>
                  </Pressable>
                ) : null}
                {showStartRunNowButton({
                  status: s(row.status),
                  is_completed: row.is_completed === true,
                  start_at: s(row.start_at) || null,
                }) ? (
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation();
                      void onStartRunNow(id);
                    }}
                    disabled={busy === `start:${id}`}
                    style={({ pressed }) => [
                      styles.cardBtnLime,
                      pressed && { opacity: 0.9 },
                      busy === `start:${id}` && styles.disabled,
                    ]}
                  >
                    <Text style={styles.cardBtnLimeText}>{busy === `start:${id}` ? "…" : "Begin Pickup Now"}</Text>
                  </Pressable>
                ) : null}
                {showEndRunButton({ status: s(row.status), is_completed: row.is_completed === true }) ? (
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation();
                      void onEndRun(id);
                    }}
                    disabled={busy === `end:${id}`}
                    style={({ pressed }) => [
                      styles.cardBtnDanger,
                      pressed && { opacity: 0.9 },
                      busy === `end:${id}` && styles.disabled,
                    ]}
                  >
                    <Text style={styles.cardBtnDangerText}>{busy === `end:${id}` ? "Ending…" : "End Run"}</Text>
                  </Pressable>
                ) : null}
              </View>

              <Pressable
                onPress={(e) => {
                  e.stopPropagation();
                  openRun(id);
                }}
                style={styles.detailsChevronRow}
              >
                <Text style={styles.runTapHint}>Details</Text>
                <FontAwesome name="chevron-right" size={12} color="rgba(255,255,255,0.35)" />
              </Pressable>
            </Pressable>
          );
        })}
      </ScrollView>

      <Pressable
        onPress={() => {
          setCreateRegion(region);
          setCreateModalOpen(true);
        }}
        style={({ pressed }) => [styles.fab, { bottom: 20 + insets.bottom }, pressed && { opacity: 0.92 }]}
        accessibilityLabel="Create run"
      >
        <FontAwesome name="plus" size={26} color="#111" />
      </Pressable>

      <Modal visible={createModalOpen} animationType="slide" transparent onRequestClose={() => setCreateModalOpen(false)}>
        <View style={styles.modalRoot} pointerEvents="box-none">
          <Pressable
            style={[StyleSheet.absoluteFill, styles.modalBackdropHitBox]}
            onPress={() => setCreateModalOpen(false)}
            accessibilityLabel="Dismiss"
          />
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            keyboardVerticalOffset={insets.top}
            style={styles.createModalKb}
          >
            <View style={[styles.createModalSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
              <View style={styles.modalGrabRow}>
                <View style={styles.modalGrab} />
              </View>
              <View style={styles.modalHeader}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.modalTitle}>Create run</Text>
                </View>
                <Pressable
                  onPress={() => setCreateModalOpen(false)}
                  style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.85 }]}
                >
                  <FontAwesome name="times" size={18} color="#fff" />
                </Pressable>
              </View>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 200 }}
              >
                {createForm}
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <Modal visible={modalOpen} animationType="slide" transparent onRequestClose={closeModal}>
        <View style={styles.modalRoot} pointerEvents="box-none">
          <Pressable style={[StyleSheet.absoluteFill, styles.modalBackdropHitBox]} onPress={closeModal} accessibilityLabel="Dismiss" />
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            keyboardVerticalOffset={insets.top}
            style={styles.modalKb}
          >
            <View style={[styles.modalSheet, { paddingBottom: 0, maxHeight: winH * 0.92 }]}>
              <View style={styles.modalGrabRow}>
                <View style={styles.modalGrab} />
              </View>
              <View style={styles.modalHeader}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.modalTitle} numberOfLines={2}>
                    {selectedRun ? s(selectedRun.title) || "Run" : "Run"}
                  </Text>
                  <Text style={styles.modalSub} numberOfLines={2}>
                    {selectedRun
                      ? `${selectedRunStageLabel} · ${fmtPickupDt(s(selectedRun.start_at))}`
                      : ""}
                  </Text>
                </View>
                <Pressable onPress={closeModal} style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.85 }]}>
                  <FontAwesome name="times" size={18} color="#fff" />
                </Pressable>
              </View>

              {detailLoading ? (
                <ActivityIndicator color="#fff" style={{ marginVertical: 24 }} />
              ) : detailError ? (
                <Text style={styles.err}>{detailError}</Text>
              ) : (
                <>
                  <ScrollView
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                    style={{ maxHeight: winH * 0.58 }}
                    nestedScrollEnabled
                    contentContainerStyle={{ paddingBottom: 200 }}
                  >
                    {counts ? (
                      <View style={styles.countRow}>
                        <View style={styles.countChip}>
                          <Text style={styles.countChipLabel}>Confirmed</Text>
                          <Text style={styles.countChipVal}>{counts.confirmed}</Text>
                        </View>
                        <View style={styles.countChip}>
                          <Text style={styles.countChipLabel}>Standby</Text>
                          <Text style={styles.countChipVal}>{counts.standby}</Text>
                        </View>
                        <View style={styles.countChip}>
                          <Text style={styles.countChipLabel}>Invites</Text>
                          <Text style={styles.countChipVal}>{counts.invites}</Text>
                        </View>
                        <View style={styles.countChip}>
                          <Text style={styles.countChipLabel}>Pending $</Text>
                          <Text style={styles.countChipVal}>{counts.pending_payment}</Text>
                        </View>
                        <View style={styles.countChip}>
                          <Text style={styles.countChipLabel}>Waitlist</Text>
                          <Text style={styles.countChipVal}>{counts.waitlist ?? 0}</Text>
                        </View>
                      </View>
                    ) : null}

                    {(detailKickoffActions.showPost || detailKickoffActions.showView) && selectedRunId ? (
                      <View style={{ marginBottom: 12, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                        {detailKickoffActions.showPost ? (
                          <Pressable
                            onPress={() =>
                              (router.push as (href: string) => void)(
                                `/admin/run-result?run_id=${encodeURIComponent(selectedRunId)}`,
                              )
                            }
                            style={({ pressed }) => [styles.cardBtnLime, pressed && { opacity: 0.9 }]}
                          >
                            <Text style={styles.cardBtnLimeText}>Post Results</Text>
                          </Pressable>
                        ) : null}
                        {detailKickoffActions.showView ? (
                          <Pressable
                            onPress={() =>
                              (router.push as (href: string) => void)(
                                `/admin/run-result?run_id=${encodeURIComponent(selectedRunId)}&readonly=1`,
                              )
                            }
                            style={({ pressed }) => [styles.cardBtnSecondary, pressed && { opacity: 0.9 }]}
                          >
                            <Text style={styles.cardBtnSecondaryText}>View Results</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    ) : null}

                    <View style={styles.modalSection}>
                      <Text style={styles.sectionTitle}>Hub & invites</Text>
                      <View style={styles.actionRow}>
                        {selectedRun &&
                        typeof selectedRun === "object" &&
                        showPromoteToHubButton({
                          status: s((selectedRun as Record<string, unknown>).status),
                          is_current: (selectedRun as Record<string, unknown>).is_current === true,
                          is_completed: (selectedRun as Record<string, unknown>).is_completed === true,
                        }) ? (
                          <Pressable
                            onPress={() => void onPromoteHub()}
                            disabled={busy === "hub" || !selectedRunId}
                            style={({ pressed }) => [styles.secondaryLime, pressed && { opacity: 0.9 }, busy === "hub" && styles.disabled]}
                          >
                            <FontAwesome name="bullhorn" size={14} color={LIME} />
                            <Text style={styles.secondaryLimeText}>{busy === "hub" ? "…" : "Promote to hub"}</Text>
                          </Pressable>
                        ) : null}
                        {selectedRun &&
                        typeof selectedRun === "object" &&
                        selectedRunId &&
                        showInvitePlayersButton({
                          status: s((selectedRun as Record<string, unknown>).status),
                          run_type: (selectedRun as Record<string, unknown>).run_type,
                          is_completed: (selectedRun as Record<string, unknown>).is_completed === true,
                        }) ? (
                          <Pressable
                            onPress={() =>
                              (router.push as (href: string) => void)(
                                `/admin/invite-players?run_id=${encodeURIComponent(selectedRunId)}`,
                              )
                            }
                            style={({ pressed }) => [styles.secondaryLime, pressed && { opacity: 0.9 }]}
                          >
                            <FontAwesome name="user-plus" size={14} color={LIME} />
                            <Text style={styles.secondaryLimeText}>Invite players</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    </View>

                    <View style={styles.modalSection}>
                      <Pressable
                        onPress={() => setEditSectionExpanded((v) => !v)}
                        style={({ pressed }) => [styles.editDetailsToggle, pressed && { opacity: 0.9 }]}
                      >
                        <Text style={styles.editDetailsToggleText}>Edit details</Text>
                        <FontAwesome
                          name={editSectionExpanded ? "chevron-up" : "chevron-down"}
                          size={14}
                          color="rgba(255,255,255,0.5)"
                        />
                      </Pressable>
                      {editSectionExpanded ? (
                        <>
                  <Text style={styles.label}>Title</Text>
                  <TextInput style={styles.input} value={editTitle} onChangeText={setEditTitle} placeholderTextColor="rgba(255,255,255,0.35)" />
                  <Text style={styles.label}>Location template</Text>
                  <View style={styles.presetRow}>
                    {(
                      [
                        ["new_haven", "New Haven"],
                        ["new_rochelle", "New Rochelle"],
                        ["other", "Other"],
                      ] as const
                    ).map(([key, label]) => {
                      const active = locationPreset === key;
                      return (
                        <Pressable
                          key={key}
                          onPress={() => applyPreset(key)}
                          style={({ pressed }) => [styles.presetChip, active && styles.presetChipActive, pressed && { opacity: 0.9 }]}
                        >
                          <Text style={[styles.presetChipText, active && styles.presetChipTextActive]}>{label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text style={styles.label}>Location (staff / confirmed)</Text>
                  <TextInput
                    style={[styles.input, styles.textArea]}
                    value={editLocationPrivate}
                    onChangeText={(v) => {
                      setEditLocationPrivate(v);
                      setLocationPreset(detectPreset(v));
                      setEditSelectedVenueFeePresetId(null);
                    }}
                    placeholder="Venue notes, parking, field #"
                    placeholderTextColor="rgba(255,255,255,0.35)"
                    multiline
                  />
                  <View style={styles.switchRow}>
                    <Text style={styles.switchLabel}>Location only after confirm</Text>
                    <Pressable
                      onPress={() => setEditLocConfirmedOnly((v) => !v)}
                      style={[styles.miniToggle, editLocConfirmedOnly && styles.miniToggleOn]}
                    >
                      <Text style={styles.miniToggleText}>{editLocConfirmedOnly ? "On" : "Off"}</Text>
                    </Pressable>
                  </View>
                  <Text style={styles.label}>Run type</Text>
                  <View style={styles.typeRow}>
                    <Pressable
                      onPress={() => setEditRunType("select")}
                      style={[styles.typeChip, editRunType === "select" && styles.typeChipActive]}
                    >
                      <Text style={[styles.typeChipText, editRunType === "select" && styles.typeChipTextActive]}>Select</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setEditRunType("public")}
                      style={[styles.typeChip, editRunType === "public" && styles.typeChipActive]}
                    >
                      <Text style={[styles.typeChipText, editRunType === "public" && styles.typeChipTextActive]}>Public</Text>
                    </Pressable>
                  </View>
                  <Text style={styles.label}>Capacity</Text>
                  <TextInput
                    style={styles.input}
                    value={editCapacity}
                    onChangeText={setEditCapacity}
                    keyboardType="number-pad"
                    placeholderTextColor="rgba(255,255,255,0.35)"
                  />
                  <VenueFeePresetRow
                    presets={venueFeePresetsForRegion}
                    selectedId={editSelectedVenueFeePresetId}
                    onSelect={(p) => {
                      setEditSelectedVenueFeePresetId(p.id);
                      setEditLocationPrivate(p.address);
                      setLocationPreset(detectPreset(p.address));
                      if (p.priceDollars > 0) setEditFieldCost(String(p.priceDollars));
                    }}
                  />
                  <Text style={styles.label}>Field cost ($)</Text>
                  <TextInput
                    style={styles.input}
                    value={editFieldCost}
                    onChangeText={(v) => {
                      setEditFieldCost(v);
                      setEditSelectedVenueFeePresetId(null);
                    }}
                    keyboardType="decimal-pad"
                    placeholderTextColor="rgba(255,255,255,0.35)"
                  />
                  <Text style={styles.label}>My earnings ($)</Text>
                  <TextInput
                    style={styles.input}
                    value={editMyEarnings}
                    onChangeText={setEditMyEarnings}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor="rgba(255,255,255,0.35)"
                  />
                  <Text style={styles.fieldHint}>Added to field cost and split among players</Text>
                  <Text style={styles.label}>Hours</Text>
                  <TextInput
                    style={styles.input}
                    value={editHours}
                    onChangeText={setEditHours}
                    keyboardType="number-pad"
                    placeholder="1.5"
                    placeholderTextColor="rgba(255,255,255,0.35)"
                  />
                  <Text style={styles.label}>Expected players</Text>
                  <TextInput
                    style={styles.input}
                    value={editExpectedPlayers}
                    onChangeText={setEditExpectedPlayers}
                    keyboardType="number-pad"
                    placeholderTextColor="rgba(255,255,255,0.35)"
                  />
                  <Text style={styles.feePerPlayerLine}>
                    Each player pays:{" "}
                    <Text style={editFeePreview != null ? styles.feePerPlayerValue : styles.feePerPlayerPlaceholder}>
                      {editFeePreview != null ? `$${editFeePreview.perPlayer.toFixed(2)}` : "—"}
                    </Text>
                  </Text>
                  <Text style={styles.feeBreakdownLine}>
                    {editFeePreview != null
                      ? `Field: $${editFeePreview.fieldTotal.toFixed(2)} · Your cut: $${editFeePreview.cutTotal.toFixed(
                          2,
                        )} · Per player: $${editFeePreview.perPlayer.toFixed(2)}`
                      : "Field: — · Your cut: — · Per player: —"}
                  </Text>
                        </>
                      ) : null}
                    </View>

                    <View style={styles.modalSection}>
                      <Text style={styles.sectionTitle}>Roster</Text>
                      <Text style={styles.rosterSubheading}>Availability ({detail?.counts?.available ?? 0} responses)</Text>
                  {(detail?.availability ?? []).length === 0 ? (
                    <Text style={styles.muted}>No availability submitted yet.</Text>
                  ) : null}
                  {(detail?.availability as Record<string, unknown>[] ?? []).map((a, idx) => {
                    const uid = String(a.user_id || "");
                    const slotId = String(a.slot_id || "");
                    const state = String(a.state || "");
                    const slot = slots.find((sl) => String(sl.id) === slotId);
                    const slotTime = slot?.start_at ? fmtPickupDt(s(slot.start_at)) : "";
                    const slotLbl = slot ? String(slot.label || "").trim() : "";
                    const slotSummary = [slotLbl, slotTime].filter(Boolean).join(" · ") || slotId || "—";
                    const fullName =
                      (typeof a.full_name === "string" && a.full_name.trim()) ||
                      (typeof a.username === "string" && a.username.trim()) ||
                      `${uid.slice(0, 8)}…`;
                    const username = typeof a.username === "string" && a.username.trim() ? a.username.trim() : "";
                    const igRaw = typeof a.instagram === "string" ? a.instagram.trim() : "";
                    const ig = igRaw ? (igRaw.startsWith("@") ? igRaw : `@${igRaw}`) : "";
                    const handles =
                      [username ? `@${username}` : null, ig || null].filter(Boolean).join(" · ") || "—";
                    const position = typeof a.playing_position === "string" && a.playing_position.trim() ? a.playing_position.trim() : "—";
                    const tier = typeof a.tier === "string" && a.tier.trim() ? a.tier.trim() : "—";
                    const tr = a.tier_rank;
                    const tierLine =
                      tr != null && Number.isFinite(Number(tr)) ? `${tier} (rank ${Number(tr)})` : tier;
                    const wins = displayPickupStat(a.wins_override, a.stats_wins);
                    const losses = displayPickupStat(a.losses_override, a.stats_losses);
                    const pod = displayPickupStat(a.player_of_day_override, a.stats_player_of_day);
                    const gotd = Number(a.stats_goalie_of_day ?? 0);
                    const confirmBusy = busy === `avail-confirm:${uid}`;
                    const declineBusy = busy === `avail-decline:${uid}`;
                    return (
                      <View key={`avail-${uid || idx}`} style={[styles.availCard, { opacity: state === "declined" ? 0.5 : 1 }]}>
                        <View style={styles.availCardHeader}>
                          <Text style={styles.availNameBold}>{fullName}</Text>
                          <View
                            style={[
                              styles.availStatePill,
                              state === "available" ? styles.availStatePillOn : styles.availStatePillOff,
                            ]}
                          >
                            <Text style={[styles.availStatePillText, state === "available" && styles.availStatePillTextOn]}>
                              {state}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.availHandles} numberOfLines={2}>
                          {handles}
                        </Text>
                        <Text style={styles.availMetaLine}>
                          {position} · {tierLine}
                        </Text>
                        <Text style={styles.availStatLine}>
                          W {wins} · L {losses} · POTD {pod} · GOTD {Number.isFinite(gotd) ? gotd : 0}
                        </Text>
                        <Text style={styles.availSlotLine}>Slot: {slotSummary}</Text>
                        <View style={styles.availActionsRow}>
                          <Pressable
                            onPress={() => void onConfirmFromAvailability(uid)}
                            disabled={!uid || confirmBusy || declineBusy}
                            style={({ pressed }) => [
                              styles.availConfirmBtn,
                              pressed && { opacity: 0.9 },
                              (!uid || confirmBusy || declineBusy) && styles.disabled,
                            ]}
                          >
                            <Text style={styles.availConfirmBtnText}>{confirmBusy ? "…" : "Confirm"}</Text>
                          </Pressable>
                          <Pressable
                            onPress={() => onDeclineAvailability(uid)}
                            disabled={!uid || confirmBusy || declineBusy}
                            style={({ pressed }) => [
                              styles.availDeclineBtn,
                              pressed && { opacity: 0.9 },
                              (!uid || confirmBusy || declineBusy) && styles.disabled,
                            ]}
                          >
                            <Text style={styles.availDeclineBtnText}>{declineBusy ? "…" : "Decline"}</Text>
                          </Pressable>
                        </View>
                      </View>
                    );
                  })}
                      <Text style={styles.rosterSubheading}>Kickoff slots</Text>
                  {slots.length === 0 ? <Text style={styles.muted}>No slots yet.</Text> : null}
                  {slots.map((sl, idx) => {
                    const sid = s(sl.id);
                    const isFinal = selectedRun && s(selectedRun.final_slot_id) === sid;
                    return (
                      <View key={sid || `slot-${idx}`} style={styles.slotRow}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.slotTime}>{fmtPickupDt(s(sl.start_at))}</Text>
                          {sl.label ? <Text style={styles.slotLabel}>{s(sl.label)}</Text> : null}
                          {isFinal ? <Text style={styles.finalTag}>Final</Text> : null}
                        </View>
                        {!isFinal ? (
                          <Pressable
                            onPress={() => void onFinalizeSlot(sid)}
                            disabled={busy === "finalize"}
                            style={({ pressed }) => [styles.slotFinalize, pressed && { opacity: 0.9 }, busy === "finalize" && styles.disabled]}
                          >
                            <Text style={styles.slotFinalizeText}>Finalize</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    );
                  })}
                  <DateTimePicker label="Slot start time" value={slotStart} onChange={onKickoffSlotDateTimeConfirmed} />
                  <Text style={styles.label}>Label (optional)</Text>
                  <TextInput
                    style={styles.input}
                    value={slotLabel}
                    onChangeText={setSlotLabel}
                    placeholder="Option A"
                    placeholderTextColor="rgba(255,255,255,0.35)"
                  />
                  <Text style={styles.mutedSmall}>Confirming the time saves the slot immediately (UTC). Use the button below to retry if save failed, or add another time after changing the picker.</Text>
                  <Pressable
                    onPress={() => void onAddSlot()}
                    disabled={busy === "slot" || !slotStart.trim()}
                    style={({ pressed }) => [styles.secondaryLime, pressed && { opacity: 0.9 }, (busy === "slot" || !slotStart.trim()) && styles.disabled]}
                  >
                    <Text style={styles.secondaryLimeText}>{busy === "slot" ? "Saving…" : "Add slot"}</Text>
                  </Pressable>

                      <Text style={[styles.rosterSubheading, { marginTop: 14 }]}>RSVPs · Confirmed ({confirmed.length})</Text>
                  {confirmed.length === 0 ? <Text style={styles.muted}>None</Text> : null}
                  {confirmed.map((p) => {
                    const isBusy = busy === `att:${p.id}` || busy === `late:${p.id}`;
                    return (
                      <View key={`c:${p.id}`} style={styles.personRow}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.personName}>{p.full_name ?? p.id}</Text>
                          <Text style={styles.personSub} numberOfLines={1}>
                            {p.id}
                          </Text>
                        </View>
                        <Pressable
                          onPress={() => void onMarkAttendance(p.id, true)}
                          disabled={isBusy}
                          style={({ pressed }) => [styles.smallChip, pressed && { opacity: 0.85 }, isBusy && styles.disabled]}
                        >
                          <Text style={styles.smallChipText}>Attended</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => void onMarkAttendance(p.id, false)}
                          disabled={isBusy}
                          style={({ pressed }) => [styles.smallChipAlt, pressed && { opacity: 0.85 }, isBusy && styles.disabled]}
                        >
                          <Text style={styles.smallChipText}>No-show</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => void onLateCancel(p.id)}
                          disabled={isBusy}
                          style={({ pressed }) => [styles.smallChipWarn, pressed && { opacity: 0.85 }, isBusy && styles.disabled]}
                        >
                          <Text style={styles.smallChipText}>Late</Text>
                        </Pressable>
                      </View>
                    );
                  })}

                      <Text style={[styles.rosterSubheading, { marginTop: 14 }]}>RSVPs · Standby ({standby.length})</Text>
                  {standby.length === 0 ? <Text style={styles.muted}>None</Text> : null}
                  {standby.map((p) => {
                    const isBusy = busy === `promote:${p.id}`;
                    return (
                      <View key={`s:${p.id}`} style={styles.personRow}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.personName}>{p.full_name ?? p.id}</Text>
                          <Text style={styles.personSub} numberOfLines={1}>
                            {p.id}
                          </Text>
                        </View>
                        <Pressable
                          onPress={() => void onPromote(p.id)}
                          disabled={isBusy}
                          style={({ pressed }) => [styles.primarySmall, pressed && { opacity: 0.9 }, isBusy && styles.disabled]}
                        >
                          <Text style={styles.primarySmallText}>{isBusy ? "…" : "Promote"}</Text>
                        </Pressable>
                      </View>
                    );
                  })}
                    </View>

                    <Pressable
                      onPress={() => void onCancelRun()}
                      disabled={busy === "cancel"}
                      style={({ pressed }) => [styles.dangerOutline, pressed && { opacity: 0.9 }, busy === "cancel" && styles.disabled]}
                    >
                      <Text style={styles.dangerOutlineText}>{busy === "cancel" ? "Canceling…" : "Cancel run"}</Text>
                    </Pressable>
                  </ScrollView>
                  <View style={[styles.modalSaveFooter, { paddingBottom: Math.max(insets.bottom, 12) }]}>
                    <Pressable
                      onPress={() => void onSaveRun()}
                      disabled={busy === "save"}
                      style={({ pressed }) => [
                        styles.primary,
                        styles.primaryInFooter,
                        pressed && { opacity: 0.9 },
                        busy === "save" && styles.disabled,
                      ]}
                    >
                      <Text style={styles.primaryText}>{busy === "save" ? "Saving…" : "Save"}</Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <Modal visible={teamAssignOpen} animationType="slide" transparent onRequestClose={requestCloseTeamAssignModal}>
        <View style={styles.modalRoot} pointerEvents="box-none">
          <Pressable
            style={[StyleSheet.absoluteFill, styles.modalBackdropHitBox]}
            onPress={requestCloseTeamAssignModal}
            accessibilityLabel="Dismiss"
          />
          <View style={[styles.teamAssignSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.modalGrabRow}>
              <View style={styles.modalGrab} />
            </View>
            <View style={styles.teamAssignHeaderRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.modalTitle}>Assign teams</Text>
                <Text style={styles.teamAssignSub}>Lock before the run starts.</Text>
              </View>
              <Pressable
                onPress={requestCloseTeamAssignModal}
                style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.85 }]}
              >
                <FontAwesome name="times" size={18} color="#fff" />
              </Pressable>
            </View>
            {teamAssignLoading ? (
              <ActivityIndicator color="#fff" style={{ marginVertical: 28 }} />
            ) : (
              <ScrollView
                keyboardShouldPersistTaps="handled"
                style={{ maxHeight: winH * 0.52 }}
                contentContainerStyle={{ paddingBottom: 16 }}
              >
                <Text style={styles.teamAssignRosterLabel}>Confirmed ({teamAssignPlayers.length})</Text>
                <View style={styles.teamAssignToggleRow}>
                  <Pressable
                    onPress={() => {
                      setTeamAssignTotal(2);
                      setTeamAssignByUser((m) => clampTeamMapToTotal(m, 2));
                    }}
                    style={({ pressed }) => [
                      styles.teamAssignToggleChip,
                      teamAssignTotal === 2 && styles.teamAssignToggleChipOn,
                      pressed && { opacity: 0.9 },
                    ]}
                  >
                    <Text
                      style={[styles.teamAssignToggleText, teamAssignTotal === 2 && styles.teamAssignToggleTextOn]}
                    >
                      2 Teams
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setTeamAssignTotal(3)}
                    style={({ pressed }) => [
                      styles.teamAssignToggleChip,
                      teamAssignTotal === 3 && styles.teamAssignToggleChipOn,
                      pressed && { opacity: 0.9 },
                    ]}
                  >
                    <Text
                      style={[styles.teamAssignToggleText, teamAssignTotal === 3 && styles.teamAssignToggleTextOn]}
                    >
                      3 Teams
                    </Text>
                  </Pressable>
                </View>
                <Pressable
                  onPress={() =>
                    setTeamAssignByUser(generateTeamsByPosition(teamAssignPlayers, teamAssignTotal))
                  }
                  style={({ pressed }) => [styles.teamAssignAutoBtn, pressed && { opacity: 0.9 }]}
                >
                  <Text style={styles.teamAssignAutoBtnText}>⚡ Auto-assign by position</Text>
                </Pressable>
                {teamAssignPlayers.length === 0 ? (
                  <Text style={styles.muted}>No confirmed players on this run.</Text>
                ) : (
                  teamAssignPlayers.map((p) => {
                    const team = teamAssignByUser[p.id] ?? "A";
                    const label = (p.full_name ?? "").trim() || p.id;
                    return (
                      <Pressable
                        key={p.id}
                        onPress={() => setTeamAssignPickUserId(p.id)}
                        style={({ pressed }) => [styles.teamAssignRow, pressed && { opacity: 0.9 }]}
                      >
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.teamAssignRowName} numberOfLines={1}>
                            {label}
                          </Text>
                          {p.playing_position ? (
                            <Text style={styles.teamAssignRowPos} numberOfLines={1}>
                              {p.playing_position}
                            </Text>
                          ) : null}
                        </View>
                        <View style={styles.teamAssignTeamPill}>
                          <Text style={styles.teamAssignTeamPillText}>{labelPickupTeam(team)}</Text>
                        </View>
                      </Pressable>
                    );
                  })
                )}
              </ScrollView>
            )}
            <Pressable
              onPress={() => void onLockTeamAssign()}
              disabled={teamAssignBusy || teamAssignLoading || teamAssignPlayers.length === 0}
              style={({ pressed }) => [
                styles.primary,
                { marginTop: 8 },
                pressed && { opacity: 0.9 },
                (teamAssignBusy || teamAssignLoading || teamAssignPlayers.length === 0) && styles.disabled,
              ]}
            >
              <Text style={styles.primaryText}>{teamAssignBusy ? "Saving…" : "Lock Teams"}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={teamAssignPickUserId != null}
        transparent
        animationType="fade"
        onRequestClose={() => setTeamAssignPickUserId(null)}
      >
        <Pressable
          style={styles.teamPickModalRoot}
          onPress={() => setTeamAssignPickUserId(null)}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        >
          <Pressable style={styles.teamPickModalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.teamPickModalTitle}>Team</Text>
            {(teamAssignTotal === 3 ? TEAMS_3 : TEAMS_2).map((t) => {
              const cur = teamAssignPickUserId ? teamAssignByUser[teamAssignPickUserId] : null;
              const selected = cur === t;
              return (
                <Pressable
                  key={t}
                  onPress={() => {
                    if (!teamAssignPickUserId) return;
                    setTeamAssignByUser((prev) => ({ ...prev, [teamAssignPickUserId]: t }));
                    setTeamAssignPickUserId(null);
                  }}
                  style={({ pressed }) => [
                    styles.teamPickModalRow,
                    selected && styles.teamPickModalRowOn,
                    pressed && { opacity: 0.88 },
                  ]}
                >
                  <Text style={[styles.teamPickModalRowText, selected && styles.teamPickModalRowTextOn]}>
                    {labelPickupTeam(t)}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable onPress={() => setTeamAssignPickUserId(null)} style={styles.teamPickModalCancel}>
              <Text style={styles.teamPickModalCancelText}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0a0a0a" },
  content: { padding: 16, paddingBottom: 48 },
  h1: { fontSize: 28, fontWeight: "800", color: "#fff", letterSpacing: -0.3 },
  lead: { marginTop: 8, color: "rgba(255,255,255,0.58)", fontSize: 14, lineHeight: 20 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
    backgroundColor: "rgba(163,230,53,0.08)",
  },
  chipText: { color: LIME, fontWeight: "800", fontSize: 13 },
  toolbarScroll: { marginTop: 12 },
  toolbarScrollContent: { flexDirection: "row", alignItems: "center", gap: 8, paddingRight: 8 },
  toolbarChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 11,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
    backgroundColor: "rgba(163,230,53,0.08)",
  },
  toolbarChipText: { color: LIME, fontWeight: "800", fontSize: 12 },
  toolbarBadge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: LIME,
  },
  toolbarBadgeText: { color: "#111", fontWeight: "900", fontSize: 10 },
  workflowTabRow: { marginTop: 10, flexDirection: "row", gap: 6 },
  workflowTab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.04)",
    alignItems: "center",
  },
  workflowTabActive: { borderColor: "rgba(163,230,53,0.45)", backgroundColor: "rgba(163,230,53,0.10)" },
  workflowTabText: { color: "rgba(255,255,255,0.55)", fontWeight: "800", fontSize: 11, textAlign: "center" },
  workflowTabTextActive: { color: LIME },
  segmentLabel: { marginTop: 18, fontSize: 11, fontWeight: "800", color: "rgba(255,255,255,0.45)", letterSpacing: 1.1 },
  segmentRow: { marginTop: 10, flexDirection: "row", gap: 8 },
  segment: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.04)",
    alignItems: "center",
  },
  segmentActive: { borderColor: "rgba(163,230,53,0.45)", backgroundColor: "rgba(163,230,53,0.10)" },
  segmentText: { color: "rgba(255,255,255,0.7)", fontWeight: "900", fontSize: 12 },
  segmentTextActive: { color: LIME },
  err: { marginTop: 12, color: "#fca5a5", fontSize: 14 },
  emptyCard: {
    marginTop: 16,
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  emptyTitle: { color: "#fff", fontWeight: "800", fontSize: 16 },
  emptyBody: { marginTop: 8, color: "rgba(255,255,255,0.55)", fontSize: 14, lineHeight: 20 },
  runCard: {
    marginTop: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  runTitle: { fontSize: 18, fontWeight: "800", color: "#fff", letterSpacing: -0.2 },
  runDateLine: { marginTop: 6, fontSize: 14, fontWeight: "700", color: "rgba(255,255,255,0.75)" },
  runTimeLine: { marginTop: 2, fontSize: 13, fontWeight: "600", color: "rgba(255,255,255,0.45)" },
  runPastEtLine: { fontSize: 15, fontWeight: "800", color: "#fff", letterSpacing: -0.2 },
  runVenueLine: { marginTop: 8, fontSize: 16, fontWeight: "700", color: "rgba(255,255,255,0.9)", lineHeight: 22 },
  runPastMetaLine: { marginTop: 6, fontSize: 13, fontWeight: "600", color: "rgba(255,255,255,0.55)" },
  pastResultPosted: { marginTop: 12, fontSize: 14, fontWeight: "800", color: LIME },
  pastResultMissing: { marginTop: 12, fontSize: 14, fontWeight: "700", color: "rgba(255,255,255,0.38)" },
  runBadgesRow: { marginTop: 12, flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  regionBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(163,230,53,0.12)",
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
  },
  regionBadgeText: { fontSize: 11, fontWeight: "900", color: LIME },
  workflowPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.35)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  workflowPillText: { fontSize: 11, fontWeight: "800", color: "rgba(255,255,255,0.88)" },
  quickStatsRow: {
    marginTop: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between",
  },
  quickStat: {
    flexGrow: 1,
    minWidth: "22%",
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(0,0,0,0.2)",
    alignItems: "center",
  },
  quickStatVal: { fontSize: 16, fontWeight: "900", color: "#fff" },
  quickStatLbl: { marginTop: 2, fontSize: 9, fontWeight: "800", color: "rgba(255,255,255,0.4)", letterSpacing: 0.3 },
  cardActionRow: { marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  cardBtnSecondary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
    backgroundColor: "rgba(163,230,53,0.08)",
  },
  cardBtnSecondaryText: { color: LIME, fontWeight: "800", fontSize: 12 },
  cardBtnDanger: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.45)",
    backgroundColor: "rgba(248,113,113,0.12)",
  },
  cardBtnDangerText: { color: "rgba(254,202,202,0.95)", fontWeight: "900", fontSize: 13 },
  cardBtnLime: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: LIME,
    borderWidth: 1,
    borderColor: LIME,
  },
  cardBtnLimeText: { color: "#111", fontWeight: "900", fontSize: 13 },
  detailsChevronRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
  },
  runTapHint: { fontSize: 12, fontWeight: "700", color: "rgba(255,255,255,0.4)" },
  fab: {
    position: "absolute",
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 999,
    backgroundColor: LIME,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.6)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  createModalKb: {
    maxHeight: "92%",
    width: "100%",
    justifyContent: "flex-end",
    zIndex: 1,
    elevation: 8,
  },
  createModalSheet: {
    backgroundColor: "#0a0a0a",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    paddingHorizontal: 16,
    paddingTop: 8,
    maxHeight: "88%",
  },
  card: {
    marginTop: 18,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  cardTitle: { fontSize: 16, fontWeight: "800", color: "#fff" },
  fieldHint: { marginTop: 6, fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 18 },
  label: { marginTop: 12, fontSize: 12, fontWeight: "700", color: "rgba(255,255,255,0.55)" },
  input: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    color: "#fff",
    backgroundColor: "rgba(0,0,0,0.28)",
  },
  textArea: { minHeight: 100, textAlignVertical: "top" },
  statePill: { justifyContent: "center" },
  statePillText: { color: "#fff", fontWeight: "900", fontSize: 15 },
  twoCol: { flexDirection: "row", gap: 12 },
  feePerPlayerLine: { marginTop: 12, fontSize: 15, fontWeight: "700", color: "rgba(255,255,255,0.7)" },
  feeBreakdownLine: { marginTop: 6, fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: 16 },
  feePerPlayerValue: { color: LIME, fontWeight: "900" },
  feePerPlayerPlaceholder: { color: "rgba(255,255,255,0.35)", fontWeight: "700" },
  createRunScheduleBlock: {
    marginBottom: 16,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
    backgroundColor: "rgba(163,230,53,0.06)",
  },
  createRunScheduleTitle: { color: "#fff", fontSize: 17, fontWeight: "900", marginBottom: 6 },
  createRunScheduleHint: { color: "rgba(255,255,255,0.55)", fontSize: 13, lineHeight: 18, marginBottom: 10 },
  createRunVerified: {
    marginTop: 4,
    color: LIME,
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 20,
  },
  createRunScheduleWarn: {
    marginTop: 4,
    color: "rgba(255,255,255,0.45)",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },
  primary: {
    marginTop: 14,
    backgroundColor: LIME,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryInFooter: { marginTop: 0 },
  primaryText: { color: "#111", fontWeight: "900", fontSize: 15 },
  disabled: { opacity: 0.55 },
  muted: { marginTop: 8, color: "rgba(255,255,255,0.55)", fontSize: 14 },
  mutedSmall: { marginTop: 6, marginBottom: 4, color: "rgba(255,255,255,0.45)", fontSize: 12, lineHeight: 16 },
  modalRoot: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  modalBackdropHitBox: { zIndex: 0 },
  modalKb: { maxHeight: "92%", zIndex: 1, elevation: 8 },
  modalSheet: {
    maxHeight: "92%",
    backgroundColor: "#0a0a0a",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  modalGrabRow: { alignItems: "center", paddingVertical: 6 },
  modalGrab: { width: 40, height: 4, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.2)" },
  modalHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 8 },
  modalTitle: { fontSize: 20, fontWeight: "800", color: "#fff" },
  modalSub: { marginTop: 4, fontSize: 13, color: "rgba(255,255,255,0.5)" },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  countRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  countChip: {
    flexGrow: 1,
    minWidth: "22%",
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.04)",
    alignItems: "center",
  },
  countChipLabel: { fontSize: 10, fontWeight: "800", color: "rgba(255,255,255,0.45)", letterSpacing: 0.5 },
  countChipVal: { marginTop: 4, fontSize: 18, fontWeight: "900", color: "#fff" },
  modalSection: { marginTop: 16, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)" },
  sectionTitle: { fontSize: 13, fontWeight: "800", color: "rgba(255,255,255,0.85)", letterSpacing: 0.6, marginBottom: 10 },
  editDetailsToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
    paddingVertical: 4,
  },
  editDetailsToggleText: { fontSize: 13, fontWeight: "800", color: "rgba(255,255,255,0.85)", letterSpacing: 0.6 },
  rosterSubheading: {
    fontSize: 12,
    fontWeight: "800",
    color: "rgba(163,230,53,0.85)",
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  modalSaveFooter: {
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    paddingTop: 12,
    backgroundColor: "#0a0a0a",
  },
  actionRow: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  secondaryLime: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
    backgroundColor: "rgba(163,230,53,0.08)",
  },
  secondaryLimeText: { color: LIME, fontWeight: "800", fontSize: 14 },
  blockHint: { marginTop: 8, fontSize: 12, color: "rgba(251,191,36,0.9)", lineHeight: 17 },
  presetRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  presetChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  presetChipActive: { borderColor: "rgba(163,230,53,0.45)", backgroundColor: "rgba(163,230,53,0.12)" },
  presetChipText: { fontSize: 13, fontWeight: "700", color: "rgba(255,255,255,0.65)" },
  presetChipTextActive: { color: LIME },
  switchRow: { marginTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  switchLabel: { flex: 1, fontSize: 13, color: "rgba(255,255,255,0.65)", fontWeight: "600", paddingRight: 12 },
  miniToggle: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(0,0,0,0.3)",
  },
  miniToggleOn: { borderColor: "rgba(163,230,53,0.45)", backgroundColor: "rgba(163,230,53,0.12)" },
  miniToggleText: { fontWeight: "800", fontSize: 12, color: "#fff" },
  typeRow: { flexDirection: "row", gap: 10, marginTop: 8 },
  typeChip: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  typeChipActive: { borderColor: "rgba(163,230,53,0.45)", backgroundColor: "rgba(163,230,53,0.1)" },
  typeChipText: { fontWeight: "800", color: "rgba(255,255,255,0.55)" },
  typeChipTextActive: { color: LIME },
  slotRow: {
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(0,0,0,0.22)",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  slotTime: { fontSize: 14, fontWeight: "800", color: "#fff" },
  slotLabel: { marginTop: 2, fontSize: 12, color: "rgba(255,255,255,0.5)" },
  finalTag: { marginTop: 4, fontSize: 11, fontWeight: "800", color: LIME },
  slotFinalize: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: LIME,
  },
  slotFinalizeText: { color: "#111", fontWeight: "900", fontSize: 12 },
  personRow: { marginTop: 12, flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  personName: { color: "#fff", fontWeight: "700" },
  personSub: { marginTop: 2, color: "rgba(255,255,255,0.45)", fontSize: 12 },
  smallChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.25)",
    backgroundColor: "rgba(163,230,53,0.1)",
  },
  smallChipAlt: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.25)",
    backgroundColor: "rgba(248,113,113,0.1)",
  },
  smallChipWarn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.25)",
    backgroundColor: "rgba(251,191,36,0.1)",
  },
  smallChipText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  primarySmall: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: LIME,
  },
  primarySmallText: { color: "#111", fontWeight: "900", fontSize: 12 },
  dangerOutline: {
    marginTop: 20,
    marginBottom: 24,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.45)",
    alignItems: "center",
    backgroundColor: "rgba(248,113,113,0.06)",
  },
  dangerOutlineText: { color: "rgba(248,113,113,0.95)", fontWeight: "800", fontSize: 15 },
  availCard: {
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(0,0,0,0.28)",
  },
  availCardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  availNameBold: { flex: 1, fontSize: 16, fontWeight: "800", color: "#fff", letterSpacing: -0.2 },
  availStatePill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  availStatePillOn: { backgroundColor: "rgba(163,230,53,0.15)" },
  availStatePillOff: { backgroundColor: "rgba(255,255,255,0.08)" },
  availStatePillText: { fontSize: 11, fontWeight: "700", color: "rgba(255,255,255,0.4)" },
  availStatePillTextOn: { color: LIME },
  availHandles: { marginTop: 6, fontSize: 13, lineHeight: 18, color: "rgba(255,255,255,0.5)", fontWeight: "600" },
  availMetaLine: { marginTop: 8, fontSize: 13, fontWeight: "700", color: "rgba(255,255,255,0.72)" },
  availStatLine: { marginTop: 6, fontSize: 13, fontWeight: "600", color: "rgba(255,255,255,0.55)" },
  availSlotLine: { marginTop: 6, fontSize: 13, fontWeight: "700", color: LIME },
  availActionsRow: { marginTop: 12, flexDirection: "row", gap: 10 },
  availConfirmBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: "rgba(34,197,94,0.22)",
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.5)",
  },
  availConfirmBtnText: { color: "#86efac", fontWeight: "900", fontSize: 13 },
  availDeclineBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: "rgba(239,68,68,0.18)",
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.55)",
  },
  availDeclineBtnText: { color: "rgba(254,202,202,0.98)", fontWeight: "900", fontSize: 13 },
  venueFeePresetScroll: { marginTop: 8 },
  venueFeePresetScrollContent: { flexDirection: "row", alignItems: "center", gap: 8, paddingRight: 4 },
  venueFeePresetChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.05)",
    flexShrink: 0,
  },
  venueFeePresetChipActive: {
    borderColor: "rgba(163,230,53,0.55)",
    backgroundColor: "rgba(163,230,53,0.18)",
  },
  venueFeePresetChipText: { fontSize: 13, fontWeight: "700", color: "rgba(255,255,255,0.65)" },
  venueFeePresetChipTextActive: { color: LIME },

  teamAssignSheet: {
    backgroundColor: "#0a0a0a",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    paddingHorizontal: 16,
    paddingTop: 8,
    maxHeight: "88%",
    zIndex: 1,
    elevation: 8,
    width: "100%",
  },
  teamAssignHeaderRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 6 },
  teamAssignSub: { marginTop: 4, fontSize: 13, color: "rgba(255,255,255,0.45)" },
  teamAssignRosterLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: "rgba(163,230,53,0.85)",
    letterSpacing: 0.4,
    marginBottom: 10,
  },
  teamAssignToggleRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
  teamAssignToggleChip: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  teamAssignToggleChipOn: { borderColor: "rgba(163,230,53,0.55)", backgroundColor: "rgba(163,230,53,0.12)" },
  teamAssignToggleText: { color: "rgba(255,255,255,0.55)", fontSize: 15, fontWeight: "800" },
  teamAssignToggleTextOn: { color: LIME },
  teamAssignAutoBtn: {
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.4)",
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
    backgroundColor: "rgba(163,230,53,0.08)",
  },
  teamAssignAutoBtnText: { color: LIME, fontWeight: "800", fontSize: 14 },
  teamAssignRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  teamAssignRowName: { color: "#fff", fontWeight: "800", fontSize: 15 },
  teamAssignRowPos: { marginTop: 4, fontSize: 12, color: "rgba(255,255,255,0.45)", fontWeight: "600" },
  teamAssignTeamPill: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
    backgroundColor: "rgba(163,230,53,0.10)",
  },
  teamAssignTeamPillText: { color: LIME, fontWeight: "900", fontSize: 13 },

  teamPickModalRoot: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  teamPickModalCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "#141414",
    padding: 20,
    gap: 12,
  },
  teamPickModalTitle: { fontSize: 15, fontWeight: "800", color: LIME, paddingHorizontal: 16, paddingVertical: 12 },
  teamPickModalRow: { paddingVertical: 14, paddingHorizontal: 16, borderRadius: 10, marginHorizontal: 4 },
  teamPickModalRowOn: { backgroundColor: "rgba(163,230,53,0.12)" },
  teamPickModalRowText: { fontSize: 16, color: "rgba(255,255,255,0.85)" },
  teamPickModalRowTextOn: { color: LIME, fontWeight: "700" },
  teamPickModalCancel: { marginTop: 4, paddingVertical: 14, alignItems: "center" },
  teamPickModalCancelText: { fontSize: 15, fontWeight: "600", color: "rgba(255,255,255,0.45)" },
});

function VenueFeePresetRow({
  presets,
  selectedId,
  onSelect,
}: {
  presets: VenueFeePreset[];
  selectedId: string | null;
  onSelect: (p: VenueFeePreset) => void;
}) {
  if (presets.length === 0) return null;
  return (
    <>
      <Text style={styles.label}>Venue preset</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        nestedScrollEnabled
        style={styles.venueFeePresetScroll}
        contentContainerStyle={styles.venueFeePresetScrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {presets.map((p) => {
          const active = selectedId === p.id;
          return (
            <Pressable
              key={p.id}
              onPress={() => onSelect(p)}
              style={({ pressed }) => [
                styles.venueFeePresetChip,
                active && styles.venueFeePresetChipActive,
                pressed && { opacity: 0.9 },
              ]}
            >
              <Text style={[styles.venueFeePresetChipText, active && styles.venueFeePresetChipTextActive]}>{p.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </>
  );
}
