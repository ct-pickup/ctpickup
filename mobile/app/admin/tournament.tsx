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
import { SERVICE_REGIONS, serviceRegionName, type ServiceRegionCode } from "@/lib/serviceRegions";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Pressable,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const LIME = "#a3e635";

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
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const token = session?.access_token ?? null;

  const [region, setRegion] = useState<ServiceRegionCode>("CT");
  const [signupFilter, setSignupFilter] = useState<"all" | Decision>("all");
  const submissionDecision = signupFilter === "all" ? undefined : signupFilter;

  const { loading, error, tournaments, activeTournament, captains, submissions, panelError, reload } =
    useAdminOutdoorTournaments(region, submissionDecision, true);

  const [busy, setBusy] = useState<string | null>(null);

  const [createTitle, setCreateTitle] = useState("");
  const [createSlug, setCreateSlug] = useState("");
  const [createTarget, setCreateTarget] = useState("12");
  const [createOfficial, setCreateOfficial] = useState("8");
  const [createMax, setCreateMax] = useState("12");
  const [createRegion, setCreateRegion] = useState<ServiceRegionCode>("CT");
  const [createStartAt, setCreateStartAt] = useState("");
  const [createDeadline, setCreateDeadline] = useState("");
  const [createVenue, setCreateVenue] = useState("");
  const [createFormat, setCreateFormat] = useState("Group stage → knockout");
  const [createEntryFee, setCreateEntryFee] = useState("250");
  const [createMinRoster, setCreateMinRoster] = useState("5");

  const [listTab, setListTab] = useState<"all" | "upcoming" | "active" | "past">("active");

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

    setBusy("create");
    const entryCents = Number(createEntryFee) * 100;
    const minR = Number(createMinRoster);
    try {
      const r = await postAdminTournaments(token, {
        action: "create",
        title,
        slug: createSlug.trim() || undefined,
        target_teams,
        official_threshold,
        max_teams,
        service_region: createRegion,
        start_at: startTrim || undefined,
        registration_deadline: deadlineTrim || undefined,
        venue: createVenue.trim() || undefined,
        format_summary: createFormat.trim() || undefined,
        entry_fee_cents: Number.isFinite(entryCents) && entryCents > 0 ? Math.floor(entryCents) : undefined,
        min_roster_players: Number.isFinite(minR) && minR >= 1 ? Math.floor(minR) : undefined,
      });
      if (!r.ok) return Alert.alert("Create failed", r.error);
      setCreateTitle("");
      setCreateSlug("");
      setCreateTarget("12");
      setCreateOfficial("8");
      setCreateMax("12");
      setCreateStartAt("");
      setCreateDeadline("");
      setCreateVenue("");
      setCreateFormat("Group stage → knockout");
      setCreateEntryFee("250");
      setCreateMinRoster("5");
      setRegion(createRegion);
      setListTab("all");
      setTimeout(() => void reload(), 300);
      Alert.alert("Created", "Tournament draft saved. Make it live from the list when ready.");
    } catch (e) {
      console.warn("[onCreateTournament] failed", e);
      Alert.alert("Something went wrong", "Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { paddingBottom: insets.bottom }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 200 }]} keyboardShouldPersistTaps="handled">
          <View style={styles.rowBetween}>
            <Text style={styles.h1}>Tournaments</Text>
            <Pressable onPress={reload} style={({ pressed }) => [styles.chip, pressed && { opacity: 0.85 }]}>
              <Text style={styles.chipText}>Refresh</Text>
            </Pressable>
          </View>

          <Text style={styles.lead}>
            Outdoor / captain hub same controls as the web admin. Filter drafts by state live hub is one tournament at
            a time.
          </Text>

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
          <Text style={styles.filterHint}>Showing tournaments for {serviceRegionName(region)}.</Text>

          {activeTournament ? (
            <View style={styles.liveBanner}>
              <FontAwesome name="star" size={14} color={LIME} />
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

          {loading ? <ActivityIndicator color="#fff" style={{ marginTop: 16 }} /> : null}
          {error ? <Text style={styles.err}>{error}</Text> : null}
          {panelError ? <Text style={styles.warn}>{panelError}</Text> : null}

          <Text style={styles.segmentLabel}>TOURNAMENT LIST</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterChips}
            keyboardShouldPersistTaps="handled"
          >
            {(["active", "upcoming", "past", "all"] as const).map((tab) => {
              const active = listTab === tab;
              return (
                <Pressable
                  key={tab}
                  onPress={() => setListTab(tab)}
                  style={({ pressed }) => [styles.filterChip, active && styles.filterChipActive, pressed && { opacity: 0.9 }]}
                >
                  <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                    {tab === "all" ? "All" : tab[0]!.toUpperCase() + tab.slice(1)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Tournaments ({filteredTournaments.length})</Text>
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
            {tournaments.length === 0 && !loading ? <Text style={styles.muted}>No tournaments in this state yet.</Text> : null}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Create tournament</Text>
            <Text style={styles.fieldHint}>Creates a draft (not live). Slug is optional we derive from title if empty.</Text>
            <Text style={styles.label}>Title</Text>
            <TextInput
              style={styles.input}
              value={createTitle}
              onChangeText={setCreateTitle}
              placeholder="Spring invitational"
              placeholderTextColor="rgba(255,255,255,0.35)"
            />
            <Text style={styles.label}>URL name (slug)</Text>
            <TextInput
              style={styles.input}
              value={createSlug}
              onChangeText={setCreateSlug}
              placeholder="spring-2026"
              placeholderTextColor="rgba(255,255,255,0.35)"
              autoCapitalize="none"
            />
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
            <View style={styles.twoCol}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Target teams</Text>
                <TextInput
                  style={styles.input}
                  value={createTarget}
                  onChangeText={setCreateTarget}
                  keyboardType="number-pad"
                  placeholderTextColor="rgba(255,255,255,0.35)"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Official threshold</Text>
                <TextInput
                  style={styles.input}
                  value={createOfficial}
                  onChangeText={setCreateOfficial}
                  keyboardType="number-pad"
                  placeholderTextColor="rgba(255,255,255,0.35)"
                />
              </View>
            </View>
            <Text style={styles.label}>Max teams</Text>
            <TextInput
              style={styles.input}
              value={createMax}
              onChangeText={setCreateMax}
              keyboardType="number-pad"
              placeholderTextColor="rgba(255,255,255,0.35)"
            />
            <Text style={styles.label}>Venue</Text>
            <TextInput
              style={styles.input}
              value={createVenue}
              onChangeText={setCreateVenue}
              placeholder="e.g. Hudson Sports Complex"
              placeholderTextColor="rgba(255,255,255,0.35)"
            />
            <Text style={styles.label}>Format</Text>
            <TextInput
              style={styles.input}
              value={createFormat}
              onChangeText={setCreateFormat}
              placeholder="Group stage → knockout"
              placeholderTextColor="rgba(255,255,255,0.35)"
            />
            <View style={styles.twoCol}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Entry fee ($)</Text>
                <TextInput
                  style={styles.input}
                  value={createEntryFee}
                  onChangeText={setCreateEntryFee}
                  keyboardType="decimal-pad"
                  placeholderTextColor="rgba(255,255,255,0.35)"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Min roster</Text>
                <TextInput
                  style={styles.input}
                  value={createMinRoster}
                  onChangeText={setCreateMinRoster}
                  keyboardType="number-pad"
                  placeholderTextColor="rgba(255,255,255,0.35)"
                />
              </View>
            </View>
            <DateTimePicker label="Tournament start (ET)" value={createStartAt} onChange={setCreateStartAt} />
            {createStartAt.trim() ? (
              <Text style={styles.fieldHint}>Selected: {formatDateTimePickerEtLabel(createStartAt.trim())}</Text>
            ) : (
              <Text style={styles.fieldHint}>Pick date and time together — defaults open to tomorrow 8:00 PM ET.</Text>
            )}
            <DateTimePicker label="Registration deadline (ET)" value={createDeadline} onChange={setCreateDeadline} />
            {createDeadline.trim() ? (
              <Text style={styles.fieldHint}>Deadline: {formatDateTimePickerEtLabel(createDeadline.trim())}</Text>
            ) : null}
            <Pressable
              onPress={() => void onCreateTournament()}
              disabled={busy === "create"}
              style={({ pressed }) => [styles.primary, pressed && { opacity: 0.9 }, busy === "create" && styles.disabled]}
            >
              <Text style={styles.primaryText}>{busy === "create" ? "Creating…" : "Create draft"}</Text>
            </Pressable>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Captain claims</Text>
            {!activeTournament ? (
              <Text style={styles.muted}>Make a tournament live to load captain claims for the active hub tournament.</Text>
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
                      <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
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

          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardTitle}>Tournament signups</Text>
            </View>
            <Text style={styles.fieldHint}>Filter affects the list only. Save updates one row at a time.</Text>
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
                    placeholderTextColor="rgba(255,255,255,0.35)"
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
    </KeyboardAvoidingView>
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
  filterHint: { marginTop: 8, fontSize: 12, color: "rgba(255,255,255,0.45)" },
  liveBanner: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.25)",
    backgroundColor: "rgba(163,230,53,0.08)",
  },
  liveBannerText: { flex: 1, color: "rgba(255,255,255,0.75)", fontSize: 13, lineHeight: 18 },
  liveBannerStrong: { color: "#fff", fontWeight: "800" },
  err: { marginTop: 12, color: "#fca5a5", fontSize: 14 },
  warn: { marginTop: 8, color: "#fcd34d", fontSize: 13 },
  card: {
    marginTop: 14,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  cardHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
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
  notesInput: { minHeight: 72, textAlignVertical: "top" },
  twoCol: { flexDirection: "row", gap: 12 },
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
  primary: {
    marginTop: 16,
    backgroundColor: LIME,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryText: { color: "#111", fontWeight: "900", fontSize: 15 },
  roomRow: { marginTop: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  roomActions: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 },
  roomTitle: { color: "#fff", fontWeight: "800" },
  liveBadge: { color: LIME, fontWeight: "900" },
  roomSub: { marginTop: 2, color: "rgba(255,255,255,0.5)", fontSize: 12, lineHeight: 16 },
  smallChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  smallChipPrimary: {
    borderColor: "rgba(163,230,53,0.45)",
    backgroundColor: "rgba(163,230,53,0.12)",
  },
  smallChipPrimaryText: { color: LIME, fontWeight: "900", fontSize: 12 },
  smallChipMuted: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  smallChipMutedText: { color: "rgba(255,255,255,0.45)", fontWeight: "800", fontSize: 12 },
  smallChipDanger: {
    borderColor: "rgba(248,113,113,0.5)",
    backgroundColor: "rgba(248,113,113,0.12)",
  },
  smallChipDangerText: { color: "#fca5a5", fontWeight: "900", fontSize: 12 },
  muted: { marginTop: 10, color: "rgba(255,255,255,0.6)" },
  disabled: { opacity: 0.55 },
  dangerOutline: {
    marginTop: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.45)",
    alignItems: "center",
    backgroundColor: "rgba(248,113,113,0.08)",
  },
  dangerOutlineText: { color: "#fecaca", fontWeight: "900", fontSize: 14 },
  captainRow: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(0,0,0,0.22)",
  },
  captainTop: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  badge: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  badgeText: { fontSize: 10, fontWeight: "900", textTransform: "uppercase", color: "#fff" },
  badgeOk: { borderColor: "rgba(163,230,53,0.4)", backgroundColor: "rgba(163,230,53,0.12)" },
  badgeWarn: { borderColor: "rgba(251,191,36,0.4)", backgroundColor: "rgba(251,191,36,0.1)" },
  badgeBad: { borderColor: "rgba(248,113,113,0.4)", backgroundColor: "rgba(248,113,113,0.1)" },
  badgeNeutral: { borderColor: "rgba(255,255,255,0.2)", backgroundColor: "rgba(255,255,255,0.06)" },
  captainName: { fontSize: 16, fontWeight: "800", color: "#fff" },
  captainTeam: { marginTop: 4, fontSize: 14, color: "rgba(255,255,255,0.65)" },
  captainMeta: { marginTop: 6, fontSize: 12, color: "rgba(255,255,255,0.45)" },
  filterChips: { flexDirection: "row", gap: 8, paddingVertical: 10 },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  filterChipActive: { borderColor: "rgba(163,230,53,0.45)", backgroundColor: "rgba(163,230,53,0.12)" },
  filterChipText: { fontSize: 12, fontWeight: "800", color: "rgba(255,255,255,0.6)", textTransform: "capitalize" },
  filterChipTextActive: { color: LIME },
  subRow: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  subName: { fontSize: 16, fontWeight: "800", color: "#fff" },
  subIg: { marginTop: 4, fontSize: 14, color: "rgba(255,255,255,0.55)" },
  subDate: { marginTop: 2, fontSize: 12, color: "rgba(255,255,255,0.4)" },
  decisionRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  decChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  decChipActive: { borderColor: "rgba(163,230,53,0.5)", backgroundColor: "rgba(163,230,53,0.14)" },
  decChipText: { fontSize: 11, fontWeight: "800", color: "rgba(255,255,255,0.55)", textTransform: "capitalize" },
  decChipTextActive: { color: LIME },
  reviewRow: { marginTop: 10 },
  reviewToggle: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(0,0,0,0.3)",
  },
  reviewToggleOn: { borderColor: "rgba(163,230,53,0.45)", backgroundColor: "rgba(163,230,53,0.12)" },
  reviewToggleText: { fontWeight: "800", fontSize: 12, color: "#fff" },
  saveBtn: {
    marginTop: 12,
    alignSelf: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: LIME,
  },
  saveBtnText: { color: "#111", fontWeight: "900", fontSize: 13 },
});
