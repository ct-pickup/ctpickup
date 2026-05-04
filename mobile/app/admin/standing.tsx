import {
  useAdminStanding,
  type AdminStandingFilter,
  type AdminStandingRow,
} from "@/hooks/useAdminStanding";
import { patchAdminPickupStanding } from "@/lib/adminApi";
import { useAuth } from "@/context/AuthContext";
import { useEffect, useMemo, useState } from "react";
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

type ReliabilityFilter = "all" | "good" | "building" | "below";
type ManualOverride = "" | "good" | "warning" | "suspended" | "banned";

function s(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function pickRowName(r: AdminStandingRow): string {
  const fn = s(r.first_name).trim();
  const ln = s(r.last_name).trim();
  const name = `${fn} ${ln}`.trim();
  if (name) return name;
  const ig = s(r.instagram).trim();
  if (ig) return `@${ig.replace(/^@/, "")}`;
  return s(r.user_id);
}

function effTone(eff: string): { border: string; bg: string; text: string } {
  switch (eff) {
    case "good":
      return { border: "rgba(52,211,153,0.45)", bg: "rgba(52,211,153,0.12)", text: "#bbf7d0" };
    case "warning":
      return { border: "rgba(251,191,36,0.45)", bg: "rgba(251,191,36,0.12)", text: "#fde68a" };
    case "suspended":
      return { border: "rgba(251,146,60,0.5)", bg: "rgba(251,146,60,0.12)", text: "#fed7aa" };
    case "banned":
      return { border: "rgba(248,113,113,0.55)", bg: "rgba(248,113,113,0.12)", text: "#fecaca" };
    default:
      return { border: "rgba(255,255,255,0.18)", bg: "rgba(255,255,255,0.06)", text: "rgba(255,255,255,0.85)" };
  }
}

function reliabilityLabel(row: AdminStandingRow): string {
  const tracked = row.reliability_tracked_pickups || 0;
  const score = row.reliability_score_pct;
  const bucket = row.reliability_bucket;

  if (tracked < 3 || score == null) return "Building rating · starts after 3 pickups";
  if (bucket === "good") return `Good Standing · ${Math.round(Number(score))}%`;
  return `Reliability · ${Math.round(Number(score))}%`;
}

function reliabilityMatches(row: AdminStandingRow, f: ReliabilityFilter): boolean {
  if (f === "all") return true;
  const bucket = row.reliability_bucket;
  if (f === "good") return bucket === "good";
  if (f === "building") return bucket === "building" || row.reliability_score_pct == null;
  return bucket === "watch" || bucket === "needs_review";
}

export default function AdminStandingScreen() {
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const insets = useSafeAreaInsets();
  const { loading, error, rows, filter, q, currentWaiverVersion, setFilter, setQ, reload } = useAdminStanding();

  const [reliabilityFilter, setReliabilityFilter] = useState<ReliabilityFilter>("all");
  const [editing, setEditing] = useState<AdminStandingRow | null>(null);
  const [manual, setManual] = useState<ManualOverride>("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [relOverride, setRelOverride] = useState("");
  const [relOverrideReason, setRelOverrideReason] = useState("");
  const [saving, setSaving] = useState(false);

  const filters: { id: AdminStandingFilter; label: string }[] = useMemo(
    () => [
      { id: "all", label: "All approved" },
      { id: "good", label: "Good + waiver" },
      { id: "warning", label: "Warning" },
      { id: "suspended", label: "Suspended" },
      { id: "banned", label: "Banned" },
      { id: "missing_waiver", label: "No waiver" },
    ],
    [],
  );

  const reliabilityFilters: { id: ReliabilityFilter; label: string }[] = useMemo(
    () => [
      { id: "all", label: "All" },
      { id: "good", label: "Good Standing" },
      { id: "building", label: "Building" },
      { id: "below", label: "Below Standard" },
    ],
    [],
  );

  const displayedRows = useMemo(
    () => rows.filter((r) => reliabilityMatches(r, reliabilityFilter)),
    [rows, reliabilityFilter],
  );

  function openEdit(row: AdminStandingRow) {
    setEditing(row);
    setManual(((row.manual_override as ManualOverride) || "") as ManualOverride);
    setReason(row.standing?.manual_reason || "");
    setNotes(row.standing?.staff_notes || "");
    setRelOverride(
      row.reliability_override_score_pct == null
        ? ""
        : String(Math.round(Number(row.reliability_override_score_pct))),
    );
    setRelOverrideReason(row.reliability_override_reason || "");
  }

  function closeEdit() {
    setEditing(null);
    setSaving(false);
  }

  useEffect(() => {
    if (!editing) return;
    const fresh = rows.find((r) => r.user_id === editing.user_id);
    if (fresh && fresh !== editing) setEditing(fresh);
  }, [rows, editing]);

  async function saveEdit(clearOverride: boolean) {
    if (!token || !editing) return;
    const overrideRaw = relOverride.trim();
    if (overrideRaw) {
      const n = Number(overrideRaw);
      if (Number.isNaN(n) || n < 0 || n > 100) {
        Alert.alert("Invalid score", "Override score must be a number between 0 and 100.");
        return;
      }
    }
    setSaving(true);
    const body = {
      user_id: editing.user_id,
      manual_standing: clearOverride ? null : (manual === "" ? null : manual),
      manual_reason: reason.trim() || null,
      staff_notes: notes.trim() || null,
      reliability_override_score_pct: overrideRaw ? Number(overrideRaw) : null,
      reliability_override_reason: relOverrideReason.trim() || null,
    } as const;
    const r = await patchAdminPickupStanding(token, body);
    setSaving(false);
    if (!r.ok) {
      Alert.alert("Save failed", r.error);
      return;
    }
    closeEdit();
    reload();
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.rowBetween}>
          <Text style={styles.h1}>Standing</Text>
          <Pressable onPress={reload} style={({ pressed }) => [styles.chip, pressed && { opacity: 0.85 }]}>
            <Text style={styles.chipText}>Refresh</Text>
          </Pressable>
        </View>

        <Text style={styles.intro}>
          Effective standing is the manual override when set otherwise automatic rules apply (no-shows, late
          cancellations, payment issues, waiver). Suspended or banned players cannot RSVP or pay for pickup.
        </Text>
        {currentWaiverVersion ? (
          <Text style={styles.muted}>Current waiver version: {currentWaiverVersion}</Text>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.label}>Search (name / IG / email)</Text>
          <TextInput
            style={styles.input}
            value={q}
            onChangeText={setQ}
            placeholder="Search…"
            placeholderTextColor="rgba(255,255,255,0.35)"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={styles.label}>Filter</Text>
          <View style={styles.filterRow}>
            {filters.map((f) => {
              const active = filter === f.id;
              return (
                <Pressable
                  key={f.id}
                  onPress={() => setFilter(f.id)}
                  style={({ pressed }) => [
                    styles.filterChip,
                    active && styles.filterChipActive,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text style={[styles.filterText, active && styles.filterTextActive]}>{f.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.label}>Reliability</Text>
          <View style={styles.filterRow}>
            {reliabilityFilters.map((f) => {
              const active = reliabilityFilter === f.id;
              return (
                <Pressable
                  key={f.id}
                  onPress={() => setReliabilityFilter(f.id)}
                  style={({ pressed }) => [
                    styles.filterChip,
                    active && styles.filterChipActive,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text style={[styles.filterText, active && styles.filterTextActive]}>{f.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {loading ? <ActivityIndicator color="#fff" style={{ marginTop: 14 }} /> : null}
        {error ? <Text style={styles.err}>{error}</Text> : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Players ({displayedRows.length}
            {displayedRows.length !== rows.length ? ` of ${rows.length}` : ""})
          </Text>
          {displayedRows.length === 0 && !loading ? (
            <Text style={styles.muted}>No rows for this filter.</Text>
          ) : null}
          {displayedRows.map((row) => {
            const eff = s(row.effective_standing).trim() || "good";
            const tone = effTone(eff);
            const ig = s(row.instagram).trim();
            const ns = row.standing?.rollup_no_shows_90d ?? 0;
            const lc = row.standing?.rollup_late_cancels_90d ?? 0;
            const pay = row.standing?.rollup_pickup_payment_issues_90d ?? 0;
            return (
              <Pressable
                key={row.user_id}
                onPress={() => openEdit(row)}
                style={({ pressed }) => [styles.person, pressed && { opacity: 0.92 }]}
              >
                <View style={styles.personHeader}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.personName} numberOfLines={1}>
                      {pickRowName(row)}
                    </Text>
                    <Text style={styles.personSub} numberOfLines={1}>
                      {ig ? `@${ig.replace(/^@/, "")}` : row.user_id}
                      {row.tier ? ` · Tier ${row.tier}` : ""}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.effBadge,
                      { borderColor: tone.border, backgroundColor: tone.bg },
                    ]}
                  >
                    <Text style={[styles.effBadgeText, { color: tone.text }]}>{eff}</Text>
                  </View>
                </View>

                {row.manual_override ? (
                  <Text style={styles.overrideHint}>Manual override active · auto: {row.auto_standing}</Text>
                ) : null}

                <View style={styles.metaRow}>
                  <View style={styles.metaPill}>
                    <Text style={styles.metaLabel}>Waiver</Text>
                    <Text
                      style={[
                        styles.metaValue,
                        row.waiver_current ? styles.metaValueOk : styles.metaValueWarn,
                      ]}
                    >
                      {row.waiver_current ? "On file" : "Missing"}
                    </Text>
                  </View>
                  <View style={styles.metaPill}>
                    <Text style={styles.metaLabel}>Join OK</Text>
                    <Text
                      style={[
                        styles.metaValue,
                        row.join_ok ? styles.metaValueOk : styles.metaValueBad,
                      ]}
                    >
                      {row.join_ok ? "Yes" : "No"}
                    </Text>
                  </View>
                  <View style={styles.metaPill}>
                    <Text style={styles.metaLabel}>Tracked</Text>
                    <Text style={styles.metaValue}>{row.reliability_tracked_pickups ?? 0}</Text>
                  </View>
                </View>

                <Text style={styles.relLabel}>{reliabilityLabel(row)}</Text>
                <Text style={styles.history}>
                  90d · NS {ns} · LC {lc} · Pay {pay}
                  {"  "}·{"  "}Attended {row.attended_count ?? 0}/{row.confirmed_count ?? 0} · strikes{" "}
                  {row.strike_count ?? 0}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <Modal visible={!!editing} animationType="slide" transparent onRequestClose={closeEdit}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalDismiss} onPress={closeEdit} accessibilityLabel="Dismiss" />
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            keyboardVerticalOffset={insets.top}
            style={styles.modalKb}
          >
            <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
              <View style={styles.modalGrabRow}>
                <View style={styles.modalGrab} />
              </View>
              {editing ? (
                <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                  <View style={styles.modalHeader}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.modalTitle} numberOfLines={2}>
                        {pickRowName(editing)}
                      </Text>
                      <Text style={styles.modalSub} numberOfLines={2}>
                        Auto: {editing.auto_standing} · Effective: {editing.effective_standing}
                      </Text>
                    </View>
                    <Pressable onPress={closeEdit} style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.85 }]}>
                      <Text style={styles.closeBtnText}>×</Text>
                    </Pressable>
                  </View>

                  <View style={styles.modalSection}>
                    <Text style={styles.sectionTitle}>Reliability score override</Text>
                    <Text style={styles.bodyMuted}>
                      Optional. Set a manual score (0–100) to override the computed reliability shown to the player.
                    </Text>
                    <Text style={styles.label}>Override score (0–100)</Text>
                    <TextInput
                      style={styles.input}
                      value={relOverride}
                      onChangeText={setRelOverride}
                      placeholder="(none)"
                      placeholderTextColor="rgba(255,255,255,0.35)"
                      keyboardType="number-pad"
                      inputMode="numeric"
                    />
                    <Text style={styles.label}>Override reason</Text>
                    <TextInput
                      style={styles.input}
                      value={relOverrideReason}
                      onChangeText={setRelOverrideReason}
                      placeholder="Internal note"
                      placeholderTextColor="rgba(255,255,255,0.35)"
                    />
                  </View>

                  <View style={styles.modalSection}>
                    <Text style={styles.sectionTitle}>Manual override</Text>
                    <View style={styles.filterRow}>
                      {(
                        [
                          ["", "None"],
                          ["good", "Good"],
                          ["warning", "Warning"],
                          ["suspended", "Suspended"],
                          ["banned", "Banned"],
                        ] as [ManualOverride, string][]
                      ).map(([id, label]) => {
                        const active = manual === id;
                        const tone = effTone(id || "default");
                        return (
                          <Pressable
                            key={id || "none"}
                            onPress={() => setManual(id)}
                            style={({ pressed }) => [
                              styles.filterChip,
                              active && {
                                borderColor: tone.border,
                                backgroundColor: tone.bg,
                              },
                              pressed && { opacity: 0.85 },
                            ]}
                          >
                            <Text
                              style={[
                                styles.filterText,
                                active && { color: tone.text, fontWeight: "800" },
                              ]}
                            >
                              {label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    <Text style={styles.label}>Reason (player-facing ops note)</Text>
                    <TextInput
                      style={styles.input}
                      value={reason}
                      onChangeText={setReason}
                      placeholder="Why this override exists"
                      placeholderTextColor="rgba(255,255,255,0.35)"
                    />

                    <Text style={styles.label}>Staff notes</Text>
                    <TextInput
                      style={[styles.input, styles.inputMulti]}
                      value={notes}
                      onChangeText={setNotes}
                      placeholder="Internal context"
                      placeholderTextColor="rgba(255,255,255,0.35)"
                      multiline
                      numberOfLines={4}
                      textAlignVertical="top"
                    />
                  </View>

                  <View style={styles.actionRow}>
                    <Pressable
                      onPress={() => void saveEdit(false)}
                      disabled={saving}
                      style={({ pressed }) => [styles.primary, pressed && { opacity: 0.9 }, saving && styles.disabled]}
                    >
                      <Text style={styles.primaryText}>{saving ? "Saving…" : "Save"}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() =>
                        Alert.alert(
                          "Clear override?",
                          "Removes the manual standing override. Reliability override score is also cleared.",
                          [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Clear",
                              style: "destructive",
                              onPress: () => {
                                setManual("");
                                setRelOverride("");
                                setRelOverrideReason("");
                                void saveEdit(true);
                              },
                            },
                          ],
                        )
                      }
                      disabled={saving}
                      style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.9 }, saving && styles.disabled]}
                    >
                      <Text style={styles.secondaryText}>Clear override</Text>
                    </Pressable>
                    <Pressable
                      onPress={closeEdit}
                      disabled={saving}
                      style={({ pressed }) => [styles.tertiary, pressed && { opacity: 0.85 }]}
                    >
                      <Text style={styles.tertiaryText}>Cancel</Text>
                    </Pressable>
                  </View>
                </ScrollView>
              ) : null}
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0a0a0a" },
  content: { padding: 16, paddingBottom: 40 },
  h1: { fontSize: 28, fontWeight: "800", color: "#fff" },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  intro: { marginTop: 10, color: "rgba(255,255,255,0.55)", fontSize: 13, lineHeight: 18 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
    backgroundColor: "rgba(163,230,53,0.08)",
  },
  chipText: { color: LIME, fontWeight: "800", fontSize: 13 },
  err: { marginTop: 10, color: "#fca5a5" },
  card: {
    marginTop: 14,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  cardTitle: { fontSize: 16, fontWeight: "800", color: "#fff" },
  bodyMuted: { marginTop: 6, color: "rgba(255,255,255,0.55)", fontSize: 12, lineHeight: 17 },
  label: { marginTop: 12, fontSize: 12, fontWeight: "700", color: "rgba(255,255,255,0.55)" },
  input: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#fff",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  inputMulti: { minHeight: 96, paddingTop: 10 },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  filterChipActive: { borderColor: "rgba(163,230,53,0.45)", backgroundColor: "rgba(163,230,53,0.10)" },
  filterText: { color: "rgba(255,255,255,0.7)", fontWeight: "700", fontSize: 12 },
  filterTextActive: { color: LIME },
  muted: { marginTop: 8, color: "rgba(255,255,255,0.55)", fontSize: 12 },

  person: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  personHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  personName: { color: "#fff", fontWeight: "800", fontSize: 15 },
  personSub: { marginTop: 2, color: "rgba(255,255,255,0.5)", fontSize: 12 },
  effBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  effBadgeText: { fontWeight: "900", fontSize: 11, letterSpacing: 0.5, textTransform: "uppercase" },
  overrideHint: { marginTop: 6, color: "rgba(251,191,36,0.85)", fontSize: 11, fontWeight: "700" },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  metaPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.04)",
    minWidth: 90,
  },
  metaLabel: { color: "rgba(255,255,255,0.45)", fontSize: 10, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase" },
  metaValue: { marginTop: 2, color: "#fff", fontSize: 13, fontWeight: "800" },
  metaValueOk: { color: "#bbf7d0" },
  metaValueWarn: { color: "#fde68a" },
  metaValueBad: { color: "#fecaca" },
  relLabel: { marginTop: 10, color: "rgba(255,255,255,0.85)", fontSize: 13, fontWeight: "700" },
  history: { marginTop: 4, color: "rgba(255,255,255,0.45)", fontSize: 11, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },

  modalRoot: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
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
    width: 36,
    height: 36,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  closeBtnText: { color: "#fff", fontSize: 22, lineHeight: 24, fontWeight: "700" },
  modalSection: { marginTop: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)" },
  sectionTitle: { fontSize: 13, fontWeight: "800", color: "rgba(255,255,255,0.85)", letterSpacing: 0.6 },

  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 16, marginBottom: 8 },
  primary: {
    backgroundColor: LIME,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryText: { color: "#111", fontWeight: "900", fontSize: 14 },
  secondary: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  secondaryText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  tertiary: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  tertiaryText: { color: "rgba(255,255,255,0.65)", fontWeight: "700", fontSize: 13 },
  disabled: { opacity: 0.55 },
});
