import { useAdminStanding, type AdminStandingFilter } from "@/hooks/useAdminStanding";
import { patchAdminPickupStanding } from "@/lib/adminApi";
import { useAuth } from "@/context/AuthContext";
import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

const LIME = "#a3e635";

function s(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function pickRowLabel(r: Record<string, unknown>): string {
  const fn = s(r.first_name).trim();
  const ln = s(r.last_name).trim();
  const ig = s(r.instagram).trim();
  const email = s(r.email).trim();
  const name = `${fn} ${ln}`.trim();
  if (name) return name;
  if (ig) return `@${ig.replace(/^@/, "")}`;
  if (email) return email;
  return s(r.user_id || r.id);
}

export default function AdminStandingScreen() {
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const { loading, error, rows, filter, q, setFilter, setQ, reload } = useAdminStanding();
  const [busyId, setBusyId] = useState<string | null>(null);

  const filters: { id: AdminStandingFilter; label: string }[] = useMemo(
    () => [
      { id: "all", label: "All" },
      { id: "good", label: "Good" },
      { id: "warning", label: "Warning" },
      { id: "suspended", label: "Suspended" },
      { id: "banned", label: "Banned" },
      { id: "missing_waiver", label: "No waiver" },
    ],
    [],
  );

  async function setStanding(userId: string, manual_standing: "good" | "warning" | "suspended" | "banned" | null) {
    if (!token) return Alert.alert("Not signed in", "Sign in again.");
    setBusyId(userId);
    const r = await patchAdminPickupStanding(token, { user_id: userId, manual_standing });
    setBusyId(null);
    if (!r.ok) return Alert.alert("Save failed", r.error);
    reload();
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.rowBetween}>
        <Text style={styles.h1}>Standing</Text>
        <Pressable onPress={reload} style={({ pressed }) => [styles.chip, pressed && { opacity: 0.85 }]}>
          <Text style={styles.chipText}>Refresh</Text>
        </Pressable>
      </View>

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
      </View>

      {loading ? <ActivityIndicator color="#fff" style={{ marginTop: 10 }} /> : null}
      {error ? <Text style={styles.err}>{error}</Text> : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Players ({rows.length})</Text>
        {rows.length === 0 ? <Text style={styles.muted}>No results.</Text> : null}
        {rows.map((r) => {
          const userId = s(r.user_id || r.id).trim();
          if (!userId) return null;
          const eff = s(r.effective_standing).trim() || "good";
          const label = pickRowLabel(r);
          const isBusy = busyId === userId;
          return (
            <View key={userId} style={styles.person}>
              <View style={{ flex: 1 }}>
                <Text style={styles.personName}>{label}</Text>
                <Text style={styles.personSub}>
                  {userId} · eff: {eff} · score: {s(r.reliability_score_pct) || "—"} · tracked:{" "}
                  {s(r.reliability_tracked_pickups) || "0"}
                </Text>
              </View>
              <Pressable
                disabled={isBusy}
                onPress={() => void setStanding(userId, "good")}
                style={({ pressed }) => [styles.smallChip, pressed && { opacity: 0.85 }, isBusy && styles.disabled]}
              >
                <Text style={styles.smallChipText}>Good</Text>
              </Pressable>
              <Pressable
                disabled={isBusy}
                onPress={() => void setStanding(userId, "warning")}
                style={({ pressed }) => [styles.smallChipWarn, pressed && { opacity: 0.85 }, isBusy && styles.disabled]}
              >
                <Text style={styles.smallChipText}>Warn</Text>
              </Pressable>
              <Pressable
                disabled={isBusy}
                onPress={() => void setStanding(userId, "suspended")}
                style={({ pressed }) => [styles.smallChipAlt, pressed && { opacity: 0.85 }, isBusy && styles.disabled]}
              >
                <Text style={styles.smallChipText}>Susp</Text>
              </Pressable>
              <Pressable
                disabled={isBusy}
                onPress={() =>
                  Alert.alert("Ban player?", "This is a manual standing override.", [
                    { text: "Nevermind", style: "cancel" },
                    { text: "Ban", style: "destructive", onPress: () => void setStanding(userId, "banned") },
                  ])
                }
                style={({ pressed }) => [styles.smallChipBan, pressed && { opacity: 0.85 }, isBusy && styles.disabled]}
              >
                <Text style={styles.smallChipText}>Ban</Text>
              </Pressable>
              <Pressable
                disabled={isBusy}
                onPress={() => void setStanding(userId, null)}
                style={({ pressed }) => [styles.smallChipClear, pressed && { opacity: 0.85 }, isBusy && styles.disabled]}
              >
                <Text style={styles.smallChipText}>Clear</Text>
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
  label: { marginTop: 10, fontSize: 12, fontWeight: "700", color: "rgba(255,255,255,0.55)" },
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
  muted: { marginTop: 10, color: "rgba(255,255,255,0.6)" },
  person: { marginTop: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  personName: { color: "#fff", fontWeight: "800" },
  personSub: { marginTop: 2, color: "rgba(255,255,255,0.45)", fontSize: 12, lineHeight: 16 },
  smallChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.25)",
    backgroundColor: "rgba(163,230,53,0.1)",
  },
  smallChipWarn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.25)",
    backgroundColor: "rgba(251,191,36,0.1)",
  },
  smallChipAlt: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(96,165,250,0.25)",
    backgroundColor: "rgba(96,165,250,0.1)",
  },
  smallChipBan: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.25)",
    backgroundColor: "rgba(248,113,113,0.1)",
  },
  smallChipClear: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  smallChipText: { color: "#fff", fontWeight: "900", fontSize: 11 },
  disabled: { opacity: 0.55 },
});

