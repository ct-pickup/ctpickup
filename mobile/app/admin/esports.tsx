import { useAdminEsportsTournaments } from "@/hooks/useAdminEsportsTournaments";
import { patchAdminEsportsTournamentStatus, type AdminEsportsTournamentRow } from "@/lib/adminApi";
import { useAuth } from "@/context/AuthContext";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

const LIME = "#a3e635";

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

function statusLabel(s: string): string {
  if (s === "active") return "Active";
  if (s === "completed") return "Completed";
  return "Upcoming";
}

export default function AdminEsportsScreen() {
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const { loading, error, tournaments, reload } = useAdminEsportsTournaments();
  const [busy, setBusy] = useState<string | null>(null);

  async function setStatus(row: AdminEsportsTournamentRow, status: "upcoming" | "active" | "completed") {
    if (!token) return Alert.alert("Not signed in", "Sign in again.");
    setBusy(`${row.id}:${status}`);
    const r = await patchAdminEsportsTournamentStatus(token, row.id, status);
    setBusy(null);
    if (!r.ok) return Alert.alert("Update failed", r.error);
    reload();
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.rowBetween}>
        <Text style={styles.h1}>Esports</Text>
        <Pressable onPress={reload} style={({ pressed }) => [styles.chip, pressed && { opacity: 0.85 }]}>
          <Text style={styles.chipText}>Refresh</Text>
        </Pressable>
      </View>

      <Text style={styles.bodyMuted}>
        Control whether a digital tournament shows as upcoming, active (live on `/esports/tournaments`), or completed.
        Create or edit full details on the web admin.
      </Text>

      {loading ? <ActivityIndicator color="#fff" style={{ marginTop: 16 }} /> : null}
      {error ? <Text style={styles.err}>{error}</Text> : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Tournaments ({tournaments.length})</Text>
        {tournaments.map((t, i) => {
          const st = String(t.status || "").toLowerCase();
          const anyBusy = busy?.startsWith(`${t.id}:`) ?? false;
          return (
            <View key={t.id} style={[styles.block, i === 0 && styles.blockFirst]}>
              <View style={styles.rowTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>{t.title}</Text>
                  <Text style={styles.sub}>
                    {t.game} · {statusLabel(st)}
                  </Text>
                  <Text style={styles.sub}>
                    {fmtShort(t.start_date)} → {fmtShort(t.end_date)}
                  </Text>
                </View>
              </View>
              <View style={styles.actions}>
                {st !== "upcoming" ? (
                  <Pressable
                    onPress={() =>
                      Alert.alert("Set upcoming?", `Mark “${t.title}” as upcoming? It will be hidden from the public list until started.`, [
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
                      Alert.alert("Start tournament?", `Mark “${t.title}” as active? It will appear on the public esports hub.`, [
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
                      Alert.alert("Complete tournament?", `Mark “${t.title}” as completed? It will leave the public active/upcoming list.`, [
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
        {tournaments.length === 0 && !loading ? (
          <Text style={styles.muted}>No esports tournaments yet. Create one on the web admin.</Text>
        ) : null}
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
  bodyMuted: { marginTop: 12, color: "rgba(255,255,255,0.6)", fontSize: 13.5, lineHeight: 19 },
  err: { marginTop: 12, color: "#fca5a5" },
  card: {
    marginTop: 14,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  cardTitle: { fontSize: 16, fontWeight: "800", color: "#fff" },
  block: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  blockFirst: { marginTop: 4, paddingTop: 0, borderTopWidth: 0 },
  rowTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  title: { color: "#fff", fontWeight: "800", fontSize: 15 },
  sub: { marginTop: 4, color: "rgba(255,255,255,0.5)", fontSize: 12, lineHeight: 16 },
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
  disabled: { opacity: 0.55 },
});
