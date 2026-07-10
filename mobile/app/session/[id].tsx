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
  tier_session_id: string | null;
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

function playerName(a: Attendee): string {
  return [a.profiles?.first_name, a.profiles?.last_name].filter(Boolean).join(" ") || a.profiles?.username || "Player";
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
  const [endBusy, setEndBusy] = useState(false);

  // Invite modal
  const [inviteOpen, setInviteOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<PlayerResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());

  // Peer vote modal
  const [voteOpen, setVoteOpen] = useState(false);
  const [votePicks, setVotePicks] = useState<string[]>([]);
  const [voteBusy, setVoteBusy] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);

  // Organizer score modal
  const [scoreOpen, setScoreOpen] = useState(false);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [scoreBusy, setScoreBusy] = useState(false);

  const myUserId = session?.user?.id;
  const isHost = run?.created_by === myUserId;
  const isCompleted = run?.status === "completed";

  const load = useCallback(async () => {
    if (!supabase || !id) return;
    setLoading(true);
    try {
      const { data: runData } = await supabase
        .from("pickup_runs")
        .select("id,title,location_text,latitude,longitude,start_at,capacity,spots_taken,fee_cents,level,open_tier_rank,run_type,format,status,created_by,service_region,tier_session_id")
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

        // Check if already voted
        if (runData?.tier_session_id) {
          const { data: myVote } = await supabase
            .from("peer_votes")
            .select("voter_id")
            .eq("session_id", runData.tier_session_id)
            .eq("voter_id", myUserId)
            .limit(1);
          setHasVoted((myVote?.length ?? 0) > 0);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [supabase, id, myUserId]);

  useEffect(() => { void load(); }, [load]);

  async function endSession() {
    if (endBusy) return;
    Alert.alert("End session?", "This marks the session as complete and starts the rating process.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "End session", style: "destructive", onPress: async () => {
          setEndBusy(true);
          const origin = siteOrigin();
          const token = session?.access_token;
          if (!origin || !token) { setEndBusy(false); return; }
          try {
            const r = await fetch(`${origin}/api/admin/pickup/end-run`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify({ run_id: id }),
            });
            const j = await r.json().catch(() => null) as { ok?: boolean; error?: string } | null;
            if (!r.ok || !j?.ok) {
              Alert.alert("Error", j?.error ?? "Could not end session.");
              return;
            }
            await load();
            setScoreOpen(true);
          } finally {
            setEndBusy(false);
          }
        }
      }
    ]);
  }

  async function submitVotes() {
    if (votePicks.length !== 3 || voteBusy || !run?.tier_session_id) return;
    if (!supabase || !myUserId) return;
    setVoteBusy(true);
    try {
      const rows = votePicks.map((votee_id, i) => ({
        session_id: run.tier_session_id!,
        voter_id: myUserId,
        votee_id,
        rank: i + 1,
      }));
      const { error } = await supabase.from("peer_votes").insert(rows);
      if (error && error.code !== "23505") {
        Alert.alert("Error", "Could not submit votes.");
        return;
      }
      setHasVoted(true);
      setVoteOpen(false);
      Alert.alert("Votes submitted!", "Thanks for rating your teammates.");
    } finally {
      setVoteBusy(false);
    }
  }

  async function submitScores() {
    if (scoreBusy || !run?.tier_session_id || !supabase) return;
    setScoreBusy(true);
    const TIER_TO_SCORE: Record<string, number> = {
      bronze: 2, silver: 4, gold: 6, platinum: 8, diamond: 10,
    };
    try {
      for (const [user_id, tierVal] of Object.entries(scores)) {
        const score = TIER_TO_SCORE[tierVal];
        if (!score) continue;
        await supabase
          .from("session_attendance")
          .update({ organizer_score: score })
          .eq("session_id", run.tier_session_id)
          .eq("user_id", user_id);
      }

      // Settle the session via RPC
      const { error } = await supabase.rpc("settle_session", { p_session_id: run.tier_session_id });
      if (error) {
        console.warn("[settle_session] error", error.message);
        Alert.alert("Scores saved", "Ratings will be processed shortly.");
      } else {
        Alert.alert("Done!", "Player ratings have been updated.");
      }
      setScoreOpen(false);
    } finally {
      setScoreBusy(false);
    }
  }

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
    setInvitedIds((prev) => new Set([...prev, player.id]));
    try {
      await Share.share({
        message: `Join my CT Pickup session: ${run?.title ?? "Soccer Session"} on ${fmtDate(run?.start_at ?? "")}`,
        url: `https://ctpickup.net/session/${id}`,
      });
    } catch {}
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
      if (!r.ok || !j?.ok) { Alert.alert("Error", j?.error ?? "Could not RSVP."); return; }
      await load();
    } finally {
      setRsvpBusy(false);
    }
  }

  function toggleVotePick(uid: string) {
    setVotePicks((cur) =>
      cur.includes(uid) ? cur.filter((x) => x !== uid) : cur.length < 3 ? [...cur, uid] : cur
    );
  }

  if (loading) {
    return <View style={s.center}><ActivityIndicator color={LIME} size="large" /></View>;
  }

  if (!run) {
    return (
      <View style={s.center}>
        <Text style={s.errorText}>Session not found.</Text>
        <Pressable onPress={() => router.back()} style={s.backBtn}><Text style={s.backBtnText}>Go back</Text></Pressable>
      </View>
    );
  }

  const spotsLeft = run.capacity - run.spots_taken;
  const isFull = spotsLeft <= 0;
  const isJoined = myStatus === "confirmed" || myStatus === "pending_payment";
  const tierLabel = run.open_tier_rank != null ? TIER_LABELS[run.open_tier_rank] : "All levels";
  const formatLabel = run.format ?? run.run_type;
  const canVote = isCompleted && isJoined && !isHost && !hasVoted && run.tier_session_id;

  return (
    <>
      <ScrollView style={s.root} contentContainerStyle={{ paddingBottom: 60 }}>
        <View style={s.header}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <FontAwesome name="chevron-left" size={16} color="rgba(255,255,255,0.6)" />
          </Pressable>
          <Text style={s.headerTitle} numberOfLines={1}>{run.title}</Text>
          <Pressable onPress={() => void shareSession()} hitSlop={10}>
            <FontAwesome name="share" size={16} color={LIME} />
          </Pressable>
        </View>

        <View style={s.pillRow}>
          {isCompleted
            ? <View style={[s.pill, { borderColor: "rgba(255,255,255,0.3)" }]}><Text style={[s.pillText, { color: "rgba(255,255,255,0.5)" }]}>Completed</Text></View>
            : <View style={[s.pill, { borderColor: isFull ? "#ef4444" : LIME }]}><Text style={[s.pillText, { color: isFull ? "#ef4444" : LIME }]}>{isFull ? "Full" : `${spotsLeft} spot${spotsLeft === 1 ? "" : "s"} left`}</Text></View>
          }
          {isHost && <View style={[s.pill, { borderColor: "#facc15" }]}><Text style={[s.pillText, { color: "#facc15" }]}>You're hosting</Text></View>}
          {isJoined && !isHost && <View style={[s.pill, { borderColor: LIME }]}><Text style={[s.pillText, { color: LIME }]}>You're in</Text></View>}
        </View>

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
        {!isHost && !isCompleted && (
          <Pressable onPress={() => void rsvp()} disabled={rsvpBusy || isFull || isJoined}
            style={[s.rsvpBtn, (isFull || isJoined) && s.rsvpBtnDisabled]}>
            {rsvpBusy ? <ActivityIndicator color="#0a0a0a" /> :
              <Text style={s.rsvpBtnText}>{isJoined ? "✓ You're in" : isFull ? "Session full" : run.fee_cents > 0 ? `Join · $${(run.fee_cents / 100).toFixed(2)}` : "Join session"}</Text>}
          </Pressable>
        )}

        {canVote && (
          <Pressable onPress={() => setVoteOpen(true)} style={s.voteBtn}>
            <FontAwesome name="star" size={14} color="#0a0a0a" />
            <Text style={s.voteBtnText}>Rate your teammates</Text>
          </Pressable>
        )}

        {isCompleted && isJoined && !isHost && hasVoted && (
          <View style={[s.rsvpBtn, s.rsvpBtnDisabled]}>
            <Text style={s.rsvpBtnText}>✓ Votes submitted</Text>
          </View>
        )}

        {isHost && !isCompleted && (
          <View style={{ gap: 10 }}>
            <Pressable onPress={() => setInviteOpen(true)} style={s.inviteBtn}>
              <FontAwesome name="user-plus" size={14} color="#0a0a0a" />
              <Text style={s.inviteBtnText}>Invite players</Text>
            </Pressable>
            <Pressable onPress={() => void shareSession()} style={s.shareBtn}>
              <FontAwesome name="share" size={14} color={LIME} />
              <Text style={s.shareBtnText}>Share link</Text>
            </Pressable>
            <Pressable onPress={() => void endSession()} disabled={endBusy}
              style={[s.endBtn, endBusy && { opacity: 0.5 }]}>
              {endBusy ? <ActivityIndicator color="#ef4444" /> :
                <Text style={s.endBtnText}>End session</Text>}
            </Pressable>
          </View>
        )}

        {isHost && isCompleted && (
          <Pressable onPress={() => setScoreOpen(true)} style={s.voteBtn}>
            <FontAwesome name="star" size={14} color="#0a0a0a" />
            <Text style={s.voteBtnText}>Score players</Text>
          </Pressable>
        )}

        {attendees.length > 0 && (
          <>
            <Text style={[s.sectionTitle, { marginTop: 24 }]}>Who's in ({attendees.length})</Text>
            <View style={s.card}>
              {attendees.map((a, i) => {
                const name = playerName(a);
                return (
                  <View key={a.user_id} style={[s.attendeeRow, i > 0 && s.attendeeBorder]}>
                    <View style={s.avatar}><Text style={s.avatarText}>{name[0]?.toUpperCase() ?? "?"}</Text></View>
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
            <TextInput style={s.modalSearchInput} value={searchQ} onChangeText={(t) => void searchPlayers(t)}
              placeholder="Search by name or username…" placeholderTextColor="rgba(255,255,255,0.3)"
              autoCorrect={false} autoFocus />
            {searching && <ActivityIndicator color={LIME} size="small" />}
          </View>
          <Pressable onPress={() => void shareSession()} style={s.shareLinkRow}>
            <FontAwesome name="link" size={14} color={LIME} />
            <Text style={s.shareLinkText}>Share session link instead</Text>
            <FontAwesome name="chevron-right" size={12} color="rgba(255,255,255,0.3)" />
          </Pressable>
          <FlatList data={searchResults} keyExtractor={(p) => p.id} keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 16, gap: 8 }}
            ListEmptyComponent={<Text style={s.emptyText}>{searchQ.length >= 2 && !searching ? "No players found." : "Start typing to search."}</Text>}
            renderItem={({ item }) => {
              const name = [item.first_name, item.last_name].filter(Boolean).join(" ") || item.username || "Player";
              const invited = invitedIds.has(item.id);
              return (
                <View style={s.playerRow}>
                  <View style={s.avatar}><Text style={s.avatarText}>{name[0]?.toUpperCase() ?? "?"}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.playerName}>{name}</Text>
                    {item.username && <Text style={s.playerUsername}>@{item.username}</Text>}
                    {item.playing_position && <Text style={s.playerPos}>{item.playing_position}</Text>}
                  </View>
                  <Pressable onPress={() => void sendInvite(item)} disabled={invited}
                    style={[s.inviteRowBtn, invited && s.inviteRowBtnDone]}>
                    <Text style={[s.inviteRowBtnText, invited && s.inviteRowBtnTextDone]}>{invited ? "✓ Sent" : "Invite"}</Text>
                  </Pressable>
                </View>
              );
            }} />
        </View>
      </Modal>

      {/* Peer Vote Modal */}
      <Modal visible={voteOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setVoteOpen(false)}>
        <View style={s.modalRoot}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Rate your teammates</Text>
            <Pressable onPress={() => setVoteOpen(false)} hitSlop={10}>
              <FontAwesome name="times" size={18} color="rgba(255,255,255,0.6)" />
            </Pressable>
          </View>
          <Text style={s.voteSubtitle}>Pick the 3 best players on the pitch. Nobody sees your picks.</Text>
          <FlatList
            data={attendees.filter((a) => a.user_id !== myUserId)}
            keyExtractor={(a) => a.user_id}
            contentContainerStyle={{ padding: 16, gap: 8 }}
            renderItem={({ item }) => {
              const name = playerName(item);
              const rank = votePicks.indexOf(item.user_id);
              const picked = rank >= 0;
              const full = votePicks.length === 3 && !picked;
              return (
                <Pressable onPress={() => toggleVotePick(item.user_id)} disabled={full}
                  style={[s.playerRow, picked && { borderWidth: 1, borderColor: LIME }, full && { opacity: 0.35 }]}>
                  <View style={[s.avatar, picked && { backgroundColor: LIME }]}>
                    <Text style={[s.avatarText, picked && { color: "#0a0a0a" }]}>{picked ? rank + 1 : name[0]?.toUpperCase() ?? "?"}</Text>
                  </View>
                  <Text style={s.playerName}>{name}</Text>
                  {picked && <FontAwesome name="check" size={14} color={LIME} />}
                </Pressable>
              );
            }}
          />
          <Pressable onPress={() => void submitVotes()} disabled={votePicks.length !== 3 || voteBusy}
            style={[s.publishBtn, votePicks.length !== 3 && { opacity: 0.4 }, { margin: 16 }]}>
            {voteBusy ? <ActivityIndicator color="#0a0a0a" /> :
              <Text style={s.publishBtnText}>Submit {votePicks.length}/3 votes</Text>}
          </Pressable>
        </View>
      </Modal>

      {/* Organizer Score Modal */}
      <Modal visible={scoreOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setScoreOpen(false)}>
        <ScrollView style={s.modalRoot} keyboardShouldPersistTaps="handled">
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Rate players</Text>
            <Pressable onPress={() => setScoreOpen(false)} hitSlop={10}>
              <FontAwesome name="times" size={18} color="rgba(255,255,255,0.6)" />
            </Pressable>
          </View>
          <Text style={s.voteSubtitle}>Assign each player the tier that best reflects how they played today.</Text>

          <View style={s.tierLegend}>
            {[
              { tier: "bronze", label: "Bronze", desc: "Learning the game", color: "#B87333" },
              { tier: "silver", label: "Silver", desc: "Solid recreational", color: "#A8B0B5" },
              { tier: "gold", label: "Gold", desc: "Competitive club level", color: "#E3B23C" },
              { tier: "platinum", label: "Platinum", desc: "College / semi-pro", color: "#E8E8E8" },
              { tier: "diamond", label: "Diamond", desc: "Elite / pro level", color: "#9B59B6" },
            ].map((t) => (
              <View key={t.tier} style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.color }} />
                <Text style={{ color: t.color, fontWeight: "700", fontSize: 12, width: 60 }}>{t.label}</Text>
                <Text style={{ color: "rgba(255,255,255,0.4)", fontSize: 12 }}>{t.desc}</Text>
              </View>
            ))}
          </View>

          <View style={{ padding: 16, gap: 16 }}>
            {attendees.filter((a) => a.user_id !== myUserId).map((a) => {
              const name = playerName(a);
              const selectedTier = scores[a.user_id] ?? "";
              const TIERS = [
                { value: "bronze", label: "B", color: "#B87333" },
                { value: "silver", label: "S", color: "#A8B0B5" },
                { value: "gold", label: "G", color: "#E3B23C" },
                { value: "platinum", label: "P", color: "#E8E8E8" },
                { value: "diamond", label: "D", color: "#9B59B6" },
              ];
              return (
                <View key={a.user_id} style={s.scoreRow}>
                  <View style={s.avatar}><Text style={s.avatarText}>{name[0]?.toUpperCase() ?? "?"}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.playerName}>{name}</Text>
                    <View style={{ flexDirection: "row", gap: 6, marginTop: 8 }}>
                      {TIERS.map((t) => (
                        <Pressable
                          key={t.value}
                          onPress={() => setScores((prev) => ({ ...prev, [a.user_id]: t.value }))}
                          style={{
                            width: 40, height: 40, borderRadius: 20,
                            borderWidth: 2,
                            borderColor: selectedTier === t.value ? t.color : "rgba(255,255,255,0.15)",
                            backgroundColor: selectedTier === t.value ? `${t.color}22` : "transparent",
                            alignItems: "center", justifyContent: "center",
                          }}
                        >
                          <Text style={{ color: selectedTier === t.value ? t.color : "rgba(255,255,255,0.4)", fontWeight: "800", fontSize: 13 }}>
                            {t.label}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
          <Pressable onPress={() => void submitScores()} disabled={scoreBusy}
            style={[s.publishBtn, scoreBusy && { opacity: 0.5 }, { margin: 16 }]}>
            {scoreBusy ? <ActivityIndicator color="#0a0a0a" /> :
              <Text style={s.publishBtnText}>Submit & settle ratings</Text>}
          </Pressable>
        </ScrollView>
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
  voteBtn: { backgroundColor: LIME, borderRadius: 14, paddingVertical: 16, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 10, marginBottom: 12 },
  voteBtnText: { color: "#0a0a0a", fontWeight: "800", fontSize: 16 },
  inviteBtn: { backgroundColor: LIME, borderRadius: 14, paddingVertical: 16, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 10 },
  inviteBtnText: { color: "#0a0a0a", fontWeight: "800", fontSize: 16 },
  shareBtn: { borderRadius: 14, paddingVertical: 14, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 10, borderWidth: 1, borderColor: LIME },
  shareBtnText: { color: LIME, fontWeight: "700", fontSize: 15 },
  endBtn: { borderRadius: 14, paddingVertical: 14, alignItems: "center", borderWidth: 1, borderColor: "#ef4444" },
  endBtnText: { color: "#ef4444", fontWeight: "700", fontSize: 15 },
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
  voteSubtitle: { color: "rgba(255,255,255,0.45)", fontSize: 13, padding: 16, paddingBottom: 8, lineHeight: 18 },
  tierLegend: { margin: 16, padding: 14, backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  scoreRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 12, padding: 12 },
  scoreInput: { width: 56, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", color: "#fff", textAlign: "center", fontSize: 16, fontWeight: "700", paddingVertical: 8 },
  publishBtn: { backgroundColor: LIME, borderRadius: 14, paddingVertical: 16, alignItems: "center" },
  publishBtnText: { color: "#0a0a0a", fontWeight: "800", fontSize: 16 },
});
