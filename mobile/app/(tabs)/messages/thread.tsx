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
import {
  postChatBlockViaApi,
  postChatReactionToggleViaApi,
  postChatReportViaApi,
  type ChatReportReason,
} from "@/lib/chatApi";
import { ANNOUNCEMENTS_CHAT_SLUG, isAdminDmGroupSlug } from "@/lib/teamChat";
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { themeColor, useThemedStyles } from "@/theme";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
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

const REACTION_PICKER_EMOJIS = ["👍", "❤️", "😂", "🔥", "💪", "⚽"] as const;

function formatRunChatClosesRelative(iso: string, nowMs: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diff = t - nowMs;
  if (diff <= 0) return "";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Chat closes soon";
  if (mins < 60) return `Chat closes in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `Chat closes in ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `Chat closes in ${days}d`;
}

function senderInitials(displayName: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase().slice(0, 2);
  const w = parts[0] ?? "?";
  return w.slice(0, 2).toUpperCase();
}

function threadHeaderTitle(title: string): string {
  const t = title.trim();
  if (t.length <= 42) return t;
  return `${t.slice(0, 41)}…`;
}

// For run_banter rooms, the baked-in room.title may contain a stale venue name set at creation
// time. Rebuild it from pickup_runs.location_private (first line) + the date part of room.title.
function resolvedRoomTitle(room: { title: string; room_type: string | null; pickup_runs: { location_private: string | null } | null } | null): string {
  if (!room) return "Messages";
  if (room.room_type === "run_banter" && room.pickup_runs?.location_private) {
    const venueName = room.pickup_runs.location_private.trim().split(/\r?\n/)[0]!.trim();
    const datePart = room.title.split(" · ")[1];
    return threadHeaderTitle(datePart ? `${venueName} · ${datePart}` : venueName);
  }
  return threadHeaderTitle(room.title);
}

export default function TeamChatThreadScreen() {
  useThemedStyles(publish_styles);

  const router = useRouter();
  const navigation = useNavigation();
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

  const {
    messages,
    reactionsByMessageId,
    applyReactionGroupsFromServer,
    loading: msgsLoading,
    error: msgsError,
    send,
    currentUserId,
  } = useTeamChatMessages(roomId);
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
  const [runChatTimeTick, setRunChatTimeTick] = useState(0);
  const listRef = useRef<FlatList<unknown> | null>(null);
  const bubbleMeasureRefs = useRef<Map<string, View>>(new Map());

  type ReactionPickerState = {
    messageId: string;
    anchor: { x: number; y: number; width: number; height: number };
    modTarget: MenuTarget | null;
  };
  const [reactionPicker, setReactionPicker] = useState<ReactionPickerState | null>(null);

  async function submitReport(reason: ChatReportReason) {
    if (!reportTarget || !accessToken || reportBusy) return;
    setReportBusy(true);
    const res = await postChatReportViaApi(accessToken, reportTarget.messageId, reason);
    setReportBusy(false);
    setReportTarget(null);
    if (res.ok) {
      setModerationToast("Report submitted. We’ll review it shortly.");
    } else {
      console.warn("[thread] submitReport failed", res.error);
      setModerationToast("Something went wrong. Please try again.");
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
                console.warn("[thread] block user failed", res.error);
                setModerationToast("Something went wrong. Please try again.");
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
  const isRunBanterRoom = room?.room_type === "run_banter";
  const runBanterAutoCloseAt = room?.auto_close_at ?? null;

  useFocusEffect(
    useCallback(() => {
      navigation.setOptions({
        title: resolvedRoomTitle(room),
        headerStyle: { backgroundColor: themeColor().bg },
        headerTintColor: themeColor().text,
        headerShadowVisible: false,
        headerBackVisible: false,
        headerLeft: () => (
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={10}
            style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1, paddingHorizontal: 8 })}
          >
            <FontAwesome name="chevron-left" size={20} color={themeColor().text} />
          </Pressable>
        ),
      });
      return () => {
        navigation.setOptions({
          headerLeft: undefined,
          headerBackVisible: undefined,
        });
      };
    }, [navigation, router, room]),
  );

  useEffect(() => {
    if (!isRunBanterRoom || !runBanterAutoCloseAt) return;
    const id = setInterval(() => setRunChatTimeTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, [isRunBanterRoom, runBanterAutoCloseAt]);

  const runBanterAutoCloseUi = useMemo(() => {
    void runChatTimeTick;
    if (!isRunBanterRoom || !runBanterAutoCloseAt) {
      return {
        bannerPast: false,
        bannerFutureText: null as string | null,
        closedForPlayer: false,
      };
    }
    const closeMs = Date.parse(runBanterAutoCloseAt);
    if (!Number.isFinite(closeMs)) {
      return { bannerPast: false, bannerFutureText: null, closedForPlayer: false };
    }
    const now = Date.now();
    const past = closeMs <= now;
    const closedForPlayer = isAdmin !== true && past;
    const bannerFutureText = !past ? formatRunChatClosesRelative(runBanterAutoCloseAt, now) : null;
    return { bannerPast: past, bannerFutureText, closedForPlayer };
  }, [isRunBanterRoom, runBanterAutoCloseAt, isAdmin, runChatTimeTick]);

  const canCompose = useMemo(() => {
    if (!roomId) return false;
    if (runBanterAutoCloseUi.closedForPlayer) return false;
    if (isAdmin === true) return true;
    return enabled === true && announcementsOnly === false;
  }, [roomId, isAdmin, enabled, announcementsOnly, runBanterAutoCloseUi.closedForPlayer]);

  async function onSend() {
    const body = draft.trim();
    if (!body || sendBusy || !canCompose) return;
    setSendBusy(true);
    setSendError(null);
    const res = await send(body);
    setSendBusy(false);
    if (!res.ok) {
      const errText = (res.error || "").toLowerCase();
      if (errText.includes("row-level security")) {
        setSendError("You can’t send right now (muted, closed, or announcements-only).");
      } else {
        console.warn("[thread] send message failed", res.error);
        setSendError("Something went wrong. Please try again.");
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
        <ActivityIndicator color={themeColor().pitchText} />
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
          <FontAwesome name="comment-o" size={28} color={themeColor().onPitch} />
        </View>
        <Text style={styles.title}>Messaging isn’t unlocked yet</Text>
        <Text style={styles.body}>Once your player profile is approved, you’ll see team updates and run reminders here.</Text>
      </View>
    );
  }

  if (roomLoading) {
    return (
      <View style={styles.screenCenter}>
        <ActivityIndicator color={themeColor().pitchText} />
      </View>
    );
  }

  if (roomError) {
    return (
      <View style={styles.screenCenter}>
        <Text style={styles.title}>Team chat</Text>
        <Text style={styles.body}>Something went wrong. Please try again.</Text>
      </View>
    );
  }

  if (!room) {
    return (
      <View style={styles.screenCenter}>
        <View style={styles.iconWrap}>
          <FontAwesome name="comment-o" size={28} color={themeColor().onPitch} />
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
      {runBanterAutoCloseUi.bannerPast ? (
        <View style={styles.runBanterBanner}>
          <Text style={styles.runBanterBannerText}>This chat has closed 🔒</Text>
        </View>
      ) : runBanterAutoCloseUi.bannerFutureText ? (
        <View style={styles.runBanterBannerHint}>
          <Text style={styles.runBanterBannerHintText}>{runBanterAutoCloseUi.bannerFutureText}</Text>
        </View>
      ) : null}
      {msgsError ? (
        <View style={[styles.notice, styles.noticeRed]}>
          <Text style={styles.noticeText}>Couldn’t load messages. Something went wrong. Please try again.</Text>
        </View>
      ) : null}
      {sendError ? (
        <View style={[styles.notice, styles.noticeRed]}>
          <Text style={styles.noticeText}>{sendError}</Text>
        </View>
      ) : null}

      {msgsLoading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={themeColor().pitchText} />
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
          const senderIsAdminProfile =
            m.sender_is_admin === true || (m.sender_is_admin == null && senderIsAdmin);
          const avatarLetters = senderIsAdminProfile ? "A" : senderInitials(initialsSource);

          const nameTextStyle = isAdminMessage ? styles.msgSenderAdmin : styles.msgSenderOther;

          const canModerate = !mine && !!m.user_id;
          const modTarget: MenuTarget | null = canModerate
            ? {
                messageId: m.id,
                userId: m.user_id,
                senderLabel: senderLabel || m.sender_display_name || "Player",
              }
            : null;

          const openReactionPicker = () => {
            const node = bubbleMeasureRefs.current.get(m.id);
            if (!node) return;
            node.measureInWindow((x, y, width, height) => {
              setReactionPicker({
                messageId: m.id,
                anchor: { x, y, width, height },
                modTarget,
              });
            });
          };

          const messageReactions = reactionsByMessageId[m.id] ?? [];

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
                      {avatarLetters}
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
              <View
                collapsable={false}
                ref={(r) => {
                  if (r) bubbleMeasureRefs.current.set(m.id, r);
                  else bubbleMeasureRefs.current.delete(m.id);
                }}
              >
                <Pressable
                  onLongPress={openReactionPicker}
                  delayLongPress={350}
                  accessibilityRole="button"
                  accessibilityHint="Long-press to add a reaction."
                  style={({ pressed }) => [
                    styles.bubble,
                    mine ? styles.bubbleMine : isAdminMessage ? styles.bubbleAdmin : styles.bubbleOther,
                    pressed ? { opacity: 0.92 } : null,
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
              {messageReactions.length > 0 ? (
                <View style={[styles.reactionPillsRow, mine ? styles.reactionPillsRowMine : styles.reactionPillsRowOther]}>
                  {messageReactions.map((g) => (
                    <Pressable
                      key={g.emoji}
                      onPress={() => {
                        void (async () => {
                          if (!accessToken) return;
                          const res = await postChatReactionToggleViaApi(accessToken, m.id, g.emoji);
                          if (res.ok) applyReactionGroupsFromServer(m.id, res.reactions);
                        })();
                      }}
                      style={({ pressed }) => [
                        styles.reactionPill,
                        g.reacted_by_me ? styles.reactionPillMine : null,
                        pressed ? { opacity: 0.88 } : null,
                      ]}
                      hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
                    >
                      <Text style={styles.reactionPillEmoji}>{g.emoji}</Text>
                      <Text style={[styles.reactionPillCount, g.reacted_by_me && styles.reactionPillCountMine]}>{g.count}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          );
        }}
      />

      <Modal
        visible={reactionPicker != null}
        transparent
        animationType="fade"
        onRequestClose={() => setReactionPicker(null)}
      >
        {reactionPicker ? (
          <View style={styles.reactionPickerRoot}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setReactionPicker(null)} />
            <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
              {(() => {
                const winW = Dimensions.get("window").width;
                const barPad = reactionPicker.modTarget ? 44 : 0;
                const barW = REACTION_PICKER_EMOJIS.length * 40 + barPad + 20;
                const top = Math.max(52, reactionPicker.anchor.y - 54);
                const center = reactionPicker.anchor.x + reactionPicker.anchor.width / 2;
                let left = center - barW / 2;
                if (left < 10) left = 10;
                if (left + barW > winW - 10) left = Math.max(10, winW - barW - 10);
                return (
                  <View style={[styles.reactionPickerBar, { top, left }]}>
                    {REACTION_PICKER_EMOJIS.map((em) => (
                      <Pressable
                        key={em}
                        accessibilityRole="button"
                        accessibilityLabel={`React with ${em}`}
                        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                        onPress={() => {
                          void (async () => {
                            if (!accessToken) {
                              setReactionPicker(null);
                              return;
                            }
                            const mid = reactionPicker.messageId;
                            const res = await postChatReactionToggleViaApi(accessToken, mid, em);
                            setReactionPicker(null);
                            if (res.ok) applyReactionGroupsFromServer(mid, res.reactions);
                          })();
                        }}
                        style={({ pressed }) => [styles.reactionPickerEmojiBtn, pressed && { opacity: 0.75 }]}
                      >
                        <Text style={styles.reactionPickerEmoji}>{em}</Text>
                      </Pressable>
                    ))}
                    {reactionPicker.modTarget ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="More message options"
                        hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                        onPress={() => {
                          const t = reactionPicker.modTarget;
                          setReactionPicker(null);
                          if (t) setMenuTarget(t);
                        }}
                        style={({ pressed }) => [styles.reactionPickerMoreBtn, pressed && { opacity: 0.75 }]}
                      >
                        <FontAwesome name="ellipsis-h" size={18} color={themeColor().text} />
                      </Pressable>
                    ) : null}
                  </View>
                );
              })()}
            </View>
          </View>
        ) : null}
      </Modal>

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
              <FontAwesome name="flag" size={16} color={themeColor().coralText} />
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
              <FontAwesome name="ban" size={16} color={themeColor().coralText} />
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
                <FontAwesome name="circle-o" size={14} color={themeColor().muted} />
                <Text style={styles.sheetRowText}>{opt.label}</Text>
              </Pressable>
            ))}
            <Pressable
              style={({ pressed }) => [styles.sheetCancel, pressed && { opacity: 0.85 }]}
              disabled={reportBusy}
              onPress={() => setReportTarget(null)}
            >
              {reportBusy ? (
                <ActivityIndicator color={themeColor().pitchText} />
              ) : (
                <Text style={styles.sheetCancelText}>Cancel</Text>
              )}
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {!runBanterAutoCloseUi.closedForPlayer ? (
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
            placeholderTextColor={themeColor().muted}
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
            {sendBusy ? <ActivityIndicator color={themeColor().onPitch} /> : <Text style={styles.sendBtnText}>Send</Text>}
          </Pressable>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

function make_styles() {
  return StyleSheet.create({
  screenCenter: {
    flex: 1,
    backgroundColor: themeColor().bg,
    padding: 24,
    justifyContent: "center",
  },
  screenPad: { flex: 1, backgroundColor: themeColor().bg, padding: 16 },
  screen: { flex: 1, backgroundColor: themeColor().bg, padding: 16 },
  iconWrap: {
    alignSelf: "center",
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: themeColor().pitch,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  title: {
    fontSize: 20, fontFamily: "InstrumentSerif_400Regular",
    fontWeight: "800",
    color: themeColor().text,
    textAlign: "center",
    marginBottom: 12,
  },
  body: {
    fontSize: 16, fontFamily: "Inter_400Regular",
    lineHeight: 22,
    color: themeColor().muted,
    textAlign: "center",
  },
  signInWrap: { marginTop: 12 },
  notice: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().overlaySubtle,
    marginBottom: 8,
  },
  noticeRed: {
    borderColor: themeColor().coral,
    backgroundColor: themeColor().overlaySubtle,
  },
  noticeLime: {
    borderColor: themeColor().pitch,
    backgroundColor: themeColor().pitchPanel,
  },
  noticeText: { color: themeColor().text, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  runBanterBanner: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().card,
  },
  runBanterBannerText: {
    color: themeColor().muted,
    fontSize: 13, fontFamily: "Inter_600SemiBold",
    lineHeight: 18,
    textAlign: "center",
    fontWeight: "600",
  },
  runBanterBannerHint: { paddingVertical: 4, paddingHorizontal: 8, marginBottom: 4 },
  runBanterBannerHintText: {
    color: themeColor().muted,
    fontSize: 13, fontFamily: "Inter_600SemiBold",
    lineHeight: 16,
    textAlign: "center",
    fontWeight: "600",
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: themeColor().scrim,
    padding: 16,
    justifyContent: "flex-end",
  },
  sheet: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().bg,
    padding: 16,
  },
  sheetTitle: { color: themeColor().text, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "900" },
  sheetSub: { marginTop: 4, color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  sheetRow: {
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().card,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sheetRowText: { color: themeColor().text, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
  sheetCancel: {
    marginTop: 12,
    paddingVertical: 12,
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().line,
  },
  sheetCancelText: { color: themeColor().muted, fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "700" },
  loadingRow: { paddingVertical: 8 },
  listContent: { paddingBottom: 12 },
  msgRow: { marginBottom: 8, maxWidth: "92%" },
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
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  msgSenderAvatarOther: {
    backgroundColor: themeColor().overlay,
    borderColor: themeColor().line,
  },
  msgSenderAvatarAdmin: {
    backgroundColor: themeColor().pitchPanel,
    borderColor: themeColor().pitch,
  },
  msgSenderAvatarText: { fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "800" },
  msgSenderAvatarTextOther: { color: themeColor().muted },
  msgSenderAvatarTextAdmin: { color: themeColor().pitchText },
  msgSenderOther: {
    color: themeColor().muted,
    fontSize: 13, fontFamily: "Inter_700Bold",
    fontWeight: "700",
    flexShrink: 1,
  },
  msgSenderAdmin: {
    color: themeColor().pitchText,
    fontSize: 13, fontFamily: "Inter_700Bold",
    fontWeight: "800",
    flexShrink: 1,
  },
  bubble: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  bubbleMine: { backgroundColor: themeColor().pitch, borderColor: themeColor().line },
  bubbleOther: { backgroundColor: themeColor().overlaySubtle, borderColor: themeColor().line },
  bubbleAdmin: {
    backgroundColor: themeColor().pitchPanel,
    borderColor: themeColor().line,
    borderLeftWidth: 3,
    borderLeftColor: themeColor().pitch,
  },
  bubbleText: { fontSize: 16, fontFamily: "Inter_400Regular", lineHeight: 20 },
  bubbleTextMine: { color: themeColor().onPitch, fontWeight: "700" },
  bubbleTextOther: { color: themeColor().muted, fontWeight: "500" },
  bubbleTextAdmin: { color: themeColor().text, fontWeight: "600" },
  reactionPickerRoot: { flex: 1 },
  reactionPickerBar: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: themeColor().card,
    borderWidth: 1,
    borderColor: themeColor().line,
    gap: 4,
  },
  reactionPickerEmojiBtn: { paddingHorizontal: 4, paddingVertical: 4 },
  reactionPickerEmoji: { fontSize: 24, fontFamily: "InstrumentSerif_400Regular", lineHeight: 32 },
  reactionPickerMoreBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  reactionPillsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 4,
    maxWidth: "100%",
  },
  reactionPillsRowMine: { alignSelf: "flex-end" },
  reactionPillsRowOther: { alignSelf: "flex-start" },
  reactionPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: themeColor().overlay,
    borderWidth: 1,
    borderColor: themeColor().line,
  },
  reactionPillMine: {
    backgroundColor: themeColor().pitchPanel,
    borderColor: themeColor().pitch,
  },
  reactionPillEmoji: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 18 },
  reactionPillCount: { fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "800", color: themeColor().muted },
  reactionPillCountMine: { color: themeColor().onPitch },
  composer: {
    flexDirection: "row",
    gap: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: themeColor().line,
    alignItems: "flex-end",
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: themeColor().line,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16, fontFamily: "Inter_400Regular",
    color: themeColor().text,
    backgroundColor: themeColor().overlaySubtle,
  },
  inputDisabled: { opacity: 0.7 },
  sendBtn: {
    backgroundColor: themeColor().pitch,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnText: { color: themeColor().onPitch, fontWeight: "900" },
  disabled: { opacity: 0.55 },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}

