import FontAwesome from "@expo/vector-icons/FontAwesome";
import { SignInPanel } from "@/components/SignInPanel";
import { useAuth } from "@/context/AuthContext";
import {
  normalizeChatSenderDisplayForMatch,
  useChatAdminUserIds,
  useChatBlockedUserIds,
  useTeamChatAccess,
  useTeamChatMessages,
  useTeamChatRoom,
} from "@/hooks/useTeamChat";
import { postChatBlockViaApi, postChatReportViaApi, type ChatReportReason } from "@/lib/chatApi";
import { ANNOUNCEMENTS_CHAT_SLUG, isAdminDmGroupSlug } from "@/lib/teamChat";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

type ReportOption = { value: ChatReportReason; label: string };

const REPORT_REASONS: readonly ReportOption[] = [
  { value: "harassment", label: "Harassment" },
  { value: "spam", label: "Spam" },
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "other", label: "Other" },
];

const LIME = "#a3e635";

function senderInitials(displayName: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase().slice(0, 2);
  const w = parts[0] ?? "?";
  return w.slice(0, 2).toUpperCase();
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

  const { messages, loading: msgsLoading, error: msgsError, send, currentUserId } = useTeamChatMessages(roomId);
  const { adminIds, adminSenderDisplayNorms } = useChatAdminUserIds(enabled);
  const { blockedIds, addLocal: addBlockedLocal } = useChatBlockedUserIds(enabled);

  const visibleMessages = useMemo(() => {
    if (blockedIds.size === 0) return messages;
    return messages.filter((m) => !m.user_id || !blockedIds.has(m.user_id));
  }, [messages, blockedIds]);

  const accessToken = session?.access_token ?? null;

  type MenuTarget = { messageId: string; userId: string; senderLabel: string };
  const [menuTarget, setMenuTarget] = useState<MenuTarget | null>(null);
  const [reportTarget, setReportTarget] = useState<MenuTarget | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
  const [moderationToast, setModerationToast] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [sendBusy, setSendBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const listRef = useRef<FlatList<unknown> | null>(null);

  async function submitReport(reason: ChatReportReason) {
    if (!reportTarget || !accessToken || reportBusy) return;
    setReportBusy(true);
    const res = await postChatReportViaApi(accessToken, reportTarget.messageId, reason);
    setReportBusy(false);
    setReportTarget(null);
    if (res.ok) {
      setModerationToast("Report submitted. We’ll review it shortly.");
    } else {
      setModerationToast(res.error || "Couldn’t submit report.");
    }
    setTimeout(() => setModerationToast(null), 3500);
  }

  function confirmBlock(target: MenuTarget) {
    Alert.alert(
      "Block this user?",
      "You won’t see their messages.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block",
          style: "destructive",
          onPress: () => {
            void (async () => {
              if (!accessToken || blockBusy) return;
              setBlockBusy(true);
              const res = await postChatBlockViaApi(accessToken, target.userId);
              setBlockBusy(false);
              if (res.ok) {
                addBlockedLocal(target.userId);
                setModerationToast("Blocked. You won’t see their messages.");
              } else {
                setModerationToast(res.error || "Couldn’t block user.");
              }
              setTimeout(() => setModerationToast(null), 3500);
            })();
          },
        },
      ],
    );
  }

  const announcementsOnly = !!room?.announcements_only;
  /** Group threads use `id` routing; slug threads are announcements / team. */
  const isGroupRoom = !!trimmedId;
  const isDmGroup = !!(room?.slug && isAdminDmGroupSlug(room.slug));
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

      {moderationToast ? (
        <View style={[styles.notice, styles.noticeLime]}>
          <Text style={styles.noticeText}>{moderationToast}</Text>
        </View>
      ) : null}

      <FlatList
        ref={(r) => {
          listRef.current = r as unknown as FlatList<unknown>;
        }}
        data={visibleMessages}
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

          const initialsSource = (m.sender_display_name || senderLabel || "Player").trim();

          const nameTextStyle = isAdminMessage ? styles.msgSenderAdmin : styles.msgSenderOther;

          const canModerate = !mine && !!m.user_id;
          const onLongPressBubble = canModerate
            ? () => {
                setMenuTarget({
                  messageId: m.id,
                  userId: m.user_id,
                  senderLabel: senderLabel || m.sender_display_name || "Player",
                });
              }
            : undefined;

          return (
            <View style={[styles.msgRow, mine ? styles.msgRowMine : styles.msgRowOther]}>
              {!mine && senderLabel != null ? (
                <View style={styles.msgSenderTapRow}>
                  <View
                    style={[
                      styles.msgSenderAvatar,
                      isAdminMessage ? styles.msgSenderAvatarAdmin : styles.msgSenderAvatarOther,
                    ]}
                  >
                    <Text
                      style={[
                        styles.msgSenderAvatarText,
                        isAdminMessage ? styles.msgSenderAvatarTextAdmin : styles.msgSenderAvatarTextOther,
                      ]}
                    >
                      {senderInitials(initialsSource)}
                    </Text>
                  </View>
                  {m.user_id ? (
                    <Pressable
                      onPress={() => router.push(`/player/${encodeURIComponent(m.user_id)}`)}
                      accessibilityRole="link"
                      accessibilityLabel={`View ${senderLabel} profile`}
                      hitSlop={{ top: 6, bottom: 6, left: 4, right: 8 }}
                      style={({ pressed }) => [styles.msgSenderNamePress, pressed ? { opacity: 0.85 } : null]}
                    >
                      <Text style={nameTextStyle}>{senderLabel}</Text>
                    </Pressable>
                  ) : (
                    <Text style={nameTextStyle}>{senderLabel}</Text>
                  )}
                </View>
              ) : null}
              <Pressable
                onLongPress={onLongPressBubble}
                delayLongPress={350}
                accessibilityRole={canModerate ? "button" : undefined}
                accessibilityHint={canModerate ? "Long-press to report or block this user." : undefined}
                style={({ pressed }) => [
                  styles.bubble,
                  mine ? styles.bubbleMine : isAdminMessage ? styles.bubbleAdmin : styles.bubbleOther,
                  pressed && canModerate ? { opacity: 0.85 } : null,
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
              </Pressable>
            </View>
          );
        }}
      />

      <Modal
        visible={menuTarget != null}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuTarget(null)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setMenuTarget(null)}>
          <Pressable style={styles.sheet} onPress={() => null}>
            <Text style={styles.sheetTitle}>Message options</Text>
            {menuTarget ? (
              <Text style={styles.sheetSub}>From {menuTarget.senderLabel}</Text>
            ) : null}
            <Pressable
              style={({ pressed }) => [styles.sheetRow, pressed && { opacity: 0.85 }]}
              onPress={() => {
                const t = menuTarget;
                setMenuTarget(null);
                if (t) setReportTarget(t);
              }}
            >
              <FontAwesome name="flag" size={16} color="#f59e0b" />
              <Text style={styles.sheetRowText}>Report message</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.sheetRow, pressed && { opacity: 0.85 }]}
              onPress={() => {
                const t = menuTarget;
                setMenuTarget(null);
                if (t) confirmBlock(t);
              }}
            >
              <FontAwesome name="ban" size={16} color="#f87171" />
              <Text style={styles.sheetRowText}>Block user</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.sheetCancel, pressed && { opacity: 0.85 }]}
              onPress={() => setMenuTarget(null)}
            >
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={reportTarget != null}
        transparent
        animationType="fade"
        onRequestClose={() => (reportBusy ? undefined : setReportTarget(null))}
      >
        <Pressable
          style={styles.sheetBackdrop}
          onPress={() => (reportBusy ? undefined : setReportTarget(null))}
        >
          <Pressable style={styles.sheet} onPress={() => null}>
            <Text style={styles.sheetTitle}>Report message</Text>
            <Text style={styles.sheetSub}>Why are you reporting this message?</Text>
            {REPORT_REASONS.map((opt) => (
              <Pressable
                key={opt.value}
                disabled={reportBusy}
                onPress={() => void submitReport(opt.value)}
                style={({ pressed }) => [
                  styles.sheetRow,
                  pressed && !reportBusy ? { opacity: 0.85 } : null,
                  reportBusy ? { opacity: 0.6 } : null,
                ]}
              >
                <FontAwesome name="circle-o" size={14} color="rgba(255,255,255,0.55)" />
                <Text style={styles.sheetRowText}>{opt.label}</Text>
              </Pressable>
            ))}
            <Pressable
              style={({ pressed }) => [styles.sheetCancel, pressed && { opacity: 0.85 }]}
              disabled={reportBusy}
              onPress={() => setReportTarget(null)}
            >
              {reportBusy ? (
                <ActivityIndicator color={LIME} />
              ) : (
                <Text style={styles.sheetCancelText}>Cancel</Text>
              )}
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

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
                  ? isDmGroup
                    ? "Message…"
                    : "Message the group"
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
  noticeLime: {
    borderColor: "rgba(163,230,53,0.4)",
    backgroundColor: "rgba(163,230,53,0.1)",
  },
  noticeText: { color: "rgba(255,255,255,0.75)", fontSize: 13, lineHeight: 18 },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    padding: 18,
    justifyContent: "flex-end",
  },
  sheet: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(18,18,18,0.98)",
    padding: 16,
  },
  sheetTitle: { color: "#fff", fontSize: 16, fontWeight: "900" },
  sheetSub: { marginTop: 6, color: "rgba(255,255,255,0.6)", fontSize: 13, lineHeight: 18 },
  sheetRow: {
    marginTop: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.04)",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sheetRowText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  sheetCancel: {
    marginTop: 14,
    paddingVertical: 12,
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  sheetCancelText: { color: "rgba(255,255,255,0.65)", fontSize: 14, fontWeight: "700" },
  loadingRow: { paddingVertical: 10 },
  listContent: { paddingBottom: 12 },
  msgRow: { marginBottom: 10, maxWidth: "92%" },
  msgRowMine: { alignSelf: "flex-end" },
  msgRowOther: { alignSelf: "flex-start" },
  msgSenderTapRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
    alignSelf: "flex-start",
  },
  msgSenderNamePress: {
    flexShrink: 1,
    alignSelf: "center",
  },
  msgSenderAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  msgSenderAvatarOther: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderColor: "rgba(255,255,255,0.14)",
  },
  msgSenderAvatarAdmin: {
    backgroundColor: "rgba(163,230,53,0.12)",
    borderColor: "rgba(163,230,53,0.35)",
  },
  msgSenderAvatarText: { fontSize: 11, fontWeight: "800" },
  msgSenderAvatarTextOther: { color: "rgba(255,255,255,0.65)" },
  msgSenderAvatarTextAdmin: { color: LIME },
  msgSenderOther: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    fontWeight: "700",
    flexShrink: 1,
  },
  msgSenderAdmin: {
    color: LIME,
    fontSize: 12,
    fontWeight: "800",
    flexShrink: 1,
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
