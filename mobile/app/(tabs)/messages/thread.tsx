import FontAwesome from "@expo/vector-icons/FontAwesome";
import { SignInPanel } from "@/components/SignInPanel";
import { useAuth } from "@/context/AuthContext";
import { useTeamChatAccess, useTeamChatMessages, useTeamChatRoom } from "@/hooks/useTeamChat";
import { ANNOUNCEMENTS_CHAT_SLUG, TEAM_CHAT_SLUG } from "@/lib/teamChat";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

const LIME = "#a3e635";

export default function TeamChatThreadScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { isReady, session } = useAuth();
  const signedIn = !!session?.user?.id;

  const { allowed, isAdmin } = useTeamChatAccess();
  const enabled = signedIn && allowed === true;
  const slugParam = typeof params.slug === "string" ? params.slug : Array.isArray(params.slug) ? params.slug[0] : null;
  const roomSlug = (slugParam || ANNOUNCEMENTS_CHAT_SLUG).trim();
  const { room, loading: roomLoading, error: roomError } = useTeamChatRoom(enabled, roomSlug);
  const roomId = room?.id ?? null;

  const { messages, loading: msgsLoading, error: msgsError, send, currentUserId } = useTeamChatMessages(roomId);

  const [draft, setDraft] = useState("");
  const [sendBusy, setSendBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const listRef = useRef<FlatList<unknown> | null>(null);

  const announcementsOnly = !!room?.announcements_only;
  const canCompose = useMemo(() => {
    if (!enabled) return false;
    if (!roomId) return false;
    if (announcementsOnly && isAdmin !== true) return false;
    return true;
  }, [enabled, roomId, announcementsOnly, isAdmin]);

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
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 84 : 0}
    >
      <View style={styles.switchRow}>
        <Pressable
          onPress={() => router.replace({ pathname: "/(tabs)/messages/thread", params: { slug: ANNOUNCEMENTS_CHAT_SLUG } })}
          style={({ pressed }) => [
            styles.switchChip,
            roomSlug === ANNOUNCEMENTS_CHAT_SLUG && styles.switchChipActive,
            pressed && { opacity: 0.9 },
          ]}
        >
          <Text style={[styles.switchText, roomSlug === ANNOUNCEMENTS_CHAT_SLUG && styles.switchTextActive]}>Announcements</Text>
        </Pressable>
        <Pressable
          onPress={() => router.replace({ pathname: "/(tabs)/messages/thread", params: { slug: TEAM_CHAT_SLUG } })}
          style={({ pressed }) => [
            styles.switchChip,
            roomSlug === TEAM_CHAT_SLUG && styles.switchChipActive,
            pressed && { opacity: 0.9 },
          ]}
        >
          <Text style={[styles.switchText, roomSlug === TEAM_CHAT_SLUG && styles.switchTextActive]}>Team chat</Text>
        </Pressable>
      </View>

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
        contentContainerStyle={styles.listContent}
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
          return (
            <View style={[styles.msgRow, mine ? styles.msgRowMine : styles.msgRowOther]}>
              {!mine ? <Text style={styles.msgSender}>{m.sender_display_name || "Player"}</Text> : null}
              <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
                <Text style={[styles.bubbleText, mine ? styles.bubbleTextMine : styles.bubbleTextOther]}>{m.body}</Text>
              </View>
            </View>
          );
        }}
      />

      <View style={styles.composer}>
        <TextInput
          style={[styles.input, !canCompose && styles.inputDisabled]}
          placeholder={
            canCompose
              ? announcementsOnly
                ? "Post an announcement…"
                : "Message the team…"
              : announcementsOnly
                ? "Announcements only"
                : "Chat is unavailable"
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
  switchRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  switchChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.04)",
    alignItems: "center",
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
  msgSender: { color: "rgba(255,255,255,0.55)", fontSize: 12, marginBottom: 4, fontWeight: "700" },
  bubble: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  bubbleMine: { backgroundColor: LIME, borderColor: "rgba(0,0,0,0.2)" },
  bubbleOther: { backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.12)" },
  bubbleText: { fontSize: 15, lineHeight: 20 },
  bubbleTextMine: { color: "#0a0a0a", fontWeight: "700" },
  bubbleTextOther: { color: "rgba(255,255,255,0.88)" },
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
