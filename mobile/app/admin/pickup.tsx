import AdminVenuePicker from "@/components/AdminVenuePicker";
import DateTimePicker, { isScheduleWallMidnightEt } from "@/components/DateTimePicker";
import AdminRunDetailLifecycle from "@/components/pickup/AdminRunDetailLifecycle";
import { useAuth } from "@/context/AuthContext";
import {
  adminVenueLocationPreset,
  serviceRegionForAdminVenueName,
} from "@/lib/adminCtPickupVenues";
import {
  fetchAdminPickupSwitchDetail,
  fetchAdminPickupSwitchList,
  fetchAdminTierSuggestions,
  postAdminCreateRun,
  type PickupSwitchDetailResponse,
} from "@/lib/adminApi";
import { hapticGoal, hapticTap } from "@/lib/haptics";
import { fmtPickupDtEt } from "@/lib/pickupPublic";
import { isPublicPickupRunType } from "@/lib/pickupRunType";
import {
  derivePickupLifecycleStage,
  pickupLifecycleStageLabel,
  showInvitePlayersButton,
} from "@/lib/pickupRunLifecycle";
import type { ServiceRegionCode } from "@/lib/serviceRegions";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const BG = "#0a0a0a";
const LIME = "#a3e635";

type WorkflowTab = "planning" | "active" | "past";

/** Field cost presets by venue name (whole dollars). */
const VENUE_FIELD_COST: Record<string, number> = {
  "Sofive Meadowlands 5v5": 162,
  "Sofive Meadowlands 7v7": 338,
  "Sofive Cherry Hill 5v5": 192,
  "Sofive Cherry Hill 7v7": 338,
  "Sofive Brooklyn": 173,
  "Hudson Sports": 131,
  "New Rochelle SoccerRoof": 278,
  "Sofive Rockville": 165,
  "SoccerDome Jessup": 113,
  "SoccerDome Harmans": 113,
  "New Haven SoccerRoof": 150,
};

function s(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function isPastRun(row: Record<string, unknown>): boolean {
  if (row.is_completed === true) return true;
  const st = s(row.status).trim();
  return st === "completed" || st === "canceled";
}

function defaultWorkflowTab(counts: Record<WorkflowTab, number>): WorkflowTab {
  if (counts.active > 0) return "active";
  return "planning";
}

function listCounts(row: Record<string, unknown>) {
  const raw = row.list_counts;
  if (!raw || typeof raw !== "object") {
    return { confirmed: 0, capacity: Number(row.capacity ?? 0) || 0 };
  }
  const o = raw as Record<string, unknown>;
  return {
    confirmed: Number(o.confirmed ?? 0) || 0,
    capacity: Number(row.capacity ?? 0) || 0,
  };
}

function venueLine(row: Record<string, unknown>): string {
  const loc = s(row.location_private).trim();
  if (loc) {
    const first = loc.split(/\r?\n/)[0]?.trim();
    if (first) return first;
  }
  return s(row.title).trim() || "Venue TBD";
}

function feeCentsFromCalculator(fieldCost: number, earnings: number, players: number): number {
  if (!Number.isFinite(fieldCost) || !Number.isFinite(earnings) || !Number.isFinite(players) || players <= 0) {
    return 0;
  }
  return Math.ceil(((fieldCost + earnings) / players) * 100);
}

function perPlayerPreview(fieldCost: number, earnings: number, players: number): string | null {
  const cents = feeCentsFromCalculator(fieldCost, earnings, players);
  if (!cents) return null;
  return `$${(cents / 100).toFixed(2)}`;
}

function SkeletonCard() {
  return (
    <View style={styles.skeletonCard}>
      <View style={[styles.skeletonLine, { width: "55%" }]} />
      <View style={[styles.skeletonLine, { width: "80%", marginTop: 10 }]} />
      <View style={[styles.skeletonLine, { width: "40%", marginTop: 10 }]} />
    </View>
  );
}

export default function AdminPickupOpsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session } = useAuth();
  const token = session?.access_token ?? null;

  const [workflowOverride, setWorkflowOverride] = useState<WorkflowTab | null>(null);
  const [runs, setRuns] = useState<Record<string, unknown>[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [tierBadge, setTierBadge] = useState(0);

  const [createOpen, setCreateOpen] = useState(false);
  const [createRunType, setCreateRunType] = useState<"public" | "select">("public");
  const [createVenue, setCreateVenue] = useState("");
  const [createStartAt, setCreateStartAt] = useState("");
  const [createCapacity, setCreateCapacity] = useState("24");
  const [createFieldCost, setCreateFieldCost] = useState("");
  const [createEarnings, setCreateEarnings] = useState("0");
  const [createBusy, setCreateBusy] = useState(false);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailRunId, setDetailRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PickupSwitchDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const createRegion = useMemo(
    (): ServiceRegionCode => serviceRegionForAdminVenueName(createVenue) ?? "CT",
    [createVenue],
  );

  const feePreview = useMemo(() => {
    const players = Number(createCapacity) || 24;
    return perPlayerPreview(Number(createFieldCost), Number(createEarnings), players);
  }, [createFieldCost, createEarnings, createCapacity]);

  const workflowCounts = useMemo(() => {
    const c: Record<WorkflowTab, number> = { planning: 0, active: 0, past: 0 };
    for (const row of runs) {
      if (isPastRun(row)) {
        c.past += 1;
        continue;
      }
      const st = s(row.status).trim();
      if (st === "planning") c.planning += 1;
      else if (st === "likely_on" || st === "active" || st === "in_progress") c.active += 1;
    }
    return c;
  }, [runs]);

  const workflowTab = workflowOverride ?? defaultWorkflowTab(workflowCounts);

  const filteredRuns = useMemo(() => {
    const base = runs.filter((row) => {
      if (workflowTab === "past") return isPastRun(row);
      if (isPastRun(row)) return false;
      const st = s(row.status).trim();
      if (workflowTab === "planning") return st === "planning";
      if (workflowTab === "active") return st === "likely_on" || st === "active" || st === "in_progress";
      return false;
    });
    return [...base].sort((a, b) => {
      const ta = Date.parse(s(a.start_at)) || 0;
      const tb = Date.parse(s(b.start_at)) || 0;
      return ta - tb;
    });
  }, [runs, workflowTab]);

  const loadRuns = useCallback(async () => {
    console.log("[admin] loadRuns called, fetching...");
    if (!token) {
      setListError("Sign in again to manage pickup runs.");
      setRuns([]);
      setListLoading(false);
      return;
    }
    setListLoading(true);
    setListError(null);
    const r = await fetchAdminPickupSwitchList(token);
    setListLoading(false);
    if (!r.ok) {
      setListError(r.error);
      setRuns([]);
      return;
    }
    console.log("[admin] loadRuns got:", r.data?.runs?.length, "runs");
    setRuns(r.data.runs ?? []);
  }, [token]);

  const loadTierBadge = useCallback(async () => {
    if (!token) {
      setTierBadge(0);
      return;
    }
    const r = await fetchAdminTierSuggestions(token);
    setTierBadge(r.ok ? Number(r.data.pending_count ?? 0) : 0);
  }, [token]);

  const loadDetail = useCallback(async () => {
    if (!token || !detailRunId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    setDetailError(null);
    const r = await fetchAdminPickupSwitchDetail(token, detailRunId);
    setDetailLoading(false);
    if (!r.ok) {
      setDetailError(r.error);
      setDetail(null);
      return;
    }
    setDetail(r.data);
  }, [token, detailRunId]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    void loadTierBadge();
  }, [loadTierBadge]);

  useEffect(() => {
    if (detailOpen && detailRunId) void loadDetail();
  }, [detailOpen, detailRunId, loadDetail]);

  function openDetail(id: string) {
    void hapticTap();
    setDetailRunId(id);
    setDetail(null);
    setDetailError(null);
    setDetailOpen(true);
  }

  function closeDetail() {
    setDetailOpen(false);
    setDetailRunId(null);
    setDetail(null);
    setDetailError(null);
  }

  function onVenueChange(name: string) {
    setCreateVenue(name);
    const preset = adminVenueLocationPreset(name);
    if (preset) {
      /* location is sent on create via location_private */
    }
    const cost = VENUE_FIELD_COST[name];
    if (typeof cost === "number" && cost > 0) setCreateFieldCost(String(cost));
  }

  async function onCreateRun() {
    if (!token) {
      Alert.alert("Not signed in", "Sign in again, then try creating a run.");
      return;
    }
    const start_at = createStartAt.trim();
    if (!start_at) {
      Alert.alert("Pick a date & time", "Choose when this run starts (Eastern Time).");
      return;
    }
    if (isScheduleWallMidnightEt(start_at)) {
      Alert.alert("Pick a time", "Runs need a real start time, not midnight.");
      return;
    }
    if (new Date(start_at) <= new Date()) {
      Alert.alert("Future only", "Start time must be in the future.");
      return;
    }
    if (!createVenue.trim()) {
      Alert.alert("Pick a venue", "Select a venue from the list.");
      return;
    }
    const fc = Number(createFieldCost);
    const me = Number(createEarnings);
    const ep = Number(createCapacity) || 24;
    if (!Number.isFinite(fc) || fc < 0) {
      Alert.alert("Field cost", "Enter a valid field cost in dollars.");
      return;
    }
    if (!Number.isFinite(me) || me < 0) {
      Alert.alert("Earnings", "Enter your earnings (0 or more).");
      return;
    }

    const location_private = adminVenueLocationPreset(createVenue) ?? createVenue;
    setCreateBusy(true);
    const r = await postAdminCreateRun(token, {
      start_at,
      title: createVenue,
      service_region: createRegion,
      capacity: ep,
      fee_cents: feeCentsFromCalculator(fc, me, ep),
      admin_fee_cents: Math.round(me * 100),
      location_private,
      run_type: createRunType,
    });
    if (!r.ok) {
      setCreateBusy(false);
      Alert.alert("Could not create run", r.error);
      return;
    }

    console.log("[admin] create success, switching tab");
    setWorkflowOverride("planning");
    console.log("[admin] workflow tab set to planning");
    await loadRuns();
    const newRunId = r.data?.run?.id ? String(r.data.run.id) : null;
    if (newRunId) {
      setDetailRunId(newRunId);
      setDetailOpen(true);
    }
    setCreateBusy(false);
    void hapticGoal();
    setCreateOpen(false);
    setCreateStartAt("");
    setCreateVenue("");
    setCreateFieldCost("");
    setCreateEarnings("0");
    setCreateCapacity("24");
  }

  const detailRun = detail?.run && typeof detail.run === "object" ? (detail.run as Record<string, unknown>) : null;
  const confirmedRoster = Array.isArray(detail?.confirmed) ? detail!.confirmed : [];
  const pendingInvites = useMemo(() => {
    if (!detail) return [];
    const invites = Array.isArray(detail.invites) ? detail.invites : [];
    const availability = Array.isArray(detail.availability) ? detail.availability : [];
    const nameByUser = new Map<string, string>();
    for (const row of availability) {
      const uid = s((row as Record<string, unknown>).user_id);
      const name = s((row as Record<string, unknown>).full_name).trim();
      if (uid && name) nameByUser.set(uid, name);
    }
    return invites.map((inv) => {
      const uid = s((inv as Record<string, unknown>).user_id);
      return {
        id: uid || s((inv as Record<string, unknown>).id),
        name: nameByUser.get(uid) || "Invited player",
      };
    });
  }, [detail]);

  async function refreshDetailAndList() {
    await loadRuns();
    if (detailOpen && detailRunId) await loadDetail();
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}
        refreshControl={<RefreshControl refreshing={listLoading} onRefresh={() => void loadRuns()} tintColor={LIME} />}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.headerRow}>
          <Text style={styles.h1}>Pickup ops</Text>
          <Pressable
            onPress={() => {
              void hapticTap();
              void loadRuns();
            }}
            style={({ pressed }) => [styles.refreshBtn, pressed && { opacity: 0.85 }]}
          >
            <FontAwesome name="refresh" size={14} color={LIME} />
            <Text style={styles.refreshText}>Refresh</Text>
          </Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toolbar}>
          <Pressable
            onPress={() => router.push("/admin/analytics")}
            style={({ pressed }) => [styles.toolChip, pressed && { opacity: 0.9 }]}
          >
            <Text style={styles.toolChipText}>Analytics</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push("/admin/database")}
            style={({ pressed }) => [styles.toolChip, pressed && { opacity: 0.9 }]}
          >
            <Text style={styles.toolChipText}>Database</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push("/admin/tier-suggestions")}
            style={({ pressed }) => [styles.toolChip, pressed && { opacity: 0.9 }]}
          >
            <Text style={styles.toolChipText}>Tier Suggestions</Text>
            {tierBadge > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{tierBadge > 99 ? "99+" : tierBadge}</Text>
              </View>
            ) : null}
          </Pressable>
        </ScrollView>

        <View style={styles.tabRow}>
          {(
            [
              ["planning", "Planning"],
              ["active", "Active"],
              ["past", "Past"],
            ] as const
          ).map(([key, label]) => {
            const active = workflowTab === key;
            const n = workflowCounts[key];
            return (
              <Pressable
                key={key}
                onPress={() => {
                  void hapticTap();
                  setWorkflowOverride(key);
                }}
                style={({ pressed }) => [styles.tab, active && styles.tabActive, pressed && { opacity: 0.9 }]}
              >
                <Text style={[styles.tabText, active && styles.tabTextActive]}>
                  {label} ({n})
                </Text>
              </Pressable>
            );
          })}
        </View>

        {listError ? <Text style={styles.err}>{listError}</Text> : null}

        {listLoading && runs.length === 0 ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : null}

        {!listLoading && filteredRuns.length === 0 && !listError ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No runs here</Text>
            <Text style={styles.emptyBody}>
              {runs.length === 0 ? "No runs yet. Tap + to schedule one." : "Try another workflow tab."}
            </Text>
          </View>
        ) : null}

        {filteredRuns.map((row) => {
          const id = s(row.id);
          if (!id) return null;
          const lc = listCounts(row);
          const typeLabel = isPublicPickupRunType(row.run_type) ? "PUBLIC" : "SELECT";
          const stage = derivePickupLifecycleStage({
            status: s(row.status),
            is_current: row.is_current === true,
            outreach_started_at: s(row.outreach_started_at) || null,
            is_completed: row.is_completed === true,
            has_result: row.has_result === true,
          });
          const showInvite = showInvitePlayersButton({
            status: s(row.status),
            run_type: row.run_type,
            is_completed: row.is_completed === true,
          });

          return (
            <Pressable
              key={id}
              onPress={() => openDetail(id)}
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.92 }]}
            >
              <View style={styles.cardTop}>
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {s(row.title).trim() || "Pickup run"}
                </Text>
                <View style={styles.typeBadge}>
                  <Text style={styles.typeBadgeText}>{typeLabel}</Text>
                </View>
              </View>
              <Text style={styles.cardEt}>{fmtPickupDtEt(s(row.start_at))}</Text>
              <Text style={styles.cardVenue} numberOfLines={2}>
                {venueLine(row)}
              </Text>
              <Text style={styles.cardMeta}>
                {lc.confirmed}/{lc.capacity || "—"} confirmed
              </Text>
              <View style={styles.statusBadge}>
                <Text style={styles.statusBadgeText}>{pickupLifecycleStageLabel(stage)}</Text>
              </View>
              {showInvite ? (
                <Pressable
                  onPress={(e) => {
                    e.stopPropagation();
                    void hapticTap();
                    router.push(`/admin/invite-players?run_id=${encodeURIComponent(id)}`);
                  }}
                  style={({ pressed }) => [styles.inviteBtn, pressed && { opacity: 0.9 }]}
                >
                  <Text style={styles.inviteBtnText}>Invite Players</Text>
                </Pressable>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>

      <Pressable
        onPress={() => {
          void hapticTap();
          setCreateOpen(true);
        }}
        style={({ pressed }) => [
          styles.fab,
          { bottom: insets.bottom + 20 },
          pressed && { opacity: 0.9 },
        ]}
      >
        <FontAwesome name="plus" size={22} color="#111" />
      </Pressable>

      {/* Create run sheet */}
      <Modal visible={createOpen} animationType="slide" transparent onRequestClose={() => setCreateOpen(false)}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Pressable style={styles.modalBackdrop} onPress={() => setCreateOpen(false)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.sheetTitle}>New run</Text>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.label}>Run type</Text>
              <View style={styles.typeToggleRow}>
                {(["public", "select"] as const).map((t) => {
                  const active = createRunType === t;
                  return (
                    <Pressable
                      key={t}
                      onPress={() => {
                        void hapticTap();
                        setCreateRunType(t);
                      }}
                      style={({ pressed }) => [
                        styles.typeToggle,
                        active && styles.typeToggleActive,
                        pressed && { opacity: 0.9 },
                      ]}
                    >
                      <Text style={[styles.typeToggleText, active && styles.typeToggleTextActive]}>
                        {t === "public" ? "PUBLIC" : "SELECT"}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <AdminVenuePicker label="Venue" value={createVenue} onChange={onVenueChange} />
              <DateTimePicker
                label="Date & time (ET)"
                value={createStartAt}
                onChange={setCreateStartAt}
                enforceFuture
                prominent
              />

              <Text style={styles.label}>Capacity</Text>
              <TextInput
                style={styles.input}
                value={createCapacity}
                onChangeText={setCreateCapacity}
                keyboardType="number-pad"
                placeholder="24"
                placeholderTextColor="rgba(255,255,255,0.35)"
              />

              <Text style={styles.label}>Field cost ($)</Text>
              <TextInput
                style={styles.input}
                value={createFieldCost}
                onChangeText={setCreateFieldCost}
                keyboardType="decimal-pad"
                placeholder="Auto-fills from venue"
                placeholderTextColor="rgba(255,255,255,0.35)"
              />

              <Text style={styles.label}>My earnings ($)</Text>
              <TextInput
                style={styles.input}
                value={createEarnings}
                onChangeText={setCreateEarnings}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor="rgba(255,255,255,0.35)"
              />

              <View style={styles.previewBox}>
                <Text style={styles.previewLabel}>Each player pays:</Text>
                <Text style={styles.previewValue}>{feePreview ?? "—"}</Text>
              </View>

              <Pressable
                disabled={createBusy}
                onPress={() => void onCreateRun()}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  createBusy && styles.primaryBtnDisabled,
                  pressed && !createBusy && { opacity: 0.9 },
                ]}
              >
                <Text style={styles.primaryBtnText}>{createBusy ? "Creating…" : "Create run"}</Text>
              </Pressable>
              <Pressable onPress={() => setCreateOpen(false)} style={styles.cancelLink}>
                <Text style={styles.cancelLinkText}>Cancel</Text>
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Detail sheet */}
      <Modal visible={detailOpen} animationType="slide" transparent onRequestClose={closeDetail}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={closeDetail} />
          <View style={[styles.sheet, styles.detailSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Run details</Text>
              <Pressable onPress={closeDetail} hitSlop={12}>
                <FontAwesome name="times" size={20} color="#fff" />
              </Pressable>
            </View>

            {detailLoading ? (
              <SkeletonCard />
            ) : detailError ? (
              <Text style={styles.err}>{detailError}</Text>
            ) : detailRun ? (
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.detailTitle}>{s(detailRun.title) || "Pickup run"}</Text>
                <Text style={styles.detailEt}>{fmtPickupDtEt(s(detailRun.start_at))}</Text>
                <Text style={styles.detailVenue}>{venueLine(detailRun)}</Text>
                <Text style={styles.detailMeta}>
                  {isPublicPickupRunType(detailRun.run_type) ? "Public" : "Select"} · Cap{" "}
                  {s(detailRun.capacity)} · Fee ${((Number(detailRun.fee_cents ?? 0) || 0) / 100).toFixed(2)}/player
                </Text>
                <Text style={styles.detailMeta}>Status: {s(detailRun.status)}</Text>

                <Text style={styles.rosterHeading}>Roster ({confirmedRoster.length} confirmed)</Text>
                {confirmedRoster.length === 0 ? (
                  <Text style={styles.rosterEmpty}>No confirmed players yet.</Text>
                ) : (
                  confirmedRoster.map((p) => (
                    <Text key={p.id} style={styles.rosterRow}>
                      {p.full_name?.trim() || "Player"}
                      {p.playing_position ? ` · ${p.playing_position}` : ""}
                    </Text>
                  ))
                )}

                {!isPublicPickupRunType(detailRun.run_type) && pendingInvites.length > 0 ? (
                  <>
                    <Text style={styles.rosterHeading}>Pending invites ({pendingInvites.length})</Text>
                    {pendingInvites.map((p) => (
                      <Text key={p.id} style={styles.rosterRowMuted}>
                        {p.name}
                      </Text>
                    ))}
                  </>
                ) : null}

                {detail ? (
                  <AdminRunDetailLifecycle
                    token={token}
                    run={detailRun}
                    detail={detail}
                    router={router}
                    actionBusy={actionBusy}
                    setActionBusy={setActionBusy}
                    onRefresh={refreshDetailAndList}
                    onCloseDetail={closeDetail}
                  />
                ) : null}
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  content: { paddingHorizontal: 16, paddingTop: 8 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  h1: { fontSize: 26, fontWeight: "800", color: "#fff" },
  refreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
  },
  refreshText: { color: LIME, fontWeight: "700", fontSize: 13 },
  toolbar: { flexDirection: "row", gap: 8, marginBottom: 14 },
  toolChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  toolChipText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  badge: {
    marginLeft: 6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: LIME,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeText: { color: "#111", fontSize: 10, fontWeight: "800" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  chipActive: { borderColor: "rgba(163,230,53,0.5)", backgroundColor: "rgba(163,230,53,0.1)" },
  chipText: { color: "rgba(255,255,255,0.65)", fontWeight: "700" },
  chipTextActive: { color: LIME },
  tabRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
  },
  tabActive: { borderColor: "rgba(163,230,53,0.45)", backgroundColor: "rgba(163,230,53,0.08)" },
  tabText: { color: "rgba(255,255,255,0.55)", fontWeight: "700", fontSize: 12 },
  tabTextActive: { color: LIME },
  err: { color: "#fca5a5", marginBottom: 12, lineHeight: 20 },
  empty: {
    padding: 20,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.03)",
    marginBottom: 12,
  },
  emptyTitle: { color: "#fff", fontWeight: "800", fontSize: 16 },
  emptyBody: { color: "rgba(255,255,255,0.55)", marginTop: 6, lineHeight: 20 },
  card: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.03)",
    marginBottom: 12,
  },
  cardTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  cardTitle: { flex: 1, color: "#fff", fontSize: 17, fontWeight: "800" },
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "rgba(163,230,53,0.15)",
  },
  typeBadgeText: { color: LIME, fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  cardEt: { color: LIME, fontSize: 15, fontWeight: "700", marginTop: 10 },
  cardVenue: { color: "rgba(255,255,255,0.75)", marginTop: 6, lineHeight: 20 },
  cardMeta: { color: "rgba(255,255,255,0.5)", marginTop: 8, fontSize: 13 },
  statusBadge: {
    alignSelf: "flex-start",
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  statusBadgeText: { color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: "700" },
  inviteBtn: {
    marginTop: 12,
    backgroundColor: LIME,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  inviteBtnText: { color: "#111", fontWeight: "800", fontSize: 14 },
  skeletonCard: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.03)",
    marginBottom: 12,
  },
  skeletonLine: { height: 14, borderRadius: 6, backgroundColor: "rgba(255,255,255,0.08)" },
  fab: {
    position: "absolute",
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: LIME,
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.65)" },
  sheet: {
    maxHeight: "92%",
    backgroundColor: "#111",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  detailSheet: { minHeight: "50%" },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  sheetTitle: { color: "#fff", fontSize: 20, fontWeight: "800" },
  label: { color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: "700", textTransform: "uppercase", marginTop: 12, marginBottom: 6 },
  typeToggleRow: { flexDirection: "row", gap: 10 },
  typeToggle: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
  },
  typeToggleActive: { borderColor: LIME, backgroundColor: "rgba(163,230,53,0.1)" },
  typeToggleText: { color: "rgba(255,255,255,0.55)", fontWeight: "800", fontSize: 15 },
  typeToggleTextActive: { color: LIME },
  input: {
    backgroundColor: "#1a1a1a",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    padding: 12,
    color: "#fff",
    fontSize: 16,
  },
  previewBox: {
    marginTop: 16,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
    backgroundColor: "rgba(163,230,53,0.08)",
  },
  previewLabel: { color: "rgba(255,255,255,0.55)", fontSize: 13 },
  previewValue: { color: LIME, fontSize: 22, fontWeight: "800", marginTop: 4 },
  primaryBtn: {
    marginTop: 20,
    backgroundColor: LIME,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText: { color: "#111", fontWeight: "800", fontSize: 16 },
  cancelLink: { alignItems: "center", marginTop: 12, paddingVertical: 8 },
  cancelLinkText: { color: "rgba(255,255,255,0.45)", fontSize: 14 },
  detailTitle: { color: "#fff", fontSize: 20, fontWeight: "800" },
  detailEt: { color: LIME, fontSize: 16, fontWeight: "700", marginTop: 8 },
  detailVenue: { color: "rgba(255,255,255,0.75)", marginTop: 8, lineHeight: 22 },
  detailMeta: { color: "rgba(255,255,255,0.5)", marginTop: 6, fontSize: 13 },
  rosterHeading: { color: "#fff", fontWeight: "800", marginTop: 20, marginBottom: 8 },
  rosterEmpty: { color: "rgba(255,255,255,0.45)", fontStyle: "italic" },
  rosterRow: { color: "rgba(255,255,255,0.8)", paddingVertical: 6, fontSize: 15 },
  rosterRowMuted: { color: "rgba(255,255,255,0.5)", paddingVertical: 6, fontSize: 14 },
});
