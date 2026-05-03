import { deleteAdminChatRoomMute, fetchAdminChatRoomMutes, postAdminChatRoomMute } from "@/lib/adminApi";
import { useAuth } from "@/context/AuthContext";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

const LIME = "#a3e635";

type MuteRow = {
  id: string;
  user_id: string;
  muted_until: string | null;
  reason: string | null;
  created_at: string;
};

function s(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

export default function AdminChatRoomScreen() {
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const params = useLocalSearchParams();
  const roomId = useMemo(() => s(params.roomId).trim(), [params.roomId]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mutes, setMutes] = useState<MuteRow[]>([]);
  const [nonce, setNonce] = useState(0);

  const [userId, setUserId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  function reload() {
    setNonce((n) => n + 1);
  }

  useEffect(() => {
    if (!token) {
      setError("Not signed in.");
      return;
    }
    if (!roomId) {
      setError("Missing roomId.");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      const r = await fetchAdminChatRoomMutes(token, roomId);
      if (cancelled) return;
      if (!r.ok) {
        setError(r.error);
        setMutes([]);
      } else {
        const rows = (r.data as { mutes?: unknown }).mutes;
        setMutes(Array.isArray(rows) ? (rows as MuteRow[]) : []);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [token, roomId, nonce]);

  async function muteNow() {
    if (!token) return Alert.alert("Not signed in", "Sign in again.");
    if (!roomId) return;
    const uid = userId.trim();
    if (!uid) return Alert.alert("Missing user id", "Paste the Supabase user id to mute.");
    setBusy("mute");
    const r = await postAdminChatRoomMute(token, roomId, { user_id: uid, reason: reason.trim() || null, muted_until: null });
    setBusy(null);
    if (!r.ok) return Alert.alert("Mute failed", r.error);
    setUserId("");
    setReason("");
    reload();
  }

  async function unmute(uid: string) {
    if (!token) return Alert.alert("Not signed in", "Sign in again.");
    if (!roomId) return;
    setBusy(`unmute:${uid}`);
    const r = await deleteAdminChatRoomMute(token, roomId, uid);
    setBusy(null);
    if (!r.ok) return Alert.alert("Unmute failed", r.error);
    reload();
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.rowBetween}>
        <Text style={styles.h1}>Room mutes</Text>
        <Pressable onPress={reload} style={({ pressed }) => [styles.chip, pressed && { opacity: 0.85 }]}>
          <Text style={styles.chipText}>Refresh</Text>
        </Pressable>
      </View>

      <Text style={styles.muted}>Room: {roomId || "—"}</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Mute user</Text>
        <Text style={styles.label}>User id</Text>
        <TextInput
          style={styles.input}
          value={userId}
          onChangeText={setUserId}
          placeholder="Supabase user id"
          placeholderTextColor="rgba(255,255,255,0.35)"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={styles.label}>Reason (optional)</Text>
        <TextInput
          style={styles.input}
          value={reason}
          onChangeText={setReason}
          placeholder="Spam, abuse…"
          placeholderTextColor="rgba(255,255,255,0.35)"
        />
        <Pressable
          onPress={() => void muteNow()}
          disabled={busy === "mute"}
          style={({ pressed }) => [styles.primary, pressed && { opacity: 0.9 }, busy === "mute" && styles.disabled]}
        >
          <Text style={styles.primaryText}>{busy === "mute" ? "Muting..." : "Mute"}</Text>
        </Pressable>
      </View>

      {loading ? <ActivityIndicator color="#fff" style={{ marginTop: 10 }} /> : null}
      {error ? <Text style={styles.err}>{error}</Text> : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Active mutes ({mutes.length})</Text>
        {mutes.length === 0 ? <Text style={styles.muted}>None</Text> : null}
        {mutes.map((m) => {
          const isBusy = busy === `unmute:${m.user_id}`;
          return (
            <View key={m.id} style={styles.muteRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.muteUser}>{m.user_id}</Text>
                <Text style={styles.muteSub}>
                  {m.reason ? `Reason: ${m.reason} · ` : ""}
                  {m.muted_until ? `Until: ${m.muted_until} · ` : ""}
                  Created: {m.created_at}
                </Text>
              </View>
              <Pressable
                onPress={() =>
                  Alert.alert("Unmute?", "Remove the mute for this user in this room.", [
                    { text: "Nevermind", style: "cancel" },
                    { text: "Unmute", style: "destructive", onPress: () => void unmute(m.user_id) },
                  ])
                }
                disabled={isBusy}
                style={({ pressed }) => [styles.smallChip, pressed && { opacity: 0.85 }, isBusy && styles.disabled]}
              >
                <Text style={styles.smallChipText}>{isBusy ? "..." : "Unmute"}</Text>
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
  muted: { marginTop: 10, color: "rgba(255,255,255,0.6)" },
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
  primary: {
    marginTop: 14,
    backgroundColor: LIME,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryText: { color: "#111", fontWeight: "900", fontSize: 15 },
  muteRow: { marginTop: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  muteUser: { color: "#fff", fontWeight: "800" },
  muteSub: { marginTop: 2, color: "rgba(255,255,255,0.5)", fontSize: 12, lineHeight: 16 },
  smallChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.25)",
    backgroundColor: "rgba(248,113,113,0.1)",
  },
  smallChipText: { color: "#fff", fontWeight: "900", fontSize: 12 },
  disabled: { opacity: 0.55 },
});

