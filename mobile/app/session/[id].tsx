import { useAuth } from "@/context/AuthContext";
import { siteOrigin } from "@/lib/env";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";

const LIME = "#a3e635";

type SessionDetail = {
  id: string;
  title: string;
  location_text: string | null;
  latitude: number | null;
  longitude: number | null;
  start_at: string;
  capacity: number;
  spots_taken: number;
  fee_cents: number;
  level: string | null;
  open_tier_rank: number | null;
  run_type: string;
  format: string | null;
  status: string;
  created_by: string | null;
  service_region: string | null;
};

type Attendee = {
  user_id: string;
  status: string;
  profiles: { first_name: string | null; last_name: string | null; username: string | null } | null;
};

type PlayerResult = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  playing_position: string | null;
};

const TIER_LABELS: Record<number, string> = {
  0: "All levels", 1: "Bronze+", 2: "Silver+", 3: "Gold+", 4: "Platinum+", 5: "Diamond only",
};

const LEVEL_LABELS: Record<string, string> = {
  casual: "Casual", competitive: "Competitive", elite: "Elite",
};

function fmt12Hour(iso: string): string {
  const d = new Date(iso);
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
}

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session, supabase } = useAuth();

  const [run, setRun] = useState<SessionDetail | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [loading, setLoading] = useState(true);
  const [rsvpBusy, setRsvpBusy] = useState(false);
  const [myStatus, setMyStatus] = useState<string | null>(null);

  // Invite modal
  const [inviteOpen, setInviteOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<PlayerResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());

  const myUserId = session?.user?.id;
  const isHost = run?.created_by === myUserId;

  const load = useCallback(async () => {
    if (!supabase || !id) return;
    setLoading(true);
    try {
      const { data: runData } = await supabase
        .from("pickup_runs")
        .select("id,title,location_text,latitude,longitude,start_at,capacity,spots_taken,fee_cents,level,open_tier_rank,run_type,format,status,created_by,service_region")
        .eq("id", id)
        .maybeSingle();
      if (runData) setRun(runData as SessionDetail);

      const { data: rsvpData } = await supabase
        .from("pickup_run_rsvps")
        .select("user_id,status,profiles(first_name,last_name,username)")
        .eq("run_id", id)
        .in("status", ["confirmed", "pending_payment"]);
      if (rsvpData) setAttendees(rsvpData as Attendee[]);

      if (myUserId) {
        const { data: myRsvp } = await supabase
          .from("pickup_run_rsvps")
          .select("status")
          .eq("run_id", id)
          .eq("user_id", myUserId)
          .maybeSingle();
        setMyStatus(myRsvp?.status ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, [supabase, id, myUserId]);

  useEffect(() => { void load(); }, [load]);

  async function searchPlayers(q: string) {
    setSearchQ(q);
    if (q.trim().length < 2) { setSearchResults([]); return; }
    if (!supabase) return;
    setSearching(true);
    try {
      const { data } = await supabase
        .from("profiles")
        .select("id,first_name,last_name,username,playing_position")
        .eq("approved", true)
        .or(`username.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%`)
        .neq("id", myUserId ?? "")
        .limit(10);
      setSearchResults((data ?? []) as PlayerResult[]);
    } finally {
      setSearching(false);
    }
  }

  async function sendInvite(player: PlayerResult) {
    if (invitedIds.has(player.id)) return;
    const origin = siteOrigin();
    const token = session?.access_token;
    if (!origin || !token) return;

    try {
      const r = await fetch(`${origin}/api/pickup/rsvp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ run_id: id, action: "invite", target_user_id: player.id }),
      });
      const j = await r.json().catch(() => null) as { ok?: boolean } | null;
      if (j?.ok) {
        setInvitedIds((prev) => new Set([...prev, player.id]));
      } else {
        // Still mark as invited for share flow
        setInvitedIds((prev) => new Set([...prev, player.id]));
      }
    } catch {
      setInvitedIds((prev) => new Set([...prev, player.id]));
    }
  }

  async function shareSession() {
    try {
      await Share.share({
        message: `Join my CT Pickup session: ${run?.title ?? "Soccer Session"} on ${fmtDate(run?.start_at ?? "")} at ${fmt12Hour(run?.start_at ?? "")}`,
        url: `https://ctpickup.net/session/${id}`,
      });
    } catch {}
  }

  async function rsvp() {
    if (rsvpBusy || !session?.access_token) return;
    const origin = siteOrigin();
    if (!origin) return;
    setRsvpBusy(true);
    try {
      const r = await fetch(`${origin}/api/pickup/rsvp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ run_id: id, action: "join" }),
      });
      const j = await r.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!r.ok || !j?.ok) {
        Alert.alert("Error", j?.error ?? "Could not RSVP.");
        return;
      }
      await load();
    } finally {
      setRsvpBusy(false);
    }
  }

  if (loading) {
    return <View style={s.center}><ActivityIndicator color={LIME} size="large" /></View>;
  }

  if (!run) {
    return (
      <View style={s.center}>
        <Text style={s.errorText}>Session not found.</Text>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backBtnText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const spotsLeft = run.capacity - run.spots_taken;
  const isFull = spotsLeft <= 0;
  const isJoined = myStatus === "confirmed" || myStatus === "pending_payment";
  const tierLabel = run.open_tier_rank != null ? TIER_LABELS[run.open_tier_rank] : "All levels";
  const formatLabel = run.format ?? run.run_type;

  return (
    <>
      <ScrollView style={s.root} contentContainerStyle={{ paddingBottom: 60 }}>
        {/* Header */}
        <View style={s.header}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <FontAwesome name="chevron-left" size={16} color="rgba(255,255,255,0.6)" />
          </Pressable>
          <Text style={s.headerTitle} numberOfLines={1}>{run.title}</Text>
          <Pressable onPress={() => void shareSession()} hitSlop={10}>
            <FontAwesome name="share" size={16} color={LIME} />
          </Pressable>
        </View>

        {/* Pills */}
        <View style={s.pillRow}>
          <View style={[s.pill, { borderColor: isFull ? "#ef4444" : LIME }]}>
            <Text style={[s.pillText, { color: isFull ? "#ef4444" : LIME }]}>
              {isFull ? "Full" : `${spotsLeft} spot${spotsLeft === 1 ? "" : "s"} left`}
            </Text>
          </View>
          {isHost && <View style={[s.pill, { borderColor: "#facc15" }]}><Text style={[s.pillText, { color: "#facc15" }]}>You're hosting</Text></View>}
          {isJoined && !isHost && <View style={[s.pill, { borderColor: LIME }]}><Text style={[s.pillText, { color: LIME }]}>You're in</Text></View>}
        </View>

        {/* Details */}
        <View style={s.card}>
          <View style={s.detailRow}>
            <FontAwesome name="calendar" size={14} color="rgba(255,255,255,0.4)" />
            <Text style={s.detailText}>{fmtDate(run.start_at)}</Text>
          </View>
          <View style={s.detailRow}>
            <FontAwesome name="clock-o" size={14} color="rgba(255,255,255,0.4)" />
            <Text style={s.detailText}>{fmt12Hour(run.start_at)}</Text>
          </View>
          {run.location_text && (
            <View style={s.detailRow}>
              <FontAwesome name="map-marker" size={14} color="rgba(255,255,255,0.4)" />
              <Text style={s.detailText}>{run.location_text}</Text>
            </View>
          )}
          <View style={s.detailRow}>
            <FontAwesome name="users" size={14} color="rgba(255,255,255,0.4)" />
            <Text style={s.detailText}>{run.spots_taken} / {run.capacity} players</Text>
          </View>
          <View style={s.detailRow}>
            <FontAwesome name="soccer-ball-o" size={14} color="rgba(255,255,255,0.4)" />
            <Text style={s.detailText}>{formatLabel} · {tierLabel}</Text>
          </View>
          {run.fee_cents > 0 && (
            <View style={s.detailRow}>
              <FontAwesome name="dollar" size={14} color="rgba(255,255,255,0.4)" />
              <Text style={s.detailText}>${(run.fee_cents / 100).toFixed(2)} buy-in</Text>
            </View>
          )}
        </View>

        {/* Actions */}
        {!isHost && (
          <Pressable onPress={() => void rsvp()} disabled={rsvpBusy || isFull || isJoined}
            style={[s.rsvpBtn, (isFull || isJoined) && s.rsvpBtnDisabled]}>
            {rsvpBusy
              ? <ActivityIndicator color="#0a0a0a" />
              : <Text style={s.rsvpBtnText}>
                  {isJoined ? "✓ You're in" : isFull ? "Session full" : run.fee_cents > 0 ? `Join · $${(run.fee_cents / 100).toFixed(2)}` : "Join session"}
                </Text>}
          </Pressable>
        )}

        {isHost && (
          <View style={{ gap: 10 }}>
            <Pressable onPress={() => setInviteOpen(true)} style={s.inviteBtn}>
              <FontAwesome name="user-plus" size={14} color="#0a0a0a" />
              <Text style={s.inviteBtnText}>Invite players</Text>
            </Pressable>
            <Pressable onPress={() => void shareSession()} style={s.shareBtn}>
              <FontAwesome name="share" size={14} color={LIME} />
              <Text style={s.shareBtnText}>Share link</Text>
            </Pressable>
          </View>
        )}

        {/* Attendees */}
        {attendees.length > 0 && (
          <>
            <Text style={[s.sectionTitle, { marginTop: 24 }]}>Who's in ({attendees.length})</Text>
            <View style={s.card}>
              {attendees.map((a, i) => {
                const name = [a.profiles?.first_name, a.profiles?.last_name].filter(Boolean).join(" ") || a.profiles?.username || "Player";
                return (
                  <View key={a.user_id} style={[s.attendeeRow, i > 0 && s.attendeeBorder]}>
                    <View style={s.avatar}>
                      <Text style={s.avatarText}>{name[0]?.toUpperCase() ?? "?"}</Text>
                    </View>
                    <Text style={s.attendeeName}>{name}</Text>
                    {a.user_id === run.created_by && <Text style={s.hostBadge}>Host</Text>}
                  </View>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>

      {/* Invite Modal */}
      <Modal visible={inviteOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setInviteOpen(false)}>
        <View style={s.modalRoot}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Invite players</Text>
            <Pressable onPress={() => setInviteOpen(false)} hitSlop={10}>
              <FontAwesome name="times" size={18} color="rgba(255,255,255,0.6)" />
            </Pressable>
          </View>

          <View style={s.modalSearch}>
            <FontAwesome name="search" size={14} color="rgba(255,255,255,0.4)" />
            <TextInput
              style={s.modalSearchInput}
              value={searchQ}
              onChangeText={(t) => void searchPlayers(t)}
              placeholder="Search by name or username…"
              placeholderTextColor="rgba(255,255,255,0.3)"
              autoCorrect={false}
              autoFocus
            />
            {searching && <ActivityIndicator color={LIME} size="small" />}
          </View>

          <Pressable onPress={() => void shareSession()} style={s.shareLinkRow}>
            <FontAwesome name="link" size={14} color={LIME} />
            <Text style={s.shareLinkText}>Share session link instead</Text>
            <FontAwesome name="chevron-right" size={12} color="rgba(255,255,255,0.3)" />
          </Pressable>

          <FlatList
            data={searchResults}
            keyExtractor={(p) => p.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 16, gap: 8 }}
            ListEmptyComponent={
              searchQ.length >= 2 && !searching
                ? <Text style={s.emptyText}>No players found.</Text>
                : searchQ.length === 0
                ? <Text style={s.emptyText}>Start typing to search CT Pickup players.</Text>
                : null
            }
            renderItem={({ item }) => {
              const name = [item.first_name, item.last_name].filter(Boolean).join(" ") || item.username || "Player";
              const invited = invitedIds.has(item.id);
              return (
                <View style={s.playerRow}>
                  <View style={s.avatar}>
                    <Text style={s.avatarText}>{name[0]?.toUpperCase() ?? "?"}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.playerName}>{name}</Text>
                    {item.username && <Text style={s.playerUsername}>@{item.username}</Text>}
                    {item.playing_position && <Text style={s.playerPos}>{item.playing_position}</Text>}
                  </View>
                  <Pressable
                    onPress={() => void sendInvite(item)}
                    disabled={invited}
                    style={[s.inviteRowBtn, invited && s.inviteRowBtnDone]}
                  >
                    <Text style={[s.inviteRowBtnText, invited && s.inviteRowBtnTextDone]}>
                      {invited ? "✓ Invited" : "Invite"}
                    </Text>
                  </Pressable>
                </View>
              );
            }}
          />
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0a0a0a", padding: 20 },
  center: { flex: 1, backgroundColor: "#0a0a0a", alignItems: "center", justifyContent: "center", padding: 24 },
  errorText: { color: "rgba(255,255,255,0.5)", fontSize: 16 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 16, marginBottom: 20 },
  headerTitle: { color: "#fff", fontSize: 17, fontWeight: "700", flex: 1, textAlign: "center", marginHorizontal: 12 },
  pillRow: { flexDirection: "row", gap: 8, marginBottom: 16, flexWrap: "wrap" },
  pill: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  pillText: { fontSize: 12, fontWeight: "700" },
  card: { backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", padding: 16, marginBottom: 16 },
  detailRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 7 },
  detailText: { color: "#fff", fontSize: 15, flex: 1 },
  rsvpBtn: { backgroundColor: LIME, borderRadius: 14, paddingVertical: 16, alignItems: "center", marginBottom: 12 },
  rsvpBtnDisabled: { opacity: 0.5 },
  rsvpBtnText: { color: "#0a0a0a", fontWeight: "800", fontSize: 16 },
  inviteBtn: { backgroundColor: LIME, borderRadius: 14, paddingVertical: 16, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 10 },
  inviteBtnText: { color: "#0a0a0a", fontWeight: "800", fontSize: 16 },
  shareBtn: { borderRadius: 14, paddingVertical: 14, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 10, borderWidth: 1, borderColor: LIME },
  shareBtnText: { color: LIME, fontWeight: "700", fontSize: 15 },
  sectionTitle: { color: "rgba(255,255,255,0.45)", fontSize: 11, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 10 },
  attendeeRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  attendeeBorder: { borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.06)" },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(163,230,53,0.15)", alignItems: "center", justifyContent: "center" },
  avatarText: { color: LIME, fontWeight: "700", fontSize: 15 },
  attendeeName: { flex: 1, color: "#fff", fontSize: 15, fontWeight: "500" },
  hostBadge: { color: "#facc15", fontSize: 11, fontWeight: "700", borderWidth: 1, borderColor: "#facc15", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  backBtn: { marginTop: 16, backgroundColor: LIME, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  backBtnText: { color: "#0a0a0a", fontWeight: "800" },
  modalRoot: { flex: 1, backgroundColor: "#0a0a0a" },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 20, paddingTop: 24, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)" },
  modalTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },
  modalSearch: { flexDirection: "row", alignItems: "center", gap: 10, margin: 16, backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", paddingHorizontal: 14, paddingVertical: 12 },
  modalSearchInput: { flex: 1, color: "#fff", fontSize: 15 },
  shareLinkRow: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 16, marginBottom: 8, padding: 14, backgroundColor: "rgba(163,230,53,0.06)", borderRadius: 12, borderWidth: 1, borderColor: "rgba(163,230,53,0.2)" },
  shareLinkText: { flex: 1, color: LIME, fontSize: 14, fontWeight: "600" },
  emptyText: { color: "rgba(255,255,255,0.35)", fontSize: 14, textAlign: "center", marginTop: 20 },
  playerRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 12, padding: 12 },
  playerName: { color: "#fff", fontSize: 15, fontWeight: "600" },
  playerUsername: { color: "rgba(255,255,255,0.4)", fontSize: 12, marginTop: 2 },
  playerPos: { color: LIME, fontSize: 11, marginTop: 2 },
  inviteRowBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: LIME },
  inviteRowBtnDone: { borderColor: "rgba(255,255,255,0.2)", backgroundColor: "rgba(255,255,255,0.04)" },
  inviteRowBtnText: { color: LIME, fontWeight: "700", fontSize: 13 },
  inviteRowBtnTextDone: { color: "rgba(255,255,255,0.35)" },
});
