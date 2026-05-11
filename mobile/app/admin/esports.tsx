import { useAdminEsportsTournaments } from "@/hooks/useAdminEsportsTournaments";
import {
  deleteAdminEsportsTournament,
  patchAdminEsportsTournament,
  patchAdminEsportsTournamentStatus,
  postAdminEsportsTournament,
  type AdminEsportsTournamentRow,
} from "@/lib/adminApi";
import { useAuth } from "@/context/AuthContext";
import DateTimePicker from "@/components/DateTimePicker";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
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

type Status = "upcoming" | "active" | "completed";

type FormState = {
  title: string;
  game: string;
  prize: string;
  start_date: string;
  end_date: string;
  status: Status;
  description: string;
  format_summary: string;
  group_stage_deadline_1: string;
  group_stage_deadline_2: string;
  group_stage_final_deadline: string;
  knockout_start_at: string;
  quarterfinal_deadline: string;
  semifinal_deadline: string;
  final_deadline: string;
};

function emptyForm(): FormState {
  return {
    title: "",
    game: "",
    prize: "",
    start_date: "",
    end_date: "",
    status: "upcoming",
    description: "",
    format_summary: "",
    group_stage_deadline_1: "",
    group_stage_deadline_2: "",
    group_stage_final_deadline: "",
    knockout_start_at: "",
    quarterfinal_deadline: "",
    semifinal_deadline: "",
    final_deadline: "",
  };
}

function s(v: string | null | undefined): string {
  return v == null ? "" : String(v);
}

function rowToForm(t: AdminEsportsTournamentRow): FormState {
  const st = String(t.status || "upcoming").toLowerCase();
  const status: Status = st === "active" || st === "completed" ? st : "upcoming";
  return {
    title: s(t.title),
    game: s(t.game),
    prize: s(t.prize),
    start_date: s(t.start_date),
    end_date: s(t.end_date),
    status,
    description: s(t.description),
    format_summary: s(t.format_summary),
    group_stage_deadline_1: s(t.group_stage_deadline_1),
    group_stage_deadline_2: s(t.group_stage_deadline_2),
    group_stage_final_deadline: s(t.group_stage_final_deadline),
    knockout_start_at: s(t.knockout_start_at),
    quarterfinal_deadline: s(t.quarterfinal_deadline),
    semifinal_deadline: s(t.semifinal_deadline),
    final_deadline: s(t.final_deadline),
  };
}

function formToPayload(f: FormState): Record<string, unknown> {
  return {
    title: f.title.trim(),
    game: f.game.trim(),
    prize: f.prize.trim(),
    start_date: f.start_date.trim(),
    end_date: f.end_date.trim(),
    status: f.status,
    description: f.description.trim() || null,
    format_summary: f.format_summary.trim() || null,
    group_stage_deadline_1: f.group_stage_deadline_1.trim() || null,
    group_stage_deadline_2: f.group_stage_deadline_2.trim() || null,
    group_stage_final_deadline: f.group_stage_final_deadline.trim() || null,
    knockout_start_at: f.knockout_start_at.trim() || null,
    quarterfinal_deadline: f.quarterfinal_deadline.trim() || null,
    semifinal_deadline: f.semifinal_deadline.trim() || null,
    final_deadline: f.final_deadline.trim() || null,
  };
}

function fmtShort(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function statusLabel(st: string): string {
  if (st === "active") return "Active";
  if (st === "completed") return "Completed";
  return "Upcoming";
}

const DEADLINE_LABELS: { key: keyof FormState; label: string }[] = [
  { key: "group_stage_deadline_1", label: "Group stage deadline 1" },
  { key: "group_stage_deadline_2", label: "Group stage deadline 2" },
  { key: "group_stage_final_deadline", label: "Group stage final deadline" },
  { key: "knockout_start_at", label: "Knockout start" },
  { key: "quarterfinal_deadline", label: "Quarterfinal deadline" },
  { key: "semifinal_deadline", label: "Semifinal deadline" },
  { key: "final_deadline", label: "Final deadline" },
];

function FormFields(props: {
  form: FormState;
  setForm: Dispatch<SetStateAction<FormState>>;
  showStatusPicker: boolean;
}) {
  const { form, setForm, showStatusPicker } = props;
  const set = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));

  return (
    <>
      <Text style={styles.label}>Title</Text>
      <TextInput
        style={styles.input}
        value={form.title}
        onChangeText={(t) => set({ title: t })}
        placeholder="Spring FC Open"
        placeholderTextColor="rgba(255,255,255,0.35)"
      />
      <Text style={styles.label}>Game</Text>
      <TextInput
        style={styles.input}
        value={form.game}
        onChangeText={(t) => set({ game: t })}
        placeholder="EA FC 26"
        placeholderTextColor="rgba(255,255,255,0.35)"
      />
      <Text style={styles.label}>Prize</Text>
      <TextInput
        style={styles.input}
        value={form.prize}
        onChangeText={(t) => set({ prize: t })}
        placeholder="$500"
        placeholderTextColor="rgba(255,255,255,0.35)"
      />
      <Text style={styles.label}>Start date (ISO)</Text>
      <View style={styles.datePickerWrap}>
        <DateTimePicker value={form.start_date} onChange={(iso) => set({ start_date: iso })} />
      </View>
      <Text style={styles.label}>End date (ISO)</Text>
      <View style={styles.datePickerWrap}>
        <DateTimePicker value={form.end_date} onChange={(iso) => set({ end_date: iso })} />
      </View>
      {showStatusPicker ? (
        <>
          <Text style={styles.label}>Status</Text>
          <View style={styles.statusRow}>
            {(["upcoming", "active", "completed"] as const).map((st) => {
              const on = form.status === st;
              return (
                <Pressable
                  key={st}
                  onPress={() => set({ status: st })}
                  style={({ pressed }) => [styles.statusChip, on && styles.statusChipOn, pressed && { opacity: 0.9 }]}
                >
                  <Text style={[styles.statusChipText, on && styles.statusChipTextOn]}>{statusLabel(st)}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}
      <Text style={styles.label}>Description</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        value={form.description}
        onChangeText={(t) => set({ description: t })}
        placeholder="Public description"
        placeholderTextColor="rgba(255,255,255,0.35)"
        multiline
      />
      <Text style={styles.label}>Format summary</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        value={form.format_summary}
        onChangeText={(t) => set({ format_summary: t })}
        placeholder="Group stage → knockout"
        placeholderTextColor="rgba(255,255,255,0.35)"
        multiline
      />
      {DEADLINE_LABELS.map(({ key, label }) => (
        <View key={key}>
          <Text style={styles.label}>{label} (ISO, optional)</Text>
          <View style={styles.datePickerWrap}>
            <DateTimePicker
              value={form[key] as string}
              onChange={(iso) => set({ [key]: iso } as Partial<FormState>)}
            />
          </View>
        </View>
      ))}
    </>
  );
}

export default function AdminEsportsScreen() {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const { loading, error, tournaments, reload } = useAdminEsportsTournaments();
  const [busy, setBusy] = useState<string | null>(null);

  const [createForm, setCreateForm] = useState<FormState>(() => emptyForm());
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(() => emptyForm());

  const openEdit = useCallback((t: AdminEsportsTournamentRow) => {
    setEditId(t.id);
    setEditForm(rowToForm(t));
    setModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setEditId(null);
    setEditForm(emptyForm());
  }, []);

  async function setStatus(row: AdminEsportsTournamentRow, status: Status) {
    if (!token) return Alert.alert("Not signed in", "Sign in again.");
    setBusy(`${row.id}:${status}`);
    const r = await patchAdminEsportsTournamentStatus(token, row.id, status);
    setBusy(null);
    if (!r.ok) return Alert.alert("Update failed", r.error);
    reload();
  }

  async function onCreate() {
    if (!token) return Alert.alert("Not signed in", "Sign in again.");
    const p = formToPayload(createForm);
    if (!p.title || String(p.title).length < 2) return Alert.alert("Validation", "Title is required (min 2 characters).");
    if (!p.game || !p.prize) return Alert.alert("Validation", "Game and prize are required.");
    if (!p.start_date || !p.end_date) return Alert.alert("Validation", "Start and end dates (ISO) are required.");

    setBusy("create");
    const r = await postAdminEsportsTournament(token, p);
    setBusy(null);
    if (!r.ok) return Alert.alert("Create failed", r.error);
    setCreateForm(emptyForm());
    reload();
    Alert.alert("Created", "Tournament saved.");
  }

  async function onSaveEdit() {
    if (!token || !editId) return;
    const p = formToPayload(editForm);
    if (!p.title || String(p.title).length < 2) return Alert.alert("Validation", "Title is required.");
    if (!p.game || !p.prize) return Alert.alert("Validation", "Game and prize are required.");
    if (!p.start_date || !p.end_date) return Alert.alert("Validation", "Start and end dates (ISO) are required.");

    setBusy(`edit:${editId}`);
    const r = await patchAdminEsportsTournament(token, editId, p);
    setBusy(null);
    if (!r.ok) return Alert.alert("Save failed", r.error);
    closeModal();
    reload();
    Alert.alert("Saved", "Tournament updated.");
  }

  function confirmDelete(row: AdminEsportsTournamentRow) {
    Alert.alert("Delete tournament?", `Permanently remove “${row.title}”? This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void (async () => {
            if (!token) return;
            setBusy(`del:${row.id}`);
            const r = await deleteAdminEsportsTournament(token, row.id);
            setBusy(null);
            if (!r.ok) return Alert.alert("Delete failed", r.error);
            if (editId === row.id) closeModal();
            reload();
          })();
        },
      },
    ]);
  }

  const listEmpty = useMemo(() => !loading && tournaments.length === 0, [loading, tournaments.length]);

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { paddingBottom: insets.bottom }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 200 }]} keyboardShouldPersistTaps="handled">
          <View style={styles.rowBetween}>
            <Text style={styles.h1}>Esports</Text>
            <Pressable onPress={reload} style={({ pressed }) => [styles.chip, pressed && { opacity: 0.85 }]}>
              <Text style={styles.chipText}>Refresh</Text>
            </Pressable>
          </View>

        <Text style={styles.lead}>
          Create and edit digital tournaments (ISO datetimes). Use Upcoming / Start / Complete to control the public
          hub listing.
        </Text>

        {loading ? <ActivityIndicator color="#fff" style={{ marginTop: 16 }} /> : null}
        {error ? <Text style={styles.err}>{error}</Text> : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Create tournament</Text>
          <Text style={styles.fieldHint}>Required: title, game, prize, start/end (ISO 8601). Deadlines optional.</Text>
          <FormFields form={createForm} setForm={setCreateForm} showStatusPicker />
          <Pressable
            onPress={() => void onCreate()}
            disabled={busy === "create"}
            style={({ pressed }) => [styles.primary, pressed && { opacity: 0.92 }, busy === "create" && styles.disabled]}
          >
            <Text style={styles.primaryText}>{busy === "create" ? "Creating…" : "Create tournament"}</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Tournaments ({tournaments.length})</Text>
          {listEmpty ? <Text style={styles.muted}>No tournaments yet. Create one above.</Text> : null}
          {tournaments.map((t, i) => {
            const st = String(t.status || "").toLowerCase();
            const anyBusy = busy?.startsWith(`${t.id}:`) ?? false;
            return (
              <View key={t.id} style={[styles.block, i === 0 && styles.blockFirst]}>
                <View style={styles.rowTop}>
                  <Pressable onPress={() => openEdit(t)} style={({ pressed }) => [{ flex: 1, opacity: pressed ? 0.85 : 1 }]}>
                    <Text style={styles.title}>{t.title}</Text>
                    <Text style={styles.sub}>
                      {t.game} · {statusLabel(st)}
                    </Text>
                    <Text style={styles.sub}>
                      {fmtShort(t.start_date)} → {fmtShort(t.end_date)}
                    </Text>
                    <Text style={styles.tapHint}>Tap to edit · prize: {t.prize}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => confirmDelete(t)}
                    disabled={busy !== null}
                    style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.85 }, busy !== null && styles.disabled]}
                    accessibilityLabel="Delete tournament"
                  >
                    <FontAwesome name="trash-o" size={18} color="rgba(248,113,113,0.95)" />
                  </Pressable>
                </View>
                <View style={styles.actions}>
                  {st !== "upcoming" ? (
                    <Pressable
                      onPress={() =>
                        Alert.alert("Set upcoming?", `Mark “${t.title}” as upcoming?`, [
                          { text: "Cancel", style: "cancel" },
                          { text: "Upcoming", onPress: () => void setStatus(t, "upcoming") },
                        ])
                      }
                      disabled={busy !== null}
                      style={({ pressed }) => [styles.mini, pressed && { opacity: 0.85 }, busy !== null && styles.disabled]}
                    >
                      <Text style={styles.miniText}>{anyBusy && busy?.endsWith(":upcoming") ? "…" : "Upcoming"}</Text>
                    </Pressable>
                  ) : null}
                  {st !== "active" ? (
                    <Pressable
                      onPress={() =>
                        Alert.alert("Start tournament?", `Mark “${t.title}” as active?`, [
                          { text: "Cancel", style: "cancel" },
                          { text: "Start", onPress: () => void setStatus(t, "active") },
                        ])
                      }
                      disabled={busy !== null}
                      style={({ pressed }) => [
                        styles.mini,
                        styles.miniPrimary,
                        pressed && { opacity: 0.85 },
                        busy !== null && styles.disabled,
                      ]}
                    >
                      <Text style={styles.miniPrimaryText}>{anyBusy && busy?.endsWith(":active") ? "…" : "Start"}</Text>
                    </Pressable>
                  ) : null}
                  {st !== "completed" ? (
                    <Pressable
                      onPress={() =>
                        Alert.alert("Complete tournament?", `Mark “${t.title}” as completed?`, [
                          { text: "Cancel", style: "cancel" },
                          { text: "Complete", style: "destructive", onPress: () => void setStatus(t, "completed") },
                        ])
                      }
                      disabled={busy !== null}
                      style={({ pressed }) => [styles.mini, pressed && { opacity: 0.85 }, busy !== null && styles.disabled]}
                    >
                      <Text style={styles.miniText}>{anyBusy && busy?.endsWith(":completed") ? "…" : "Complete"}</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>

      <Modal visible={modalOpen} animationType="slide" transparent onRequestClose={closeModal}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalDismiss} onPress={closeModal} accessibilityLabel="Dismiss" />
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            keyboardVerticalOffset={insets.top}
            style={styles.modalKb}
          >
            <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
              <View style={styles.modalGrabRow}>
                <View style={styles.modalGrab} />
              </View>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle} numberOfLines={2}>
                  Edit tournament
                </Text>
                <Pressable onPress={closeModal} style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.85 }]}>
                  <FontAwesome name="times" size={18} color="#fff" />
                </Pressable>
              </View>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 200 }}
              >
                <FormFields form={editForm} setForm={setEditForm} showStatusPicker />
                <Pressable
                  onPress={() => void onSaveEdit()}
                  disabled={!editId || busy?.startsWith("edit:")}
                  style={({ pressed }) => [
                    styles.primary,
                    { marginTop: 8 },
                    pressed && { opacity: 0.92 },
                    (!editId || busy?.startsWith("edit:")) && styles.disabled,
                  ]}
                >
                  <Text style={styles.primaryText}>{busy?.startsWith("edit:") ? "Saving…" : "Save"}</Text>
                </Pressable>
                {editId ? (
                  <Pressable
                    onPress={() => {
                      const row = tournaments.find((x) => x.id === editId);
                      if (row) confirmDelete(row);
                    }}
                    style={({ pressed }) => [styles.dangerOutline, pressed && { opacity: 0.9 }]}
                  >
                    <Text style={styles.dangerOutlineText}>Delete tournament</Text>
                  </Pressable>
                ) : null}
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
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
  err: { marginTop: 12, color: "#fca5a5", fontSize: 14 },
  card: {
    marginTop: 14,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  cardTitle: { fontSize: 16, fontWeight: "800", color: "#fff" },
  fieldHint: { marginTop: 6, fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 18 },
  label: { marginTop: 12, fontSize: 12, fontWeight: "700", color: "rgba(255,255,255,0.55)" },
  datePickerWrap: { marginTop: 8 },
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
  textArea: { minHeight: 88, textAlignVertical: "top" },
  statusRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  statusChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  statusChipOn: { borderColor: "rgba(163,230,53,0.45)", backgroundColor: "rgba(163,230,53,0.12)" },
  statusChipText: { fontSize: 12, fontWeight: "800", color: "rgba(255,255,255,0.55)" },
  statusChipTextOn: { color: LIME },
  primary: {
    marginTop: 16,
    backgroundColor: LIME,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryText: { color: "#111", fontWeight: "900", fontSize: 15 },
  disabled: { opacity: 0.55 },
  block: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  blockFirst: { marginTop: 4, paddingTop: 0, borderTopWidth: 0 },
  rowTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  title: { color: "#fff", fontWeight: "800", fontSize: 16 },
  sub: { marginTop: 4, color: "rgba(255,255,255,0.5)", fontSize: 12, lineHeight: 16 },
  tapHint: { marginTop: 6, fontSize: 11, fontWeight: "700", color: "rgba(163,230,53,0.65)" },
  iconBtn: {
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.35)",
    backgroundColor: "rgba(248,113,113,0.08)",
  },
  actions: { marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 8 },
  mini: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  miniText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  miniPrimary: {
    borderColor: "rgba(163,230,53,0.45)",
    backgroundColor: "rgba(163,230,53,0.12)",
  },
  miniPrimaryText: { color: LIME, fontWeight: "900", fontSize: 12 },
  muted: { marginTop: 10, color: "rgba(255,255,255,0.6)" },
  modalRoot: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  modalDismiss: { flex: 1 },
  modalKb: { maxHeight: "92%" },
  modalSheet: {
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
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 },
  modalTitle: { flex: 1, fontSize: 18, fontWeight: "800", color: "#fff" },
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
  dangerOutline: {
    marginTop: 14,
    marginBottom: 24,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.45)",
    alignItems: "center",
    backgroundColor: "rgba(248,113,113,0.06)",
  },
  dangerOutlineText: { color: "rgba(248,113,113,0.95)", fontWeight: "800", fontSize: 14 },
});
