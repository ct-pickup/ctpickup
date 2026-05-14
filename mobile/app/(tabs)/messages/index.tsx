import { SignInPanel } from "@/components/SignInPanel";
import { useAuth } from "@/context/AuthContext";
import { useAdminDmPeerLabels, useTeamChatAccess } from "@/hooks/useTeamChat";
import {
  ANNOUNCEMENTS_CHAT_SLUG,
  TEAM_CHAT_SLUG,
  isAdminDmGroupSlug,
  useUserChatRooms,
  type ChatRoomSummary,
} from "@/lib/teamChat";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

const LIME = "#a3e635";

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

export default function MessagesIndex() {
  const router = useRouter();
  const { isReady, session } = useAuth();
  const signedIn = !!session?.user?.id;
  const { allowed, isAdmin } = useTeamChatAccess();
  const enabled = signedIn && allowed === true;
  const { rooms, loading, error } = useUserChatRooms(enabled);
  const adminDmPeerLabels = useAdminDmPeerLabels(enabled, isAdmin === true, rooms, session?.user?.id ?? null);

  const bySlug = useMemo(() => new Map(rooms.map((r) => [r.slug, r] as const)), [rooms]);
  const announcementsTitle = bySlug.get(ANNOUNCEMENTS_CHAT_SLUG)?.title ?? "Announcements";
  const teamTitle = bySlug.get(TEAM_CHAT_SLUG)?.title ?? "Team chat";

  const groupRoomsNonDm = useMemo(
    () => rooms.filter((r) => r.room_type === "group" && !isAdminDmGroupSlug(r.slug)),
    [rooms],
  );
  const tournamentTeamRooms = useMemo(() => rooms.filter((r) => r.room_type === "tournament_team"), [rooms]);
  const runBanterRooms = useMemo(() => rooms.filter((r) => r.room_type === "run_banter"), [rooms]);
  const dmGroupRooms = useMemo(
    () => rooms.filter((r) => r.room_type === "group" && isAdminDmGroupSlug(r.slug)),
    [rooms],
  );

  if (!isReady) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={LIME} />
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
          <FontAwesome name="comment-o" size={28} color="#0a0a0a" />
        </View>
        <Text style={styles.title}>Messaging isn’t unlocked yet</Text>
        <Text style={styles.body}>Once your player profile is approved, you’ll see team updates and staff messages here.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Messages</Text>
      {loading ? <ActivityIndicator color={LIME} style={{ marginVertical: 24 }} /> : null}
      {error ? <Text style={styles.err}>Couldn’t load rooms: {error}</Text> : null}

      <Text style={styles.section}>Channels</Text>
      <Pressable
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        onPress={() =>
          router.push({ pathname: "/(tabs)/messages/thread", params: { slug: ANNOUNCEMENTS_CHAT_SLUG } })
        }
      >
        <FontAwesome name="bullhorn" size={18} color={LIME} style={styles.rowIcon} />
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>{announcementsTitle}</Text>
          <Text style={styles.rowSub}>Staff updates</Text>
        </View>
        <FontAwesome name="chevron-right" size={14} color="rgba(255,255,255,0.35)" />
      </Pressable>
      <Pressable
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        onPress={() => router.push({ pathname: "/(tabs)/messages/thread", params: { slug: TEAM_CHAT_SLUG } })}
      >
        <FontAwesome name="comments" size={18} color={LIME} style={styles.rowIcon} />
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>{teamTitle}</Text>
          <Text style={styles.rowSub}>Team chat</Text>
        </View>
        <FontAwesome name="chevron-right" size={14} color="rgba(255,255,255,0.35)" />
      </Pressable>

      {groupRoomsNonDm.length > 0 ? (
        <>
          <Text style={[styles.section, { marginTop: 22 }]}>Group chats</Text>
          {groupRoomsNonDm.map((r) => (
            <Pressable
              key={r.id}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => router.push({ pathname: "/(tabs)/messages/thread", params: { id: r.id } })}
            >
              <FontAwesome name="users" size={18} color={LIME} style={styles.rowIcon} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{titleForRoomRow(r, isAdmin === true, adminDmPeerLabels)}</Text>
                <Text style={styles.rowSub}>Group chat</Text>
              </View>
              <FontAwesome name="chevron-right" size={14} color="rgba(255,255,255,0.35)" />
            </Pressable>
          ))}
        </>
      ) : null}

      {tournamentTeamRooms.length > 0 ? (
        <>
          <Text style={[styles.section, { marginTop: 22 }]}>Tournament teams</Text>
          {tournamentTeamRooms.map((r) => (
            <Pressable
              key={r.id}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => router.push({ pathname: "/(tabs)/messages/thread", params: { id: r.id } })}
            >
              <FontAwesome name="users" size={18} color={LIME} style={styles.rowIcon} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{r.title}</Text>
                <Text style={styles.rowSub}>Tournament team</Text>
              </View>
              <FontAwesome name="chevron-right" size={14} color="rgba(255,255,255,0.35)" />
            </Pressable>
          ))}
        </>
      ) : null}

      {runBanterRooms.length > 0 ? (
        <>
          <Text style={[styles.section, { marginTop: 22 }]}>Run chats</Text>
          {runBanterRooms.map((r) => (
            <Pressable
              key={r.id}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => router.push({ pathname: "/(tabs)/messages/thread", params: { id: r.id } })}
            >
              <FontAwesome name="comments" size={18} color={LIME} style={styles.rowIcon} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{r.title}</Text>
                <Text style={styles.rowSub}>Pickup run</Text>
              </View>
              <FontAwesome name="chevron-right" size={14} color="rgba(255,255,255,0.35)" />
            </Pressable>
          ))}
        </>
      ) : null}

      {dmGroupRooms.length > 0 ? (
        <>
          <Text style={[styles.section, { marginTop: 22 }]}>Direct messages</Text>
          {dmGroupRooms.map((r) => (
            <Pressable
              key={r.id}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => router.push({ pathname: "/(tabs)/messages/thread", params: { id: r.id } })}
            >
              <FontAwesome name="user" size={18} color={LIME} style={styles.rowIcon} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{titleForRoomRow(r, isAdmin === true, adminDmPeerLabels)}</Text>
                <Text style={styles.rowSub}>Direct message</Text>
              </View>
              <FontAwesome name="chevron-right" size={14} color="rgba(255,255,255,0.35)" />
            </Pressable>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0a0a0a" },
  content: { padding: 18, paddingBottom: 40 },
  center: {
    flex: 1,
    backgroundColor: "#0a0a0a",
    padding: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  pad: { flex: 1, backgroundColor: "#0a0a0a", padding: 18 },
  heading: { color: "#fff", fontSize: 24, fontWeight: "900", marginBottom: 6 },
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
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: LIME,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  section: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 10,
    marginTop: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  rowPressed: { opacity: 0.92 },
  rowIcon: { marginRight: 12 },
  rowTitle: { color: "#fff", fontSize: 16, fontWeight: "800" },
  rowSub: { color: "rgba(255,255,255,0.4)", fontSize: 12, marginTop: 2 },
  err: { color: "#f87171", marginBottom: 12, fontSize: 13 },
});
