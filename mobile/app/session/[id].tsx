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
  tiered_pricing: boolean | null;
};

type Attendee = {
  user_id: string;
  status: string;
  profiles: {
    first_name: string | null;
    last_name: string | null;
    username: string | null;
    playing_position: string | null;
  } | null;
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

function playerInitials(a: Attendee): string {
  const first = a.profiles?.first_name?.trim()?.[0];
  const last = a.profiles?.last_name?.trim()?.[0];
  if (first && last) return (first + last).toUpperCase();
  if (first) return first.toUpperCase();
  const name = playerName(a);
  return name[0]?.toUpperCase() ?? "?";
}

const HOST_RATING_CATEGORIES: Array<{ key: string; label: string; hint: string }> = [
  { key: "field_secured", label: "Field secured", hint: "Was there a field ready when you arrived?" },
  { key: "organization", label: "Organization", hint: "Did the host run the session well?" },
  { key: "player_quality", label: "Player quality", hint: "Did the skill level match what was advertised?" },
  { key: "safety", label: "Safety", hint: "Were issues handled appropriately?" },
  { key: "would_play_again", label: "Would play again", hint: "Overall, would you join this host's session again?" },
];

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

  // Host rating modal (attendee → host after completed)
  const [hostRatingOpen, setHostRatingOpen] = useState(false);
  const [hostRatingScores, setHostRatingScores] = useState<Record<string, number>>({});
  const [hostRatingBusy, setHostRatingBusy] = useState(false);
  const [hasRatedHost, setHasRatedHost] = useState(false);
  const [teamsOpen, setTeamsOpen] = useState(false);
  const [teamAssignments, setTeamAssignments] = useState<Record<string, "A" | "B">>({});
  const [teamsBusy, setTeamsBusy] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const [winningTeam, setWinningTeam] = useState<"A" | "B" | null>(null);
  const [potd, setPotd] = useState<string | null>(null);
  const [defenderPotd, setDefenderPotd] = useState<string | null>(null);
  const [midfielderPotd, setMidfielderPotd] = useState<string | null>(null);
  const [attackerPotd, setAttackerPotd] = useState<string | null>(null);
  const [goaliePotd, setGoaliePotd] = useState<string | null>(null);
  const [resultBusy, setResultBusy] = useState(false);

  const myUserId = session?.user?.id;
  const isHost = run?.created_by === myUserId;
  const isCompleted = run?.status === "completed";

  const load = useCallback(async () => {
    if (!supabase || !id) return;
    setLoading(true);
    try {
      // Promote planning → active once kickoff has passed (best-effort).
      try {
        const origin = siteOrigin();
        const token = session?.access_token;
        if (origin && token) {
          await fetch(`${origin}/api/sessions/activate-if-started`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ run_id: id }),
          });
        }
      } catch {
        /* ignore */
      }

      const { data: runData } = await supabase
        .from("pickup_runs")
        .select("id,title,location_text,latitude,longitude,start_at,capacity,spots_taken,fee_cents,level,open_tier_rank,run_type,format,status,created_by,service_region,tier_session_id,tiered_pricing")
        .eq("id", id)
        .maybeSingle();
      if (runData) setRun(runData as SessionDetail);

      // RSVP rows don't FK to profiles (user_id → auth.users), so join embedded
      // profiles silently returns null. Fetch RSVPs + profiles separately and merge.
      const { data: rsvpData } = await supabase
        .from("pickup_run_rsvps")
        .select("user_id,status")
        .eq("run_id", id)
        .in("status", ["confirmed", "pending_payment"]);

      const rsvps = (rsvpData ?? []) as Array<{ user_id: string; status: string }>;
      const userIds = Array.from(new Set(rsvps.map((r) => r.user_id).filter(Boolean)));

      const profileById = new Map<string, Attendee["profiles"]>();
      if (userIds.length > 0) {
        const { data: profileRows } = await supabase
          .from("profiles")
          .select("id,first_name,last_name,username,playing_position")
          .in("id", userIds);
        for (const p of (profileRows ?? []) as Array<{
          id: string;
          first_name: string | null;
          last_name: string | null;
          username: string | null;
          playing_position: string | null;
        }>) {
          profileById.set(p.id, {
            first_name: p.first_name,
            last_name: p.last_name,
            username: p.username,
            playing_position: p.playing_position,
          });
        }
      }

      setAttendees(
        rsvps.map((r) => ({
          user_id: r.user_id,
          status: r.status,
          profiles: profileById.get(r.user_id) ?? null,
        })),
      );

      if (myUserId) {
        const { data: myRsvp } = await supabase
          .from("pickup_run_rsvps")
          .select("status")
          .eq("run_id", id)
          .eq("user_id", myUserId)
          .maybeSingle();
        setMyStatus(myRsvp?.status ?? null);

        // Check if already voted (tier_session may be created lazily on first vote)
        if (runData?.tier_session_id) {
          const { data: myVote } = await supabase
            .from("peer_votes")
            .select("voter_id")
            .eq("session_id", runData.tier_session_id)
            .eq("voter_id", myUserId)
            .limit(1);
          setHasVoted((myVote?.length ?? 0) > 0);
        } else {
          setHasVoted(false);
        }

        const { data: myHostRating } = await supabase
          .from("host_ratings")
          .select("id")
          .eq("run_id", id)
          .eq("rater_id", myUserId)
          .maybeSingle();
        setHasRatedHost(Boolean(myHostRating?.id));
      } else {
        setHasRatedHost(false);
      }
    } finally {
      setLoading(false);
    }
  }, [supabase, id, myUserId, session?.access_token]);

  useEffect(() => { void load(); }, [load]);

  async function endSession() {
    if (endBusy) return;
    Alert.alert(
      "End session",
      "Score players so their ratings update, or end without recording host ratings.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Score players",
          onPress: () => {
            void (async () => {
              setEndBusy(true);
              try {
                const tid = await finalizeRunForRating();
                if (!tid) return;
                setScoreOpen(true);
              } finally {
                setEndBusy(false);
              }
            })();
          },
        },
        {
          text: "End without ratings",
          style: "destructive",
          onPress: () => {
            Alert.alert(
              "End without ratings?",
              "No host ratings will be recorded for this session. Peer votes may still count if players submitted them.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "End anyway",
                  style: "destructive",
                  onPress: () => {
                    void (async () => {
                      setEndBusy(true);
                      try {
                        await finalizeRunForRating({ skipScoreModal: true });
                      } finally {
                        setEndBusy(false);
                      }
                    })();
                  },
                },
              ],
            );
          },
        },
      ],
    );
  }

  /** Mark run completed + ensure tier_session (host-allowed end route, with admin end-run fallback). */
  async function finalizeRunForRating(opts?: { skipScoreModal?: boolean }): Promise<string | null> {
    const origin = siteOrigin();
    const token = session?.access_token;
    if (!origin || !token || !id) {
      Alert.alert("Error", "Not signed in.");
      return null;
    }

    // Prefer host-allowed end route; fall back to admin end-run if available.
    let tierSessionId: string | null = run?.tier_session_id ?? null;
    console.log("[endSession] starting finalize", { run_id: id, tier_session_id: tierSessionId });

    const r = await fetch(`${origin}/api/sessions/end`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ run_id: id }),
    });
    const j = await r.json().catch(() => null) as {
      ok?: boolean;
      error?: string;
      tier_session_id?: string;
    } | null;
    console.log("[endSession] /api/sessions/end response", { status: r.status, body: j });

    if (r.ok && j?.ok && j.tier_session_id) {
      tierSessionId = j.tier_session_id;
    } else if (!tierSessionId) {
      const adminR = await fetch(`${origin}/api/admin/pickup/end-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ run_id: id }),
      });
      const adminJ = await adminR.json().catch(() => null) as {
        ok?: boolean;
        error?: string;
        tier_session_id?: string;
      } | null;
      console.log("[endSession] /api/admin/pickup/end-run response", {
        status: adminR.status,
        body: adminJ,
      });
      if (!adminR.ok || !adminJ?.ok) {
        Alert.alert("Error", j?.error ?? adminJ?.error ?? "Could not end session.");
        return null;
      }
      tierSessionId = adminJ.tier_session_id ?? null;
    }

    if (!tierSessionId) {
      Alert.alert("Error", "Session ended but rating setup failed.");
      return null;
    }

    setRun((cur) =>
      cur ? { ...cur, tier_session_id: tierSessionId, status: "completed" } : cur,
    );
    await load();
    if (!opts?.skipScoreModal) {
      // caller opens score modal
    } else {
      Alert.alert("Session ended", "No host ratings were recorded.");
    }
    return tierSessionId;
  }

  async function leaveSession() {
    if (rsvpBusy || !session?.access_token) return;
    const isPaid = (run?.fee_cents ?? 0) > 0;
    const alertBody = isPaid
      ? "Leaving more than 24 hours before kickoff earns a platform credit. Within 24 hours: no refund."
      : "Are you sure you want to leave this session?";
    Alert.alert("Leave session?", alertBody, [
      { text: "Stay", style: "cancel" },
      {
        text: "Leave", style: "destructive", onPress: async () => {
          const origin = siteOrigin();
          if (!origin) return;
          setRsvpBusy(true);
          try {
            const r = await fetch(`${origin}/api/sessions/leave`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${session!.access_token}` },
              body: JSON.stringify({ run_id: id }),
            });
            const j = await r.json().catch(() => null) as { ok?: boolean; credit_issued?: boolean; amount_cents?: number } | null;
            if (j?.ok) {
              await load();
              if (j.credit_issued && j.amount_cents) {
                const dollars = (j.amount_cents / 100).toFixed(2);
                Alert.alert("Left session", `A platform credit of $${dollars} has been added to your account.`);
              } else if (isPaid) {
                Alert.alert("Left session", "No refund applies within 24 hours of kickoff.");
              }
            }
          } finally {
            setRsvpBusy(false);
          }
        }
      }
    ]);
  }

  async function cancelSession() {
    if (endBusy || !session?.access_token) return;
    Alert.alert(
      "Cancel session?",
      "All players will be notified and refunded if they paid. This cannot be undone.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Cancel session", style: "destructive", onPress: async () => {
            const origin = siteOrigin();
            if (!origin) return;
            setEndBusy(true);
            try {
              const r = await fetch(`${origin}/api/sessions/cancel`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${session!.access_token}` },
                body: JSON.stringify({ run_id: id }),
              });
              const j = await r.json().catch(() => null) as { ok?: boolean; error?: string } | null;
              if (!r.ok || !j?.ok) { Alert.alert("Error", j?.error ?? "Could not cancel."); return; }
              Alert.alert("Session cancelled", "All players have been notified.");
              await load();
            } finally {
              setEndBusy(false);
            }
          }
        }
      ]
    );
  }

  async function submitTeams() {
    if (teamsBusy || !session?.access_token) return;
    const origin = siteOrigin();
    if (!origin) return;
    setTeamsBusy(true);
    try {
      const assignments = Object.entries(teamAssignments).map(([user_id, team]) => ({ user_id, team }));
      if (assignments.length === 0) { Alert.alert("Assign teams first."); return; }
      const r = await fetch(`${origin}/api/sessions/assign-teams`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ run_id: id, assignments }),
      });
      const j = await r.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!r.ok || !j?.ok) { Alert.alert("Error", j?.error ?? "Failed to save teams."); return; }
      setTeamsOpen(false);
      Alert.alert("Teams saved!", "Now record the result when the game ends.");
    } finally {
      setTeamsBusy(false);
    }
  }

  async function submitResult() {
    if (resultBusy || !session?.access_token || !winningTeam) return;
    const origin = siteOrigin();
    if (!origin) return;
    setResultBusy(true);
    try {
      const r = await fetch(`${origin}/api/sessions/result`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          run_id: id,
          winning_team: winningTeam,
          player_of_the_day: potd,
          defender_of_the_day: defenderPotd,
          midfielder_of_the_day: midfielderPotd,
          attacker_of_the_day: attackerPotd,
          goalie_of_the_day: goaliePotd,
        }),
      });
      const j = await r.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!r.ok || !j?.ok) { Alert.alert("Error", j?.error ?? "Failed to save result."); return; }
      setResultOpen(false);
      Alert.alert("Result recorded!", "Win/loss stats and awards have been updated.");
      await load();
    } finally {
      setResultBusy(false);
    }
  }

  async function submitVotes() {
    if (votePicks.length !== 3 || voteBusy || !run) return;
    if (!session?.access_token) return;
    const origin = siteOrigin();
    if (!origin) {
      Alert.alert("Error", "App is missing site URL configuration.");
      return;
    }
    setVoteBusy(true);
    try {
      const r = await fetch(`${origin}/api/sessions/peer-vote`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ run_id: run.id, picks: votePicks }),
      });
      const j = await r.json().catch(() => null) as {
        ok?: boolean;
        error?: string;
        tier_session_id?: string;
        already_voted?: boolean;
      } | null;
      if (!r.ok || !j?.ok) {
        Alert.alert("Error", j?.error ?? "Could not submit votes.");
        return;
      }
      if (j.tier_session_id) {
        setRun((cur) => (cur ? { ...cur, tier_session_id: j.tier_session_id! } : cur));
      }
      setHasVoted(true);
      setVoteOpen(false);
      Alert.alert(
        j.already_voted ? "Already voted" : "Votes submitted!",
        j.already_voted ? "Your picks were already recorded." : "Thanks for rating your teammates.",
      );
    } finally {
      setVoteBusy(false);
    }
  }

  async function submitHostRating() {
    if (hostRatingBusy || !run) return;
    if (!session?.access_token) return;
    const origin = siteOrigin();
    if (!origin) {
      Alert.alert("Error", "App is missing site URL configuration.");
      return;
    }
    for (const c of HOST_RATING_CATEGORIES) {
      const v = hostRatingScores[c.key];
      if (v == null || v < 1 || v > 5) {
        Alert.alert("Rate all categories", "Please give 1–5 stars for each category.");
        return;
      }
    }
    setHostRatingBusy(true);
    try {
      const r = await fetch(`${origin}/api/sessions/rate-host`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          run_id: run.id,
          field_secured: hostRatingScores.field_secured,
          organization: hostRatingScores.organization,
          player_quality: hostRatingScores.player_quality,
          safety: hostRatingScores.safety,
          would_play_again: hostRatingScores.would_play_again,
        }),
      });
      const j = (await r.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        overall?: number | null;
      } | null;
      if (!r.ok || !j?.ok) {
        Alert.alert("Error", j?.error ?? "Could not submit host rating.");
        return;
      }
      setHasRatedHost(true);
      setHostRatingOpen(false);
      setHostRatingScores({});
      Alert.alert("Thanks for rating!", "Your host rating was submitted.");
    } finally {
      setHostRatingBusy(false);
    }
  }

  async function ensureTierSessionId(): Promise<string | null> {
    if (run?.tier_session_id) {
      console.log("[ensureTierSessionId] using existing", run.tier_session_id);
      return run.tier_session_id;
    }
    const origin = siteOrigin();
    const token = session?.access_token;
    if (!origin || !token || !run) return null;

    // Prefer admin end-run (creates tier_session + attendance) when host has admin; else ensure route.
    console.log("[ensureTierSessionId] tier_session_id null — calling end-run / ensure");
    const adminR = await fetch(`${origin}/api/admin/pickup/end-run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ run_id: run.id }),
    });
    const adminJ = await adminR.json().catch(() => null) as {
      ok?: boolean;
      error?: string;
      tier_session_id?: string;
    } | null;
    console.log("[ensureTierSessionId] end-run response", { status: adminR.status, body: adminJ });

    if (adminR.ok && adminJ?.ok && adminJ.tier_session_id) {
      setRun((cur) =>
        cur
          ? { ...cur, tier_session_id: adminJ.tier_session_id!, status: "completed" }
          : cur,
      );
      return adminJ.tier_session_id;
    }

    const r = await fetch(`${origin}/api/sessions/ensure-tier-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ run_id: run.id }),
    });
    const j = await r.json().catch(() => null) as {
      ok?: boolean;
      tier_session_id?: string;
      error?: string;
    } | null;
    console.log("[ensureTierSessionId] ensure-tier-session response", { status: r.status, body: j });
    if (!r.ok || !j?.ok || !j.tier_session_id) {
      Alert.alert("Error", j?.error ?? adminJ?.error ?? "Could not open rating.");
      return null;
    }
    setRun((cur) => (cur ? { ...cur, tier_session_id: j.tier_session_id! } : cur));
    return j.tier_session_id;
  }

  async function openHostScore() {
    const tid = await ensureTierSessionId();
    if (!tid) return;
    setScoreOpen(true);
  }

  async function submitScores() {
    if (scoreBusy || !run) return;
    const origin = siteOrigin();
    const token = session?.access_token;
    if (!origin || !token) {
      Alert.alert("Error", "Not signed in.");
      return;
    }

    const scoredCount = Object.values(scores).filter(Boolean).length;
    if (scoredCount === 0) {
      Alert.alert("Score players", "Pick a tier for at least one player before submitting.");
      return;
    }

    setScoreBusy(true);
    try {
      let tierSessionId = run.tier_session_id;
      console.log("[submitScores] initial tier_session_id", tierSessionId);

      // If missing, create via admin end-run (creates tier_session + attendance rows).
      if (!tierSessionId) {
        const adminR = await fetch(`${origin}/api/admin/pickup/end-run`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ run_id: run.id }),
        });
        const adminJ = await adminR.json().catch(() => null) as {
          ok?: boolean;
          error?: string;
          tier_session_id?: string;
        } | null;
        console.log("[submitScores] end-run response", { status: adminR.status, body: adminJ });

        if (adminR.ok && adminJ?.ok && adminJ.tier_session_id) {
          tierSessionId = adminJ.tier_session_id;
        } else {
          // Non-admin hosts: ensure-tier-session still creates the rating session.
          const ensured = await ensureTierSessionId();
          tierSessionId = ensured;
        }
      }

      console.log("[submitScores] using tier_session_id", tierSessionId);
      if (!tierSessionId) {
        Alert.alert("Error", "Could not create a rating session.");
        return;
      }

      setRun((cur) => (cur ? { ...cur, tier_session_id: tierSessionId! } : cur));

      // Persist scores via admin API — session_attendance has no client UPDATE RLS policy.
      const r = await fetch(`${origin}/api/sessions/host-scores`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          run_id: run.id,
          tier_session_id: tierSessionId,
          scores,
        }),
      });
      const j = await r.json().catch(() => null) as {
        ok?: boolean;
        error?: string;
        tier_session_id?: string;
        settled?: boolean;
        settle_error?: string;
        updateResults?: unknown;
      } | null;
      console.log("[submitScores] host-scores response", { status: r.status, body: j });

      if (!r.ok || !j?.ok) {
        Alert.alert("Error", j?.error ?? "Could not save scores.");
        return;
      }

      if (j.tier_session_id) {
        setRun((cur) => (cur ? { ...cur, tier_session_id: j.tier_session_id! } : cur));
      }

      if (j.settled) {
        Alert.alert("Done!", "Player ratings have been updated.");
      } else {
        Alert.alert(
          "Scores saved",
          j.settle_error
            ? `Ratings saved, but settle failed: ${j.settle_error}`
            : "Ratings will be processed shortly.",
        );
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
    const origin = siteOrigin();
    const token = session?.access_token;
    if (!origin || !token) {
      Alert.alert("Error", "Not signed in.");
      return;
    }
    try {
      const r = await fetch(`${origin}/api/sessions/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ run_id: id, invitee_id: player.id }),
      });
      const j = await r.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!r.ok || !j?.ok) {
        Alert.alert("Invite failed", j?.error ?? "Could not invite that player.");
        return;
      }
      setInvitedIds((prev) => new Set([...prev, player.id]));
      const left = run ? Math.max(0, run.capacity - run.spots_taken) : 0;
      await Share.share({
        message: `Join ${run?.title ?? "a CT Pickup session"} on ${fmtDate(run?.start_at ?? "")} at ${fmt12Hour(run?.start_at ?? "")} — ${left} spot${left === 1 ? "" : "s"} left. Download CT Pickup: https://apps.apple.com/app/id6766061001`,
        url: `ctpickup://session/${id}`,
      });
    } catch {
      Alert.alert("Invite failed", "Could not invite that player.");
    }
  }

  async function shareSession() {
    try {
      const left = run ? Math.max(0, run.capacity - run.spots_taken) : 0;
      await Share.share({
        message: `Join ${run?.title ?? "a CT Pickup session"} on ${fmtDate(run?.start_at ?? "")} at ${fmt12Hour(run?.start_at ?? "")} — ${left} spot${left === 1 ? "" : "s"} left. Download CT Pickup: https://apps.apple.com/app/id6766061001`,
        url: `ctpickup://session/${id}`,
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
        body: JSON.stringify({ run_id: id, action: "join", checkout_return: "mobile" }),
      });
      const j = await r.json().catch(() => null) as { ok?: boolean; error?: string; checkout_url?: string; status?: string } | null;
      if (!r.ok || !j?.ok) { Alert.alert("Error", j?.error ?? "Could not RSVP."); return; }

      // If checkout URL returned, open Stripe payment
      if (j?.checkout_url) {
        const { Linking } = await import("react-native");
        await Linking.openURL(j.checkout_url);
      }

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
  const sessionStarted = (() => {
    const t = new Date(run.start_at).getTime();
    return Number.isFinite(t) && t < Date.now();
  })();
  // Peer voting after kickoff (or once completed) — does not require tier_session_id upfront.
  const canVote = isJoined && !isHost && !hasVoted && (isCompleted || sessionStarted);
  const voteBtnLabel = isCompleted ? "Rate your teammates" : "Rate session";
  const canHostScore = isHost && (isCompleted || sessionStarted);
  const hostScoreLabel = isCompleted ? "Score players" : "Rate session";

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

        {isJoined && !isHost && !isCompleted && (
          <Pressable onPress={() => void leaveSession()} disabled={rsvpBusy}
            style={[s.endBtn, { marginBottom: 12 }, rsvpBusy && { opacity: 0.5 }]}>
            <Text style={s.endBtnText}>Leave session</Text>
          </Pressable>
        )}

        {canVote && (
          <Pressable onPress={() => setVoteOpen(true)} style={s.voteBtn}>
            <FontAwesome name="star" size={14} color="#0a0a0a" />
            <Text style={s.voteBtnText}>{voteBtnLabel}</Text>
          </Pressable>
        )}

        {isCompleted && isJoined && !isHost && !hasRatedHost && (
          <Pressable
            onPress={() => {
              setHostRatingScores({});
              setHostRatingOpen(true);
            }}
            style={s.voteBtn}
          >
            <FontAwesome name="star" size={14} color="#0a0a0a" />
            <Text style={s.voteBtnText}>Rate the host</Text>
          </Pressable>
        )}

        {isCompleted && isJoined && !isHost && hasRatedHost && (
          <View style={[s.rsvpBtn, s.rsvpBtnDisabled, { marginBottom: 12 }]}>
            <Text style={s.rsvpBtnText}>✓ Host rated</Text>
          </View>
        )}

        {(isCompleted || sessionStarted) && isJoined && !isHost && hasVoted && (
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
            <Pressable onPress={() => setTeamsOpen(true)} style={s.shareBtn}>
              <FontAwesome name="users" size={14} color={LIME} />
              <Text style={s.shareBtnText}>Assign teams</Text>
            </Pressable>
            <Pressable onPress={() => setResultOpen(true)} style={s.shareBtn}>
              <FontAwesome name="trophy" size={14} color={LIME} />
              <Text style={s.shareBtnText}>Record result</Text>
            </Pressable>
            <Pressable onPress={() => void cancelSession()} disabled={endBusy}
              style={[s.endBtn, { borderColor: "rgba(239,68,68,0.5)" }, endBusy && { opacity: 0.5 }]}>
              <Text style={[s.endBtnText, { color: "rgba(239,68,68,0.6)" }]}>Cancel session</Text>
            </Pressable>
            <Pressable onPress={() => void endSession()} disabled={endBusy}
              style={[s.endBtn, endBusy && { opacity: 0.5 }]}>
              {endBusy ? <ActivityIndicator color="#ef4444" /> :
                <Text style={s.endBtnText}>End session</Text>}
            </Pressable>
          </View>
        )}

        {canHostScore && (
          <Pressable onPress={() => void openHostScore()} style={[s.voteBtn, { marginTop: isHost && !isCompleted ? 10 : 0 }]}>
            <FontAwesome name="star" size={14} color="#0a0a0a" />
            <Text style={s.voteBtnText}>{hostScoreLabel}</Text>
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
                    <View style={s.avatar}><Text style={s.avatarText}>{playerInitials(a)}</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.attendeeName}>{name}</Text>
                      {a.profiles?.username ? (
                        <Text style={s.playerUsername}>@{a.profiles.username}</Text>
                      ) : null}
                      {a.profiles?.playing_position ? (
                        <Text style={s.playerPos}>{a.profiles.playing_position}</Text>
                      ) : null}
                    </View>
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
            <Text style={s.modalTitle}>{isCompleted ? "Rate your teammates" : "Rate session"}</Text>
            <Pressable onPress={() => setVoteOpen(false)} hitSlop={10}>
              <FontAwesome name="times" size={18} color="rgba(255,255,255,0.6)" />
            </Pressable>
          </View>
          <Text style={s.voteSubtitle}>Pick the 3 best players on the pitch. Nobody sees your picks.</Text>
          <FlatList
            data={attendees.filter((a) => a.user_id !== myUserId && a.user_id !== run.created_by)}
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
                    <Text style={[s.avatarText, picked && { color: "#0a0a0a" }]}>{picked ? rank + 1 : playerInitials(item)}</Text>
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
                  <View style={s.avatar}><Text style={s.avatarText}>{playerInitials(a)}</Text></View>
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

      {/* Team Assignment Modal */}
      <Modal visible={teamsOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setTeamsOpen(false)}>
        <ScrollView style={s.modalRoot}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Assign teams</Text>
            <Pressable onPress={() => setTeamsOpen(false)} hitSlop={10}>
              <FontAwesome name="times" size={18} color="rgba(255,255,255,0.6)" />
            </Pressable>
          </View>
          <Text style={s.voteSubtitle}>Tap a player to toggle between Team A and Team B.</Text>
          <View style={s.assignGrid}>
            {attendees.map((a) => {
              const name = playerName(a);
              const team = teamAssignments[a.user_id];
              return (
                <Pressable
                  key={a.user_id}
                  onPress={() => setTeamAssignments((prev) => ({
                    ...prev,
                    [a.user_id]: prev[a.user_id] === "A" ? "B" : "A",
                  }))}
                  style={[
                    s.assignCard,
                    team === "A" && s.assignCardA,
                    team === "B" && s.assignCardB,
                  ]}
                >
                  <View style={[
                    s.assignAvatar,
                    team === "A" && { backgroundColor: "rgba(59,130,246,0.25)" },
                    team === "B" && { backgroundColor: "rgba(239,68,68,0.25)" },
                  ]}>
                    <Text style={[
                      s.assignAvatarText,
                      team === "A" && { color: "#3B82F6" },
                      team === "B" && { color: "#ef4444" },
                    ]}>
                      {playerInitials(a)}
                    </Text>
                  </View>
                  <Text style={s.assignName} numberOfLines={2}>{name}</Text>
                  {a.profiles?.username ? (
                    <Text style={s.assignUsername} numberOfLines={1}>@{a.profiles.username}</Text>
                  ) : null}
                  <View style={[
                    s.assignTeamBadge,
                    team === "A" && { backgroundColor: "#3B82F6" },
                    team === "B" && { backgroundColor: "#ef4444" },
                  ]}>
                    <Text style={s.assignTeamBadgeText}>{team ? `Team ${team}` : "Tap to assign"}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          <Pressable onPress={() => void submitTeams()} disabled={teamsBusy}
            style={[s.publishBtn, teamsBusy && { opacity: 0.5 }, { margin: 16 }]}>
            {teamsBusy ? <ActivityIndicator color="#0a0a0a" /> :
              <Text style={s.publishBtnText}>Save teams</Text>}
          </Pressable>
        </ScrollView>
      </Modal>

      {/* Result Modal */}
      <Modal visible={resultOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setResultOpen(false)}>
        <ScrollView style={s.modalRoot}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Record result</Text>
            <Pressable onPress={() => setResultOpen(false)} hitSlop={10}>
              <FontAwesome name="times" size={18} color="rgba(255,255,255,0.6)" />
            </Pressable>
          </View>

          <View style={{ marginHorizontal: 16, marginTop: 12, marginBottom: 4, backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 10, padding: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" }}>
            <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, lineHeight: 18 }}>You cannot receive awards for sessions you host.</Text>
          </View>

          <Text style={s.voteSubtitle}>Who won?</Text>
          <View style={{ flexDirection: "row", gap: 10, padding: 16, paddingTop: 8 }}>
            <Pressable onPress={() => setWinningTeam("A")}
              style={{ flex: 1, paddingVertical: 16, borderRadius: 12, borderWidth: 2, borderColor: winningTeam === "A" ? "#3B82F6" : "rgba(255,255,255,0.15)", backgroundColor: winningTeam === "A" ? "rgba(59,130,246,0.15)" : "transparent", alignItems: "center" }}>
              <Text style={{ color: winningTeam === "A" ? "#3B82F6" : "rgba(255,255,255,0.5)", fontWeight: "800", fontSize: 18 }}>Team A</Text>
            </Pressable>
            <Pressable onPress={() => setWinningTeam("B")}
              style={{ flex: 1, paddingVertical: 16, borderRadius: 12, borderWidth: 2, borderColor: winningTeam === "B" ? "#ef4444" : "rgba(255,255,255,0.15)", backgroundColor: winningTeam === "B" ? "rgba(239,68,68,0.15)" : "transparent", alignItems: "center" }}>
              <Text style={{ color: winningTeam === "B" ? "#ef4444" : "rgba(255,255,255,0.5)", fontWeight: "800", fontSize: 18 }}>Team B</Text>
            </Pressable>
          </View>

          {[
            { label: "Player of the Day", state: potd, set: setPotd },
            { label: "Defender of the Day", state: defenderPotd, set: setDefenderPotd },
            { label: "Midfielder of the Day", state: midfielderPotd, set: setMidfielderPotd },
            { label: "Attacker of the Day", state: attackerPotd, set: setAttackerPotd },
            { label: "Goalie of the Day", state: goaliePotd, set: setGoaliePotd },
          ].map(({ label, state, set }) => (
            <View key={label} style={{ paddingHorizontal: 16, marginBottom: 16 }}>
              <Text style={s.voteSubtitle}>{label}</Text>
              <View style={s.assignGrid}>
                {attendees.filter((a) => a.user_id !== run.created_by).map((a) => {
                  const name = playerName(a);
                  const selected = state === a.user_id;
                  return (
                    <Pressable
                      key={a.user_id}
                      onPress={() => set(selected ? null : a.user_id)}
                      style={[s.assignCard, selected && s.assignCardSelected]}
                    >
                      <View style={[s.assignAvatar, selected && { backgroundColor: "rgba(163,230,53,0.25)" }]}>
                        <Text style={[s.assignAvatarText, selected && { color: LIME }]}>
                          {playerInitials(a)}
                        </Text>
                      </View>
                      <Text style={[s.assignName, selected && { color: LIME }]} numberOfLines={2}>
                        {name}
                      </Text>
                      {a.profiles?.username ? (
                        <Text style={s.assignUsername} numberOfLines={1}>@{a.profiles.username}</Text>
                      ) : null}
                      {selected ? (
                        <FontAwesome name="star" size={14} color={LIME} style={{ marginTop: 4 }} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}

          <Pressable onPress={() => void submitResult()} disabled={resultBusy || !winningTeam}
            style={[s.publishBtn, (resultBusy || !winningTeam) && { opacity: 0.4 }, { margin: 16 }]}>
            {resultBusy ? <ActivityIndicator color="#0a0a0a" /> :
              <Text style={s.publishBtnText}>Save result & awards</Text>}
          </Pressable>
        </ScrollView>
      </Modal>

      {/* Host Rating Modal */}
      <Modal
        visible={hostRatingOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setHostRatingOpen(false)}
      >
        <ScrollView style={s.modalRoot} keyboardShouldPersistTaps="handled">
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>
              Rate{" "}
              {(() => {
                const host = attendees.find((a) => a.user_id === run?.created_by);
                return host ? playerName(host) : "the host";
              })()}{" "}
              as a host
            </Text>
            <Pressable onPress={() => setHostRatingOpen(false)} hitSlop={10}>
              <FontAwesome name="times" size={18} color="rgba(255,255,255,0.6)" />
            </Pressable>
          </View>

          <View style={{ padding: 16, gap: 20 }}>
            {HOST_RATING_CATEGORIES.map((cat) => {
              const selected = hostRatingScores[cat.key] ?? 0;
              return (
                <View key={cat.key} style={s.hostRatingCat}>
                  <Text style={s.hostRatingLabel}>{cat.label}</Text>
                  <Text style={s.hostRatingHint}>{cat.hint}</Text>
                  <View style={s.hostRatingStars}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Pressable
                        key={n}
                        onPress={() =>
                          setHostRatingScores((prev) => ({ ...prev, [cat.key]: n }))
                        }
                        hitSlop={6}
                        style={{ padding: 4 }}
                      >
                        <FontAwesome
                          name={n <= selected ? "star" : "star-o"}
                          size={28}
                          color={n <= selected ? LIME : "rgba(255,255,255,0.35)"}
                        />
                      </Pressable>
                    ))}
                  </View>
                </View>
              );
            })}
          </View>

          <Pressable
            onPress={() => void submitHostRating()}
            disabled={
              hostRatingBusy ||
              HOST_RATING_CATEGORIES.some((c) => !hostRatingScores[c.key])
            }
            style={[
              s.publishBtn,
              (hostRatingBusy ||
                HOST_RATING_CATEGORIES.some((c) => !hostRatingScores[c.key])) && {
                opacity: 0.4,
              },
              { margin: 16 },
            ]}
          >
            {hostRatingBusy ? (
              <ActivityIndicator color="#0a0a0a" />
            ) : (
              <Text style={s.publishBtnText}>Submit rating</Text>
            )}
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
  hostRatingCat: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    padding: 14,
    gap: 6,
  },
  hostRatingLabel: { color: "#fff", fontSize: 16, fontWeight: "700" },
  hostRatingHint: { color: "rgba(255,255,255,0.45)", fontSize: 13, marginBottom: 4 },
  hostRatingStars: { flexDirection: "row", alignItems: "center", gap: 4 },
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
  assignGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  assignCard: {
    width: "47%",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    gap: 6,
  },
  assignCardA: { borderColor: "#3B82F6", backgroundColor: "rgba(59,130,246,0.08)" },
  assignCardB: { borderColor: "#ef4444", backgroundColor: "rgba(239,68,68,0.08)" },
  assignCardSelected: { borderColor: LIME, backgroundColor: "rgba(163,230,53,0.08)" },
  assignAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(163,230,53,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  assignAvatarText: { color: LIME, fontWeight: "800", fontSize: 16 },
  assignName: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 17,
    minHeight: 34,
  },
  assignUsername: { color: "rgba(255,255,255,0.4)", fontSize: 11, textAlign: "center" },
  assignTeamBadge: {
    marginTop: 2,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  assignTeamBadgeText: { color: "#fff", fontWeight: "800", fontSize: 11 },
});
