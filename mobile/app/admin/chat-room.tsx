import {
  deleteAdminChatMessage,
  deleteAdminChatRoomMute,
  fetchAdminChatRoom,
  fetchAdminChatRoomMutes,
  patchAdminChatRoom,
  postAdminChatRoomMute,
  type ChatRoom,
} from "@/lib/adminApi";
import { useAuth } from "@/context/AuthContext";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Pressable,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

const LIME = "#a3e635";

type MuteRow = {
  id: string;
  user_id: string;
  muted_until: string | null;
  reason: string | null;
  created_at: string;
};

type ChatMessageRow = {
  id: string;
  body: string;
  sender_display_name: string;
  created_at: string;
};

type ProfileHit = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
};

function s(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function profileSearchOrFilter(q: string): string {
  const inner = q
    .trim()
    .replace(/%/g, "")
    .replace(/_/g, "")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ");
  const pat = `%${inner}%`;
  return `first_name.ilike.${pat},last_name.ilike.${pat},email.ilike.${pat}`;
}

function formatMsgTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export default function AdminChatRoomScreen() {
  const { session, supabase, isReady: authReady } = useAuth();
  const token = session?.access_token ?? null;
  const params = useLocalSearchParams();
  const roomId = useMemo(() => s(params.roomId).trim(), [params.roomId]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mutes, setMutes] = useState<MuteRow[]>([]);
  const [nonce, setNonce] = useState(0);

  const [room, setRoom] = useState<ChatRoom | null>(null);
  const [roomLoadErr, setRoomLoadErr] = useState<string | null>(null);
  const [draftActive, setDraftActive] = useState(true);
  const [draftAnnOnly, setDraftAnnOnly] = useState(false);
  const [draftClosesAt, setDraftClosesAt] = useState("");
  const [busyRoomSave, setBusyRoomSave] = useState(false);

  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [msgErr, setMsgErr] = useState<string | null>(null);

  const [userId, setUserId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const [profileQuery, setProfileQuery] = useState("");
  const [profileHits, setProfileHits] = useState<ProfileHit[]>([]);
  const [profileSearchBusy, setProfileSearchBusy] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function reload() {
    setNonce((n) => n + 1);
  }

  const loadMessages = useCallback(async () => {
    if (!supabase || !roomId) {
      setMessages([]);
      setMsgErr(!supabase ? "Supabase not configured." : null);
      return;
    }
    setMsgErr(null);
    const { data, error: qErr } = await supabase
      .from("chat_messages")
      .select("id,body,sender_display_name,created_at")
      .eq("room_id", roomId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (qErr) {
      setMsgErr(qErr.message);
      setMessages([]);
      return;
    }
    const rows = Array.isArray(data) ? (data as ChatMessageRow[]) : [];
    setMessages(rows.slice().reverse());
  }, [supabase, roomId]);

  useEffect(() => {
    if (!token) {
      setError("Not signed in.");
      setRoom(null);
      setRoomLoadErr(null);
      setMutes([]);
      return;
    }
    if (!roomId) {
      setError("Missing roomId.");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRoomLoadErr(null);
    void (async () => {
      const [roomR, mutesR] = await Promise.all([fetchAdminChatRoom(token, roomId), fetchAdminChatRoomMutes(token, roomId)]);
      if (cancelled) return;

      if (!roomR.ok) {
        setRoom(null);
        setRoomLoadErr(roomR.error);
      } else {
        const r = (roomR.data as { room?: ChatRoom }).room;
        if (r) {
          setRoom(r);
          setDraftActive(r.is_active);
          setDraftAnnOnly(r.announcements_only);
          setDraftClosesAt(r.closes_at ? String(r.closes_at) : "");
        } else {
          setRoom(null);
          setRoomLoadErr("Room not found.");
        }
      }

      if (!mutesR.ok) {
        setError(mutesR.error);
        setMutes([]);
      } else {
        const rows = (mutesR.data as { mutes?: unknown }).mutes;
        setMutes(Array.isArray(rows) ? (rows as MuteRow[]) : []);
      }

      await loadMessages();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [token, roomId, nonce, loadMessages]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = profileQuery.trim();
    if (!authReady || !supabase || q.length < 2) {
      setProfileHits([]);
      setProfileSearchBusy(false);
      return;
    }
    setProfileSearchBusy(true);
    searchTimer.current = setTimeout(() => {
      void (async () => {
        const { data, error: qErr } = await supabase
          .from("profiles")
          .select("id,first_name,last_name,email")
          .or(profileSearchOrFilter(q))
          .limit(12);
        setProfileSearchBusy(false);
        if (qErr) {
          setProfileHits([]);
          return;
        }
        setProfileHits(Array.isArray(data) ? (data as ProfileHit[]) : []);
      })();
    }, 320);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [profileQuery, supabase, authReady]);

  async function saveRoomControls() {
    if (!token) return Alert.alert("Not signed in", "Sign in again.");
    if (!roomId) return;
    const rawClose = draftClosesAt.trim();
    let closes_at: string | null = null;
    if (rawClose) {
      const t = new Date(rawClose).getTime();
      if (Number.isNaN(t)) {
        return Alert.alert("Invalid date", "Enter closes_at as a valid ISO-8601 datetime, or leave blank.");
      }
      closes_at = new Date(rawClose).toISOString();
    }
    setBusyRoomSave(true);
    const r = await patchAdminChatRoom(token, roomId, {
      is_active: draftActive,
      announcements_only: draftAnnOnly,
      closes_at,
    });
    setBusyRoomSave(false);
    if (!r.ok) return Alert.alert("Save failed", r.error);
    const updated = (r.data as { room?: ChatRoom }).room;
    if (updated) {
      setRoom(updated);
      setDraftActive(updated.is_active);
      setDraftAnnOnly(updated.announcements_only);
      setDraftClosesAt(updated.closes_at ? String(updated.closes_at) : "");
    }
    Alert.alert("Saved", "Room settings updated.");
  }

  async function muteNow() {
    if (!token) return Alert.alert("Not signed in", "Sign in again.");
    if (!roomId) return;
    const uid = userId.trim();
    if (!uid) return Alert.alert("Missing user id", "Search for a user or paste their Supabase user id.");
    setBusy("mute");
    const r = await postAdminChatRoomMute(token, roomId, { user_id: uid, reason: reason.trim() || null, muted_until: null });
    setBusy(null);
    if (!r.ok) return Alert.alert("Mute failed", r.error);
    setUserId("");
    setReason("");
    setProfileQuery("");
    setProfileHits([]);
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

  function confirmDeleteMessage(m: ChatMessageRow) {
    if (!token) return Alert.alert("Not signed in", "Sign in again.");
    if (!roomId) return;
    Alert.alert("Delete message?", "This permanently removes the message.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          setBusy(`delmsg:${m.id}`);
          void (async () => {
            const r = await deleteAdminChatMessage(token, roomId, m.id);
            setBusy(null);
            if (!r.ok) return Alert.alert("Delete failed", r.error);
            await loadMessages();
          })();
        },
      },
    ]);
  }

  function pickProfile(p: ProfileHit) {
    setUserId(p.id);
    setProfileHits([]);
    setProfileQuery("");
  }

  const displayName = (p: ProfileHit) => {
    const n = [p.first_name, p.last_name].map((x) => String(x || "").trim()).filter(Boolean).join(" ");
    return n || p.email || p.id;
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 200 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.rowBetween}>
          <Text style={styles.h1}>Room</Text>
          <Pressable onPress={reload} style={({ pressed }) => [styles.chip, pressed && { opacity: 0.85 }]}>
            <Text style={styles.chipText}>Refresh</Text>
          </Pressable>
        </View>

        <Text style={styles.muted}>
          {room ? `${room.title} · ${room.slug}` : "—"} · id: {roomId || "—"}
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Room controls</Text>
          {loading && !room ? <ActivityIndicator color="#fff" style={{ marginTop: 12 }} /> : null}
          {roomLoadErr ? <Text style={styles.err}>{roomLoadErr}</Text> : null}
          {room ? (
            <>
              <View style={[styles.rowBetween, { marginTop: 12 }]}>
                <Text style={styles.labelInline}>Active (is_active)</Text>
                <Switch
                  value={draftActive}
                  onValueChange={setDraftActive}
                  trackColor={{ false: "rgba(255,255,255,0.18)", true: LIME }}
                  thumbColor="#f4f4f5"
                />
              </View>
              <View style={[styles.rowBetween, { marginTop: 12 }]}>
                <Text style={styles.labelInline}>Announcements only</Text>
                <Switch
                  value={draftAnnOnly}
                  onValueChange={setDraftAnnOnly}
                  trackColor={{ false: "rgba(255,255,255,0.18)", true: LIME }}
                  thumbColor="#f4f4f5"
                />
              </View>
              <Text style={styles.label}>closes_at (ISO, optional)</Text>
              <TextInput
                style={styles.input}
                value={draftClosesAt}
                onChangeText={setDraftClosesAt}
                placeholder="2026-05-04T18:00:00.000Z or leave empty"
                placeholderTextColor="rgba(255,255,255,0.35)"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Pressable
                onPress={() => void saveRoomControls()}
                disabled={busyRoomSave}
                style={({ pressed }) => [styles.primary, pressed && { opacity: 0.9 }, busyRoomSave && styles.disabled]}
              >
                <Text style={styles.primaryText}>{busyRoomSave ? "Saving..." : "Save"}</Text>
              </Pressable>
            </>
          ) : !roomLoadErr && !loading ? (
            <Text style={styles.muted}>No room data.</Text>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Recent messages ({messages.length})</Text>
          <Text style={styles.bodyMuted}>Last 20 in this room (oldest first).</Text>
          {msgErr ? <Text style={styles.err}>{msgErr}</Text> : null}
          {messages.length === 0 && !msgErr ? <Text style={styles.muted}>None</Text> : null}
          {messages.map((m) => {
            const delBusy = busy === `delmsg:${m.id}`;
            return (
              <View key={m.id} style={styles.msgRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.msgName}>{m.sender_display_name || "—"}</Text>
                  <Text style={styles.msgBody}>{m.body}</Text>
                  <Text style={styles.msgTime}>{formatMsgTime(m.created_at)}</Text>
                </View>
                <Pressable
                  onPress={() => confirmDeleteMessage(m)}
                  disabled={delBusy}
                  style={({ pressed }) => [
                    styles.smallChip,
                    styles.smallChipDanger,
                    pressed && { opacity: 0.85 },
                    delBusy && styles.disabled,
                  ]}
                >
                  <Text style={styles.smallChipDangerText}>{delBusy ? "..." : "Delete"}</Text>
                </Pressable>
              </View>
            );
          })}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Mute user</Text>
          <Text style={styles.label}>Find user</Text>
          <TextInput
            style={styles.input}
            value={profileQuery}
            onChangeText={setProfileQuery}
            placeholder="First name, last name, or email"
            placeholderTextColor="rgba(255,255,255,0.35)"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {profileSearchBusy ? <ActivityIndicator color="#fff" style={{ marginTop: 8 }} /> : null}
          {profileHits.length > 0 ? (
            <View style={styles.hitBox}>
              {profileHits.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => pickProfile(p)}
                  style={({ pressed }) => [styles.hitRow, pressed && { opacity: 0.85 }]}
                >
                  <Text style={styles.hitTitle}>{displayName(p)}</Text>
                  <Text style={styles.hitSub}>{p.email || p.id}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <Text style={styles.label}>User id</Text>
          <TextInput
            style={styles.input}
            value={userId}
            onChangeText={setUserId}
            placeholder="Supabase user id (uuid)"
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
    </KeyboardAvoidingView>
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
  bodyMuted: { marginTop: 8, color: "rgba(255,255,255,0.55)", fontSize: 13, lineHeight: 18 },
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
  labelInline: { fontSize: 13, fontWeight: "800", color: "rgba(255,255,255,0.75)" },
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
  msgRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  msgName: { color: LIME, fontWeight: "800", fontSize: 14 },
  msgBody: { marginTop: 4, color: "#fff", fontSize: 14, lineHeight: 20 },
  msgTime: { marginTop: 4, color: "rgba(255,255,255,0.45)", fontSize: 12 },
  smallChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  smallChipText: { color: "#fff", fontWeight: "900", fontSize: 12 },
  smallChipDanger: {
    borderColor: "rgba(248,113,113,0.35)",
    backgroundColor: "rgba(248,113,113,0.10)",
  },
  smallChipDangerText: { color: "#fecaca", fontWeight: "900", fontSize: 12 },
  hitBox: {
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.25)",
    overflow: "hidden",
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  hitRow: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)" },
  hitTitle: { color: "#fff", fontWeight: "800", fontSize: 14 },
  hitSub: { marginTop: 2, color: "rgba(255,255,255,0.5)", fontSize: 12 },
  disabled: { opacity: 0.55 },
});
