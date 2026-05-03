import { useAdminPickupOverview } from "@/hooks/useAdminPickupOverview";
import {
  postAdminCancelRun,
  postAdminCreateRun,
  postAdminLateCancel,
  postAdminMarkAttendance,
  postAdminPromote,
} from "@/lib/adminApi";
import { useAuth } from "@/context/AuthContext";
import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

const LIME = "#a3e635";

function s(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function asIdRow(r: Record<string, unknown>): { id: string; full_name: string | null } {
  const id = s(r.id || r.user_id).trim();
  const full = s(r.full_name).trim();
  return { id, full_name: full ? full : null };
}

export default function AdminPickupOpsScreen() {
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const { loading, error, data, reload, region, setRegion } = useAdminPickupOverview("CT");

  const run = (data?.run || null) as Record<string, unknown> | null;
  const runId = run && typeof run.id === "string" ? (run.id as string) : null;

  const confirmed = useMemo(() => (Array.isArray(data?.confirmed) ? data!.confirmed : []), [data]);
  const standby = useMemo(() => (Array.isArray(data?.standby) ? data!.standby : []), [data]);

  const [createStartAt, setCreateStartAt] = useState("");
  const [createTitle, setCreateTitle] = useState("");
  const [createCapacity, setCreateCapacity] = useState("24");

  const [busy, setBusy] = useState<string | null>(null);

  async function requireToken(): Promise<string | null> {
    if (!token) {
      Alert.alert("Not signed in", "Sign in again.");
      return null;
    }
    return token;
  }

  async function onCreateRun() {
    const t = await requireToken();
    if (!t) return;
    const start_at = createStartAt.trim();
    if (!start_at) {
      Alert.alert("Missing start time", "Enter an ISO string like 2026-05-03T20:00:00Z");
      return;
    }
    setBusy("create");
    const r = await postAdminCreateRun(t, {
      start_at,
      title: createTitle.trim() || undefined,
      service_region: region,
      capacity: Number(createCapacity || 24),
    });
    setBusy(null);
    if (!r.ok) {
      Alert.alert("Create failed", r.error);
      return;
    }
    Alert.alert("Created", "Run created.");
    reload();
  }

  async function onCancelRun() {
    if (!runId) return;
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
            const r = await postAdminCancelRun(t, { run_id: runId, reason: "Canceled from mobile admin" });
            setBusy(null);
            if (!r.ok) return Alert.alert("Cancel failed", r.error);
            Alert.alert("Canceled", "Run canceled.");
            reload();
          })();
        },
      },
    ]);
  }

  async function onPromote(userId: string) {
    if (!runId) return;
    const t = await requireToken();
    if (!t) return;
    setBusy(`promote:${userId}`);
    const r = await postAdminPromote(t, { run_id: runId, promote_user_id: userId });
    setBusy(null);
    if (!r.ok) return Alert.alert("Promote failed", r.error);
    reload();
  }

  async function onMarkAttendance(userId: string, attended: boolean) {
    if (!runId) return;
    const t = await requireToken();
    if (!t) return;
    setBusy(`att:${userId}`);
    const r = await postAdminMarkAttendance(t, { run_id: runId, attendance: [{ user_id: userId, attended }] });
    setBusy(null);
    if (!r.ok) return Alert.alert("Save failed", r.error);
    reload();
  }

  async function onLateCancel(userId: string) {
    if (!runId) return;
    const t = await requireToken();
    if (!t) return;
    setBusy(`late:${userId}`);
    const r = await postAdminLateCancel(t, { run_id: runId, user_id: userId, note: "Late cancel (mobile admin)" });
    setBusy(null);
    if (!r.ok) return Alert.alert("Late cancel failed", r.error);
    Alert.alert("Recorded", "Late cancel recorded.");
    reload();
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.rowBetween}>
        <Text style={styles.h1}>Pickup ops</Text>
        <Pressable onPress={reload} style={({ pressed }) => [styles.chip, pressed && { opacity: 0.85 }]}>
          <Text style={styles.chipText}>Refresh</Text>
        </Pressable>
      </View>

      <View style={styles.segmentWrap}>
        <Text style={styles.segmentLabel}>State</Text>
        <View style={styles.segmentRow}>
          {(["NY", "CT", "NJ", "MD"] as const).map((code) => {
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
      </View>

      {loading ? <ActivityIndicator color="#fff" style={{ marginTop: 10 }} /> : null}
      {error ? <Text style={styles.err}>{error}</Text> : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Create run</Text>
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
          <Text style={styles.primaryText}>{busy === "create" ? "Creating..." : "Create run"}</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <Text style={styles.cardTitle}>Current upcoming run</Text>
          {runId ? (
            <Pressable
              onPress={() => void onCancelRun()}
              disabled={busy === "cancel"}
              style={({ pressed }) => [styles.dangerChip, pressed && { opacity: 0.85 }, busy === "cancel" && styles.disabled]}
            >
              <Text style={styles.dangerChipText}>{busy === "cancel" ? "Canceling..." : "Cancel"}</Text>
            </Pressable>
          ) : null}
        </View>
        {!run ? (
          <Text style={styles.muted}>No upcoming run found.</Text>
        ) : (
          <>
            <Text style={styles.mono}>{s(run.title) || "Pickup run"}</Text>
            <Text style={styles.muted}>Start: {s(run.start_at)}</Text>
            <Text style={styles.muted}>Status: {s(run.status)}</Text>
            <Text style={styles.muted}>Capacity: {s(run.capacity)}</Text>
          </>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Confirmed ({confirmed.length})</Text>
        {confirmed.length === 0 ? <Text style={styles.muted}>None</Text> : null}
        {confirmed.map((r) => {
          const p = asIdRow(r);
          if (!p.id) return null;
          const key = `c:${p.id}`;
          const isBusy = busy === `att:${p.id}` || busy === `late:${p.id}`;
          return (
            <View key={key} style={styles.personRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.personName}>{p.full_name ?? p.id}</Text>
                <Text style={styles.personSub}>{p.id}</Text>
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

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Standby ({standby.length})</Text>
        {standby.length === 0 ? <Text style={styles.muted}>None</Text> : null}
        {standby.map((r) => {
          const p = asIdRow(r);
          if (!p.id) return null;
          const key = `s:${p.id}`;
          const isBusy = busy === `promote:${p.id}`;
          return (
            <View key={key} style={styles.personRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.personName}>{p.full_name ?? p.id}</Text>
                <Text style={styles.personSub}>{p.id}</Text>
              </View>
              <Pressable
                onPress={() => void onPromote(p.id)}
                disabled={isBusy}
                style={({ pressed }) => [styles.primarySmall, pressed && { opacity: 0.9 }, isBusy && styles.disabled]}
              >
                <Text style={styles.primarySmallText}>{isBusy ? "..." : "Promote"}</Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0a0a0a" },
  content: { padding: 16, paddingBottom: 40 },
  h1: { fontSize: 28, fontWeight: "800", color: "#fff" },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  segmentWrap: { marginTop: 12 },
  segmentLabel: { fontSize: 12, fontWeight: "800", color: "rgba(255,255,255,0.6)", letterSpacing: 0.6 },
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
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
    backgroundColor: "rgba(163,230,53,0.08)",
  },
  chipText: { color: LIME, fontWeight: "800", fontSize: 13 },
  dangerChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.35)",
    backgroundColor: "rgba(248,113,113,0.08)",
  },
  dangerChipText: { color: "rgba(248,113,113,0.95)", fontWeight: "800", fontSize: 13 },
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
  statePill: { justifyContent: "center" },
  statePillText: { color: "#fff", fontWeight: "900", fontSize: 15 },
  twoCol: { flexDirection: "row", gap: 12, marginTop: 4 },
  primary: {
    marginTop: 14,
    backgroundColor: LIME,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryText: { color: "#111", fontWeight: "900", fontSize: 15 },
  muted: { marginTop: 10, color: "rgba(255,255,255,0.6)" },
  mono: { marginTop: 10, color: "#fff", fontWeight: "700" },
  personRow: { marginTop: 12, flexDirection: "row", alignItems: "center", gap: 8 },
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
  disabled: { opacity: 0.55 },
});

