import { useAdminChatRooms } from "@/hooks/useAdminChatRooms";
import {
  deleteAdminChatRoom,
  patchAdminChatRoom,
  postAdminAnnouncement,
  postAdminChatRoom,
  type ChatRoom,
  type ChatRoomType,
} from "@/lib/adminApi";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
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

const LIME = "#a3e635";

type TierOption = {
  rank: number;
  label: string;
};

// Pickup tier mapping (see profiles.tier_rank comment): 1A=1, 1B=2, 2=3, 3=4, 4=5, PUBLIC=6.
const TIER_OPTIONS: TierOption[] = [
  { rank: 1, label: "1A" },
  { rank: 2, label: "1B" },
  { rank: 3, label: "2" },
  { rank: 4, label: "3" },
  { rank: 5, label: "4" },
  { rank: 6, label: "Public" },
];

type ProfileHit = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  tier_rank: number | null;
};

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

function profileLabel(p: ProfileHit): string {
  const name = [p.first_name, p.last_name].map((x) => String(x || "").trim()).filter(Boolean).join(" ");
  return name || p.email || p.id;
}

function fmtRoomLine(r: ChatRoom): string {
  const bits: string[] = [];
  bits.push(r.room_type || "public");
  bits.push(r.is_active ? "active" : "inactive");
  if (r.announcements_only && r.room_type !== "announcement") bits.push("announcements-only");
  if (r.closes_at) bits.push(`closes ${r.closes_at}`);
  return bits.join(" · ");
}

export default function AdminChatScreen() {
  const { session, supabase, isReady: authReady } = useAuth();
  const token = session?.access_token ?? null;
  const router = useRouter();
  const { loading, error, rooms, reload } = useAdminChatRooms();

  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [roomType, setRoomType] = useState<ChatRoomType>("public");
  const [tierRanks, setTierRanks] = useState<Set<number>>(new Set());
  const [pickedMembers, setPickedMembers] = useState<ProfileHit[]>([]);
  const [memberQuery, setMemberQuery] = useState("");
  const [memberHits, setMemberHits] = useState<ProfileHit[]>([]);
  const [memberSearchBusy, setMemberSearchBusy] = useState(false);
  const memberSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [announceDraft, setAnnounceDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  // Live profile search for Group room member picker.
  useEffect(() => {
    if (memberSearchTimer.current) clearTimeout(memberSearchTimer.current);
    const q = memberQuery.trim();
    if (!authReady || !supabase || roomType !== "group" || q.length < 2) {
      setMemberHits([]);
      setMemberSearchBusy(false);
      return;
    }
    setMemberSearchBusy(true);
    memberSearchTimer.current = setTimeout(() => {
      void (async () => {
        const { data, error: qErr } = await supabase
          .from("profiles")
          .select("id,first_name,last_name,email,tier_rank")
          .or(profileSearchOrFilter(q))
          .limit(12);
        setMemberSearchBusy(false);
        if (qErr) {
          setMemberHits([]);
          return;
        }
        setMemberHits(Array.isArray(data) ? (data as ProfileHit[]) : []);
      })();
    }, 320);
    return () => {
      if (memberSearchTimer.current) clearTimeout(memberSearchTimer.current);
    };
  }, [memberQuery, supabase, authReady, roomType]);

  const pickedMemberIds = useMemo(() => new Set(pickedMembers.map((p) => p.id)), [pickedMembers]);

  function toggleTierRank(rank: number) {
    setTierRanks((prev) => {
      const next = new Set(prev);
      if (next.has(rank)) next.delete(rank);
      else next.add(rank);
      return next;
    });
  }

  function addMember(p: ProfileHit) {
    if (pickedMemberIds.has(p.id)) return;
    setPickedMembers((prev) => [...prev, p]);
    setMemberQuery("");
    setMemberHits([]);
  }

  function removeMember(id: string) {
    setPickedMembers((prev) => prev.filter((p) => p.id !== id));
  }

  function resetCreateForm() {
    setSlug("");
    setTitle("");
    setRoomType("public");
    setTierRanks(new Set());
    setPickedMembers([]);
    setMemberQuery("");
    setMemberHits([]);
  }

  async function createRoom() {
    if (!token) return Alert.alert("Not signed in", "Sign in again.");
    const s = slug.trim();
    const t = title.trim();
    if (!s || !t) return Alert.alert("Missing fields", "Room ID and title are required.");

    const tiersArr = Array.from(tierRanks);
    const memberIds = pickedMembers.map((p) => p.id);

    if (roomType === "group" && tiersArr.length === 0 && memberIds.length === 0) {
      return Alert.alert(
        "Group needs members",
        "Pick at least one tier or add specific members so the room isn’t empty.",
      );
    }

    setBusy("create");
    const r = await postAdminChatRoom(token, {
      slug: s,
      title: t,
      room_type: roomType,
      announcements_only: roomType === "announcement",
      ...(roomType === "group"
        ? {
            member_tier_ranks: tiersArr,
            member_user_ids: memberIds,
          }
        : {}),
    });
    setBusy(null);
    if (!r.ok) return Alert.alert("Create failed", r.error);

    const data = r.data;
    if (data?.member_error) {
      Alert.alert(
        "Room created with warnings",
        `Some members failed to add: ${data.member_error}`,
      );
    } else if (roomType === "group" && data) {
      Alert.alert("Group room created", `Added ${data.member_count ?? 0} members.`);
    }

    resetCreateForm();
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
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 200 }]}
        keyboardShouldPersistTaps="handled"
      >
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

        <Text style={styles.label}>Room type</Text>
        <View style={styles.segmentRow}>
          {(["public", "announcement", "group"] as ChatRoomType[]).map((type) => {
            const active = roomType === type;
            const label = type === "public" ? "Public" : type === "announcement" ? "Announcement" : "Group";
            return (
              <Pressable
                key={type}
                onPress={() => setRoomType(type)}
                style={({ pressed }) => [
                  styles.segment,
                  active && styles.segmentActive,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>

        {roomType === "group" ? (
          <>
            <Text style={styles.label}>Tiers (auto-add everyone with these tiers)</Text>
            <View style={styles.tierRow}>
              {TIER_OPTIONS.map((opt) => {
                const checked = tierRanks.has(opt.rank);
                return (
                  <Pressable
                    key={opt.rank}
                    onPress={() => toggleTierRank(opt.rank)}
                    style={({ pressed }) => [
                      styles.tierChip,
                      checked && styles.tierChipActive,
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    <Text style={[styles.tierChipText, checked && styles.tierChipTextActive]}>{opt.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.label}>Add specific members</Text>
            <TextInput
              style={styles.input}
              value={memberQuery}
              onChangeText={setMemberQuery}
              placeholder="First name, last name, or email"
              placeholderTextColor="rgba(255,255,255,0.35)"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {memberSearchBusy ? <ActivityIndicator color="#fff" style={{ marginTop: 8 }} /> : null}
            {memberHits.length > 0 ? (
              <View style={styles.hitBox}>
                {memberHits.map((p) => {
                  const already = pickedMemberIds.has(p.id);
                  return (
                    <Pressable
                      key={p.id}
                      onPress={() => addMember(p)}
                      disabled={already}
                      style={({ pressed }) => [styles.hitRow, pressed && !already && { opacity: 0.85 }, already && styles.disabled]}
                    >
                      <Text style={styles.hitTitle}>{profileLabel(p)}</Text>
                      <Text style={styles.hitSub}>
                        {p.email || p.id}
                        {p.tier_rank != null ? ` · tier_rank ${p.tier_rank}` : ""}
                        {already ? " · added" : ""}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            {pickedMembers.length > 0 ? (
              <View style={{ marginTop: 10 }}>
                <Text style={styles.label}>Selected ({pickedMembers.length})</Text>
                {pickedMembers.map((p) => (
                  <View key={p.id} style={styles.memberRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberName}>{profileLabel(p)}</Text>
                      <Text style={styles.memberSub}>{p.email || p.id}</Text>
                    </View>
                    <Pressable
                      onPress={() => removeMember(p.id)}
                      style={({ pressed }) => [styles.smallChip, styles.smallChipDanger, pressed && { opacity: 0.85 }]}
                    >
                      <Text style={styles.smallChipDangerText}>Remove</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        ) : null}

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
  segmentRow: {
    marginTop: 8,
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  segment: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  segmentActive: {
    borderColor: LIME,
    backgroundColor: "rgba(163,230,53,0.18)",
  },
  segmentText: { color: "rgba(255,255,255,0.75)", fontWeight: "800", fontSize: 13 },
  segmentTextActive: { color: LIME },
  tierRow: { marginTop: 8, flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tierChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  tierChipActive: { borderColor: LIME, backgroundColor: "rgba(163,230,53,0.18)" },
  tierChipText: { color: "rgba(255,255,255,0.75)", fontWeight: "800", fontSize: 12 },
  tierChipTextActive: { color: LIME },
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
  memberRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  memberName: { color: "#fff", fontWeight: "800", fontSize: 13 },
  memberSub: { marginTop: 2, color: "rgba(255,255,255,0.5)", fontSize: 11 },
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
