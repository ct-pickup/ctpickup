import { useAdminOutdoorTournaments } from "@/hooks/useAdminOutdoorTournaments";
import { postAdminSetHubTournament, type AdminOutdoorTournament } from "@/lib/adminApi";
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

function fmtMeta(t: AdminOutdoorTournament): string {
  const bits: string[] = [];
  if (t.target_teams != null) bits.push(`target ${t.target_teams}`);
  if (t.official_threshold != null) bits.push(`official >=${t.official_threshold}`);
  if (t.max_teams != null) bits.push(`max ${t.max_teams}`);
  return bits.length ? bits.join(" · ") : "—";
}

export default function AdminTournamentScreen() {
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const { loading, error, tournaments, reload } = useAdminOutdoorTournaments();
  const [busy, setBusy] = useState<string | null>(null);

  const hasLive = tournaments.some((t) => t.is_active);

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

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.rowBetween}>
        <Text style={styles.h1}>Tournaments</Text>
        <Pressable onPress={reload} style={({ pressed }) => [styles.chip, pressed && { opacity: 0.85 }]}>
          <Text style={styles.chipText}>Refresh</Text>
        </Pressable>
      </View>

      <Text style={styles.bodyMuted}>
        Choose which outdoor / captain tournament appears on the website hub (`/tournament`). Only one can be live at a
        time.
      </Text>

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

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Tournaments ({tournaments.length})</Text>
        {tournaments.map((t) => {
          const isLive = !!t.is_active;
          const isRowBusy = busy === `hub:${t.id}`;
          return (
            <View key={t.id} style={styles.roomRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.roomTitle}>
                  {t.title || "Untitled"}
                  {isLive ? <Text style={styles.liveBadge}> · LIVE</Text> : null}
                </Text>
                <Text style={styles.roomSub}>
                  {t.slug || "—"} · {fmtMeta(t)}
                </Text>
              </View>
              {!isLive ? (
                <Pressable
                  onPress={() =>
                    Alert.alert("Make live?", `Set “${t.title}” as the only live tournament on the hub?`, [
                      { text: "Cancel", style: "cancel" },
                      { text: "Make live", onPress: () => void setHub(t.id) },
                    ])
                  }
                  disabled={busy !== null}
                  style={({ pressed }) => [styles.smallChip, styles.smallChipPrimary, pressed && { opacity: 0.85 }, busy !== null && styles.disabled]}
                >
                  <Text style={styles.smallChipPrimaryText}>{isRowBusy ? "…" : "Make live"}</Text>
                </Pressable>
              ) : (
                <View style={styles.smallChipMuted}>
                  <Text style={styles.smallChipMutedText}>Hub</Text>
                </View>
              )}
            </View>
          );
        })}
        {tournaments.length === 0 && !loading ? <Text style={styles.muted}>No tournaments yet. Create one on the web admin.</Text> : null}
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
  roomRow: { marginTop: 12, flexDirection: "row", alignItems: "center", gap: 10 },
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
});
