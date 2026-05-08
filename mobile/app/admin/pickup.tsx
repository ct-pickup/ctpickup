import { useAuth } from "@/context/AuthContext";
import {
  fetchAdminPickupSwitchDetail,
  fetchAdminPickupSwitchList,
  type PickupSwitchDetailResponse,
  postAdminCancelRun,
  postAdminCreateRun,
  postAdminLateCancel,
  postAdminMarkAttendance,
  postAdminPickupSwitch,
  postAdminPromote,
  postAdminSetHubPickup,
} from "@/lib/adminApi";
import { siteOrigin } from "@/lib/env";
import { fmtPickupDt } from "@/lib/pickupPublic";
import { SERVICE_REGIONS, serviceRegionName, type ServiceRegionCode } from "@/lib/serviceRegions";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const LIME = "#a3e635";

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

function statusLabel(st: unknown): string {
  const v = s(st).trim();
  if (!v) return "UNKNOWN";
  if (v === "planning") return "PLANNING";
  if (v === "likely_on") return "LIKELY ON";
  if (v === "active") return "ACTIVE";
  return v.toUpperCase();
}

function runTypeLabel(rt: unknown): string {
  const v = s(rt).trim();
  if (v === "select") return "SELECT";
  if (v === "public") return "PUBLIC";
  return v ? v.toUpperCase() : "—";
}

function locationSnippet(loc: unknown, max = 72): string {
  const t = s(loc).replace(/\s+/g, " ").trim();
  if (!t) return "No venue text yet";
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function detectPreset(locationPrivate: string): LocationPresetKey {
  const t = locationPrivate.trim();
  if (!t) return "";
  if (t === LOCATION_PRESETS.new_haven.trim()) return "new_haven";
  if (t === LOCATION_PRESETS.new_rochelle.trim()) return "new_rochelle";
  return "other";
}

/** field_cost in dollars; returns fee in whole dollars (ceil). */
function feePerPlayerDollars(fieldCostDollars: number, expectedPlayers: number): number | null {
  if (!Number.isFinite(fieldCostDollars) || !Number.isFinite(expectedPlayers) || expectedPlayers <= 0) return null;
  return Math.ceil(fieldCostDollars / expectedPlayers);
}

function feeCentsFromCalculator(fieldCostDollars: number, expectedPlayers: number): number {
  const per = feePerPlayerDollars(fieldCostDollars, expectedPlayers);
  if (per == null) return 0;
  return per * 100;
}

export default function AdminPickupOpsScreen() {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const token = session?.access_token ?? null;

  const [region, setRegion] = useState<ServiceRegionCode>("CT");
  const [runs, setRuns] = useState<Record<string, unknown>[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PickupSwitchDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [editTitle, setEditTitle] = useState("");
  const [editRunType, setEditRunType] = useState<"select" | "public">("select");
  const [editCapacity, setEditCapacity] = useState("18");
  const [editFieldCost, setEditFieldCost] = useState("");
  const [editHours, setEditHours] = useState("1.5");
  const [editExpectedPlayers, setEditExpectedPlayers] = useState("18");
  const [editLocationPrivate, setEditLocationPrivate] = useState("");
  const [editLocConfirmedOnly, setEditLocConfirmedOnly] = useState(true);
  const [locationPreset, setLocationPreset] = useState<LocationPresetKey>("");

  const [slotStart, setSlotStart] = useState("");
  const [slotLabel, setSlotLabel] = useState("");

  const [createStartAt, setCreateStartAt] = useState("");
  const [createTitle, setCreateTitle] = useState("");
  const [createCapacity, setCreateCapacity] = useState("24");
  const [createFieldCost, setCreateFieldCost] = useState("");
  const [createHours, setCreateHours] = useState("1.5");
  const [createExpectedPlayers, setCreateExpectedPlayers] = useState("24");
  const [createLocationText, setCreateLocationText] = useState("");
  const [createSelectedVenueFeePresetId, setCreateSelectedVenueFeePresetId] = useState<string | null>(null);
  const [editSelectedVenueFeePresetId, setEditSelectedVenueFeePresetId] = useState<string | null>(null);

  const [busy, setBusy] = useState<string | null>(null);

  const venueFeePresetsForRegion = useMemo(() => VENUE_FEE_PRESETS.filter((p) => p.region === region), [region]);

  useEffect(() => {
    setCreateSelectedVenueFeePresetId(null);
    setEditSelectedVenueFeePresetId(null);
  }, [region]);

  const loadRuns = useCallback(async () => {
    if (!token) {
      setListError("Not signed in.");
      setRuns([]);
      return;
    }
    setListLoading(true);
    setListError(null);
    const r = await fetchAdminPickupSwitchList(token, { region });
    setListLoading(false);
    if (!r.ok) {
      setListError(r.error);
      setRuns([]);
      return;
    }
    setRuns(r.data.runs || []);
  }, [token, region]);

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
      const feeDollars = Number.isFinite(cents) ? cents / 100 : 0;
      setEditExpectedPlayers(String(cap));
      setEditFieldCost(
        Number.isFinite(cents) && cap > 0 && Number.isFinite(feeDollars) ? String(feeDollars * cap) : "",
      );
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
    if (!modalOpen || !selectedRunId) return;
    void loadDetail();
  }, [modalOpen, selectedRunId, loadDetail]);

  const selectedRun = detail?.run ?? null;
  const slots = useMemo(() => (Array.isArray(detail?.slots) ? detail!.slots : []) as Record<string, unknown>[], [detail]);
  const counts = detail?.counts;
  const confirmed = useMemo(() => (Array.isArray(detail?.confirmed) ? detail!.confirmed : []), [detail]);
  const standby = useMemo(() => (Array.isArray(detail?.standby) ? detail!.standby : []), [detail]);
  const auto = detail?.auto_status;

  const createFeePreview = useMemo(
    () => feePerPlayerDollars(Number(createFieldCost), Number(createExpectedPlayers)),
    [createFieldCost, createExpectedPlayers],
  );
  const editFeePreview = useMemo(
    () => feePerPlayerDollars(Number(editFieldCost), Number(editExpectedPlayers)),
    [editFieldCost, editExpectedPlayers],
  );

  async function requireToken(): Promise<string | null> {
    if (!token) {
      Alert.alert("Not signed in", "Sign in again.");
      return null;
    }
    return token;
  }

  function openRun(id: string) {
    setSelectedRunId(id);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setSelectedRunId(null);
    setDetail(null);
    setDetailError(null);
    setSlotStart("");
    setSlotLabel("");
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
    const ep = Number(editExpectedPlayers);
    if (!Number.isFinite(fc) || fc < 0) {
      setBusy(null);
      return Alert.alert("Invalid field cost", "Enter a valid number for field cost ($).");
    }
    if (!Number.isFinite(ep) || ep <= 0 || !Number.isInteger(ep)) {
      setBusy(null);
      return Alert.alert("Invalid expected players", "Enter a positive whole number of players splitting the cost.");
    }
    const fee_cents = feeCentsFromCalculator(fc, ep);
    const r = await postAdminPickupSwitch(t, {
      action: "edit_run",
      run_id: selectedRunId,
      title: editTitle.trim(),
      capacity: Number(editCapacity || 18),
      fee_cents,
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

  async function onAddSlot() {
    const t = await requireToken();
    if (!t || !selectedRunId) return;
    const start_at = slotStart.trim();
    if (!start_at) return Alert.alert("Missing time", "Enter kickoff as ISO, e.g. 2026-05-10T18:00:00Z");
    setBusy("slot");
    const r = await postAdminPickupSwitch(t, {
      action: "add_slot",
      run_id: selectedRunId,
      start_at,
      label: slotLabel.trim() || null,
    });
    setBusy(null);
    if (!r.ok) return Alert.alert("Add slot failed", r.error);
    setSlotStart("");
    setSlotLabel("");
    void loadDetail();
    void loadRuns();
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
            setBusy("finalize");
            const r = await postAdminPickupSwitch(t, {
              action: "finalize_slot",
              run_id: selectedRunId,
              slot_id: slotId,
            });
            setBusy(null);
            if (!r.ok) return Alert.alert("Finalize failed", r.error);
            void loadDetail();
            void loadRuns();
          })();
        },
      },
    ]);
  }

  async function onLaunchOutreach() {
    const t = await requireToken();
    if (!t || !selectedRunId) return;
    const origin = siteOrigin();
    const runLink = origin ? `${origin.replace(/\/$/, "")}/pickup` : "/pickup";
    const dateOrTbd =
      selectedRun && s(selectedRun.start_at)
        ? fmtPickupDt(s(selectedRun.start_at))
        : auto && s((auto as Record<string, unknown>).anchor_start_at)
          ? fmtPickupDt(s((auto as Record<string, unknown>).anchor_start_at))
          : "TBD";

    Alert.alert("Launch outreach?", "Sends Tier-1 SMS for select runs (36h+ before kickoff). Public runs skip invites.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Launch",
        onPress: () => {
          void (async () => {
            setBusy("outreach");
            const r = await postAdminPickupSwitch(t, {
              action: "launch_outreach",
              run_id: selectedRunId,
              run_link: runLink,
              date_or_tbd: dateOrTbd,
            });
            setBusy(null);
            if (!r.ok) return Alert.alert("Launch failed", r.error);
            Alert.alert("Launched", "Outreach started for this run.");
            void loadDetail();
            void loadRuns();
          })();
        },
      },
    ]);
  }

  async function onPromoteHub() {
    const t = await requireToken();
    if (!t || !selectedRunId) return;
    Alert.alert("Promote to hub?", "This run becomes the featured pickup on the public site for its region.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Promote",
        onPress: () => {
          void (async () => {
            setBusy("hub");
            const r = await postAdminSetHubPickup(t, selectedRunId);
            setBusy(null);
            if (!r.ok) return Alert.alert("Promote failed", r.error);
            void loadRuns();
            void loadDetail();
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
      Alert.alert("Missing start time", "Enter an ISO string like 2026-05-03T20:00:00Z");
      return;
    }
    const fc = Number(createFieldCost);
    const ep = Number(createExpectedPlayers);
    if (!Number.isFinite(fc) || fc < 0) {
      return Alert.alert("Invalid field cost", "Enter a valid number for field cost ($).");
    }
    if (!Number.isFinite(ep) || ep <= 0 || !Number.isInteger(ep)) {
      return Alert.alert("Invalid expected players", "Enter a positive whole number of players splitting the cost.");
    }
    const fee_cents = feeCentsFromCalculator(fc, ep);
    setBusy("create");
    const r = await postAdminCreateRun(t, {
      start_at,
      title: createTitle.trim() || undefined,
      service_region: region,
      capacity: Number(createCapacity || 24),
      fee_cents,
      location_text: createLocationText.trim() || undefined,
    });
    setBusy(null);
    if (!r.ok) return Alert.alert("Create failed", r.error);
    Alert.alert("Created", "Run created.");
    setCreateStartAt("");
    setCreateTitle("");
    setCreateFieldCost("");
    setCreateHours("1.5");
    setCreateExpectedPlayers(createCapacity.trim() || "24");
    setCreateLocationText("");
    setCreateSelectedVenueFeePresetId(null);
    void loadRuns();
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
            setBusy("cancel");
            const r = await postAdminCancelRun(t, { run_id: selectedRunId, reason: "Canceled from mobile admin" });
            setBusy(null);
            if (!r.ok) return Alert.alert("Cancel failed", r.error);
            Alert.alert("Canceled", "Run canceled.");
            closeModal();
            void loadRuns();
          })();
        },
      },
    ]);
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

  const launchBlocked = useMemo(() => {
    if (!selectedRun) return "Select a run.";
    if (s(selectedRun.outreach_started_at)) return "Outreach already launched.";
    if (!auto || !s((auto as Record<string, unknown>).anchor_start_at)) return "Add a kickoff slot first.";
    const h = (auto as Record<string, unknown>).hours_until_start;
    if (h === null || h === undefined || Number(h) < 36) return "Kickoff must be at least 36 hours away.";
    return null;
  }, [selectedRun, auto]);

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom }]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.rowBetween}>
          <Text style={styles.h1}>Pickup ops</Text>
          <Pressable onPress={() => void loadRuns()} style={({ pressed }) => [styles.chip, pressed && { opacity: 0.85 }]}>
            <Text style={styles.chipText}>Refresh</Text>
          </Pressable>
        </View>

        <Text style={styles.lead}>Runs in {serviceRegionName(region)} tap a card for slots, outreach, roster, and edits.</Text>

        <Text style={styles.segmentLabel}>STATE</Text>
        <View style={styles.segmentRow}>
          {SERVICE_REGIONS.map(({ code }) => {
            const active = region === code;
            return (
              <Pressable
                key={code}
                onPress={() => {
                  setRegion(code);
                  if (modalOpen) closeModal();
                }}
                style={({ pressed }) => [styles.segment, active && styles.segmentActive, pressed && { opacity: 0.9 }]}
              >
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{code}</Text>
              </Pressable>
            );
          })}
        </View>

        {listLoading ? <ActivityIndicator color="#fff" style={{ marginTop: 16 }} /> : null}
        {listError ? <Text style={styles.err}>{listError}</Text> : null}

        {!listLoading && runs.length === 0 && !listError ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No runs in this state.</Text>
            <Text style={styles.emptyBody}>Create one below or switch state.</Text>
          </View>
        ) : null}

        {runs.map((row) => {
          const id = s(row.id);
          if (!id) return null;
          const isHub = !!row.is_current;
          return (
            <Pressable
              key={id}
              onPress={() => openRun(id)}
              style={({ pressed }) => [styles.runCard, pressed && { opacity: 0.92 }]}
            >
              <View style={styles.runCardTop}>
                <Text style={styles.runEyebrow}>{runTypeLabel(row.run_type)}</Text>
                {isHub ? (
                  <View style={styles.hubPill}>
                    <Text style={styles.hubPillText}>HUB</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.runTitle}>{s(row.title) || "Pickup run"}</Text>
              <Text style={styles.runLoc} numberOfLines={2}>
                {locationSnippet(row.location_private)}
              </Text>
              <View style={styles.runMetaRow}>
                <View style={styles.statusPill}>
                  <Text style={styles.statusPillText}>{statusLabel(row.status)}</Text>
                </View>
                <Text style={styles.runTime}>{fmtPickupDt(s(row.start_at))}</Text>
              </View>
              <View style={styles.runChevronRow}>
                <Text style={styles.runTapHint}>Details</Text>
                <FontAwesome name="chevron-right" size={12} color="rgba(255,255,255,0.35)" />
              </View>
            </Pressable>
          );
        })}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Create run</Text>
          <Text style={styles.fieldHint}>New run uses API defaults refine in the detail sheet after creation.</Text>
          <Text style={styles.label}>Start at (ISO)</Text>
          <TextInput
            style={styles.input}
            value={createStartAt}
            onChangeText={setCreateStartAt}
            placeholder="2026-05-03T20:00:00Z"
            placeholderTextColor="rgba(255,255,255,0.35)"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={styles.twoCol}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>State</Text>
              <View style={[styles.input, styles.statePill]}>
                <Text style={styles.statePillText}>{region}</Text>
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Capacity</Text>
              <TextInput
                style={styles.input}
                value={createCapacity}
                onChangeText={setCreateCapacity}
                keyboardType="number-pad"
                placeholder="24"
                placeholderTextColor="rgba(255,255,255,0.35)"
              />
            </View>
          </View>
          <VenueFeePresetRow
            presets={venueFeePresetsForRegion}
            selectedId={createSelectedVenueFeePresetId}
            onSelect={(p) => {
              setCreateSelectedVenueFeePresetId(p.id);
              setCreateLocationText(p.address);
              if (p.priceDollars > 0) setCreateFieldCost(String(p.priceDollars));
            }}
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
            Fee per player:{" "}
            <Text style={createFeePreview != null ? styles.feePerPlayerValue : styles.feePerPlayerPlaceholder}>
              {createFeePreview != null ? `$${createFeePreview.toFixed(2)}` : "—"}
            </Text>
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
          <Pressable
            onPress={() => void onCreateRun()}
            disabled={busy === "create"}
            style={({ pressed }) => [styles.primary, pressed && { opacity: 0.9 }, busy === "create" && styles.disabled]}
          >
            <Text style={styles.primaryText}>{busy === "create" ? "Creating…" : "Create run"}</Text>
          </Pressable>
        </View>
      </ScrollView>

      <Modal visible={modalOpen} animationType="slide" transparent onRequestClose={closeModal}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalDismiss} onPress={closeModal} accessibilityLabel="Dismiss" />
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            keyboardVerticalOffset={insets.top}
            style={styles.modalKb}
          >
            <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.modalGrabRow}>
              <View style={styles.modalGrab} />
            </View>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.modalTitle} numberOfLines={2}>
                  {selectedRun ? s(selectedRun.title) || "Run" : "Run"}
                </Text>
                <Text style={styles.modalSub} numberOfLines={1}>
                  {selectedRun ? `${statusLabel(selectedRun.status)} · ${fmtPickupDt(s(selectedRun.start_at))}` : ""}
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
              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
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
                  </View>
                ) : null}

                <View style={styles.modalSection}>
                  <Text style={styles.sectionTitle}>Hub & outreach</Text>
                  <View style={styles.actionRow}>
                    <Pressable
                      onPress={() => void onPromoteHub()}
                      disabled={busy === "hub" || !selectedRunId}
                      style={({ pressed }) => [styles.secondaryLime, pressed && { opacity: 0.9 }, busy === "hub" && styles.disabled]}
                    >
                      <FontAwesome name="bullhorn" size={14} color={LIME} />
                      <Text style={styles.secondaryLimeText}>{busy === "hub" ? "…" : "Promote to hub"}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => void onLaunchOutreach()}
                      disabled={busy === "outreach" || !!launchBlocked}
                      style={({ pressed }) => [
                        styles.secondaryLime,
                        pressed && { opacity: 0.9 },
                        (busy === "outreach" || !!launchBlocked) && styles.disabled,
                      ]}
                    >
                      <FontAwesome name="paper-plane" size={14} color={LIME} />
                      <Text style={styles.secondaryLimeText}>{busy === "outreach" ? "…" : "Launch outreach"}</Text>
                    </Pressable>
                  </View>
                  {launchBlocked ? <Text style={styles.blockHint}>{launchBlocked}</Text> : null}
                </View>

                <View style={styles.modalSection}>
                  <Text style={styles.sectionTitle}>Edit run</Text>
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
                    Fee per player:{" "}
                    <Text style={editFeePreview != null ? styles.feePerPlayerValue : styles.feePerPlayerPlaceholder}>
                      {editFeePreview != null ? `$${editFeePreview.toFixed(2)}` : "—"}
                    </Text>
                  </Text>
                  <Pressable
                    onPress={() => void onSaveRun()}
                    disabled={busy === "save"}
                    style={({ pressed }) => [styles.primary, pressed && { opacity: 0.9 }, busy === "save" && styles.disabled]}
                  >
                    <Text style={styles.primaryText}>{busy === "save" ? "Saving…" : "Save run"}</Text>
                  </Pressable>
                </View>

                <View style={styles.modalSection}>
                  <Text style={styles.sectionTitle}>Kickoff slots</Text>
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
                  <Text style={styles.label}>Add slot (ISO start)</Text>
                  <TextInput
                    style={styles.input}
                    value={slotStart}
                    onChangeText={setSlotStart}
                    placeholder="2026-05-10T18:00:00Z"
                    placeholderTextColor="rgba(255,255,255,0.35)"
                    autoCapitalize="none"
                  />
                  <Text style={styles.label}>Label (optional)</Text>
                  <TextInput
                    style={styles.input}
                    value={slotLabel}
                    onChangeText={setSlotLabel}
                    placeholder="Option A"
                    placeholderTextColor="rgba(255,255,255,0.35)"
                  />
                  <Pressable
                    onPress={() => void onAddSlot()}
                    disabled={busy === "slot"}
                    style={({ pressed }) => [styles.secondaryLime, pressed && { opacity: 0.9 }, busy === "slot" && styles.disabled]}
                  >
                    <Text style={styles.secondaryLimeText}>{busy === "slot" ? "Adding…" : "Add slot"}</Text>
                  </Pressable>
                </View>

                <View style={styles.modalSection}>
                  <Text style={styles.sectionTitle}>Confirmed ({confirmed.length})</Text>
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
                </View>

                <View style={styles.modalSection}>
                  <Text style={styles.sectionTitle}>Standby ({standby.length})</Text>
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
            )}
            </View>
          </KeyboardAvoidingView>
        </View>
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
  runCardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  runEyebrow: { fontSize: 11, fontWeight: "800", letterSpacing: 1, color: "rgba(163,230,53,0.85)" },
  hubPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(163,230,53,0.15)",
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
  },
  hubPillText: { fontSize: 10, fontWeight: "900", color: LIME },
  runTitle: { fontSize: 18, fontWeight: "800", color: "#fff", letterSpacing: -0.2 },
  runLoc: { marginTop: 6, fontSize: 13, color: "rgba(255,255,255,0.55)", lineHeight: 18 },
  runMetaRow: { marginTop: 12, flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.35)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  statusPillText: { fontSize: 11, fontWeight: "800", color: "rgba(255,255,255,0.85)" },
  runTime: { fontSize: 13, color: "rgba(255,255,255,0.5)", fontWeight: "600" },
  runChevronRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
  },
  runTapHint: { fontSize: 12, fontWeight: "700", color: "rgba(255,255,255,0.4)" },
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
  feePerPlayerValue: { color: LIME, fontWeight: "900" },
  feePerPlayerPlaceholder: { color: "rgba(255,255,255,0.35)", fontWeight: "700" },
  primary: {
    marginTop: 14,
    backgroundColor: LIME,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryText: { color: "#111", fontWeight: "900", fontSize: 15 },
  disabled: { opacity: 0.55 },
  muted: { marginTop: 8, color: "rgba(255,255,255,0.55)", fontSize: 14 },
  modalRoot: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  modalDismiss: { flex: 1 },
  modalKb: { maxHeight: "92%" },
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
