import { useAuth } from "@/context/AuthContext";
import { useProfileAdmin } from "@/context/ProfileAdminContext";
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

import { PhotoHeader, PhotoUploadField, useFieldPhotos } from "@/components/photo";
import { setRunFieldPhoto } from "@/lib/photoUpload";
import { headline, themeColor } from "@/theme";
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
  { key: "would_play_again", label: "Would play again", hint: "Would you join this host's session again?" },
];

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session, supabase } = useAuth();
  const { isAdmin } = useProfileAdmin();
  const fieldPhotos = useFieldPhotos(id ? [id] : []);
  const [savedPhoto, setSavedPhoto] = useState<string | null | undefined>(undefined);
  const heroPhoto = savedPhoto !== undefined ? savedPhoto ?? undefined : id ? fieldPhotos[id] : undefined;

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
  const [voteStep, setVoteStep] = useState<1 | 2>(1);
  const [potdNominee, setPotdNominee] = useState<string | null>(null);
  const [hasPotdVoted, setHasPotdVoted] = useState(false);
  const [potdSummary, setPotdSummary] = useState<{
    winnerId: string | null;
    winnerName: string;
    voteCount: number;
    totalVotes: number;
  } | null>(null);

  // Organizer score modal
  const [scoreOpen, setScoreOpen] = useState(false);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [scoreBusy, setScoreBusy] = useState(false);

  // Host rating modal (attendee → host after kickoff)
  const [hostRatingOpen, setHostRatingOpen] = useState(false);
  const [hostScores, setHostScores] = useState<Record<string, number>>({});
  const [hostRatingBusy, setHostRatingBusy] = useState(false);
  const [hasRatedHost, setHasRatedHost] = useState(false);
  const [teamsOpen, setTeamsOpen] = useState(false);
  const [teamAssignments, setTeamAssignments] = useState<Record<string, "A" | "B">>({});
  const [teamsBusy, setTeamsBusy] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const [winningTeam, setWinningTeam] = useState<"A" | "B" | null>(null);
  const [defenderPotd, setDefenderPotd] = useState<string | null>(null);
  const [midfielderPotd, setMidfielderPotd] = useState<string | null>(null);
  const [attackerPotd, setAttackerPotd] = useState<string | null>(null);
  const [goaliePotd, setGoaliePotd] = useState<string | null>(null);
  const [resultBusy, setResultBusy] = useState(false);

  const myUserId = session?.user?.id;
  const isHost = run?.created_by === myUserId;
  const isCompleted = run?.status === "completed";
  const canEditPhoto = Boolean(myUserId) && (isHost || isAdmin);

  const saveFieldPhoto = useCallback(
    async (url: string | null) => {
      if (!supabase || !id) throw new Error("Please sign in again to change the photo.");
      await setRunFieldPhoto(supabase, id, url);
      setSavedPhoto(url);
    },
    [supabase, id],
  );

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

      let resolved = runData as SessionDetail | null;
      if (
        resolved?.status === "planning" &&
        resolved.start_at &&
        new Date(resolved.start_at).getTime() < Date.now()
      ) {
        const { data: updated } = await supabase
          .from("pickup_runs")
          .update({ status: "active" })
          .eq("id", id)
          .eq("status", "planning")
          .select(
            "id,title,location_text,latitude,longitude,start_at,capacity,spots_taken,fee_cents,level,open_tier_rank,run_type,format,status,created_by,service_region,tier_session_id,tiered_pricing",
          )
          .maybeSingle();
        if (updated) resolved = updated as SessionDetail;
        else resolved = { ...resolved, status: "active" };
      }
      if (resolved) setRun(resolved);

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

        const { data: myPotd, error: myPotdErr } = await supabase
          .from("potd_votes")
          .select("nominee_id")
          .eq("run_id", id)
          .eq("voter_id", myUserId)
          .maybeSingle();
        if (myPotdErr) {
          console.warn("[session] potd_votes read:", myPotdErr.message);
          setHasPotdVoted(false);
        } else {
          setHasPotdVoted(Boolean(myPotd?.nominee_id));
          if (myPotd?.nominee_id) setPotdNominee(String(myPotd.nominee_id));
        }

        // POTD tally for completed sessions (public read policy).
        if (resolved?.status === "completed") {
          const { data: potdRows, error: potdErr } = await supabase
            .from("potd_votes")
            .select("nominee_id")
            .eq("run_id", id);
          if (potdErr) {
            console.warn("[session] potd tally:", potdErr.message);
            setPotdSummary(null);
          } else {
          const counts = new Map<string, number>();
          for (const row of potdRows ?? []) {
            const nid = typeof row.nominee_id === "string" ? row.nominee_id : "";
            if (!nid) continue;
            counts.set(nid, (counts.get(nid) || 0) + 1);
          }
          let winnerId: string | null = null;
          let voteCount = 0;
          for (const [nid, n] of counts.entries()) {
            if (n > voteCount) {
              winnerId = nid;
              voteCount = n;
            }
          }
          const { data: resultRow } = await supabase
            .from("pickup_run_results")
            .select("player_of_day")
            .eq("run_id", id)
            .maybeSingle();
          if (typeof resultRow?.player_of_day === "string" && resultRow.player_of_day) {
            winnerId = resultRow.player_of_day;
            voteCount = counts.get(winnerId) ?? voteCount;
          }
          if (winnerId && voteCount > 0) {
            const winnerProfile = profileById.get(winnerId);
            const winnerName = winnerProfile
              ? [winnerProfile.first_name, winnerProfile.last_name].filter(Boolean).join(" ").trim() ||
                winnerProfile.username ||
                "Player"
              : "Player";
            setPotdSummary({
              winnerId,
              winnerName,
              voteCount,
              totalVotes: potdRows?.length ?? 0,
            });
          } else {
            setPotdSummary(null);
          }
          }
        } else {
          setPotdSummary(null);
        }

        const { data: existingRating } = await supabase
          .from("host_ratings")
          .select("id")
          .eq("run_id", id)
          .eq("rater_id", myUserId)
          .maybeSingle();
        setHasRatedHost(!!existingRating);

        // Lazily fire voting pushes (+30m) and auto-settle ratings (+2h).
        const joined =
          myRsvp?.status === "confirmed" || myRsvp?.status === "pending_payment";
        const host = resolved?.created_by === myUserId;
        const startMs = resolved?.start_at ? new Date(resolved.start_at).getTime() : NaN;
        const thirtyMinPassed =
          Number.isFinite(startMs) && Date.now() >= startMs + 30 * 60 * 1000;
        const twoHoursPassed =
          Number.isFinite(startMs) && Date.now() >= startMs + 2 * 60 * 60 * 1000;
        if ((joined || host) && (thirtyMinPassed || twoHoursPassed)) {
          const origin = siteOrigin();
          const token = session?.access_token;
          if (origin && token) {
            void fetch(`${origin}/api/sessions/check-voting`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ run_id: id }),
            }).catch(() => {});
          }
        }
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
      "This closes the session and updates player ratings. You can adjust scores next.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "End session",
          onPress: () => {
            void (async () => {
              setEndBusy(true);
              try {
                const tid = await finalizeRunForRating();
                if (!tid) return;
                // Prompt host to override default scores immediately.
                setScoreOpen(true);
              } finally {
                setEndBusy(false);
              }
            })();
          },
        },
      ],
    );
  }

  /** Mark run completed + ensure tier_session (host-allowed end route, with admin end-run fallback). */
  async function finalizeRunForRating(): Promise<string | null> {
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
            const j = await r.json().catch(() => null) as {
              ok?: boolean; error?: string; credit_issued?: boolean; amount_cents?: number;
              credit_restored?: boolean; already_credited?: boolean;
            } | null;
            if (!r.ok || !j?.ok) { Alert.alert("Could not leave", j?.error ?? "Something went wrong. Try again."); return; }
            await load();
            const lines: string[] = [];
            if (j.credit_issued && j.amount_cents) lines.push(`A platform credit of $${(j.amount_cents / 100).toFixed(2)} has been added to your account.`);
            if (j.credit_restored) lines.push("The credit you used to join has been restored.");
            if (j.already_credited) lines.push("A credit for this session was already issued to your account earlier.");
            if (lines.length > 0) Alert.alert("Left session", lines.join(" "));
            else if (isPaid) Alert.alert("Left session", "No refund applies within 24 hours of kickoff.");
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
      "All players will be notified. Card payments are refunded in full and credits used to join are restored. This cannot be undone.",
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
              const j = await r.json().catch(() => null) as {
                ok?: boolean; error?: string; refunded?: number; credits_restored?: number;
                failures?: { user_id: string | null; error: string }[];
              } | null;
              if (!r.ok || !j?.ok) {
                const failed = j?.failures?.length ?? 0;
                Alert.alert(failed > 0 ? "Refunds not finished" : "Error", j?.error ?? "Could not cancel.");
                await load();
                return;
              }
              const parts = ["All players have been notified."];
              if (j.refunded) parts.push(`${j.refunded} card refund${j.refunded === 1 ? "" : "s"} issued.`);
              if (j.credits_restored) parts.push(`${j.credits_restored} credit${j.credits_restored === 1 ? "" : "s"} restored.`);
              Alert.alert("Session cancelled", parts.join(" "));
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
      const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string; already_voted?: boolean } | null;
      if (!r.ok || !j?.ok) {
        Alert.alert("Error", j?.error ?? "Failed to submit votes.");
        return;
      }
      setHasVoted(true);
      setVoteStep(2);
    } finally {
      setVoteBusy(false);
    }
  }

  async function submitPotdVote() {
    if (!potdNominee || voteBusy || !run || !session?.access_token) return;
    const origin = siteOrigin();
    if (!origin) {
      Alert.alert("Error", "App is missing site URL configuration.");
      return;
    }
    setVoteBusy(true);
    try {
      const r = await fetch(`${origin}/api/sessions/potd-vote`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ run_id: run.id, nominee_id: potdNominee }),
      });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string; already_voted?: boolean } | null;
      if (!r.ok || !j?.ok) {
        Alert.alert("Error", j?.error ?? "Failed to submit Player of the Day vote.");
        return;
      }
      setHasPotdVoted(true);
      setVoteOpen(false);
      Alert.alert("Thanks!", "Your Player of the Day vote was recorded.");
      await load();
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
      const v = hostScores[c.key];
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
          field_secured: hostScores.field_secured,
          organization: hostScores.organization,
          player_quality: hostScores.player_quality,
          safety: hostScores.safety,
          would_play_again: hostScores.would_play_again,
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
      setHostScores({});
      Alert.alert("Thanks for rating the host!");
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
    return <View style={s.center}><ActivityIndicator color={themeColor().pitchText} size="large" /></View>;
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
  const needsPeerVote = !hasVoted;
  const needsPotdVote = !hasPotdVoted;
  const canVote = isJoined && !isHost && (isCompleted || sessionStarted) && (needsPeerVote || needsPotdVote);
  const voteBtnLabel = needsPeerVote
    ? isCompleted
      ? "Rate your teammates"
      : "Rate session"
    : "Vote Player of the Day";
  const canHostScore = isHost && (isCompleted || sessionStarted);
  const hostScoreLabel = isCompleted ? "Score players" : "Rate session";

  function openVoteModal() {
    setVoteStep(hasVoted && !hasPotdVoted ? 2 : 1);
    setVoteOpen(true);
  }

  return (
    <>
      <ScrollView style={s.root} contentContainerStyle={{ paddingBottom: 60 }}>
        <View style={s.header}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <FontAwesome name="chevron-left" size={16} color={themeColor().muted} />
          </Pressable>
          <Text style={s.headerTitle} numberOfLines={1}>{run.title}</Text>
          <Pressable onPress={() => void shareSession()} hitSlop={10}>
            <FontAwesome name="share" size={16} color={themeColor().pitchText} />
          </Pressable>
        </View>

        <PhotoHeader uri={heroPhoto} aspect="tall" chalkSize="md" style={s.hero} accessibilityLabel="Field photo">
          {heroPhoto ? (
            <>
              <Text style={s.heroTitle} numberOfLines={2}>{run.title}</Text>
              {run.location_text ? (
                <Text style={s.heroSub} numberOfLines={1}>{run.location_text}</Text>
              ) : null}
            </>
          ) : null}
        </PhotoHeader>

        {canEditPhoto ? (
          <View style={s.photoControls}>
            <PhotoUploadField
              bucket="field-photos"
              name="field"
              label="Field photo"
              aspect="wide"
              preview={false}
              addLabel="Add field photo"
              value={heroPhoto ?? null}
              onChange={saveFieldPhoto}
            />
          </View>
        ) : null}

        {canVote ? (
          <Pressable
            onPress={openVoteModal}
            style={s.rateBanner}
            accessibilityRole="button"
            accessibilityLabel={voteBtnLabel}
          >
            <FontAwesome name="star" size={14} color={themeColor().onPitch} />
            <Text style={s.rateBannerText}>{voteBtnLabel} →</Text>
          </Pressable>
        ) : null}

        <View style={s.pillRow}>
          {isCompleted
            ? <View style={[s.pill, { borderColor: themeColor().line }]}><Text style={[s.pillText, { color: themeColor().muted }]}>Completed</Text></View>
            : <View style={[s.pill, { borderColor: isFull ? themeColor().coral : themeColor().pitch }]}><Text style={[s.pillText, { color: isFull ? themeColor().coralText : themeColor().onPitchPanel }]}>{isFull ? "Full" : `${spotsLeft} spot${spotsLeft === 1 ? "" : "s"} left`}</Text></View>
          }
          {isHost && <View style={[s.pill, { borderColor: themeColor().line }]}><Text style={[s.pillText, { color: themeColor().muted }]}>You're hosting</Text></View>}
          {isJoined && !isHost && <View style={[s.pill, { borderColor: themeColor().pitch }]}><Text style={[s.pillText, { color: themeColor().pitchText }]}>You're in</Text></View>}
        </View>

        <View style={s.card}>
          <View style={s.detailRow}>
            <FontAwesome name="calendar" size={14} color={themeColor().muted} />
            <Text style={s.detailText}>{fmtDate(run.start_at)}</Text>
          </View>
          <View style={s.detailRow}>
            <FontAwesome name="clock-o" size={14} color={themeColor().muted} />
            <Text style={s.detailText}>{fmt12Hour(run.start_at)}</Text>
          </View>
          {run.location_text && (
            <View style={s.detailRow}>
              <FontAwesome name="map-marker" size={14} color={themeColor().muted} />
              <Text style={s.detailText}>{run.location_text}</Text>
            </View>
          )}
          <View style={s.detailRow}>
            <FontAwesome name="users" size={14} color={themeColor().muted} />
            <Text style={s.detailText}>{run.spots_taken} / {run.capacity} players</Text>
          </View>
          <View style={s.detailRow}>
            <FontAwesome name="soccer-ball-o" size={14} color={themeColor().muted} />
            <Text style={s.detailText}>{formatLabel} · {tierLabel}</Text>
          </View>
          {run.fee_cents > 0 && (
            <View style={s.detailRow}>
              <FontAwesome name="dollar" size={14} color={themeColor().muted} />
              <Text style={s.detailText}>${(run.fee_cents / 100).toFixed(2)} buy-in</Text>
            </View>
          )}
        </View>

        {/* Actions */}
        {!isHost && !isCompleted && (
          <Pressable onPress={() => void rsvp()} disabled={rsvpBusy || isFull || isJoined}
            style={[s.rsvpBtn, (isFull || isJoined) && s.rsvpBtnDisabled]}>
            {rsvpBusy ? <ActivityIndicator color={themeColor().onPitch} /> :
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
          <Pressable onPress={openVoteModal} style={s.voteBtn}>
            <FontAwesome name="star" size={14} color={themeColor().onPitch} />
            <Text style={s.voteBtnText}>{voteBtnLabel}</Text>
          </Pressable>
        )}

        {potdSummary ? (
          <View style={s.potdResultCard}>
            <Text style={s.potdResultTitle}>Player of the Day</Text>
            <Text style={s.potdResultBody}>
              {potdSummary.voteCount} player{potdSummary.voteCount === 1 ? "" : "s"} voted{" "}
              {potdSummary.winnerName} Player of the Day
            </Text>
          </View>
        ) : null}

        {sessionStarted && isJoined && !isHost && !hasRatedHost && (
          <Pressable
            onPress={() => {
              setHostScores({});
              setHostRatingOpen(true);
            }}
            style={s.hostRateBtn}
          >
            <FontAwesome name="star-o" size={14} color={themeColor().accent} />
            <Text style={s.hostRateBtnText}>Rate the host</Text>
          </Pressable>
        )}

        {sessionStarted && isJoined && !isHost && hasRatedHost && (
          <View style={s.hostRatedDone}>
            <Text style={s.hostRatedDoneText}>✓ Host rated</Text>
          </View>
        )}

        {(isCompleted || sessionStarted) && isJoined && !isHost && hasVoted && (
          <View style={[s.rsvpBtn, s.rsvpBtnDisabled]}>
            <Text style={s.rsvpBtnText}>✓ Votes submitted</Text>
          </View>
        )}

        {isHost && !isCompleted && (
          <View style={{ gap: 8 }}>
            <Pressable onPress={() => setInviteOpen(true)} style={s.inviteBtn}>
              <FontAwesome name="user-plus" size={14} color={themeColor().onPitch} />
              <Text style={s.inviteBtnText}>Invite players</Text>
            </Pressable>
            <Pressable onPress={() => void shareSession()} style={s.shareBtn}>
              <FontAwesome name="share" size={14} color={themeColor().accent} />
              <Text style={s.shareBtnText}>Share link</Text>
            </Pressable>
            <Pressable onPress={() => setTeamsOpen(true)} style={s.shareBtn}>
              <FontAwesome name="users" size={14} color={themeColor().accent} />
              <Text style={s.shareBtnText}>Assign teams</Text>
            </Pressable>
            <Pressable onPress={() => setResultOpen(true)} style={s.shareBtn}>
              <FontAwesome name="trophy" size={14} color={themeColor().accent} />
              <Text style={s.shareBtnText}>Record result</Text>
            </Pressable>
            <Pressable onPress={() => void cancelSession()} disabled={endBusy}
              style={[s.endBtn, { borderColor: themeColor().coral }, endBusy && { opacity: 0.5 }]}>
              <Text style={[s.endBtnText, { color: themeColor().coralText }]}>Cancel session</Text>
            </Pressable>
            <Pressable onPress={() => void endSession()} disabled={endBusy}
              style={[s.endBtn, endBusy && { opacity: 0.5 }]}>
              {endBusy ? <ActivityIndicator color={themeColor().coralText} /> :
                <Text style={s.endBtnText}>End session</Text>}
            </Pressable>
          </View>
        )}

        {canHostScore && (
          <Pressable onPress={() => void openHostScore()} style={[s.voteBtn, { marginTop: isHost && !isCompleted ? 10 : 0 }]}>
            <FontAwesome name="star" size={14} color={themeColor().onPitch} />
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
              <FontAwesome name="times" size={18} color={themeColor().muted} />
            </Pressable>
          </View>
          <View style={s.modalSearch}>
            <FontAwesome name="search" size={14} color={themeColor().muted} />
            <TextInput style={s.modalSearchInput} value={searchQ} onChangeText={(t) => void searchPlayers(t)}
              placeholder="Search by name or username…" placeholderTextColor={themeColor().muted}
              autoCorrect={false} autoFocus />
            {searching && <ActivityIndicator color={themeColor().pitchText} size="small" />}
          </View>
          <Pressable onPress={() => void shareSession()} style={s.shareLinkRow}>
            <FontAwesome name="link" size={14} color={themeColor().onPitchPanel} />
            <Text style={s.shareLinkText}>Share session link instead</Text>
            <FontAwesome name="chevron-right" size={12} color={themeColor().onPitchPanel} />
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

      {/* Peer Vote Modal — Step 1: top 3, Step 2: POTD */}
      <Modal visible={voteOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setVoteOpen(false)}>
        <View style={s.modalRoot}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>
              {voteStep === 1
                ? isCompleted
                  ? "Rate your teammates"
                  : "Rate session"
                : "Player of the Day"}
            </Text>
            <Pressable onPress={() => setVoteOpen(false)} hitSlop={10}>
              <FontAwesome name="times" size={18} color={themeColor().muted} />
            </Pressable>
          </View>
          {voteStep === 1 ? (
            <>
              <Text style={s.voteSubtitle}>
                Step 1 of 2 — Pick your top 3 players. Nobody sees your picks.
              </Text>
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
                    <Pressable
                      onPress={() => toggleVotePick(item.user_id)}
                      disabled={full}
                      style={[s.playerRow, picked && { borderWidth: 1, borderColor: themeColor().pitch }, full && { opacity: 0.35 }]}
                    >
                      <View style={[s.avatar, picked && { backgroundColor: themeColor().pitch }]}>
                        <Text style={[s.avatarText, picked && { color: themeColor().onPitch }]}>
                          {picked ? rank + 1 : playerInitials(item)}
                        </Text>
                      </View>
                      <Text style={s.playerName}>{name}</Text>
                      {picked && <FontAwesome name="check" size={14} color={themeColor().pitchText} />}
                    </Pressable>
                  );
                }}
              />
              <Pressable
                onPress={() => void submitVotes()}
                disabled={votePicks.length !== 3 || voteBusy}
                style={[s.publishBtn, votePicks.length !== 3 && { opacity: 0.4 }, { margin: 16 }]}
              >
                {voteBusy ? (
                  <ActivityIndicator color={themeColor().onPitch} />
                ) : (
                  <Text style={s.publishBtnText}>Continue · {votePicks.length}/3</Text>
                )}
              </Pressable>
            </>
          ) : (
            <>
              <Text style={s.voteSubtitle}>
                Step 2 of 2 — Who stood out most? Pick one Player of the Day.
              </Text>
              <FlatList
                data={attendees.filter((a) => a.user_id !== myUserId && a.user_id !== run.created_by)}
                keyExtractor={(a) => a.user_id}
                contentContainerStyle={{ padding: 16, gap: 8 }}
                renderItem={({ item }) => {
                  const name = playerName(item);
                  const selected = potdNominee === item.user_id;
                  return (
                    <Pressable
                      onPress={() => setPotdNominee(selected ? null : item.user_id)}
                      style={[s.playerRow, selected && { borderWidth: 1, borderColor: themeColor().pitch }]}
                    >
                      <View style={[s.avatar, selected && { backgroundColor: themeColor().pitch }]}>
                        <Text style={[s.avatarText, selected && { color: themeColor().onPitch }]}>
                          {selected ? "★" : playerInitials(item)}
                        </Text>
                      </View>
                      <Text style={[s.playerName, selected && { color: themeColor().pitchText }]}>{name}</Text>
                      {selected ? <FontAwesome name="star" size={14} color={themeColor().pitchText} /> : null}
                    </Pressable>
                  );
                }}
              />
              <Pressable
                onPress={() => void submitPotdVote()}
                disabled={!potdNominee || voteBusy}
                style={[s.publishBtn, !potdNominee && { opacity: 0.4 }, { margin: 16 }]}
              >
                {voteBusy ? (
                  <ActivityIndicator color={themeColor().onPitch} />
                ) : (
                  <Text style={s.publishBtnText}>Submit Player of the Day</Text>
                )}
              </Pressable>
            </>
          )}
        </View>
      </Modal>

      {/* Organizer Score Modal */}
      <Modal visible={scoreOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setScoreOpen(false)}>
        <ScrollView style={s.modalRoot} keyboardShouldPersistTaps="handled">
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Rate players</Text>
            <Pressable onPress={() => setScoreOpen(false)} hitSlop={10}>
              <FontAwesome name="times" size={18} color={themeColor().muted} />
            </Pressable>
          </View>
          <Text style={s.voteSubtitle}>Assign each player the tier that best reflects how they played today.</Text>

          <View style={s.tierLegend}>
            {[
              { tier: "bronze", label: "Bronze", desc: "Learning the game", color: themeColor().muted },
              { tier: "silver", label: "Silver", desc: "Solid recreational", color: themeColor().muted },
              { tier: "gold", label: "Gold", desc: "Competitive club level", color: themeColor().muted },
              { tier: "platinum", label: "Platinum", desc: "College / semi-pro", color: themeColor().text },
              { tier: "diamond", label: "Diamond", desc: "Elite / pro level", color: themeColor().muted },
            ].map((t) => (
              <View key={t.tier} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <View style={{ width: 10, height: 10, borderRadius: 10, backgroundColor: t.color }} />
                <Text style={{ color: t.color, fontWeight: "700", fontSize: 13, fontFamily: "Inter_700Bold", width: 60 }}>{t.label}</Text>
                <Text style={{ color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular" }}>{t.desc}</Text>
              </View>
            ))}
          </View>

          <View style={{ padding: 16, gap: 16 }}>
            {attendees.filter((a) => a.user_id !== myUserId).map((a) => {
              const name = playerName(a);
              const selectedTier = scores[a.user_id] ?? "";
              const TIERS = [
                { value: "bronze", label: "B", color: themeColor().muted },
                { value: "silver", label: "S", color: themeColor().muted },
                { value: "gold", label: "G", color: themeColor().muted },
                { value: "platinum", label: "P", color: themeColor().text },
                { value: "diamond", label: "D", color: themeColor().muted },
              ];
              return (
                <View key={a.user_id} style={s.scoreRow}>
                  <View style={s.avatar}><Text style={s.avatarText}>{playerInitials(a)}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.playerName}>{name}</Text>
                    <View style={{ flexDirection: "row", gap: 4, marginTop: 8 }}>
                      {TIERS.map((t) => (
                        <Pressable
                          key={t.value}
                          onPress={() => setScores((prev) => ({ ...prev, [a.user_id]: t.value }))}
                          style={{
                            width: 40, height: 40, borderRadius: 999,
                            borderWidth: 2,
                            borderColor: selectedTier === t.value ? t.color : themeColor().muted,
                            backgroundColor: selectedTier === t.value ? `${t.color}22` : "transparent",
                            alignItems: "center", justifyContent: "center",
                          }}
                        >
                          <Text style={{ color: selectedTier === t.value ? t.color : themeColor().muted, fontWeight: "800", fontSize: 13, fontFamily: "Inter_700Bold" }}>
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
            {scoreBusy ? <ActivityIndicator color={themeColor().onPitch} /> :
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
              <FontAwesome name="times" size={18} color={themeColor().muted} />
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
                    team === "A" && { backgroundColor: themeColor().pitchPanel },
                    team === "B" && { backgroundColor: themeColor().overlayStrong },
                  ]}>
                    <Text style={[
                      s.assignAvatarText,
                      team === "A" && { color: themeColor().onPitchPanel },
                      team === "B" && { color: themeColor().text },
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
                    team === "A" && { backgroundColor: themeColor().pitchPanel },
                    team === "B" && { backgroundColor: themeColor().overlayStrong },
                  ]}>
                    <Text style={s.assignTeamBadgeText}>{team ? `Team ${team}` : "Tap to assign"}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          <Pressable onPress={() => void submitTeams()} disabled={teamsBusy}
            style={[s.publishBtn, teamsBusy && { opacity: 0.5 }, { margin: 16 }]}>
            {teamsBusy ? <ActivityIndicator color={themeColor().onPitch} /> :
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
              <FontAwesome name="times" size={18} color={themeColor().muted} />
            </Pressable>
          </View>

          <View style={{ marginHorizontal: 16, marginTop: 12, marginBottom: 4, backgroundColor: themeColor().overlaySubtle, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: themeColor().line }}>
            <Text style={{ color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 }}>You cannot receive awards for sessions you host.</Text>
          </View>
          <View style={{ marginHorizontal: 16, marginTop: 8, marginBottom: 4, backgroundColor: themeColor().pitch, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: themeColor().pitch }}>
            <Text style={{ color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 }}>
              Player of the Day is voted by attendees. Pick Defender, Midfielder, Attacker, and Goalie awards below.
            </Text>
          </View>

          <Text style={s.voteSubtitle}>Who won?</Text>
          <View style={{ flexDirection: "row", gap: 8, padding: 16, paddingTop: 8 }}>
            <Pressable onPress={() => setWinningTeam("A")}
              style={{ flex: 1, paddingVertical: 16, borderRadius: 12, borderWidth: 2, borderColor: winningTeam === "A" ? themeColor().pitch : themeColor().overlay, backgroundColor: winningTeam === "A" ? themeColor().pitch : "transparent", alignItems: "center" }}>
              <Text style={{ color: winningTeam === "A" ? themeColor().onPitch : themeColor().text, fontSize: 20, ...headline }}>Team A</Text>
            </Pressable>
            <Pressable onPress={() => setWinningTeam("B")}
              style={{ flex: 1, paddingVertical: 16, borderRadius: 12, borderWidth: 2, borderColor: winningTeam === "B" ? themeColor().text : themeColor().overlay, backgroundColor: winningTeam === "B" ? themeColor().text : "transparent", alignItems: "center" }}>
              <Text style={{ color: winningTeam === "B" ? themeColor().bg : themeColor().text, fontSize: 20, ...headline }}>Team B</Text>
            </Pressable>
          </View>

          {[
            { label: "Defender of the Day", state: defenderPotd, set: setDefenderPotd },
            { label: "Midfielder of the Day", state: midfielderPotd, set: setMidfielderPotd },
            { label: "Attacker of the Day", state: attackerPotd, set: setAttackerPotd },
            { label: "Goalie of the Day", state: goaliePotd, set: setGoaliePotd },
          ].map(({ label, state, set }) => (
            <View key={label} style={{ paddingHorizontal: 16, marginBottom: 16 }}>
              <Text style={s.voteSubtitle}>{label}</Text>
              {state ? (
                <Text style={s.awardToggleHint}>Tap selected player again to remove</Text>
              ) : null}
              <View style={s.assignGrid}>
                {attendees.filter((a) => a.user_id !== run.created_by).map((a) => {
                  const name = playerName(a);
                  const selected = state === a.user_id;
                  return (
                    <Pressable
                      key={a.user_id}
                      onPress={() => set(selected ? null : a.user_id)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={
                        selected ? `${name}, selected. Tap to remove` : `Select ${name} for ${label}`
                      }
                      style={[s.assignCard, selected ? s.assignCardSelected : s.assignCardIdle]}
                    >
                      <View style={[s.assignAvatar, selected ? s.assignAvatarSelected : s.assignAvatarIdle]}>
                        <Text style={[s.assignAvatarText, !selected && { color: themeColor().muted }]}>
                          {playerInitials(a)}
                        </Text>
                      </View>
                      <Text style={[s.assignName, selected && { color: themeColor().pitchText }]} numberOfLines={2}>
                        {name}
                      </Text>
                      {a.profiles?.username ? (
                        <Text style={s.assignUsername} numberOfLines={1}>@{a.profiles.username}</Text>
                      ) : null}
                      {selected ? (
                        <View style={s.awardSelectedBadge}>
                          <FontAwesome name="star" size={12} color={themeColor().pitchText} />
                          <Text style={s.awardSelectedBadgeText}>Selected · tap ✕</Text>
                        </View>
                      ) : (
                        <Text style={s.awardIdleHint}>Tap to select</Text>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}

          <Pressable onPress={() => void submitResult()} disabled={resultBusy || !winningTeam}
            style={[s.publishBtn, (resultBusy || !winningTeam) && { opacity: 0.4 }, { margin: 16 }]}>
            {resultBusy ? <ActivityIndicator color={themeColor().onPitch} /> :
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
                const first = host?.profiles?.first_name?.trim();
                return first || (host ? playerName(host) : "the host");
              })()}{" "}
              as a host
            </Text>
            <Pressable onPress={() => setHostRatingOpen(false)} hitSlop={10}>
              <FontAwesome name="times" size={18} color={themeColor().muted} />
            </Pressable>
          </View>
          <Text style={s.voteSubtitle}>Your rating is anonymous</Text>

          <View style={{ padding: 16, gap: 20 }}>
            {HOST_RATING_CATEGORIES.map((cat) => {
              const selected = hostScores[cat.key] ?? 0;
              return (
                <View key={cat.key} style={s.hostRatingCat}>
                  <Text style={s.hostRatingLabel}>{cat.label}</Text>
                  <Text style={s.hostRatingHint}>{cat.hint}</Text>
                  <View style={s.hostRatingStars}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Pressable
                        key={n}
                        onPress={() =>
                          setHostScores((prev) => ({ ...prev, [cat.key]: n }))
                        }
                        hitSlop={6}
                        style={{ padding: 4 }}
                      >
                        <FontAwesome
                          name={n <= selected ? "star" : "star-o"}
                          size={28}
                          color={n <= selected ? themeColor().pitchText : themeColor().muted}
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
              HOST_RATING_CATEGORIES.some((c) => !hostScores[c.key])
            }
            style={[
              s.publishBtn,
              (hostRatingBusy ||
                HOST_RATING_CATEGORIES.some((c) => !hostScores[c.key])) && {
                opacity: 0.4,
              },
              { margin: 16 },
            ]}
          >
            {hostRatingBusy ? (
              <ActivityIndicator color={themeColor().onPitch} />
            ) : (
              <Text style={s.publishBtnText}>Submit rating</Text>
            )}
          </Pressable>
        </ScrollView>
      </Modal>
    </>
  );
}

function make_s() {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: themeColor().bg, padding: 20 },
  center: { flex: 1, backgroundColor: themeColor().bg, alignItems: "center", justifyContent: "center", padding: 24 },
  errorText: { color: themeColor().muted, fontSize: 16, fontFamily: "Inter_400Regular" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 16, marginBottom: 20 },
  hero: { marginHorizontal: -20, marginTop: -4, marginBottom: 16 },
  photoControls: { marginTop: -4, marginBottom: 16 },
  heroTitle: { color: themeColor().onPhoto, fontSize: 24, ...headline },
  heroSub: { color: themeColor().onPhoto, fontSize: 14, fontFamily: "Inter_500Medium", fontWeight: "500", marginTop: 4 },
  headerTitle: { color: themeColor().text, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700", flex: 1, textAlign: "center", marginHorizontal: 12 },
  rateBanner: {
    backgroundColor: themeColor().pitch,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 12,
  },
  rateBannerText: { color: themeColor().onPitch, fontWeight: "800", fontSize: 16, fontFamily: "Inter_700Bold" },
  pillRow: { flexDirection: "row", gap: 8, marginBottom: 16, flexWrap: "wrap" },
  pill: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  pillText: { fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700" },
  card: { backgroundColor: themeColor().card, borderRadius: 12, borderWidth: 1, borderColor: themeColor().line, padding: 16, marginBottom: 16 },
  detailRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  detailText: { color: themeColor().text, fontSize: 16, fontFamily: "Inter_400Regular", flex: 1 },
  rsvpBtn: { backgroundColor: themeColor().pitch, borderRadius: 12, paddingVertical: 16, alignItems: "center", marginBottom: 12 },
  rsvpBtnDisabled: { opacity: 0.5 },
  rsvpBtnText: { color: themeColor().onPitch, fontWeight: "800", fontSize: 16, fontFamily: "Inter_700Bold" },
  voteBtn: { backgroundColor: themeColor().pitch, borderRadius: 12, paddingVertical: 16, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: 12 },
  voteBtnText: { color: themeColor().onPitch, fontWeight: "800", fontSize: 16, fontFamily: "Inter_700Bold" },
  hostRateBtn: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: themeColor().accent,
    backgroundColor: "transparent",
  },
  hostRateBtnText: { color: themeColor().accent, fontWeight: "800", fontSize: 16, fontFamily: "Inter_700Bold" },
  hostRatedDone: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    marginBottom: 12,
    backgroundColor: themeColor().overlaySubtle,
  },
  hostRatedDoneText: { color: themeColor().muted, fontWeight: "700", fontSize: 16, fontFamily: "Inter_700Bold" },
  hostRatingCat: {
    backgroundColor: themeColor().overlaySubtle,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().line,
    padding: 12,
    gap: 4,
  },
  hostRatingLabel: { color: themeColor().text, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
  hostRatingHint: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 4 },
  hostRatingStars: { flexDirection: "row", alignItems: "center", gap: 4 },
  inviteBtn: { backgroundColor: themeColor().pitch, borderRadius: 12, paddingVertical: 16, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 },
  inviteBtnText: { color: themeColor().onPitch, fontWeight: "800", fontSize: 16, fontFamily: "Inter_700Bold" },
  shareBtn: { borderRadius: 12, paddingVertical: 12, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: themeColor().accent },
  shareBtnText: { color: themeColor().accent, fontWeight: "700", fontSize: 16, fontFamily: "Inter_700Bold" },
  endBtn: { borderRadius: 12, paddingVertical: 12, alignItems: "center", borderWidth: 1, borderColor: themeColor().coral },
  endBtnText: { color: themeColor().coralText, fontWeight: "700", fontSize: 16, fontFamily: "Inter_700Bold" },
  sectionTitle: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700", marginBottom: 8 },
  attendeeRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  attendeeBorder: { borderTopWidth: 1, borderTopColor: themeColor().line },
  avatar: { width: 36, height: 36, borderRadius: 12, backgroundColor: themeColor().pitchPanel, alignItems: "center", justifyContent: "center" },
  avatarText: { color: themeColor().onPitchPanel, fontWeight: "700", fontSize: 16, fontFamily: "Inter_700Bold" },
  attendeeName: { flex: 1, color: themeColor().text, fontSize: 16, fontFamily: "Inter_500Medium", fontWeight: "500" },
  hostBadge: { color: themeColor().muted, fontSize: 11, fontFamily: "Inter_700Bold", fontWeight: "700", borderWidth: 1, borderColor: themeColor().line, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  backBtn: { marginTop: 16, backgroundColor: themeColor().pitch, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  backBtnText: { color: themeColor().onPitch, fontWeight: "800" },
  modalRoot: { flex: 1, backgroundColor: themeColor().bg },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 20, paddingTop: 24, borderBottomWidth: 1, borderBottomColor: themeColor().line },
  modalTitle: { color: themeColor().text, fontSize: 20, ...headline },
  modalSearch: { flexDirection: "row", alignItems: "center", gap: 8, margin: 16, backgroundColor: themeColor().overlay, borderRadius: 12, borderWidth: 1, borderColor: themeColor().line, paddingHorizontal: 12, paddingVertical: 12 },
  modalSearchInput: { flex: 1, color: themeColor().text, fontSize: 16, fontFamily: "Inter_400Regular" },
  shareLinkRow: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginBottom: 8, padding: 12, backgroundColor: themeColor().pitchPanel, borderRadius: 12, borderWidth: 1, borderColor: themeColor().pitch },
  shareLinkText: { flex: 1, color: themeColor().onPitchPanel, fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  emptyText: { color: themeColor().muted, fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 20 },
  playerRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: themeColor().card, borderRadius: 12, padding: 12 },
  playerName: { color: themeColor().text, fontSize: 16, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  playerUsername: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4 },
  playerPos: { color: themeColor().pitchText, fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4 },
  inviteRowBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: themeColor().accent },
  inviteRowBtnDone: { borderColor: themeColor().line, backgroundColor: themeColor().overlaySubtle },
  inviteRowBtnText: { color: themeColor().accent, fontWeight: "700", fontSize: 13, fontFamily: "Inter_700Bold" },
  inviteRowBtnTextDone: { color: themeColor().muted },
  voteSubtitle: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", padding: 16, paddingBottom: 8, lineHeight: 18 },
  potdResultCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().pitch,
    backgroundColor: themeColor().pitchPanel,
  },
  potdResultTitle: { color: themeColor().onPitchPanel, fontWeight: "800", fontSize: 13, fontFamily: "Inter_700Bold", marginBottom: 4 },
  potdResultBody: { color: themeColor().text, fontSize: 16, fontFamily: "Inter_600SemiBold", lineHeight: 21, fontWeight: "600" },
  tierLegend: { margin: 16, padding: 12, backgroundColor: themeColor().card, borderRadius: 12, borderWidth: 1, borderColor: themeColor().line },
  scoreRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: themeColor().card, borderRadius: 12, padding: 12 },
  scoreInput: { width: 56, backgroundColor: themeColor().overlay, borderRadius: 10, borderWidth: 1, borderColor: themeColor().line, color: themeColor().text, textAlign: "center", fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700", paddingVertical: 8 },
  publishBtn: { backgroundColor: themeColor().pitch, borderRadius: 12, paddingVertical: 16, alignItems: "center" },
  publishBtnText: { color: themeColor().onPitch, fontWeight: "800", fontSize: 16, fontFamily: "Inter_700Bold" },
  assignGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  assignCard: {
    width: "47%",
    alignItems: "center",
    backgroundColor: themeColor().card,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: themeColor().line,
    gap: 4,
  },
  assignCardIdle: {
    borderColor: themeColor().line,
    backgroundColor: themeColor().overlaySubtle,
  },
  assignCardA: { borderColor: themeColor().pitch, backgroundColor: themeColor().card },
  assignCardB: { borderColor: themeColor().text, backgroundColor: themeColor().overlaySubtle },
  assignCardSelected: {
    borderColor: themeColor().pitch,
    borderWidth: 2,
    backgroundColor: themeColor().pitchPanel,
  },
  assignAvatar: {
    width: 48,
    height: 48,
    borderRadius: 999,
    backgroundColor: themeColor().pitchPanel,
    alignItems: "center",
    justifyContent: "center",
  },
  assignAvatarSelected: { backgroundColor: themeColor().pitchPanel },
  assignAvatarIdle: { backgroundColor: themeColor().overlay },
  assignAvatarText: { color: themeColor().onPitchPanel, fontWeight: "800", fontSize: 16, fontFamily: "Inter_700Bold" },
  assignName: {
    color: themeColor().text,
    fontSize: 13, fontFamily: "Inter_700Bold",
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 17,
    minHeight: 34,
  },
  assignUsername: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  awardToggleHint: {
    marginTop: -4,
    marginBottom: 8,
    color: themeColor().pitchText,
    fontSize: 13, fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
  },
  awardSelectedBadge: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: themeColor().pitchPanel,
  },
  awardSelectedBadgeText: { color: themeColor().onPitchPanel, fontSize: 11, fontFamily: "Inter_700Bold", fontWeight: "700" },
  awardIdleHint: {
    marginTop: 4,
    color: themeColor().muted,
    fontSize: 13, fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
  },
  assignTeamBadge: {
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: themeColor().overlay,
  },
  assignTeamBadgeText: { color: themeColor().text, fontWeight: "800", fontSize: 11, fontFamily: "Inter_700Bold" },
});
}
let s = make_s();
function publish_s() {
  s = make_s();
}

