import { useAuth } from "@/context/AuthContext";
import { togglePlayerFollow } from "@/lib/siteApi";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

const LIME = "#a3e635";
const BG = "#0a0a0a";

type Tab = "followers" | "following";

type Row = {
  id: string;
  displayName: string;
  username: string | null;
  avatar_url: string | null;
};

function initials(displayName: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase().slice(0, 2);
  const w = parts[0] ?? "?";
  return w.slice(0, 2).toUpperCase();
}

function displayNameFromProfile(row: {
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
}): string {
  const combined = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
  if (combined) return combined;
  const u = typeof row.username === "string" ? row.username.trim() : "";
  if (u) return `@${u}`;
  return "Player";
}

export default function FollowingScreen() {
  const router = useRouter();
  const { session, supabase, isReady } = useAuth();
  const token = session?.access_token ?? null;
  const viewerId = session?.user?.id ?? null;

  const raw = useLocalSearchParams<{ profileId?: string | string[] }>();
  const profileIdParam =
    typeof raw.profileId === "string" ? raw.profileId : Array.isArray(raw.profileId) ? raw.profileId[0] : undefined;

  const subjectId = profileIdParam?.trim() || viewerId || "";

  const [tab, setTab] = useState<Tab>("followers");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [followersRows, setFollowersRows] = useState<Row[]>([]);
  const [followingRows, setFollowingRows] = useState<Row[]>([]);
  const [followMap, setFollowMap] = useState<Map<string, boolean>>(new Map());
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isReady || !supabase || !viewerId || !subjectId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const [{ data: f1, error: e1 }, { data: f2, error: e2 }] = await Promise.all([
        supabase.from("player_follows").select("follower_id").eq("following_id", subjectId),
        supabase.from("player_follows").select("following_id").eq("follower_id", subjectId),
      ]);
      if (e1 || e2) {
        setErr(e1?.message || e2?.message || "Could not load.");
        setFollowersRows([]);
        setFollowingRows([]);
        setLoading(false);
        return;
      }

      const followerIds = (f1 ?? [])
        .map((r) => (r as { follower_id?: unknown }).follower_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
      const followingIds = (f2 ?? [])
        .map((r) => (r as { following_id?: unknown }).following_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);

      const allIds = Array.from(new Set([...followerIds, ...followingIds]));
      const profileById = new Map<string, Row>();

      const CHUNK = 80;
      for (let i = 0; i < allIds.length; i += CHUNK) {
        const chunk = allIds.slice(i, i + CHUNK);
        const { data: profs, error: pe } = await supabase
          .from("profiles")
          .select("id,first_name,last_name,username,avatar_url")
          .in("id", chunk);
        if (pe) {
          setErr(pe.message);
          break;
        }
        for (const p of profs ?? []) {
          const row = p as {
            id?: unknown;
            first_name?: string | null;
            last_name?: string | null;
            username?: string | null;
            avatar_url?: string | null;
          };
          const id = typeof row.id === "string" ? row.id : null;
          if (!id) continue;
          profileById.set(id, {
            id,
            displayName: displayNameFromProfile(row),
            username: typeof row.username === "string" && row.username.trim() ? row.username.trim() : null,
            avatar_url: typeof row.avatar_url === "string" && row.avatar_url.trim() ? row.avatar_url.trim() : null,
          });
        }
      }

      const nextFollow = new Map<string, boolean>();
      if (allIds.length > 0) {
        const { data: myFollows, error: mfErr } = await supabase
          .from("player_follows")
          .select("following_id")
          .eq("follower_id", viewerId)
          .in("following_id", allIds);
        if (!mfErr) {
          for (const r of myFollows ?? []) {
            const fid = (r as { following_id?: unknown }).following_id;
            if (typeof fid === "string") nextFollow.set(fid, true);
          }
        }
      }

      setFollowMap(nextFollow);
      setFollowersRows(
        followerIds.map((id) => profileById.get(id) ?? { id, displayName: "Player", username: null, avatar_url: null }),
      );
      setFollowingRows(
        followingIds.map((id) => profileById.get(id) ?? { id, displayName: "Player", username: null, avatar_url: null }),
      );
    } finally {
      setLoading(false);
    }
  }, [isReady, supabase, viewerId, subjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const listData = tab === "followers" ? followersRows : followingRows;

  const onToggleRow = useCallback(
    async (targetId: string) => {
      if (!token || busyId) return;
      setBusyId(targetId);
      const r = await togglePlayerFollow(token, targetId);
      if (r.ok) {
        setFollowMap((prev) => {
          const m = new Map(prev);
          m.set(targetId, r.following);
          return m;
        });
        if (subjectId === viewerId && tab === "following" && !r.following) {
          setFollowingRows((prev) => prev.filter((row) => row.id !== targetId));
        }
      }
      setBusyId(null);
    },
    [token, busyId, subjectId, viewerId, tab],
  );

  const headerTabs = useMemo(
    () => (
      <View style={styles.tabRow}>
        <Pressable
          onPress={() => setTab("followers")}
          style={[styles.tabBtn, tab === "followers" ? styles.tabBtnOn : null]}
        >
          <Text style={[styles.tabBtnText, tab === "followers" ? styles.tabBtnTextOn : null]}>Followers</Text>
        </Pressable>
        <Pressable
          onPress={() => setTab("following")}
          style={[styles.tabBtn, tab === "following" ? styles.tabBtnOn : null]}
        >
          <Text style={[styles.tabBtnText, tab === "following" ? styles.tabBtnTextOn : null]}>Following</Text>
        </Pressable>
      </View>
    ),
    [tab],
  );

  if (!viewerId || !token) {
    return (
      <View style={styles.center}>
        <Text style={styles.errText}>Sign in to view followers and following.</Text>
      </View>
    );
  }

  if (!subjectId) {
    return (
      <View style={styles.center}>
        <Text style={styles.errText}>Missing profile.</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {headerTabs}
      {loading ? (
        <View style={styles.centerGrow}>
          <ActivityIndicator size="large" color={LIME} />
        </View>
      ) : err ? (
        <View style={styles.centerGrow}>
          <Text style={styles.errText}>{err}</Text>
        </View>
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(item) => item.id}
          contentContainerStyle={listData.length === 0 ? styles.emptyList : styles.listPad}
          ListEmptyComponent={
            <Text style={styles.emptyText}>{tab === "followers" ? "No followers yet." : "Not following anyone yet."}</Text>
          }
          renderItem={({ item }) => {
            const followingThem = followMap.get(item.id) === true;
            const busy = busyId === item.id;
            return (
              <View style={styles.row}>
                <Pressable
                  style={styles.rowMain}
                  onPress={() => router.push({ pathname: "/player/[id]", params: { id: item.id } } as const)}
                >
                  {item.avatar_url ? (
                    <Image source={{ uri: item.avatar_url }} style={styles.avatarImg} />
                  ) : (
                    <View style={styles.avatarPh}>
                      <Text style={styles.avatarPhText}>{initials(item.displayName)}</Text>
                    </View>
                  )}
                  <View style={styles.rowText}>
                    <Text style={styles.rowName} numberOfLines={1}>
                      {item.displayName}
                    </Text>
                    <Text style={styles.rowUser} numberOfLines={1}>
                      {item.username ? `@${item.username}` : "—"}
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  onPress={() => void onToggleRow(item.id)}
                  disabled={busy}
                  style={({ pressed }) => [
                    followingThem ? styles.rowBtnFollowing : styles.rowBtnFollow,
                    { opacity: busy ? 0.55 : pressed ? 0.85 : 1 },
                  ]}
                >
                  <Text style={followingThem ? styles.rowBtnFollowingText : styles.rowBtnFollowText}>
                    {followingThem ? "Following ✓" : "Follow"}
                  </Text>
                </Pressable>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  center: {
    flex: 1,
    backgroundColor: BG,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  centerGrow: { flex: 1, alignItems: "center", justifyContent: "center" },
  errText: { color: "#fca5a5", fontSize: 15, textAlign: "center" },
  tabRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 10,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
  },
  tabBtnOn: {
    borderColor: LIME,
    backgroundColor: "rgba(163,230,53,0.12)",
  },
  tabBtnText: { fontSize: 14, fontWeight: "700", color: "rgba(255,255,255,0.55)" },
  tabBtnTextOn: { color: LIME },
  listPad: { paddingHorizontal: 16, paddingBottom: 32 },
  emptyList: { flexGrow: 1, padding: 24, justifyContent: "center" },
  emptyText: { color: "rgba(255,255,255,0.45)", fontSize: 15, textAlign: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.1)",
    gap: 10,
  },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, minWidth: 0 },
  avatarImg: { width: 44, height: 44, borderRadius: 22 },
  avatarPh: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(163,230,53,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarPhText: { fontSize: 14, fontWeight: "800", color: LIME },
  rowText: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 16, fontWeight: "700", color: "#fff" },
  rowUser: { fontSize: 13, color: "rgba(255,255,255,0.45)", marginTop: 2 },
  rowBtnFollow: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: LIME,
  },
  rowBtnFollowText: { fontSize: 13, fontWeight: "800", color: "#0a0a0a" },
  rowBtnFollowing: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    backgroundColor: "transparent",
  },
  rowBtnFollowingText: { fontSize: 12, fontWeight: "700", color: "rgba(255,255,255,0.85)" },
});
