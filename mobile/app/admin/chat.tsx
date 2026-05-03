import { useAdminChatRooms } from "@/hooks/useAdminChatRooms";
import { deleteAdminChatRoom, patchAdminChatRoom, postAdminAnnouncement, postAdminChatRoom, type ChatRoom } from "@/lib/adminApi";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

const LIME = "#a3e635";

function fmtRoomLine(r: ChatRoom): string {
  const bits: string[] = [];
  bits.push(r.is_active ? "active" : "inactive");
  if (r.announcements_only) bits.push("announcements-only");
  if (r.closes_at) bits.push(`closes ${r.closes_at}`);
  return bits.join(" · ");
}

export default function AdminChatScreen() {
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const router = useRouter();
  const { loading, error, rooms, reload } = useAdminChatRooms();

  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [annOnly, setAnnOnly] = useState(false);
  const [announceDraft, setAnnounceDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function createRoom() {
    if (!token) return Alert.alert("Not signed in", "Sign in again.");
    const s = slug.trim();
    const t = title.trim();
    if (!s || !t) return Alert.alert("Missing fields", "Room ID and title are required.");
    setBusy("create");
    const r = await postAdminChatRoom(token, { slug: s, title: t, announcements_only: annOnly });
    setBusy(null);
    if (!r.ok) return Alert.alert("Create failed", r.error);
    setSlug("");
    setTitle("");
    setAnnOnly(false);
    reload();
  }

  async function toggleActive(room: ChatRoom) {
    if (!token) return Alert.alert("Not signed in", "Sign in again.");
    setBusy(`toggle:${room.id}`);
    const r = await patchAdminChatRoom(token, room.id, { is_active: !room.is_active });
    setBusy(null);
    if (!r.ok) return Alert.alert("Update failed", r.error);
    reload();
  }

  function confirmDelete(room: ChatRoom) {
    if (!token) return Alert.alert("Not signed in", "Sign in again.");
    Alert.alert(
      "Delete room?",
      `This will permanently delete “${room.title}” and all of its messages.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            setBusy(`delete:${room.id}`);
            void (async () => {
              const r = await deleteAdminChatRoom(token, room.id);
              setBusy(null);
              if (!r.ok) return Alert.alert("Delete failed", r.error);
              reload();
            })();
          },
        },
      ],
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.rowBetween}>
        <Text style={styles.h1}>Chat</Text>
        <Pressable onPress={reload} style={({ pressed }) => [styles.chip, pressed && { opacity: 0.85 }]}>
          <Text style={styles.chipText}>Refresh</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Create room</Text>
        <Text style={styles.label}>Room ID</Text>
        <TextInput
          style={styles.input}
          value={slug}
          onChangeText={setSlug}
          placeholder="ct-announcements"
          placeholderTextColor="rgba(255,255,255,0.35)"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={styles.label}>Title</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="Announcements"
          placeholderTextColor="rgba(255,255,255,0.35)"
        />
        <View style={[styles.rowBetween, { marginTop: 12 }]}>
          <Text style={styles.labelInline}>Announcements only</Text>
          <Switch
            value={annOnly}
            onValueChange={setAnnOnly}
            trackColor={{ false: "rgba(255,255,255,0.18)", true: LIME }}
            thumbColor="#f4f4f5"
          />
        </View>
        <Pressable
          onPress={() => void createRoom()}
          disabled={busy === "create"}
          style={({ pressed }) => [styles.primary, pressed && { opacity: 0.9 }, busy === "create" && styles.disabled]}
        >
          <Text style={styles.primaryText}>{busy === "create" ? "Creating..." : "Create"}</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Post announcement</Text>
        <Text style={styles.bodyMuted}>
          Sends to the announcements-only room and triggers a push notification for everyone with notifications enabled.
        </Text>
        <TextInput
          style={[styles.input, styles.inputMulti]}
          value={announceDraft}
          onChangeText={setAnnounceDraft}
          placeholder="Write an update…"
          placeholderTextColor="rgba(255,255,255,0.35)"
          multiline
        />
        <Pressable
          onPress={() => {
            if (!token) return Alert.alert("Not signed in", "Sign in again.");
            const msg = announceDraft.trim();
            if (!msg) return Alert.alert("Missing message", "Write an announcement.");
            setBusy("announce");
            void (async () => {
              const r = await postAdminAnnouncement(token, { room_slug: "announcements", message: msg });
              setBusy(null);
              if (!r.ok) return Alert.alert("Send failed", r.error);
              setAnnounceDraft("");
              Alert.alert("Sent", `Announcement posted. Push sent to ${r.data?.pushed ?? 0} devices.`);
            })();
          }}
          disabled={busy === "announce"}
          style={({ pressed }) => [styles.primary, pressed && { opacity: 0.9 }, busy === "announce" && styles.disabled]}
        >
          <Text style={styles.primaryText}>{busy === "announce" ? "Sending..." : "Send announcement"}</Text>
        </Pressable>
      </View>

      {loading ? <ActivityIndicator color="#fff" style={{ marginTop: 10 }} /> : null}
      {error ? <Text style={styles.err}>{error}</Text> : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Rooms ({rooms.length})</Text>
        {rooms.map((r) => {
          const isBusyToggle = busy === `toggle:${r.id}`;
          const isBusyDelete = busy === `delete:${r.id}`;
          const anyBusy = isBusyToggle || isBusyDelete;
          return (
            <Pressable
              key={r.id}
              onPress={() => router.push({ pathname: "/admin/chat-room", params: { roomId: r.id } })}
              style={({ pressed }) => [styles.roomRow, pressed && { opacity: 0.9 }, anyBusy && styles.disabled]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.roomTitle}>{r.title}</Text>
                <Text style={styles.roomSub}>
                  {r.slug} · {fmtRoomLine(r)}
                </Text>
              </View>
              <Pressable
                onPress={(e) => {
                  e.stopPropagation();
                  confirmDelete(r);
                }}
                disabled={anyBusy}
                style={({ pressed }) => [styles.smallChip, styles.smallChipDanger, pressed && { opacity: 0.85 }, anyBusy && styles.disabled]}
              >
                <Text style={styles.smallChipDangerText}>{isBusyDelete ? "Deleting..." : "Delete"}</Text>
              </Pressable>
              <Pressable
                onPress={(e) => {
                  e.stopPropagation();
                  void toggleActive(r);
                }}
                disabled={anyBusy}
                style={({ pressed }) => [styles.smallChip, pressed && { opacity: 0.85 }, anyBusy && styles.disabled]}
              >
                <Text style={styles.smallChipText}>{isBusyToggle ? "Saving..." : r.is_active ? "Disable" : "Enable"}</Text>
              </Pressable>
            </Pressable>
          );
        })}
        {rooms.length === 0 ? <Text style={styles.muted}>No rooms.</Text> : null}
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
  inputMulti: { minHeight: 88, textAlignVertical: "top" },
  primary: {
    marginTop: 14,
    backgroundColor: LIME,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryText: { color: "#111", fontWeight: "900", fontSize: 15 },
  bodyMuted: { marginTop: 10, color: "rgba(255,255,255,0.6)", fontSize: 13.5, lineHeight: 19 },
  roomRow: { marginTop: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  roomTitle: { color: "#fff", fontWeight: "800" },
  roomSub: { marginTop: 2, color: "rgba(255,255,255,0.5)", fontSize: 12, lineHeight: 16 },
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
  muted: { marginTop: 10, color: "rgba(255,255,255,0.6)" },
  disabled: { opacity: 0.55 },
});

