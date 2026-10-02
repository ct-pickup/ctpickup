import AdminVenuePicker from "@/components/AdminVenuePicker";
import DateTimePicker, { formatDateTimePickerEtLabel, isScheduleWallMidnightEt } from "@/components/DateTimePicker";
import { useAdminOutdoorTournaments } from "@/hooks/useAdminOutdoorTournaments";
import {
  deleteAdminTournament,
  postAdminSetHubTournament,
  postAdminTournaments,
  type AdminOutdoorTournament,
  type TourneySubmissionRow,
} from "@/lib/adminApi";
import { useAuth } from "@/context/AuthContext";
import { getMobileSupabaseClient } from "@/lib/supabase";
import {
  CUSTOM_VENUE_OPTION,
  serviceRegionForAdminVenueName,
  serviceRegionFromAddress,
} from "@/lib/adminCtPickupVenues";
import { SERVICE_REGIONS, type ServiceRegionCode } from "@/lib/serviceRegions";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { themeColor, useThemedStyles } from "@/theme";
const DECISIONS = ["pending", "confirmed", "standby", "rejected"] as const;
type Decision = (typeof DECISIONS)[number];

function s(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return "—";
  }
}

function slugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function fmtMeta(t: AdminOutdoorTournament): string {
  const bits: string[] = [];
  if (t.service_region) bits.push(String(t.service_region));
  else bits.push("legacy hub");
  if (t.target_teams != null) bits.push(`target ${t.target_teams}`);
  if (t.official_threshold != null) bits.push(`official ≥${t.official_threshold}`);
  if (t.max_teams != null) bits.push(`max ${t.max_teams}`);
  return bits.length ? bits.join(" · ") : "—";
}

function displaySubmissionName(row: TourneySubmissionRow): string {
  const a = String(row.first_name ?? "").trim();
  const b = String(row.last_name ?? "").trim();
  const joined = [a, b].filter(Boolean).join(" ");
  if (joined) return joined;
  const m =
    row.meta && typeof row.meta === "object" && row.meta !== null
      ? (row.meta as Record<string, unknown>)
      : null;
  const legacy = String(m?.intake_full_name ?? m?.full_name ?? "").trim();
  return legacy || "—";
}

function statusBadgeStyle(status: string) {
  const st = status.toLowerCase();
  if (st.includes("paid") || st.includes("verified")) return styles.badgeOk;
  if (st.includes("pending") || st.includes("submitted")) return styles.badgeWarn;
  if (st.includes("rejected") || st.includes("canceled")) return styles.badgeBad;
  return styles.badgeNeutral;
}

export default function AdminTournamentScreen() {
  useThemedStyles(publish_styles);

  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const token = session?.access_token ?? null;

  const [region, setRegion] = useState<ServiceRegionCode>("CT");
  const [signupFilter, setSignupFilter] = useState<"all" | Decision>("all");
  const submissionDecision = signupFilter === "all" ? undefined : signupFilter;

  const { loading, error, tournaments, activeTournament, captains, submissions, prizePoolCents, panelError, reload } =
    useAdminOutdoorTournaments(region, submissionDecision, true);

  const [busy, setBusy] = useState<string | null>(null);
  const [earlyTermBusy, setEarlyTermBusy] = useState(false);
  const [prizesPaidBusy, setPrizesPaidBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const [createTitle, setCreateTitle] = useState("");
  const [createTarget, setCreateTarget] = useState("12");
  const [createOfficial, setCreateOfficial] = useState("8");
  const [createMax, setCreateMax] = useState("12");
  const [createServiceRegion, setCreateServiceRegion] = useState<ServiceRegionCode>("CT");
  const [createStartAt, setCreateStartAt] = useState("");
  const [createDeadline, setCreateDeadline] = useState("");
  const [createVenue, setCreateVenue] = useState("");
  const [createCustomVenueName, setCreateCustomVenueName] = useState("");
  const [createCustomVenueAddress, setCreateCustomVenueAddress] = useState("");
  const [createCustomVenueZip, setCreateCustomVenueZip] = useState("");
  const [createRegionOverride, setCreateRegionOverride] = useState<ServiceRegionCode | null>(null);
  const [createFormat, setCreateFormat] = useState("Group stage → knockout");
  const [createEntryFee, setCreateEntryFee] = useState("250");
  const [createMinRoster, setCreateMinRoster] = useState("5");

  const [listTab, setListTab] = useState<"all" | "upcoming" | "active" | "past">("active");

  const isCreateCustomVenue = createVenue === CUSTOM_VENUE_OPTION;

  const createRegionFromAddress = useMemo(
    () => (isCreateCustomVenue ? serviceRegionFromAddress(createCustomVenueAddress) : null),
    [isCreateCustomVenue, createCustomVenueAddress],
  );

  const showCreateRegionPicker = isCreateCustomVenue && !createRegionFromAddress;

  const createRegion = useMemo((): ServiceRegionCode => {
    if (isCreateCustomVenue) {
      return createRegionFromAddress ?? createRegionOverride ?? "CT";
    }
    return serviceRegionForAdminVenueName(createVenue) ?? createServiceRegion;
  }, [
    isCreateCustomVenue,
    createVenue,
    createRegionFromAddress,
    createRegionOverride,
    createServiceRegion,
  ]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  }, [reload]);

  const [drafts, setDrafts] = useState<
    Record<string, { decision: Decision; notes: string; reviewed: boolean }>
  >({});

  useEffect(() => {
    const supabase = getMobileSupabaseClient();
    if (!supabase) return;
    const channel = supabase
      .channel("admin-tournaments")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tournaments" },
        () => {
          void reload();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [region, reload]);

  useEffect(() => {
    const next: Record<string, { decision: Decision; notes: string; reviewed: boolean }> = {};
    for (const row of submissions) {
      const raw = String(row.decision || "pending").toLowerCase();
      const safeDecision: Decision = (DECISIONS as readonly string[]).includes(raw) ? (raw as Decision) : "pending";
      next[row.id] = {
        decision: safeDecision,
        notes: row.notes ?? "",
        reviewed: !!row.reviewed,
      };
    }
    setDrafts(next);
  }, [submissions]);

  const hasLive = useMemo(() => tournaments.some((t) => t.is_active), [tournaments]);

  const filteredTournaments = useMemo(() => {
    const now = Date.now();
    return tournaments.filter((row) => {
      const startRaw = row.start_at ?? null;
      const startMs = startRaw ? new Date(String(startRaw)).getTime() : NaN;
      const createdMs = row.created_at ? new Date(String(row.created_at)).getTime() : 0;
      const anchor = Number.isFinite(startMs) ? startMs : createdMs;
      if (listTab === "active") return !!row.is_active;
      if (listTab === "upcoming") return !row.is_active && anchor >= now;
      if (listTab === "past") return !row.is_active && anchor > 0 && anchor < now;
      return true;
    });
  }, [tournaments, listTab]);

  const activeTitle = activeTournament ? s(activeTournament.title) : "";
  const activeTournamentId = activeTournament ? s(activeTournament.id) : null;
  const earlyTermination = activeTournament ? !!activeTournament.early_termination : false;
  const prizesPaidAt = activeTournament ? (activeTournament.prizes_paid_at as string | null | undefined) ?? null : null;

  function fmtDollars(cents: number | null): string {
    if (cents == null) return "—";
    return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  async function setEarlyTermination(value: boolean) {
    if (!token || !activeTournamentId) return Alert.alert("No active tournament");
    setEarlyTermBusy(true);
    const r = await postAdminTournaments(token, {
      action: "set_early_termination",
      tournament_id: activeTournamentId,
      early_termination: value,
    });
    setEarlyTermBusy(false);
    if (!r.ok) return Alert.alert("Update failed", r.error);
    reload();
  }

  async function markPrizesPaid() {
    if (!token || !activeTournamentId) return Alert.alert("No active tournament");
    setPrizesPaidBusy(true);
    const r = await postAdminTournaments(token, {
      action: "mark_prizes_paid",
      tournament_id: activeTournamentId,
    });
    setPrizesPaidBusy(false);
    if (!r.ok) return Alert.alert("Error", r.error);
    reload();
    Alert.alert("Recorded", "Cash payout marked as complete.");
  }

  async function setHub(tournamentId: string | null) {
    if (!token) return Alert.alert("Not signed in", "Sign in again.");
    const key = tournamentId ? `hub:${tournamentId}` : "hub:clear";
    setBusy(key);
    const r = await postAdminSetHubTournament(token, tournamentId);
    setBusy(null);
    if (!r.ok) return Alert.alert("Update failed", r.error);
    reload();
    Alert.alert(
      tournamentId ? "Live" : "Offline",
      tournamentId ? "This tournament is now live on the public tournament hub." : "No tournament is live on the hub.",
    );
  }

  async function approveCaptainClaim(captainId: string) {
    if (!token) return Alert.alert("Not signed in", "Sign in again.");
    setBusy(`ap:${captainId}`);
    const r = await postAdminTournaments(token, { action: "approve_captain_claim", captain_id: captainId });
    setBusy(null);
    if (!r.ok) return Alert.alert("Approve failed", r.error);
    reload();
    Alert.alert("Approved", "Captain can complete Stripe checkout.");
  }

  async function rejectCaptainClaim(captainId: string) {
    if (!token) return Alert.alert("Not signed in", "Sign in again.");
    setBusy(`rj:${captainId}`);
    const r = await postAdminTournaments(token, { action: "reject_captain_claim", captain_id: captainId });
    setBusy(null);
    if (!r.ok) return Alert.alert("Reject failed", r.error);
    reload();
  }

  async function cancelTournamentById(tournamentId: string, title: string) {
    if (!token) return Alert.alert("Not signed in", "Sign in again.");
    setBusy(`cx:${tournamentId}`);
    const r = await postAdminTournaments(token, { action: "cancel_tournament", tournament_id: tournamentId });
    setBusy(null);
    if (!r.ok) return Alert.alert("Cancel failed", r.error);
    reload();
    Alert.alert("Canceled", `Refunds processed where possible for “${title}”.`);
  }

  async function deleteTournament(id: string) {
    if (!token) return Alert.alert("Not signed in", "Sign in again.");
    setBusy(`del:${id}`);
    const r = await deleteAdminTournament(token, id);
    setBusy(null);
    if (!r.ok) return Alert.alert("Delete failed", r.error);
    reload();
  }

  const setDraft = useCallback((id: string, patch: Partial<{ decision: Decision; notes: string; reviewed: boolean }>) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: {
        decision: patch.decision ?? prev[id]?.decision ?? "pending",
        notes: patch.notes !== undefined ? patch.notes : (prev[id]?.notes ?? ""),
        reviewed: patch.reviewed !== undefined ? patch.reviewed : (prev[id]?.reviewed ?? false),
      },
    }));
  }, []);

  async function saveSubmission(id: string) {
    if (!token) return Alert.alert("Not signed in", "Sign in again.");
    const d = drafts[id];
    if (!d) return;
    setBusy(`sub:${id}`);
    const r = await postAdminTournaments(token, {
      action: "update_submission",
      submission_id: id,
      decision: d.decision,
      notes: d.notes,
      reviewed: d.reviewed,
    });
    setBusy(null);
    if (!r.ok) return Alert.alert("Save failed", r.error);
    reload();
  }

  async function onCreateTournament() {
    if (!token) return Alert.alert("Not signed in", "Sign in again.");
    const title = createTitle.trim();
    if (title.length < 2) return Alert.alert("Title required", "Enter at least 2 characters.");
    const target_teams = Number(createTarget);
    const official_threshold = Number(createOfficial);
    const max_teams = Number(createMax);
    if (!Number.isFinite(target_teams) || target_teams < 1) return Alert.alert("Invalid", "Target teams must be ≥ 1.");
    if (!Number.isFinite(official_threshold) || official_threshold < 1)
      return Alert.alert("Invalid", "Official threshold must be ≥ 1.");
    if (!Number.isFinite(max_teams) || max_teams < 8 || max_teams > 12) return Alert.alert("Invalid", "Max teams must be 8–12.");

    const startTrim = createStartAt.trim();
    const deadlineTrim = createDeadline.trim();
    if (startTrim && isScheduleWallMidnightEt(startTrim)) {
      return Alert.alert("Please select a time for the run");
    }
    if (deadlineTrim && isScheduleWallMidnightEt(deadlineTrim)) {
      return Alert.alert("Please select a time for the run");
    }

    let venueLabel = createVenue.trim();
    let venue_zip_code: string | undefined;
    if (isCreateCustomVenue) {
      const customName = createCustomVenueName.trim();
      const customAddress = createCustomVenueAddress.trim();
      if (!customName) return Alert.alert("Venue name", "Enter a name for the custom venue.");
      if (!customAddress) return Alert.alert("Venue address", "Enter the full address for the custom venue.");
      const customZip = createCustomVenueZip.replace(/\D/g, "").slice(0, 5);
      if (customZip.length !== 5) {
        return Alert.alert("Venue ZIP code", "Enter a 5-digit US ZIP code for the custom venue.");
      }
      if (!createRegionFromAddress && !createRegionOverride) {
        return Alert.alert(
          "Pick a region",
          "Could not detect NY, CT, NJ, or MD from the address. Select a service region.",
        );
      }
      venueLabel = customName;
      venue_zip_code = customZip;
    } else if (!venueLabel) {
      return Alert.alert("Pick a venue", "Select a venue from the list.");
    }

    setBusy("create");
    const entryCents = Number(createEntryFee) * 100;
    const minR = Number(createMinRoster);
    const slug = slugFromTitle(title);
    try {
      const r = await postAdminTournaments(token, {
        action: "create",
        title,
        slug: slug || undefined,
        target_teams,
        official_threshold,
        max_teams,
        service_region: createRegion,
        start_at: startTrim || undefined,
        registration_deadline: deadlineTrim || undefined,
        venue: venueLabel || undefined,
        ...(venue_zip_code ? { venue_zip_code } : {}),
        format_summary: createFormat.trim() || undefined,
        entry_fee_cents: Number.isFinite(entryCents) && entryCents > 0 ? Math.floor(entryCents) : undefined,
        min_roster_players: Number.isFinite(minR) && minR >= 1 ? Math.floor(minR) : undefined,
      });
      if (!r.ok) return Alert.alert("Create failed", r.error);
      setCreateTitle("");
      setCreateTarget("12");
      setCreateOfficial("8");
      setCreateMax("12");
      setCreateServiceRegion("CT");
      setCreateStartAt("");
      setCreateDeadline("");
      setCreateVenue("");
      setCreateCustomVenueName("");
      setCreateCustomVenueAddress("");
      setCreateCustomVenueZip("");
      setCreateRegionOverride(null);
      setCreateFormat("Group stage → knockout");
      setCreateEntryFee("250");
      setCreateMinRoster("5");
      setRegion(createServiceRegion);
      setListTab("all");
      setCreateModalOpen(false);
      await reload();
      Alert.alert("Created", "Tournament draft saved. Make it live from the list when ready.");
    } catch (e) {
      console.warn("[onCreateTournament] failed", e);
      Alert.alert("Something went wrong", "Please try again.");
    } finally {
      setBusy(null);
    }
  }

  const listTabs = ["active", "upcoming", "past", "all"] as const;

  const createForm = (
    <>
      <Text style={styles.label}>Title</Text>
      <TextInput
        style={styles.input}
        value={createTitle}
        onChangeText={setCreateTitle}
        placeholder="Spring invitational"
        placeholderTextColor={themeColor().muted}
      />
      <View style={styles.twoCol}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Target teams</Text>
          <TextInput
            style={styles.input}
            value={createTarget}
            onChangeText={setCreateTarget}
            keyboardType="number-pad"
            placeholderTextColor={themeColor().muted}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Official threshold</Text>
          <TextInput
            style={styles.input}
            value={createOfficial}
            onChangeText={setCreateOfficial}
            keyboardType="number-pad"
            placeholderTextColor={themeColor().muted}
          />
        </View>
      </View>
      <Text style={styles.label}>Max teams</Text>
      <TextInput
        style={styles.input}
        value={createMax}
        onChangeText={setCreateMax}
        keyboardType="number-pad"
        placeholderTextColor={themeColor().muted}
      />
      <AdminVenuePicker
        value={createVenue}
        onChange={(name) => {
          setCreateVenue(name);
          if (name === CUSTOM_VENUE_OPTION) {
            setCreateCustomVenueName("");
            setCreateCustomVenueAddress("");
            setCreateCustomVenueZip("");
            setCreateRegionOverride(null);
            return;
          }
          setCreateCustomVenueName("");
          setCreateCustomVenueAddress("");
          setCreateCustomVenueZip("");
          setCreateRegionOverride(null);
          const regionCode = serviceRegionForAdminVenueName(name);
          if (regionCode) setCreateServiceRegion(regionCode);
        }}
      />
      {isCreateCustomVenue ? (
        <>
          <Text style={styles.label}>Venue name</Text>
          <TextInput
            style={styles.input}
            value={createCustomVenueName}
            onChangeText={setCreateCustomVenueName}
            placeholder="Venue name e.g. Chelsea Piers"
            placeholderTextColor={themeColor().muted}
          />
          <Text style={styles.label}>Venue address</Text>
          <TextInput
            style={styles.input}
            value={createCustomVenueAddress}
            onChangeText={(text) => {
              setCreateCustomVenueAddress(text);
              if (serviceRegionFromAddress(text)) setCreateRegionOverride(null);
            }}
            placeholder="Full address e.g. 62 Chelsea Piers, New York, NY"
            placeholderTextColor={themeColor().muted}
            multiline
          />
          <Text style={styles.label}>Venue ZIP code</Text>
          <TextInput
            style={styles.input}
            value={createCustomVenueZip}
            onChangeText={(text) => setCreateCustomVenueZip(text.replace(/\D/g, "").slice(0, 5))}
            placeholder="e.g. 10011"
            placeholderTextColor={themeColor().muted}
            keyboardType="number-pad"
            maxLength={5}
          />
          {showCreateRegionPicker ? (
            <>
              <Text style={styles.label}>Service region</Text>
              <View style={styles.regionChipRow}>
                {SERVICE_REGIONS.map(({ code }) => {
                  const active = createRegionOverride === code;
                  return (
                    <Pressable
                      key={code}
                      onPress={() => setCreateRegionOverride(code)}
                      style={({ pressed }) => [
                        styles.regionChip,
                        active && styles.regionChipActive,
                        pressed && { opacity: 0.9 },
                      ]}
                    >
                      <Text style={[styles.regionChipText, active && styles.regionChipTextActive]}>{code}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : createRegionFromAddress ? (
            <Text style={styles.fieldHint}>Region: {createRegionFromAddress} (from address)</Text>
          ) : null}
        </>
      ) : null}
      <Text style={styles.label}>Format</Text>
      <TextInput
        style={styles.input}
        value={createFormat}
        onChangeText={setCreateFormat}
        placeholder="Group stage → knockout"
        placeholderTextColor={themeColor().muted}
      />
      <View style={styles.twoCol}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Entry fee ($)</Text>
          <TextInput
            style={styles.input}
            value={createEntryFee}
            onChangeText={setCreateEntryFee}
            keyboardType="decimal-pad"
            placeholderTextColor={themeColor().muted}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Min roster</Text>
          <TextInput
            style={styles.input}
            value={createMinRoster}
            onChangeText={setCreateMinRoster}
            keyboardType="number-pad"
            placeholderTextColor={themeColor().muted}
          />
        </View>
      </View>
      <DateTimePicker label="Tournament start (ET)" value={createStartAt} onChange={setCreateStartAt} />
      {createStartAt.trim() ? (
        <Text style={styles.fieldHint}>Selected: {formatDateTimePickerEtLabel(createStartAt.trim())}</Text>
      ) : null}
      <DateTimePicker label="Registration deadline (ET)" value={createDeadline} onChange={setCreateDeadline} />
      {createDeadline.trim() ? (
        <Text style={styles.fieldHint}>Deadline: {formatDateTimePickerEtLabel(createDeadline.trim())}</Text>
      ) : null}
    </>
  );

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { paddingBottom: insets.bottom }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 120 }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={themeColor().pitchText} />}
      >
          <Text style={styles.segmentLabel}>STATE (LIST FILTER)</Text>
          <View style={styles.segmentRow}>
            {SERVICE_REGIONS.map(({ code }) => {
              const active = region === code;
              return (
                <Pressable
                  key={code}
                  onPress={() => setRegion(code)}
                  style={({ pressed }) => [styles.segment, active && styles.segmentActive, pressed && { opacity: 0.9 }]}
                >
                  <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{code}</Text>
                </Pressable>
              );
            })}
          </View>

          {activeTournament ? (
            <View style={styles.liveBanner}>
              <FontAwesome name="star" size={14} color={themeColor().pitchText} />
              <Text style={styles.liveBannerText}>
                Live on hub: <Text style={styles.liveBannerStrong}>{activeTitle || "—"}</Text>
                {activeTournament.service_region ? ` · ${s(activeTournament.service_region)}` : ""}
              </Text>
            </View>
          ) : null}

          {hasLive ? (
            <Pressable
              onPress={() =>
                Alert.alert("Take hub offline?", "Players will not see a live tournament on the public pages.", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Take offline", style: "destructive", onPress: () => void setHub(null) },
                ])
              }
              disabled={busy !== null}
              style={({ pressed }) => [styles.dangerOutline, pressed && { opacity: 0.9 }, busy !== null && styles.disabled]}
            >
              <Text style={styles.dangerOutlineText}>{busy === "hub:clear" ? "Working…" : "Take all offline"}</Text>
            </Pressable>
          ) : null}

          {loading ? <ActivityIndicator color={themeColor().text} style={{ marginTop: 16 }} /> : null}
          {error ? <Text style={styles.err}>{error}</Text> : null}
          {panelError ? <Text style={styles.warn}>{panelError}</Text> : null}

          <Text style={styles.segmentLabel}>TOURNAMENT LIST</Text>
          <View style={styles.listTabBar}>
            {listTabs.map((tab, index) => {
              const active = listTab === tab;
              const isLast = index === listTabs.length - 1;
              return (
                <Pressable
                  key={tab}
                  onPress={() => setListTab(tab)}
                  style={({ pressed }) => [
                    styles.listTabSegment,
                    isLast && styles.listTabSegmentLast,
                    active && styles.listTabSegmentActive,
                    pressed && { opacity: 0.9 },
                  ]}
                >
                  <Text style={[styles.listTabSegmentText, active && styles.listTabSegmentTextActive]}>
                    {tab === "all" ? "All" : tab[0]!.toUpperCase() + tab.slice(1)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {filteredTournaments.length === 0 && !loading ? (
            <Text style={styles.emptyMuted}>No tournaments yet</Text>
          ) : (
          <View style={styles.card}>
            {filteredTournaments.map((t) => {
              const isLive = !!t.is_active;
              const isHubBusy = busy === `hub:${t.id}`;
              const isDelBusy = busy === `del:${t.id}`;
              const isCxBusy = busy === `cx:${t.id}`;
              return (
                <View key={t.id} style={styles.roomRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.roomTitle}>
                      {t.title || "Untitled"}
                      {isLive ? <Text style={styles.liveBadge}> · LIVE</Text> : null}
                    </Text>
                    <Text style={styles.roomSub} numberOfLines={2}>
                      {t.slug || "—"} · {fmtMeta(t)}
                    </Text>
                  </View>
                  <View style={styles.roomActions}>
                    {!isLive ? (
                      <Pressable
                        onPress={() =>
                          Alert.alert("Make live?", `Set “${t.title}” as the only live tournament on the hub?`, [
                            { text: "Cancel", style: "cancel" },
                            { text: "Make live", onPress: () => void setHub(t.id) },
                          ])
                        }
                        disabled={busy !== null}
                        style={({ pressed }) => [
                          styles.smallChip,
                          styles.smallChipPrimary,
                          pressed && { opacity: 0.85 },
                          busy !== null && styles.disabled,
                        ]}
                      >
                        <Text style={styles.smallChipPrimaryText}>{isHubBusy ? "…" : "Make live"}</Text>
                      </Pressable>
                    ) : (
                      <View style={styles.smallChipMuted}>
                        <Text style={styles.smallChipMutedText}>Hub</Text>
                      </View>
                    )}
                    <Pressable
                      onPress={() =>
                        router.push({
                          pathname: "/admin/tournament-bracket",
                          params: { tournament_id: t.id },
                        })
                      }
                      style={({ pressed }) => [
                        styles.smallChip,
                        styles.smallChipPrimary,
                        pressed && { opacity: 0.85 },
                      ]}
                    >
                      <Text style={styles.smallChipPrimaryText}>Bracket</Text>
                    </Pressable>
                    <Pressable
                      onPress={() =>
                        Alert.alert("Cancel tournament?", "Paid captains will be refunded via Stripe when possible.", [
                          { text: "Back", style: "cancel" },
                          {
                            text: "Cancel event",
                            style: "destructive",
                            onPress: () => void cancelTournamentById(t.id, t.title || "Tournament"),
                          },
                        ])
                      }
                      disabled={busy !== null}
                      style={({ pressed }) => [
                        styles.smallChip,
                        styles.smallChipDanger,
                        pressed && { opacity: 0.85 },
                        busy !== null && styles.disabled,
                      ]}
                    >
                      <Text style={styles.smallChipDangerText}>{isCxBusy ? "…" : "Cancel"}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() =>
                        Alert.alert("Delete tournament?", "This cannot be undone.", [
                          { text: "Cancel", style: "cancel" },
                          { text: "Delete", style: "destructive", onPress: () => void deleteTournament(t.id) },
                        ])
                      }
                      disabled={busy !== null}
                      style={({ pressed }) => [
                        styles.smallChip,
                        styles.smallChipDanger,
                        pressed && { opacity: 0.85 },
                        busy !== null && styles.disabled,
                      ]}
                    >
                      <Text style={styles.smallChipDangerText}>{isDelBusy ? "…" : "Delete"}</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
          )}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Captain claims</Text>
            {!activeTournament ? (
              <Text style={styles.emptyMuted}>No active tournament</Text>
            ) : captains.length === 0 ? (
              <Text style={styles.muted}>No captain claims yet.</Text>
            ) : (
              captains.map((c) => (
                <View key={c.id} style={styles.captainRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={styles.captainTop}>
                      <View style={[styles.badge, statusBadgeStyle(c.status)]}>
                        <Text style={styles.badgeText}>{c.status || "—"}</Text>
                      </View>
                    </View>
                    <Text style={styles.captainName}>{c.captain_name || "—"}</Text>
                    <Text style={styles.captainTeam}>{c.team_name || "—"}</Text>
                    <Text style={styles.captainMeta}>
                      IG {c.captain_instagram || "—"} · Roster {typeof c.roster_size === "number" ? c.roster_size : 0} ·
                      Paid headcount {typeof c.players_paid === "number" ? c.players_paid : "—"}
                    </Text>
                    <Text style={styles.captainMeta}>Submitted {fmtDate(c.claim_submitted_at)}</Text>
                    {c.status === "claim_submitted" && !c.captain_verified ? (
                      <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                        <Pressable
                          onPress={() =>
                            Alert.alert("Approve captain?", "They will be able to complete Stripe checkout.", [
                              { text: "Back", style: "cancel" },
                              { text: "Approve", onPress: () => void approveCaptainClaim(c.id) },
                            ])
                          }
                          disabled={busy !== null}
                          style={[styles.smallChip, styles.smallChipPrimary, busy !== null && styles.disabled]}
                        >
                          <Text style={styles.smallChipPrimaryText}>{busy === `ap:${c.id}` ? "…" : "Approve pay"}</Text>
                        </Pressable>
                        <Pressable
                          onPress={() =>
                            Alert.alert("Reject claim?", "They will not be able to pay until they submit again.", [
                              { text: "Back", style: "cancel" },
                              { text: "Reject", style: "destructive", onPress: () => void rejectCaptainClaim(c.id) },
                            ])
                          }
                          disabled={busy !== null}
                          style={[styles.smallChip, styles.smallChipDanger, busy !== null && styles.disabled]}
                        >
                          <Text style={styles.smallChipDangerText}>{busy === `rj:${c.id}` ? "…" : "Reject"}</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                </View>
              ))
            )}
          </View>

          {activeTournament ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Prize Pool</Text>

              <View style={styles.prizeRow}>
                <Text style={styles.prizeLabel}>Total collected</Text>
                <Text style={styles.prizeValue}>{fmtDollars(prizePoolCents)}</Text>
              </View>
              <View style={[styles.prizeRow, styles.prizeRowTotal]}>
                <Text style={styles.prizeLabelBold}>Prize pool</Text>
                <Text style={styles.prizeValueBold}>{fmtDollars(prizePoolCents)}</Text>
              </View>

              <View style={styles.prizeDivider} />

              {!earlyTermination ? (
                <>
                  <Text style={styles.prizeSplitLabel}>Normal completion — 100% to winner</Text>
                  <View style={styles.prizeRow}>
                    <Text style={styles.prizeLabel}>1st place</Text>
                    <Text style={styles.prizeValue}>{fmtDollars(prizePoolCents)}</Text>
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.prizeSplitLabel}>Early termination — 3-way split</Text>
                  <View style={styles.prizeRow}>
                    <Text style={styles.prizeLabel}>1st place (60%)</Text>
                    <Text style={styles.prizeValue}>{fmtDollars(prizePoolCents != null ? Math.floor(prizePoolCents * 0.60) : null)}</Text>
                  </View>
                  <View style={styles.prizeRow}>
                    <Text style={styles.prizeLabel}>2nd place (25%)</Text>
                    <Text style={styles.prizeValue}>{fmtDollars(prizePoolCents != null ? Math.floor(prizePoolCents * 0.25) : null)}</Text>
                  </View>
                  <View style={styles.prizeRow}>
                    <Text style={styles.prizeLabel}>3rd place (15%)</Text>
                    <Text style={styles.prizeValue}>{fmtDollars(prizePoolCents != null ? Math.floor(prizePoolCents * 0.15) : null)}</Text>
                  </View>
                </>
              )}

              <View style={styles.prizeDivider} />

              <Pressable
                onPress={() => {
                  if (earlyTermBusy) return;
                  Alert.alert(
                    earlyTermination ? "Remove early termination?" : "Mark as early termination?",
                    earlyTermination
                      ? "Switch back to 100% payout to winner."
                      : "Switches payout split to 60% / 25% / 15%.",
                    [
                      { text: "Cancel", style: "cancel" },
                      { text: "Confirm", onPress: () => void setEarlyTermination(!earlyTermination) },
                    ],
                  );
                }}
                style={({ pressed }) => [
                  styles.earlyTermToggle,
                  earlyTermination && styles.earlyTermToggleOn,
                  pressed && { opacity: 0.88 },
                  earlyTermBusy && styles.disabled,
                ]}
              >
                <Text style={[styles.earlyTermToggleText, earlyTermination && styles.earlyTermToggleTextOn]}>
                  {earlyTermBusy ? "Updating…" : earlyTermination ? "Early termination: ON" : "Early termination: OFF"}
                </Text>
              </Pressable>

              {prizesPaidAt ? (
                <View style={styles.prizesPaidBanner}>
                  <Text style={styles.prizesPaidText}>
                    Prizes paid (cash) · {new Date(prizesPaidAt).toLocaleString()}
                  </Text>
                </View>
              ) : (
                <Pressable
                  onPress={() =>
                    Alert.alert("Mark prizes paid?", "Records that cash was handed out. Cannot be undone.", [
                      { text: "Cancel", style: "cancel" },
                      { text: "Mark paid", onPress: () => void markPrizesPaid() },
                    ])
                  }
                  disabled={prizesPaidBusy}
                  style={({ pressed }) => [
                    styles.primary,
                    { marginTop: 12 },
                    pressed && { opacity: 0.9 },
                    prizesPaidBusy && styles.disabled,
                  ]}
                >
                  <Text style={styles.primaryText}>{prizesPaidBusy ? "Saving…" : "Mark Prizes Paid (Cash)"}</Text>
                </Pressable>
              )}
            </View>
          ) : null}

          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardTitle}>Tournament signups</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChips} keyboardShouldPersistTaps="handled">
              {(["all", ...DECISIONS] as const).map((f) => {
                const active = signupFilter === f;
                const label = f === "all" ? "All" : f;
                return (
                  <Pressable
                    key={f}
                    onPress={() => setSignupFilter(f)}
                    style={({ pressed }) => [styles.filterChip, active && styles.filterChipActive, pressed && { opacity: 0.9 }]}
                  >
                    <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {submissions.length === 0 ? <Text style={styles.muted}>No signups for this filter.</Text> : null}
            {submissions.map((r) => {
              const d = drafts[r.id] ?? {
                decision: (DECISIONS.includes(r.decision as Decision) ? r.decision : "pending") as Decision,
                notes: r.notes ?? "",
                reviewed: !!r.reviewed,
              };
              const rowBusy = busy === `sub:${r.id}`;
              return (
                <View key={r.id} style={styles.subRow}>
                  <Text style={styles.subName}>{displaySubmissionName(r)}</Text>
                  <Text style={styles.subIg}>{r.instagram || "—"}</Text>
                  <Text style={styles.subDate}>{fmtDate(r.created_at)}</Text>
                  <Text style={styles.label}>Decision</Text>
                  <View style={styles.decisionRow}>
                    {DECISIONS.map((dec) => {
                      const on = d.decision === dec;
                      return (
                        <Pressable
                          key={dec}
                          onPress={() => setDraft(r.id, { decision: dec })}
                          style={({ pressed }) => [
                            styles.decChip,
                            on && styles.decChipActive,
                            pressed && { opacity: 0.9 },
                          ]}
                        >
                          <Text style={[styles.decChipText, on && styles.decChipTextActive]}>{dec}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text style={styles.label}>Notes</Text>
                  <TextInput
                    style={[styles.input, styles.notesInput]}
                    value={d.notes}
                    onChangeText={(t) => setDraft(r.id, { notes: t })}
                    placeholder="Staff notes"
                    placeholderTextColor={themeColor().muted}
                    multiline
                  />
                  <Pressable
                    onPress={() => setDraft(r.id, { reviewed: !d.reviewed })}
                    style={styles.reviewRow}
                  >
                    <View style={[styles.reviewToggle, d.reviewed && styles.reviewToggleOn]}>
                      <Text style={styles.reviewToggleText}>{d.reviewed ? "Reviewed" : "Not reviewed"}</Text>
                    </View>
                  </Pressable>
                  <Pressable
                    onPress={() => void saveSubmission(r.id)}
                    disabled={rowBusy}
                    style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.9 }, rowBusy && styles.disabled]}
                  >
                    <Text style={styles.saveBtnText}>{rowBusy ? "Saving…" : "Save"}</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
      </ScrollView>

      <Pressable
        onPress={() => setCreateModalOpen(true)}
        style={({ pressed }) => [
          styles.fab,
          { bottom: insets.bottom + 24 },
          pressed && { opacity: 0.9 },
        ]}
        accessibilityLabel="Create tournament"
      >
        <FontAwesome name="plus" size={22} color={themeColor().onPitch} />
      </Pressable>

      <Modal
        visible={createModalOpen}
        animationType="slide"
        presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}
        onRequestClose={() => setCreateModalOpen(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalScreen}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View style={[styles.modalHeader, { paddingTop: insets.top + 8 }]}>
            <Text style={styles.modalTitle}>New tournament</Text>
            <Pressable
              onPress={() => setCreateModalOpen(false)}
              hitSlop={12}
              style={({ pressed }) => [styles.modalClose, pressed && { opacity: 0.85 }]}
              accessibilityLabel="Close"
            >
              <FontAwesome name="times" size={22} color={themeColor().text} />
            </Pressable>
          </View>
          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalContent}
            keyboardShouldPersistTaps="handled"
          >
            {createForm}
          </ScrollView>
          <View style={[styles.modalFooter, { paddingBottom: insets.bottom + 16 }]}>
            <Pressable
              onPress={() => void onCreateTournament()}
              disabled={busy === "create"}
              style={({ pressed }) => [styles.primary, pressed && { opacity: 0.9 }, busy === "create" && styles.disabled]}
            >
              <Text style={styles.primaryText}>{busy === "create" ? "Creating…" : "Create draft"}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function make_styles() {
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: themeColor().bg },
  content: { padding: 16, paddingBottom: 48 },
  segmentLabel: { marginTop: 8, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "800", color: themeColor().muted,},
  segmentRow: { marginTop: 8, flexDirection: "row", gap: 8 },
  segment: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().overlaySubtle,
    alignItems: "center",
  },
  segmentActive: { borderColor: themeColor().pitch, backgroundColor: themeColor().pitchPanel },
  segmentText: { color: themeColor().muted, fontWeight: "900", fontSize: 13, fontFamily: "Inter_700Bold" },
  segmentTextActive: { color: themeColor().pitchText },
  listTabBar: {
    marginTop: 8,
    flexDirection: "row",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: themeColor().line,
    overflow: "hidden",
    backgroundColor: themeColor().card,
  },
  listTabSegment: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: themeColor().line,
  },
  listTabSegmentLast: { borderRightWidth: 0 },
  listTabSegmentActive: { backgroundColor: themeColor().pitchPanel },
  listTabSegmentText: { fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "800", color: themeColor().muted },
  listTabSegmentTextActive: { color: themeColor().pitchText },
  emptyMuted: { marginTop: 12, fontSize: 14, fontFamily: "Inter_400Regular", color: themeColor().muted },
  liveBanner: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().pitch,
    backgroundColor: themeColor().pitchPanel,
  },
  liveBannerText: { flex: 1, color: themeColor().onPitchPanel, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  liveBannerStrong: { color: themeColor().text, fontWeight: "800" },
  err: { marginTop: 12, color: themeColor().coralText, fontSize: 14, fontFamily: "Inter_400Regular" },
  warn: { marginTop: 8, color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular" },
  card: {
    marginTop: 12,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().card,
  },
  cardHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardTitle: { fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "800", color: themeColor().text },
  fieldHint: { marginTop: 4, fontSize: 13, fontFamily: "Inter_400Regular", color: themeColor().muted, lineHeight: 18 },
  label: { marginTop: 12, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700", color: themeColor().muted },
  input: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: themeColor().line,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16, fontFamily: "Inter_400Regular",
    color: themeColor().text,
    backgroundColor: themeColor().bg,
  },
  notesInput: { minHeight: 72, textAlignVertical: "top" },
  twoCol: { flexDirection: "row", gap: 12 },
  primary: {
    marginTop: 0,
    backgroundColor: themeColor().pitch,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryText: { color: themeColor().onPitch, fontWeight: "900", fontSize: 16, fontFamily: "Inter_700Bold" },
  roomRow: { marginTop: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  roomActions: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 },
  roomTitle: { color: themeColor().text, fontWeight: "800" },
  liveBadge: { color: themeColor().pitchText, fontWeight: "900" },
  roomSub: { marginTop: 4, color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 16 },
  smallChip: {
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().overlaySubtle,
  },
  smallChipPrimary: {
    borderColor: themeColor().pitch,
    backgroundColor: themeColor().pitchPanel,
  },
  smallChipPrimaryText: { color: themeColor().onPitchPanel, fontWeight: "900", fontSize: 13, fontFamily: "Inter_700Bold" },
  smallChipMuted: {
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().overlaySubtle,
  },
  smallChipMutedText: { color: themeColor().muted, fontWeight: "800", fontSize: 13, fontFamily: "Inter_700Bold" },
  smallChipDanger: {
    borderColor: themeColor().coral,
    backgroundColor: themeColor().overlaySubtle,
  },
  smallChipDangerText: { color: themeColor().coralText, fontWeight: "900", fontSize: 13, fontFamily: "Inter_700Bold" },
  muted: { marginTop: 8, color: themeColor().muted },
  disabled: { opacity: 0.55 },
  dangerOutline: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().coral,
    alignItems: "center",
    backgroundColor: themeColor().overlaySubtle,
  },
  dangerOutlineText: { color: themeColor().coralText, fontWeight: "900", fontSize: 14, fontFamily: "Inter_700Bold" },
  captainRow: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().bg,
  },
  captainTop: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  badge: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  badgeText: { fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "900", color: themeColor().text },
  badgeOk: { borderColor: themeColor().pitch, backgroundColor: themeColor().pitchPanel },
  badgeWarn: { borderColor: themeColor().line, backgroundColor: themeColor().overlaySubtle },
  badgeBad: { borderColor: themeColor().coral, backgroundColor: themeColor().overlaySubtle },
  badgeNeutral: { borderColor: themeColor().line, backgroundColor: themeColor().overlaySubtle },
  captainName: { fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "800", color: themeColor().text },
  captainTeam: { marginTop: 4, fontSize: 14, fontFamily: "Inter_400Regular", color: themeColor().muted },
  captainMeta: { marginTop: 4, fontSize: 13, fontFamily: "Inter_400Regular", color: themeColor().muted },
  filterChips: { flexDirection: "row", gap: 8, paddingVertical: 8 },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().overlaySubtle,
  },
  filterChipActive: { borderColor: themeColor().pitch, backgroundColor: themeColor().pitchPanel },
  filterChipText: { fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "800", color: themeColor().muted, textTransform: "capitalize" },
  filterChipTextActive: { color: themeColor().pitchText },
  subRow: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: themeColor().line,
  },
  subName: { fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "800", color: themeColor().text },
  subIg: { marginTop: 4, fontSize: 14, fontFamily: "Inter_400Regular", color: themeColor().muted },
  subDate: { marginTop: 4, fontSize: 13, fontFamily: "Inter_400Regular", color: themeColor().muted },
  decisionRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 8 },
  decChip: {
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().bg,
  },
  decChipActive: { borderColor: themeColor().pitch, backgroundColor: themeColor().pitchPanel },
  decChipText: { fontSize: 11, fontFamily: "Inter_700Bold", fontWeight: "800", color: themeColor().muted, textTransform: "capitalize" },
  decChipTextActive: { color: themeColor().pitchText },
  reviewRow: { marginTop: 8 },
  reviewToggle: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().bg,
  },
  reviewToggleOn: { borderColor: themeColor().pitch, backgroundColor: themeColor().pitchPanel },
  reviewToggleText: { fontWeight: "800", fontSize: 13, fontFamily: "Inter_700Bold", color: themeColor().text },
  saveBtn: {
    marginTop: 12,
    alignSelf: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: themeColor().pitch,
  },
  saveBtnText: { color: themeColor().onPitch, fontWeight: "900", fontSize: 13, fontFamily: "Inter_700Bold" },
  venueSelectedRow: {
    marginTop: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().pitch,
    backgroundColor: themeColor().pitchPanel,
  },
  venueSelectedText: { color: themeColor().text, fontWeight: "800", fontSize: 16, fontFamily: "Inter_700Bold" },
  venuePlaceholder: { marginTop: 8, fontSize: 14, fontFamily: "Inter_400Regular", color: themeColor().muted },
  venueScroll: { marginTop: 8 },
  venueScrollContent: { flexDirection: "row", alignItems: "stretch", gap: 8, paddingRight: 8 },
  venueChip: {
    maxWidth: 168,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().overlaySubtle,
  },
  venueChipActive: {
    borderColor: themeColor().pitch,
    backgroundColor: themeColor().pitchPanel,
  },
  venueChipText: { fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700", color: themeColor().muted },
  venueChipTextActive: { color: themeColor().pitchText },
  regionChipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  regionChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().overlaySubtle,
  },
  regionChipActive: {
    borderColor: themeColor().pitch,
    backgroundColor: themeColor().pitchPanel,
  },
  regionChipText: { fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "800", color: themeColor().muted },
  regionChipTextActive: { color: themeColor().pitchText },
  fab: {
    position: "absolute",
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 999,
    backgroundColor: themeColor().pitch,
    alignItems: "center",
    justifyContent: "center",
  },
  modalScreen: { flex: 1, backgroundColor: themeColor().bg },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: themeColor().line,
  },
  modalTitle: { fontSize: 20, fontFamily: "InstrumentSerif_400Regular", fontWeight: "800", color: themeColor().text },
  modalClose: { padding: 4 },
  modalScroll: { flex: 1 },
  modalContent: { padding: 16, paddingBottom: 24 },
  modalFooter: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: themeColor().line,
  },
  prizeRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8 },
  prizeRowTotal: { marginTop: 4 },
  prizeLabel: { fontSize: 14, fontFamily: "Inter_400Regular", color: themeColor().muted },
  prizeValue: { fontSize: 14, fontFamily: "Inter_700Bold", color: themeColor().text, fontWeight: "700" },
  prizeLabelBold: { fontSize: 16, fontFamily: "Inter_700Bold", color: themeColor().text, fontWeight: "800" },
  prizeValueBold: { fontSize: 16, fontFamily: "Inter_700Bold", color: themeColor().pitchText, fontWeight: "900" },
  prizeDivider: { marginTop: 12, marginBottom: 4, height: StyleSheet.hairlineWidth, backgroundColor: themeColor().overlay },
  prizeSplitLabel: { marginTop: 8, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700", color: themeColor().muted,},
  earlyTermToggle: {
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().overlaySubtle,
    alignItems: "center",
  },
  earlyTermToggleOn: {
    borderColor: themeColor().line,
    backgroundColor: themeColor().overlaySubtle,
  },
  earlyTermToggleText: { fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "800", color: themeColor().muted },
  earlyTermToggleTextOn: { color: themeColor().muted },
  prizesPaidBanner: {
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: themeColor().pitch,
    backgroundColor: themeColor().pitchPanel,
    alignItems: "center",
  },
  prizesPaidText: { fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700", color: themeColor().pitchText },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}

