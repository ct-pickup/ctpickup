import { useAuth } from "@/context/AuthContext";
import { siteOrigin } from "@/lib/env";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const LIME = "#a3e635";

const TIER_COLORS: Record<string, string> = {
  bronze: "#B87333",
  silver: "#A8B0B5",
  gold: "#E3B23C",
  platinum: "#E8E8E8",
  diamond: "#9B59B6",
};

function tierColor(tier: string | null | undefined): string {
  return tier ? (TIER_COLORS[tier] ?? LIME) : LIME;
}

/** Live-updating elapsed-time string, refreshed every 60 seconds. */
function useElapsedTime(startedAt: string | null): string {
  const [elapsed, setElapsed] = useState("");
  useEffect(() => {
    if (!startedAt) return;
    const update = () => {
      const mins = Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000);
      if (mins < 1) setElapsed("Just started");
      else if (mins < 60) setElapsed(mins + " min in");
      else {
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        setElapsed(h + "h " + (m > 0 ? m + "min " : "") + "in");
      }
    };
    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, [startedAt]);
  return elapsed;
}

function fmt12Hour(iso: string): string {
  const d = new Date(iso);
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
}

type TrainingPost = {
  id: string;
  user_id: string;
  field_name: string;
  latitude: number;
  longitude: number;
  started_at: string;
  training_until: string | null;
  what_im_working_on: string | null;
  spots_available: number;
  notes: string | null;
  status: string;
};

type Person = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  avatar_url: string | null;
  playing_position: string | null;
  tier: string | null;
};

type JoinRequest = {
  id: string;
  requester_id: string;
  status: string;
  created_at: string;
  person: Person | null;
};

function personName(p: Person | null): string {
  if (!p) return "Player";
  return [p.first_name, p.last_name].filter(Boolean).join(" ") || p.username || "Player";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export default function TrainingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, supabase } = useAuth();
  const myUserId = session?.user?.id ?? null;

  const [post, setPost] = useState<TrainingPost | null>(null);
  const [host, setHost] = useState<Person | null>(null);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [myRequestStatus, setMyRequestStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const elapsed = useElapsedTime(post?.started_at ?? null);

  const loadPeople = useCallback(
    async (ids: string[]): Promise<Map<string, Person>> => {
      const map = new Map<string, Person>();
      if (!supabase || ids.length === 0) return map;
      const uniq = Array.from(new Set(ids));
      const [profilesRes, ratingsRes] = await Promise.all([
        supabase.from("profiles").select("id,first_name,last_name,username,avatar_url,playing_position").in("id", uniq),
        supabase.from("player_ratings").select("user_id,tier").in("user_id", uniq),
      ]);
      const tierById = new Map<string, string | null>();
      for (const row of (ratingsRes.data ?? []) as Array<{ user_id: string; tier: string | null }>) {
        tierById.set(row.user_id, row.tier);
      }
      for (const row of (profilesRes.data ?? []) as Array<Omit<Person, "tier">>) {
        map.set(row.id, { ...row, tier: tierById.get(row.id) ?? null });
      }
      return map;
    },
    [supabase],
  );

  const load = useCallback(async () => {
    if (!supabase || !id) return;
    setLoading(true);
    try {
      const { data: postData } = await supabase
        .from("training_posts")
        .select("id,user_id,field_name,latitude,longitude,started_at,training_until,what_im_working_on,spots_available,notes,status")
        .eq("id", id)
        .maybeSingle();
      if (!postData) {
        setPost(null);
        return;
      }
      const p = postData as TrainingPost;
      setPost(p);

      const isHostView = p.user_id === myUserId;

      if (isHostView) {
        const { data: reqRows } = await supabase
          .from("training_join_requests")
          .select("id,requester_id,status,created_at")
          .eq("training_post_id", id)
          .order("created_at", { ascending: true });
        const rows = (reqRows ?? []) as Array<Omit<JoinRequest, "person">>;
        const people = await loadPeople([p.user_id, ...rows.map((r) => r.requester_id)]);
        setHost(people.get(p.user_id) ?? null);
        setRequests(rows.map((r) => ({ ...r, person: people.get(r.requester_id) ?? null })));
      } else {
        const people = await loadPeople([p.user_id]);
        setHost(people.get(p.user_id) ?? null);
        if (myUserId) {
          const { data: mine } = await supabase
            .from("training_join_requests")
            .select("status")
            .eq("training_post_id", id)
            .eq("requester_id", myUserId)
            .maybeSingle();
          setMyRequestStatus(mine?.status ?? null);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [supabase, id, myUserId, loadPeople]);

  useEffect(() => {
    void load();
  }, [load]);

  const endTraining = useCallback(() => {
    if (busy || !session?.access_token) return;
    Alert.alert("End training?", "This removes your training session from the map.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "End training",
        style: "destructive",
        onPress: async () => {
          const origin = siteOrigin();
          if (!origin) return;
          setBusy(true);
          try {
            const r = await fetch(`${origin}/api/training/end`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${session!.access_token}` },
              body: JSON.stringify({ post_id: id }),
            });
            const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
            if (!r.ok || !j?.ok) {
              Alert.alert("Error", j?.error ?? "Could not end training.");
              return;
            }
            await load();
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }, [busy, session, id, load]);

  const respond = useCallback(
    async (requestId: string, decision: "accepted" | "declined") => {
      if (busy || !session?.access_token) return;
      const origin = siteOrigin();
      if (!origin) return;
      setBusy(true);
      try {
        const r = await fetch(`${origin}/api/training/respond`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ request_id: requestId, decision }),
        });
        const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
        if (!r.ok || !j?.ok) {
          Alert.alert("Error", j?.error ?? "Could not update request.");
          return;
        }
        await load();
      } finally {
        setBusy(false);
      }
    },
    [busy, session, load],
  );

  const requestJoin = useCallback(async () => {
    if (busy || !session?.access_token) return;
    const origin = siteOrigin();
    if (!origin) return;
    setBusy(true);
    try {
      const r = await fetch(`${origin}/api/training/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ post_id: id }),
      });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!r.ok || !j?.ok) {
        Alert.alert("Error", j?.error ?? "Could not send request.");
        return;
      }
      setMyRequestStatus("pending");
    } finally {
      setBusy(false);
    }
  }, [busy, session, id]);

  if (loading) {
    return (
      <View style={s.center}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={LIME} size="large" />
      </View>
    );
  }

  if (!post) {
    return (
      <View style={s.center}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={s.errorText}>Training session not found.</Text>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backBtnText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const isHost = post.user_id === myUserId;
  const isEnded = post.status !== "active";
  const hostTier = host?.tier ?? null;
  const hostTierC = tierColor(hostTier);
  const isDiamond = (hostTier ?? "").toLowerCase() === "diamond";
  const spotsOpen = Math.max(0, Math.trunc(Number(post.spots_available ?? 0)));
  const isFull = spotsOpen <= 0;

  const pending = requests.filter((r) => r.status === "pending");
  const accepted = requests.filter((r) => r.status === "accepted");
  const spotsLabel =
    spotsOpen <= 0
      ? accepted.length > 0
        ? "Full"
        : "Solo training"
      : `${spotsOpen} spot${spotsOpen === 1 ? "" : "s"} open`;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView style={[s.root, { paddingTop: insets.top }]} contentContainerStyle={{ paddingBottom: 60 }}>
        {/* Header */}
        <View style={s.header}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <FontAwesome name="chevron-left" size={16} color="rgba(255,255,255,0.6)" />
          </Pressable>
          <Text style={s.headerTitle} numberOfLines={1}>
            {post.field_name}
          </Text>
          {isHost && !isEnded ? (
            <Pressable onPress={endTraining} hitSlop={10} disabled={busy}>
              <Text style={s.endLink}>End</Text>
            </Pressable>
          ) : (
            <View style={{ width: 30 }} />
          )}
        </View>

        {isEnded && (
          <View style={s.endedBanner}>
            <FontAwesome name="info-circle" size={14} color="#ef4444" />
            <Text style={s.endedBannerText}>This training session has ended</Text>
          </View>
        )}

        {/* Host / person identity */}
        <View style={s.identityRow}>
          <View style={[s.avatarRing, { borderColor: hostTierC }]}>
            {host?.avatar_url ? (
              <Image source={{ uri: host.avatar_url }} style={s.avatarImg} />
            ) : (
              <View style={[s.avatarImg, s.avatarFallback]}>
                <Text style={[s.avatarFallbackText, { color: hostTierC }]}>{initials(personName(host))}</Text>
              </View>
            )}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.hostName} numberOfLines={1}>
              {personName(host)}
            </Text>
            {hostTier ? (
              <View style={[s.tierBadge, { borderColor: hostTierC, backgroundColor: `${hostTierC}22` }]}>
                {isDiamond ? <Text style={[s.tierDiamond, { color: hostTierC }]}>◆ </Text> : null}
                <Text style={[s.tierBadgeText, { color: hostTierC }]}>
                  {hostTier.toUpperCase()}
                  {host?.playing_position ? ` · ${host.playing_position}` : ""}
                </Text>
              </View>
            ) : host?.playing_position ? (
              <Text style={s.positionText}>{host.playing_position}</Text>
            ) : null}
          </View>
        </View>

        {/* Live timer + session info */}
        <View style={s.card}>
          <View style={s.liveRow}>
            <View style={[s.liveDot, isEnded && { backgroundColor: "rgba(255,255,255,0.3)" }]} />
            <Text style={[s.liveText, isEnded && { color: "rgba(255,255,255,0.4)" }]}>
              {isEnded ? "Ended" : elapsed || "Just started"}
            </Text>
          </View>
          {post.started_at ? (
            <View style={s.detailRow}>
              <FontAwesome name="clock-o" size={14} color="rgba(255,255,255,0.4)" />
              <Text style={s.detailText}>Started at {fmt12Hour(post.started_at)}</Text>
            </View>
          ) : null}
          {post.training_until ? (
            <View style={s.detailRow}>
              <FontAwesome name="clock-o" size={14} color="rgba(255,255,255,0.4)" />
              <Text style={s.detailText}>Training until {fmt12Hour(post.training_until)}</Text>
            </View>
          ) : null}
          <View style={s.detailRow}>
            <FontAwesome name="map-marker" size={14} color="rgba(255,255,255,0.4)" />
            <Text style={s.detailText}>{post.field_name}</Text>
          </View>
          <View style={s.detailRow}>
            <FontAwesome name="users" size={14} color="rgba(255,255,255,0.4)" />
            <Text style={[s.detailText, isFull && accepted.length > 0 && { color: "#ef4444" }]}>
              {spotsLabel}
            </Text>
          </View>
        </View>

        {post.what_im_working_on && (
          <View style={s.card}>
            <Text style={s.sectionTitle}>Working on</Text>
            <Text style={s.workingOnText}>{post.what_im_working_on}</Text>
          </View>
        )}

        {post.notes ? (
          <View style={s.card}>
            <Text style={s.sectionTitle}>Notes</Text>
            <Text style={s.notesText}>{post.notes}</Text>
          </View>
        ) : null}

        {/* Visitor action */}
        {!isHost && !isEnded && (
          <>
            {myRequestStatus === "accepted" ? (
              <View style={[s.actionBtn, s.actionBtnDone]}>
                <Text style={s.actionBtnDoneText}>✓ You're in</Text>
              </View>
            ) : myRequestStatus === "declined" ? (
              <View style={[s.actionBtn, s.actionBtnDone]}>
                <Text style={s.actionBtnDoneText}>Request declined</Text>
              </View>
            ) : myRequestStatus === "pending" ? (
              <View style={[s.actionBtn, s.actionBtnDone]}>
                <Text style={s.actionBtnDoneText}>Request sent</Text>
              </View>
            ) : (
              <Pressable
                onPress={() => void requestJoin()}
                disabled={busy || isFull}
                style={[s.actionBtn, (busy || isFull) && { opacity: 0.5 }]}
              >
                {busy ? (
                  <ActivityIndicator color="#0a0a0a" />
                ) : (
                  <Text style={s.actionBtnText}>{isFull ? "Full" : "Request to join"}</Text>
                )}
              </Pressable>
            )}
          </>
        )}

        {/* Host: join requests */}
        {isHost && !isEnded && (
          <>
            <Text style={[s.sectionLabel, { marginTop: 24 }]}>
              Join requests{pending.length > 0 ? ` (${pending.length})` : ""}
            </Text>
            {pending.length === 0 ? (
              <View style={s.emptyBox}>
                <Text style={s.emptyText}>No requests yet. You'll get a notification when someone wants to join.</Text>
              </View>
            ) : (
              <View style={{ gap: 10 }}>
                {pending.map((req) => {
                  const name = personName(req.person);
                  const t = req.person?.tier ?? null;
                  const tc = tierColor(t);
                  return (
                    <View key={req.id} style={s.requestRow}>
                      <View style={[s.reqAvatar, { borderColor: tc }]}>
                        {req.person?.avatar_url ? (
                          <Image source={{ uri: req.person.avatar_url }} style={s.reqAvatarImg} />
                        ) : (
                          <Text style={[s.reqAvatarText, { color: tc }]}>{initials(name)}</Text>
                        )}
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.reqName} numberOfLines={1}>
                          {name}
                        </Text>
                        <Text style={s.reqMeta} numberOfLines={1}>
                          {t ? t.toUpperCase() : "Unrated"}
                          {req.person?.playing_position ? ` · ${req.person.playing_position}` : ""}
                        </Text>
                      </View>
                      <Pressable
                        onPress={() => void respond(req.id, "declined")}
                        disabled={busy}
                        style={[s.declineBtn, busy && { opacity: 0.5 }]}
                      >
                        <FontAwesome name="times" size={14} color="#ef4444" />
                      </Pressable>
                      <Pressable
                        onPress={() => void respond(req.id, "accepted")}
                        disabled={busy}
                        style={[s.acceptBtn, busy && { opacity: 0.5 }]}
                      >
                        <Text style={s.acceptBtnText}>Accept</Text>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            )}

            {accepted.length > 0 && (
              <>
                <Text style={[s.sectionLabel, { marginTop: 24 }]}>Training with you ({accepted.length})</Text>
                <View style={s.card}>
                  {accepted.map((req, i) => {
                    const name = personName(req.person);
                    const tc = tierColor(req.person?.tier ?? null);
                    return (
                      <View key={req.id} style={[s.attendeeRow, i > 0 && s.attendeeBorder]}>
                        <View style={[s.reqAvatar, { borderColor: tc, width: 32, height: 32 }]}>
                          {req.person?.avatar_url ? (
                            <Image source={{ uri: req.person.avatar_url }} style={s.reqAvatarImg} />
                          ) : (
                            <Text style={[s.reqAvatarText, { color: tc, fontSize: 12 }]}>{initials(name)}</Text>
                          )}
                        </View>
                        <Text style={s.attendeeName}>{name}</Text>
                      </View>
                    );
                  })}
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0a0a0a", padding: 20 },
  center: { flex: 1, backgroundColor: "#0a0a0a", alignItems: "center", justifyContent: "center", padding: 24 },
  errorText: { color: "rgba(255,255,255,0.5)", fontSize: 16 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 8, marginBottom: 20 },
  headerTitle: { color: "#fff", fontSize: 17, fontWeight: "700", flex: 1, textAlign: "center", marginHorizontal: 12 },
  endLink: { color: "#ef4444", fontSize: 15, fontWeight: "700" },
  endedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(239,68,68,0.1)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.3)",
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  endedBannerText: { color: "#ef4444", fontSize: 14, fontWeight: "600" },
  identityRow: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 16 },
  avatarRing: { width: 64, height: 64, borderRadius: 32, borderWidth: 2, padding: 3, alignItems: "center", justifyContent: "center" },
  avatarImg: { width: "100%", height: "100%", borderRadius: 28 },
  avatarFallback: { backgroundColor: "rgba(255,255,255,0.06)", alignItems: "center", justifyContent: "center" },
  avatarFallbackText: { fontSize: 20, fontWeight: "800" },
  hostName: { color: "#fff", fontSize: 22, fontWeight: "800", letterSpacing: -0.3 },
  tierBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    marginTop: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  tierBadgeText: { fontSize: 11, fontWeight: "800", letterSpacing: 0.5 },
  tierDiamond: { fontSize: 11, fontWeight: "800" },
  positionText: { color: "rgba(255,255,255,0.55)", fontSize: 13, marginTop: 4 },
  card: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    padding: 16,
    marginBottom: 16,
  },
  liveRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  liveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#4ADE80" },
  liveText: { color: "#4ADE80", fontSize: 16, fontWeight: "800" },
  detailRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 7 },
  detailText: { color: "#fff", fontSize: 15, flex: 1 },
  sectionTitle: { color: "rgba(255,255,255,0.45)", fontSize: 11, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 8 },
  workingOnText: { color: "#fff", fontSize: 18, fontWeight: "600", lineHeight: 24 },
  notesText: { color: "rgba(255,255,255,0.8)", fontSize: 15, lineHeight: 21 },
  actionBtn: { backgroundColor: LIME, borderRadius: 14, paddingVertical: 16, alignItems: "center", marginTop: 4 },
  actionBtnText: { color: "#0a0a0a", fontWeight: "800", fontSize: 16 },
  actionBtnDone: { backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.15)" },
  actionBtnDoneText: { color: "rgba(255,255,255,0.7)", fontWeight: "700", fontSize: 15 },
  sectionLabel: { color: "rgba(255,255,255,0.45)", fontSize: 11, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 12 },
  emptyBox: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    padding: 18,
  },
  emptyText: { color: "rgba(255,255,255,0.4)", fontSize: 14, lineHeight: 20 },
  requestRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    padding: 12,
  },
  reqAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  reqAvatarImg: { width: "100%", height: "100%" },
  reqAvatarText: { fontWeight: "800", fontSize: 15 },
  reqName: { color: "#fff", fontSize: 15, fontWeight: "700" },
  reqMeta: { color: "rgba(255,255,255,0.5)", fontSize: 12, marginTop: 2 },
  declineBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  acceptBtn: { backgroundColor: LIME, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  acceptBtnText: { color: "#0a0a0a", fontWeight: "800", fontSize: 14 },
  attendeeRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  attendeeBorder: { borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.06)" },
  attendeeName: { flex: 1, color: "#fff", fontSize: 15, fontWeight: "500" },
  backBtn: { marginTop: 16, backgroundColor: LIME, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  backBtnText: { color: "#0a0a0a", fontWeight: "800" },
});
