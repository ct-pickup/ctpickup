import FontAwesome from "@expo/vector-icons/FontAwesome";
import { SignInPanel } from "@/components/SignInPanel";
import { useAuth } from "@/context/AuthContext";
import {
  normalizeChatSenderDisplayForMatch,
  useChatAdminUserIds,
  useTeamChatAccess,
  useTeamChatMessages,
  useTeamChatRoom,
} from "@/hooks/useTeamChat";
import { ANNOUNCEMENTS_CHAT_SLUG, TEAM_CHAT_SLUG, useUserChatRooms, type ChatRoomSummary } from "@/lib/teamChat";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

const LIME = "#a3e635";

type SwitchChip =
  | { kind: "slug"; key: string; slug: string; label: string }
  | { kind: "id"; key: string; id: string; label: string };

/**
 * Builds the chip list for the room switcher. Always shows Announcements first
 * and Team chat second (even before they load — they fall back to the
 * hardcoded slug/title), then any group rooms the user belongs to in the order
 * returned by RLS.
 */
function buildSwitchChips(rooms: ChatRoomSummary[]): SwitchChip[] {
  const bySlug = new Map(rooms.map((r) => [r.slug, r] as const));

  const announcements = bySlug.get(ANNOUNCEMENTS_CHAT_SLUG);
  const team = bySlug.get(TEAM_CHAT_SLUG);

  const chips: SwitchChip[] = [
    {
      kind: "slug",
      key: `slug:${ANNOUNCEMENTS_CHAT_SLUG}`,
      slug: ANNOUNCEMENTS_CHAT_SLUG,
      label: announcements?.title || "Announcements",
    },
    {
      kind: "slug",
      key: `slug:${TEAM_CHAT_SLUG}`,
      slug: TEAM_CHAT_SLUG,
      label: team?.title || "Team chat",
    },
  ];

  for (const r of rooms) {
    if (r.room_type !== "group") continue;
    chips.push({
      kind: "id",
      key: `id:${r.id}`,
      id: r.id,
      label: r.title,
    });
  }

  return chips;
}

export default function TeamChatThreadScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { isReady, session } = useAuth();
  const signedIn = !!session?.user?.id;

  const { allowed, isAdmin } = useTeamChatAccess();
  const enabled = signedIn && allowed === true;
  const slugParam = typeof params.slug === "string" ? params.slug : Array.isArray(params.slug) ? params.slug[0] : null;
  const idParam = typeof params.id === "string" ? params.id : Array.isArray(params.id) ? params.id[0] : null;
  const trimmedId = idParam ? idParam.trim() : "";
  const trimmedSlug = slugParam ? slugParam.trim() : "";
  const lookup = trimmedId
    ? ({ id: trimmedId } as const)
    : ({ slug: trimmedSlug || ANNOUNCEMENTS_CHAT_SLUG } as const);
  const { room, loading: roomLoading, error: roomError } = useTeamChatRoom(enabled, lookup);
  const roomId = room?.id ?? null;
  const activeSlug = room?.slug ?? (trimmedId ? null : trimmedSlug || ANNOUNCEMENTS_CHAT_SLUG);
  const activeId = room?.id ?? (trimmedId || null);

  const { rooms: userRooms } = useUserChatRooms(enabled);
  const switchChips = useMemo(() => buildSwitchChips(userRooms), [userRooms]);

  const { messages, loading: msgsLoading, error: msgsError, send, currentUserId } = useTeamChatMessages(roomId);
  const { adminIds, adminSenderDisplayNorms } = useChatAdminUserIds(enabled);

  const [draft, setDraft] = useState("");
  const [sendBusy, setSendBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const listRef = useRef<FlatList<unknown> | null>(null);

  const announcementsOnly = !!room?.announcements_only;
  /** Group threads use `id` routing; slug threads are announcements / team. */
  const isGroupRoom = !!trimmedId;
  const canCompose = useMemo(() => {
    if (!roomId) return false;
    if (isAdmin === true) return true;
    return enabled === true && announcementsOnly === false;
  }, [roomId, isAdmin, enabled, announcementsOnly]);

  async function onSend() {
    const body = draft.trim();
    if (!body || sendBusy || !canCompose) return;
    setSendBusy(true);
    setSendError(null);
    const res = await send(body);
    setSendBusy(false);
    if (!res.ok) {
      const msg = res.error || "Could not send.";
      if (msg.toLowerCase().includes("row-level security")) {
        setSendError("You can’t send right now (muted, closed, or announcements-only).");
      } else {
        setSendError(msg);
      }
      return;
    }
    setDraft("");
    requestAnimationFrame(() => {
      try {
        listRef.current?.scrollToEnd({ animated: true });
      } catch {
        // ignore
      }
    });
  }

  if (!isReady) {
    return (
      <View style={styles.screenCenter}>
        <ActivityIndicator color={LIME} />
      </View>
    );
  }

  if (!signedIn) {
    return (
      <View style={styles.screenPad}>
        <Text style={styles.title}>Team chat</Text>
        <Text style={styles.body}>Sign in to view announcements and team updates.</Text>
        <View style={styles.signInWrap}>
          <SignInPanel />
        </View>
      </View>
    );
  }

  if (allowed === false) {
    return (
      <View style={styles.screenCenter}>
        <View style={styles.iconWrap}>
          <FontAwesome name="comment-o" size={28} color="#0a0a0a" />
        </View>
        <Text style={styles.title}>Messaging isn’t unlocked yet</Text>
        <Text style={styles.body}>Once your player profile is approved, you’ll see team updates and run reminders here.</Text>
      </View>
    );
  }

  if (roomLoading) {
    return (
      <View style={styles.screenCenter}>
        <ActivityIndicator color={LIME} />
      </View>
    );
  }

  if (roomError) {
    return (
      <View style={styles.screenCenter}>
        <Text style={styles.title}>Team chat</Text>
        <Text style={styles.body}>Couldn’t load chat: {roomError}</Text>
      </View>
    );
  }

  if (!room) {
    return (
      <View style={styles.screenCenter}>
        <View style={styles.iconWrap}>
          <FontAwesome name="comment-o" size={28} color="#0a0a0a" />
        </View>
        <Text style={styles.title}>Team chat is off</Text>
        <Text style={styles.body}>Messaging can be turned on for specific sessions. Check again later.</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 84 : 0}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.switchRowWrap}
        contentContainerStyle={styles.switchRow}
      >
        {switchChips.map((chip) => {
          const isActive = chip.kind === "id" ? chip.id === activeId : chip.slug === activeSlug;
          return (
            <Pressable
              key={chip.key}
              onPress={() =>
                router.replace({
                  pathname: "/(tabs)/messages/thread",
                  params: chip.kind === "id" ? { id: chip.id } : { slug: chip.slug },
                })
              }
              style={({ pressed }) => [
                styles.switchChip,
                isActive && styles.switchChipActive,
                pressed && { opacity: 0.9 },
              ]}
            >
              <Text style={[styles.switchText, isActive && styles.switchTextActive]}>{chip.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {announcementsOnly ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            Announcements only. {isAdmin === true ? "You can post updates." : "Only staff can post in this room."}
          </Text>
        </View>
      ) : null}
      {msgsError ? (
        <View style={[styles.notice, styles.noticeRed]}>
          <Text style={styles.noticeText}>Couldn’t load messages: {msgsError}</Text>
        </View>
      ) : null}
      {sendError ? (
        <View style={[styles.notice, styles.noticeRed]}>
          <Text style={styles.noticeText}>{sendError}</Text>
        </View>
      ) : null}

      {msgsLoading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={LIME} />
        </View>
      ) : null}

      <FlatList
        ref={(r) => {
          listRef.current = r as unknown as FlatList<unknown>;
        }}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={[styles.listContent, { paddingBottom: 200 }]}
        onContentSizeChange={() => {
          try {
            listRef.current?.scrollToEnd({ animated: false });
          } catch {
            // ignore
          }
        }}
        renderItem={({ item }) => {
          const m = item as (typeof messages)[number];
          const mine = !!currentUserId && m.user_id === currentUserId;
          const senderIsAdmin = adminIds.has(m.user_id);
          // Announcements room: every message from others is staff-shaped.
          // Group/team (announcements_only false): admin card only when sender is staff.
          const isAdminMessage = !mine && (announcementsOnly || senderIsAdmin);

          const senderDisplayNorm = normalizeChatSenderDisplayForMatch(m.sender_display_name || "");
          const senderNameMatchesAdmin =
            senderDisplayNorm.length > 0 && adminSenderDisplayNorms.has(senderDisplayNorm);

          let senderLabel: string | null = null;
          if (!mine) {
            if (announcementsOnly) {
              senderLabel = "Admin";
            } else if (isGroupRoom) {
              senderLabel = m.sender_display_name || "Player";
            } else if (senderNameMatchesAdmin) {
              senderLabel = "Admin";
            } else {
              senderLabel = m.sender_display_name || "Player";
            }
          }

          return (
            <View style={[styles.msgRow, mine ? styles.msgRowMine : styles.msgRowOther]}>
              {!mine && senderLabel != null ? (
                <Text style={isAdminMessage ? styles.msgSenderAdmin : styles.msgSenderOther}>{senderLabel}</Text>
              ) : null}
              <View
                style={[
                  styles.bubble,
                  mine ? styles.bubbleMine : isAdminMessage ? styles.bubbleAdmin : styles.bubbleOther,
                ]}
              >
                <Text
                  style={[
                    styles.bubbleText,
                    mine
                      ? styles.bubbleTextMine
                      : isAdminMessage
                        ? styles.bubbleTextAdmin
                        : styles.bubbleTextOther,
                  ]}
                >
                  {m.body}
                </Text>
              </View>
            </View>
          );
        }}
      />

      <View style={styles.composer}>
        <TextInput
          style={[styles.input, !canCompose && styles.inputDisabled]}
          placeholder={
            !canCompose
              ? announcementsOnly
                ? "Announcements only"
                : "Chat is unavailable"
              : isAdmin === true && announcementsOnly
                ? "Post an announcement"
                : isGroupRoom
                  ? "Message the group"
                  : "Message the team…"
          }
          placeholderTextColor="rgba(255,255,255,0.35)"
          value={draft}
          onChangeText={(t) => {
            setDraft(t);
            if (sendError) setSendError(null);
          }}
          editable={canCompose && !sendBusy}
          multiline
        />
        <Pressable
          accessibilityRole="button"
          style={[styles.sendBtn, (!draft.trim() || !canCompose || sendBusy) && styles.disabled]}
          disabled={!draft.trim() || !canCompose || sendBusy}
          onPress={() => void onSend()}
        >
          {sendBusy ? <ActivityIndicator color="#0a0a0a" /> : <Text style={styles.sendBtnText}>Send</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screenCenter: {
    flex: 1,
    backgroundColor: "#0a0a0a",
    padding: 24,
    justifyContent: "center",
  },
  screenPad: { flex: 1, backgroundColor: "#0a0a0a", padding: 18 },
  screen: { flex: 1, backgroundColor: "#0a0a0a", padding: 18 },
  switchRowWrap: { flexGrow: 0, marginBottom: 10 },
  switchRow: { flexDirection: "row", gap: 10, paddingRight: 4 },
  switchChip: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.04)",
    alignItems: "center",
    justifyContent: "center",
  },
  switchChipActive: { borderColor: "rgba(163,230,53,0.45)", backgroundColor: "rgba(163,230,53,0.10)" },
  switchText: { color: "rgba(255,255,255,0.7)", fontWeight: "900", fontSize: 12 },
  switchTextActive: { color: LIME },
  iconWrap: {
    alignSelf: "center",
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: LIME,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: "#fff",
    textAlign: "center",
    marginBottom: 12,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: "rgba(255,255,255,0.55)",
    textAlign: "center",
  },
  signInWrap: { marginTop: 14 },
  notice: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
    marginBottom: 10,
  },
  noticeRed: {
    borderColor: "rgba(248,113,113,0.35)",
    backgroundColor: "rgba(248,113,113,0.08)",
  },
  noticeText: { color: "rgba(255,255,255,0.75)", fontSize: 13, lineHeight: 18 },
  loadingRow: { paddingVertical: 10 },
  listContent: { paddingBottom: 12 },
  msgRow: { marginBottom: 10, maxWidth: "92%" },
  msgRowMine: { alignSelf: "flex-end" },
  msgRowOther: { alignSelf: "flex-start" },
  msgSenderOther: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    marginBottom: 4,
    fontWeight: "700",
  },
  msgSenderAdmin: {
    color: LIME,
    fontSize: 12,
    marginBottom: 4,
    fontWeight: "800",
  },
  bubble: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  bubbleMine: { backgroundColor: LIME, borderColor: "rgba(0,0,0,0.2)" },
  bubbleOther: { backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.12)" },
  bubbleAdmin: {
    backgroundColor: "rgba(163,230,53,0.08)",
    borderColor: "rgba(255,255,255,0.1)",
    borderLeftWidth: 3,
    borderLeftColor: LIME,
  },
  bubbleText: { fontSize: 15, lineHeight: 20 },
  bubbleTextMine: { color: "#0a0a0a", fontWeight: "700" },
  bubbleTextOther: { color: "rgba(255,255,255,0.72)", fontWeight: "500" },
  bubbleTextAdmin: { color: "#ffffff", fontWeight: "600" },
  composer: {
    flexDirection: "row",
    gap: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    alignItems: "flex-end",
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#fff",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  inputDisabled: { opacity: 0.7 },
  sendBtn: {
    backgroundColor: LIME,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnText: { color: "#0a0a0a", fontWeight: "900" },
  disabled: { opacity: 0.55 },
});
