import { AnimatedPressScale } from "@/components/AnimatedPressScale";
import { SignInPanel } from "@/components/SignInPanel";
import { useAuth } from "@/context/AuthContext";
import { useAdminDmPeerLabels, useTeamChatAccess } from "@/hooks/useTeamChat";
import { hapticTap } from "@/lib/haptics";
import {
  ANNOUNCEMENTS_CHAT_SLUG,
  TEAM_CHAT_SLUG,
  isAdminDmGroupSlug,
  useUserChatRooms,
  type ChatRoomSummary,
} from "@/lib/teamChat";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { headline, themeColor, useThemedStyles } from "@/theme";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

function titleForRoomRow(
  r: ChatRoomSummary,
  isAdmin: boolean,
  adminDmPeerLabels: Record<string, string>,
): string {
  if (isAdmin && r.room_type === "group" && isAdminDmGroupSlug(r.slug) && adminDmPeerLabels[r.id]) {
    return adminDmPeerLabels[r.id]!;
  }
  return r.title;
}

// Rebuilds the run chat display title with the actual venue from pickup_runs.location_private.
// The baked-in r.title falls back to a service-region default when location_private was null
// at room creation time, causing every CT run to show "New Haven SoccerRoof."
function runChatTitle(r: ChatRoomSummary): string {
  const loc = r.pickup_runs?.location_private?.trim();
  if (loc) {
    const venueName = loc.split(/\r?\n/)[0]!.trim();
    const datePart = r.title.split(" · ")[1]; // "Jun 11"
    return datePart ? `${venueName} · ${datePart}` : venueName;
  }
  return r.title;
}

export default function MessagesIndex() {
  useThemedStyles(publish_styles);

  const router = useRouter();
  const { isReady, session } = useAuth();
  const signedIn = !!session?.user?.id;
  const { allowed, isAdmin } = useTeamChatAccess();
  const enabled = signedIn && allowed === true;
  const { rooms, loading, error, reload } = useUserChatRooms(enabled);
  const adminDmPeerLabels = useAdminDmPeerLabels(enabled, isAdmin === true, rooms, session?.user?.id ?? null);

  const [runChatTab, setRunChatTab] = useState<"active" | "past">("active");
  const [listRefreshing, setListRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setListRefreshing(true);
    try {
      await reload();
    } finally {
      setListRefreshing(false);
    }
  }, [reload]);

  const bySlug = useMemo(() => new Map(rooms.map((r) => [r.slug, r] as const)), [rooms]);
  const announcementsTitle = bySlug.get(ANNOUNCEMENTS_CHAT_SLUG)?.title ?? "Announcements";
  const teamTitle = bySlug.get(TEAM_CHAT_SLUG)?.title ?? "Team chat";

  const groupRoomsNonDm = useMemo(
    () => rooms.filter((r) => r.room_type === "group" && !isAdminDmGroupSlug(r.slug)),
    [rooms],
  );
  const tournamentTeamRooms = useMemo(() => rooms.filter((r) => r.room_type === "tournament_team"), [rooms]);
  const runBanterRooms = useMemo(() => rooms.filter((r) => r.room_type === "run_banter"), [rooms]);
  // auto_close_at = start_at + 24h (set at room creation, never updated).
  // Active = run hasn't started yet; Past = it has. Null auto_close_at → Past.
  const activeRunRooms = useMemo(
    () =>
      runBanterRooms.filter((r) => {
        if (!r.auto_close_at) return false;
        return Date.parse(r.auto_close_at) - 86_400_000 > Date.now();
      }),
    [runBanterRooms],
  );
  const pastRunRooms = useMemo(
    () =>
      runBanterRooms.filter((r) => {
        if (!r.auto_close_at) return true;
        return Date.parse(r.auto_close_at) - 86_400_000 <= Date.now();
      }),
    [runBanterRooms],
  );
  const visibleRunRooms = runChatTab === "active" ? activeRunRooms : pastRunRooms;
  const dmGroupRooms = useMemo(
    () => rooms.filter((r) => r.room_type === "group" && isAdminDmGroupSlug(r.slug)),
    [rooms],
  );

  if (!isReady) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={themeColor().pitchText} />
      </View>
    );
  }

  if (!signedIn) {
    return (
      <View style={styles.pad}>
        <Text style={styles.title}>Messages</Text>
        <Text style={styles.body}>Sign in to see team updates and direct messages.</Text>
        <View style={styles.signInWrap}>
          <SignInPanel />
        </View>
      </View>
    );
  }

  if (allowed === false) {
    return (
      <View style={styles.center}>
        <View style={styles.iconWrap}>
          <FontAwesome name="comment-o" size={28} color={themeColor().onPitch} />
        </View>
        <Text style={styles.title}>Messaging isn’t unlocked yet</Text>
        <Text style={styles.body}>Once your player profile is approved, you’ll see team updates and staff messages here.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={listRefreshing}
          onRefresh={() => void onRefresh()}
          tintColor={themeColor().pitchText}
        />
      }
    >
      <Text style={styles.heading}>Messages</Text>
      {loading && !listRefreshing ? (
        <ActivityIndicator color={themeColor().pitchText} style={{ marginVertical: 24 }} />
      ) : null}
      {error ? <Text style={styles.err}>Couldn’t load rooms: {error}</Text> : null}

      <Text style={styles.section}>Channels</Text>
      <Pressable
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        onPress={() =>
          router.push({ pathname: "/(tabs)/messages/thread", params: { slug: ANNOUNCEMENTS_CHAT_SLUG } })
        }
      >
        <FontAwesome name="bullhorn" size={18} color={themeColor().pitchText} style={styles.rowIcon} />
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>{announcementsTitle}</Text>
          <Text style={styles.rowSub}>Staff updates</Text>
        </View>
        <FontAwesome name="chevron-right" size={14} color={themeColor().muted} />
      </Pressable>
      <Pressable
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        onPress={() => router.push({ pathname: "/(tabs)/messages/thread", params: { slug: TEAM_CHAT_SLUG } })}
      >
        <FontAwesome name="comments" size={18} color={themeColor().pitchText} style={styles.rowIcon} />
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>{teamTitle}</Text>
          <Text style={styles.rowSub}>Team chat</Text>
        </View>
        <FontAwesome name="chevron-right" size={14} color={themeColor().muted} />
      </Pressable>

      {groupRoomsNonDm.length > 0 ? (
        <>
          <Text style={[styles.section, { marginTop: 20 }]}>Group chats</Text>
          {groupRoomsNonDm.map((r) => (
            <Pressable
              key={r.id}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => router.push({ pathname: "/(tabs)/messages/thread", params: { id: r.id } })}
            >
              <FontAwesome name="users" size={18} color={themeColor().pitchText} style={styles.rowIcon} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{titleForRoomRow(r, isAdmin === true, adminDmPeerLabels)}</Text>
                <Text style={styles.rowSub}>Group chat</Text>
              </View>
              <FontAwesome name="chevron-right" size={14} color={themeColor().muted} />
            </Pressable>
          ))}
        </>
      ) : null}

      {tournamentTeamRooms.length > 0 ? (
        <>
          <Text style={[styles.section, { marginTop: 20 }]}>Tournament teams</Text>
          {tournamentTeamRooms.map((r) => (
            <Pressable
              key={r.id}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => router.push({ pathname: "/(tabs)/messages/thread", params: { id: r.id } })}
            >
              <FontAwesome name="users" size={18} color={themeColor().pitchText} style={styles.rowIcon} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{r.title}</Text>
                <Text style={styles.rowSub}>Tournament team</Text>
              </View>
              <FontAwesome name="chevron-right" size={14} color={themeColor().muted} />
            </Pressable>
          ))}
        </>
      ) : null}

      {runBanterRooms.length > 0 ? (
        <>
          <Text style={[styles.section, { marginTop: 20 }]}>Run chats</Text>
          <View style={styles.runTabRow}>
            {(["active", "past"] as const).map((t) => {
              const active = runChatTab === t;
              return (
                <AnimatedPressScale
                  key={t}
                  pressedScale={0.95}
                  onPress={() => { void hapticTap(); setRunChatTab(t); }}
                  style={[styles.runTab, active && styles.runTabActive]}
                >
                  <Text style={[styles.runTabText, active && styles.runTabTextActive]}>
                    {t === "active" ? "Active" : "Past"}
                  </Text>
                </AnimatedPressScale>
              );
            })}
          </View>
          {visibleRunRooms.length === 0 ? (
            <Text style={styles.runTabEmpty}>
              {runChatTab === "active" ? "No active run chats." : "No past run chats."}
            </Text>
          ) : (
            visibleRunRooms.map((r) => (
              <Pressable
                key={r.id}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                onPress={() => router.push({ pathname: "/(tabs)/messages/thread", params: { id: r.id } })}
              >
                <FontAwesome name="comments" size={18} color={themeColor().pitchText} style={styles.rowIcon} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{runChatTitle(r)}</Text>
                  <Text style={styles.rowSub}>{r.description?.trim() || "Pickup run"}</Text>
                </View>
                <FontAwesome name="chevron-right" size={14} color={themeColor().muted} />
              </Pressable>
            ))
          )}
        </>
      ) : null}

      {dmGroupRooms.length > 0 ? (
        <>
          <Text style={[styles.section, { marginTop: 20 }]}>Direct messages</Text>
          {dmGroupRooms.map((r) => (
            <Pressable
              key={r.id}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => router.push({ pathname: "/(tabs)/messages/thread", params: { id: r.id } })}
            >
              <FontAwesome name="user" size={18} color={themeColor().pitchText} style={styles.rowIcon} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{titleForRoomRow(r, isAdmin === true, adminDmPeerLabels)}</Text>
                <Text style={styles.rowSub}>Direct message</Text>
              </View>
              <FontAwesome name="chevron-right" size={14} color={themeColor().muted} />
            </Pressable>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

function make_styles() {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: themeColor().bg },
  content: { padding: 16, paddingBottom: 40 },
  center: {
    flex: 1,
    backgroundColor: themeColor().bg,
    padding: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  pad: { flex: 1, backgroundColor: themeColor().bg, padding: 16 },
  heading: { color: themeColor().text, fontSize: 24, ...headline, marginBottom: 4 },
  title: {
    fontSize: 20, ...headline,
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
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: themeColor().pitch,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  section: {
    color: themeColor().muted,
    fontSize: 13, fontFamily: "Inter_700Bold",
    fontWeight: "800",
    marginBottom: 8,
    marginTop: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: themeColor().card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().line,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  rowPressed: { opacity: 0.92 },
  rowIcon: { marginRight: 12 },
  rowTitle: { color: themeColor().text, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "800" },
  rowSub: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4 },
  err: { color: themeColor().coralText, marginBottom: 12, fontSize: 13, fontFamily: "Inter_400Regular" },
  runTabRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  runTab: {
    paddingVertical: 4,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().overlaySubtle,
  },
  runTabActive: {
    borderColor: themeColor().pitch,
    backgroundColor: themeColor().pitchPanel,
  },
  runTabText: { fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700", color: themeColor().muted },
  runTabTextActive: { color: themeColor().pitchText },
  runTabEmpty: { color: themeColor().muted, fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 8 },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}

