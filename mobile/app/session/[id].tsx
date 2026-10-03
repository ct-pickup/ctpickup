import { useAuth } from "@/context/AuthContext";
import { useProfilePhoto } from "@/context/ProfilePhotoContext";
import { useProfileAdmin } from "@/context/ProfileAdminContext";
import { siteOrigin } from "@/lib/env";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState, type ComponentProps } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import PlayerAvatar from "@/components/PlayerAvatar";
import { PhotoHeader, PhotoUploadField, useFieldPhotos } from "@/components/photo";
import FillYourGameCard from "@/components/pickup/FillYourGameCard";
import PlayedWithRow, { usePlayedWith } from "@/components/pickup/PlayedWithRow";
import { ResultScoreFields } from "@/components/pickup/ResultScoreFields";
import SpotsBadge from "@/components/pickup/SpotsBadge";
import { canEditResult } from "@/lib/pickup/resultOutcome";
import {
  EMPTY_RESULT_FORM,
  fetchPostedResult,
  probeResultScoresSupported,
  resultFormBody,
  resultFormFromStored,
  type PostedResult,
  type ResultFormState,
} from "@/lib/resultForm";
import { invalidateMyRecord } from "@/lib/playerRecord";
import { fmtPickupSlotChipEt, fmtPickupTimeEt, runTimeTbd } from "@/lib/pickup/runStartAtDisplay";
import { fetchRunTimeTbdIds } from "@/lib/pickup/runTimeTbd";
import { setRunFieldPhoto } from "@/lib/photoUpload";
import {
  averageStars,
  fetchPlayerStars,
  fetchRunMinStars,
  formatStars,
  hostScore as toHostScore,
  levelLabel,
  SKILL_STAR_RANGE,
} from "@/lib/starRatings";
import { milesFromZip } from "@/lib/venueDistance";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";
import type { DevFixtures } from "../../dev-fixtures";

// eslint-disable-next-line @typescript-eslint/no-require-imports -- must stay a __DEV__ require so release bundles drop dev-fixtures
const devFixtures: DevFixtures | null = __DEV__ ? require("../../dev-fixtures").default : null;

type SessionDetail = {
  id: string;
  title: string;
  location_text: string | null;
  latitude: number | null;
  longitude: number | null;
  start_at: string;
  time_tbd?: boolean;
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
    avatar_url: string | null;
  } | null;
};

type HostInfo = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  avatar_url: string | null;
};

type PlayerResult = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  playing_position: string | null;
};

const GOING_SHOWN = 7;
const OPEN_RUN_STATUSES = new Set(["planning", "likely_on", "active"]);
const JOIN_BAR_HEIGHT = 52;
const TOAST_MS = 3000;

const RATING_OPTIONS = [
  { value: "bronze", desc: "Learning the game" },
  { value: "silver", desc: "Solid recreational" },
  { value: "gold", desc: "Competitive club level" },
  { value: "platinum", desc: "College / semi-pro" },
  { value: "diamond", desc: "Elite / pro level" },
].map((o) => ({ ...o, label: `${SKILL_STAR_RANGE[o.value].high}★` }));

function formatFee(cents: number): string {
  if (cents <= 0) return "Free";
  const dollars = cents / 100;
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)} per player`;
}

function formatMiles(mi: number): string {
  return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi away`;
}

function Toast({ message, id, bottom }: { message: string; id: number; bottom: number }) {
  useThemedStyles(publish_s);
  const [opacity] = useState(() => new Animated.Value(0));
  useEffect(() => {
    opacity.setValue(0);
    const anim = Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.delay(TOAST_MS - 360),
      Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [id, opacity]);
  return (
    <Animated.View pointerEvents="none" style={[s.toast, { bottom, opacity }]} accessibilityLiveRegion="polite">
      <Text style={s.toastText}>{message}</Text>
    </Animated.View>
  );
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
  useThemedStyles(publish_s);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, supabase } = useAuth();
  const { ensurePhotoForGame, handlePhotoRequired } = useProfilePhoto();
  const { isAdmin } = useProfileAdmin();
  const fixture = useMemo(() => (devFixtures && id ? devFixtures.session(id) : null), [id]);
  const fieldPhotos = useFieldPhotos(id && !fixture ? [id] : []);
  const [savedPhoto, setSavedPhoto] = useState<string | null | undefined>(undefined);
  const heroPhoto = fixture
    ? fixture.photo
    : savedPhoto !== undefined
      ? savedPhoto ?? undefined
      : id
        ? fieldPhotos[id]
        : undefined;

  const [run, setRun] = useState<SessionDetail | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const livePlayedWith = usePlayedWith(id ? [id] : [], { skip: Boolean(fixture), reloadKey: attendees.length });
  const playedWith = fixture ? fixture.playedWith : id ? livePlayedWith.byRun[id] : undefined;
  const [loading, setLoading] = useState(true);
  const [rsvpBusy, setRsvpBusy] = useState(false);
  const [myStatus, setMyStatus] = useState<string | null>(null);
  const [endBusy, setEndBusy] = useState(false);
  const [stars, setStars] = useState<Map<string, number>>(new Map());
  const [minStar, setMinStar] = useState<number | null>(null);
  const [host, setHost] = useState<HostInfo | null>(null);
  const [hostScore, setHostScore] = useState<number | null>(null);
  const [myZip, setMyZip] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [photoEditorOpen, setPhotoEditorOpen] = useState(false);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);

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
  const [resultMode, setResultMode] = useState<"record" | "edit">("record");
  const [resultForm, setResultForm] = useState<ResultFormState>(EMPTY_RESULT_FORM);
  const [scoresAvailable, setScoresAvailable] = useState(false);
  const [postedResult, setPostedResult] = useState<PostedResult | null>(null);
  const [defenderPotd, setDefenderPotd] = useState<string | null>(null);
  const [midfielderPotd, setMidfielderPotd] = useState<string | null>(null);
  const [attackerPotd, setAttackerPotd] = useState<string | null>(null);
  const [goaliePotd, setGoaliePotd] = useState<string | null>(null);
  const [resultBusy, setResultBusy] = useState(false);

  const myUserId = session?.user?.id;
  const isHost = run?.created_by === myUserId;
  const isCompleted = run?.status === "completed";
  const canEditPhoto = Boolean(myUserId) && (isHost || isAdmin) && !fixture;

  const saveFieldPhoto = useCallback(
    async (url: string | null) => {
      if (!supabase || !id) throw new Error("Please sign in again to change the photo.");
      await setRunFieldPhoto(supabase, id, url);
      setSavedPhoto(url);
    },
    [supabase, id],
  );

  const load = useCallback(async () => {
    if (fixture) {
      setRun(fixture.run);
      setAttendees(fixture.attendees);
      setHost(fixture.host);
      setStars(fixture.stars);
      setMinStar(fixture.minStar);
      setMyStatus(null);
      setLoading(false);
      return;
    }
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

      const tbdIds = runData ? await fetchRunTimeTbdIds(supabase, [id]) : new Set<string>();
      let resolved = runData ? { ...(runData as SessionDetail), time_tbd: tbdIds.has(id) } : null;
      if (
        resolved?.status === "planning" &&
        !resolved.time_tbd &&
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
        if (updated) resolved = { ...(updated as SessionDetail), time_tbd: false };
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
      const hostId = resolved?.created_by ?? null;
      const profileIds = hostId && !userIds.includes(hostId) ? [...userIds, hostId] : userIds;

      const profileById = new Map<string, Attendee["profiles"]>();
      if (profileIds.length > 0) {
        const { data: profileRows, error: profileErr } = await supabase
          .from("profiles")
          .select("id,first_name,last_name,username,playing_position,avatar_url")
          .in("id", profileIds);
        if (profileErr) console.warn("[session] profiles read:", profileErr.message);
        for (const p of (profileRows ?? []) as Array<{
          id: string;
          first_name: string | null;
          last_name: string | null;
          username: string | null;
          playing_position: string | null;
          avatar_url: string | null;
        }>) {
          profileById.set(p.id, {
            first_name: p.first_name,
            last_name: p.last_name,
            username: p.username,
            playing_position: p.playing_position,
            avatar_url: p.avatar_url?.trim() || null,
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

      const hostRow = hostId ? profileById.get(hostId) : null;
      setHost(
        hostId
          ? {
              id: hostId,
              first_name: hostRow?.first_name ?? null,
              last_name: hostRow?.last_name ?? null,
              username: hostRow?.username ?? null,
              avatar_url: hostRow?.avatar_url ?? null,
            }
          : null,
      );

      const [starMap, minStarMap] = await Promise.all([
        fetchPlayerStars(supabase, userIds),
        fetchRunMinStars(supabase, [id]),
      ]);
      setStars(starMap);
      setMinStar(minStarMap.get(id) ?? null);

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
        const startMs = resolved?.start_at && !resolved.time_tbd ? new Date(resolved.start_at).getTime() : NaN;
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
  }, [fixture, supabase, id, myUserId, session?.access_token]);

  useEffect(() => { void load(); }, [load]);

  const hostId = run?.created_by ?? null;
  useEffect(() => {
    if (fixture) {
      setHostScore(fixture.hostScore);
      return;
    }
    setHostScore(null);
    const origin = siteOrigin();
    if (!hostId || !origin) return;
    let cancelled = false;
    void (async () => {
      try {
        const headers: Record<string, string> = {};
        if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
        const r = await fetch(`${origin}/api/sessions/host-rating?host_id=${encodeURIComponent(hostId)}`, { headers });
        const j = (await r.json().catch(() => null)) as { avg_overall?: number | null; total_ratings?: number } | null;
        if (cancelled) return;
        if (!r.ok || !j) {
          console.warn("[session] host rating read failed:", r.status);
          return;
        }
        if ((j.total_ratings ?? 0) >= 1 && typeof j.avg_overall === "number") {
          setHostScore(toHostScore(j.avg_overall));
        }
      } catch (e) {
        if (!cancelled) console.warn("[session] host rating read failed:", e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fixture, hostId, session?.access_token]);

  useEffect(() => {
    if (!supabase || !myUserId) {
      setMyZip(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.from("profiles").select("zip_code").eq("id", myUserId).maybeSingle();
      if (cancelled) return;
      if (error) console.warn("[session] zip read:", error.message);
      setMyZip((data as { zip_code?: string | null } | null)?.zip_code?.trim() || null);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, myUserId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  async function endSession() {
    if (endBusy) return;
    Alert.alert(
      "End session",
      "This closes the session and updates player ratings. You can adjust ratings next.",
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
    const pendingPayment = myStatus === "pending_payment";
    let alertBody = pendingPayment
      ? "Your unfinished payment will be cancelled and you won't be charged. If it already went through, you'll be treated as a paid player."
      : isPaid
        ? "Leaving more than 24 hours before kickoff gives back what you paid, as a refund or credit depending on when you paid. Within 24 hours: no refund or credit."
        : "Are you sure you want to leave this session?";
    const previewOrigin = siteOrigin();
    if (previewOrigin && isPaid) {
      const pr = await fetch(`${previewOrigin}/api/sessions/leave`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ run_id: id, preview: true }),
      }).catch(() => null);
      const pj = pr ? ((await pr.json().catch(() => null)) as { preview?: { message?: unknown }; error?: string } | null) : null;
      if (pr && !pr.ok) {
        Alert.alert("Could not leave", pj?.error ?? "Something went wrong. Try again.");
        return;
      }
      if (typeof pj?.preview?.message === "string") alertBody = pj.preview.message;
    }
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
            const j = await r.json().catch(() => null) as { ok?: boolean; error?: string; message?: string } | null;
            if (!r.ok || !j?.ok) { Alert.alert("Could not leave", j?.error ?? "Something went wrong. Try again."); return; }
            await load();
            if (typeof j.message === "string" && j.message) Alert.alert("Left session", j.message);
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
      "All players will be notified. Card payments are refunded to the card and players who joined with a credit get it back as a credit. This cannot be undone.",
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
                ok?: boolean; error?: string; refunded?: number; credited?: number;
                failures?: { user_id: string; name: string | null; error: string }[];
              } | null;
              if (!r.ok || !j?.ok) {
                const failures = j?.failures ?? [];
                if (failures.length > 0) {
                  const done: string[] = [];
                  if (j?.refunded) done.push(`${j.refunded} card refund${j.refunded === 1 ? "" : "s"} issued.`);
                  if (j?.credited) done.push(`${j.credited} credit${j.credited === 1 ? "" : "s"} issued.`);
                  const lines = failures.map((f) => `• ${f.name ?? "A player"}: ${f.error}`);
                  const summary = [j?.error, ...done].filter(Boolean).join(" ");
                  Alert.alert("Some players were not refunded", `${summary}\n\n${lines.join("\n")}`);
                } else {
                  Alert.alert("Error", j?.error ?? "Could not cancel.");
                }
                await load();
                return;
              }
              const parts = ["All players have been notified."];
              if (j.refunded) parts.push(`${j.refunded} card refund${j.refunded === 1 ? "" : "s"} issued.`);
              if (j.credited) parts.push(`${j.credited} credit${j.credited === 1 ? "" : "s"} issued.`);
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

  useEffect(() => {
    if (!supabase || !id || fixture) return;
    let cancelled = false;
    void Promise.all([probeResultScoresSupported(supabase), fetchPostedResult(supabase, id)]).then(([ok, posted]) => {
      if (cancelled) return;
      setScoresAvailable(ok);
      setPostedResult(posted);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, id, fixture, isCompleted]);

  const canEditScore =
    Boolean(postedResult) &&
    !fixture &&
    (isAdmin ||
      (isHost && canEditResult({ isAdmin: false, isHost: true, postedAt: postedResult?.created_at }).ok));

  function openResult(mode: "record" | "edit") {
    setResultMode(mode);
    setResultForm(mode === "edit" && postedResult ? resultFormFromStored(postedResult) : EMPTY_RESULT_FORM);
    setResultOpen(true);
  }

  async function submitResult() {
    if (resultBusy || !session?.access_token) return;
    const fields = resultFormBody(resultForm, scoresAvailable);
    if (!fields.ok) { Alert.alert("Result", fields.error); return; }
    const origin = siteOrigin();
    if (!origin) return;
    const editing = resultMode === "edit";
    setResultBusy(true);
    try {
      const r = await fetch(`${origin}/api/sessions/result`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          run_id: id,
          ...fields.body,
          ...(editing
            ? { score_only: true }
            : {
                defender_of_the_day: defenderPotd,
                midfielder_of_the_day: midfielderPotd,
                attacker_of_the_day: attackerPotd,
                goalie_of_the_day: goaliePotd,
              }),
        }),
      });
      const j = await r.json().catch(() => null) as { ok?: boolean; error?: string; code?: string } | null;
      if (!r.ok || !j?.ok) {
        if (j?.code === "scores_unavailable" || j?.code === "draws_unavailable") {
          setScoresAvailable(false);
          setResultForm((f) => ({ ...f, tracked: false, pick: f.pick === "draw" ? null : f.pick }));
        }
        Alert.alert("Error", j?.error ?? "Failed to save result.");
        return;
      }
      setResultOpen(false);
      invalidateMyRecord();
      Alert.alert(editing ? "Result updated" : "Result recorded!", editing ? "The score has been changed." : "Results and awards have been updated.");
      if (supabase && id) setPostedResult(await fetchPostedResult(supabase, id));
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
      Alert.alert("Rate players", "Pick a rating for at least one player before submitting.");
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
        Alert.alert("Error", j?.error ?? "Could not save ratings.");
        return;
      }

      if (j.tier_session_id) {
        setRun((cur) => (cur ? { ...cur, tier_session_id: j.tier_session_id! } : cur));
      }

      if (j.settled) {
        Alert.alert("Done!", "Player ratings have been updated.");
      } else {
        Alert.alert(
          "Ratings saved",
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
        message: `Join ${run?.title ?? "a Competitive Together session"} on ${fmtPickupSlotChipEt(run?.start_at, runTimeTbd(run))} — ${left} spot${left === 1 ? "" : "s"} left. Download Competitive Together: https://apps.apple.com/app/id6766061001`,
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
        message: `Join ${run?.title ?? "a Competitive Together session"} on ${fmtPickupSlotChipEt(run?.start_at, runTimeTbd(run))} — ${left} spot${left === 1 ? "" : "s"} left. Download Competitive Together: https://apps.apple.com/app/id6766061001`,
        url: `ctpickup://session/${id}`,
      });
    } catch {}
  }

  async function rsvp() {
    if (__DEV__ && fixture) {
      setToast({ id: Date.now(), text: "Preview game. Joining is off." });
      return;
    }
    if (rsvpBusy || !session?.access_token) return;
    const origin = siteOrigin();
    if (!origin) return;
    if (!ensurePhotoForGame()) return;
    setRsvpBusy(true);
    try {
      const r = await fetch(`${origin}/api/pickup/rsvp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ run_id: id, action: "join", checkout_return: "mobile" }),
      });
      const j = await r.json().catch(() => null) as { ok?: boolean; error?: string; checkout_url?: string; status?: string } | null;
      if (handlePhotoRequired(r.status, j)) return;
      if (!r.ok || !j?.ok) { Alert.alert("Error", j?.error ?? "Could not RSVP."); return; }

      // If checkout URL returned, open Stripe payment
      if (j?.checkout_url) {
        const { Linking } = await import("react-native");
        await Linking.openURL(j.checkout_url);
      }

      await load();
      if (j.status === "confirmed" && run) {
        setToast({
          id: Date.now(),
          text: runTimeTbd(run) ? "You're in. Time TBD; we'll let you know." : `You're in. See you at ${fmtPickupTimeEt(run.start_at)}.`,
        });
      } else if (j.status === "waitlist") {
        setToast({ id: Date.now(), text: "You're on the waitlist." });
      }
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
    return (
      <View style={s.center}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={themeColor().pitchText} size="large" />
      </View>
    );
  }

  if (!run) {
    return (
      <View style={s.center}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={s.errorText}>Session not found.</Text>
        <Pressable onPress={() => router.back()} style={s.backBtn}><Text style={s.backBtnText}>Go back</Text></Pressable>
      </View>
    );
  }

  const spotsLeft = run.capacity - run.spots_taken;
  const isFull = spotsLeft <= 0;
  const isJoined = myStatus === "confirmed" || myStatus === "pending_payment";
  const formatLabel = run.format?.trim() || null;
  const sessionStarted = (() => {
    if (runTimeTbd(run)) return false;
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
  const hostScoreLabel = isCompleted ? "Rate players" : "Rate session";

  const locationParts = (run.location_text ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  const fieldName = locationParts[0] || run.title || "Pickup game";
  const town = locationParts[1] ?? null;
  const miles = milesFromZip(myZip, run.latitude, run.longitude);
  const placeLine = [town, miles != null ? formatMiles(miles) : null].filter(Boolean).join(" · ");
  const fillPct = run.capacity > 0 ? Math.min(100, Math.max(0, (run.spots_taken / run.capacity) * 100)) : 0;
  const goingShown = attendees.slice(0, GOING_SHOWN);
  const goingExtra = attendees.length - goingShown.length;
  const avgStar = averageStars(attendees.map((a) => stars.get(a.user_id)));
  const hostName = host
    ? [host.first_name, host.last_name].filter(Boolean).join(" ").trim() || host.username || "Host"
    : null;

  const showJoinBar = !isHost && !isCompleted;
  const showFill = fixture
    ? fixture.fill != null
    : isHost && !sessionStarted && spotsLeft > 0 && OPEN_RUN_STATUSES.has(run.status);
  const join: { label: string; variant: "filled" | "outline"; onPress?: () => void } =
    myStatus === "confirmed"
      ? { label: "You're in · Leave", variant: "outline", onPress: () => void leaveSession() }
      : myStatus === "pending_payment"
        ? { label: "Payment pending · Leave", variant: "outline", onPress: () => void leaveSession() }
        : myStatus === "waitlist"
          ? { label: "On the waitlist", variant: "outline" }
          : isFull
            ? { label: "Full · Join waitlist", variant: "filled", onPress: () => void rsvp() }
            : { label: "Join game", variant: "filled", onPress: () => void rsvp() };
  const joinBarBottom = Math.max(insets.bottom, 12);
  const joinBarTotal = JOIN_BAR_HEIGHT + 12 + joinBarBottom;

  const menuItems: Array<{ key: string; label: string; icon: ComponentProps<typeof FontAwesome>["name"]; onPress: () => void }> = [
    { key: "share", label: "Share session", icon: "share", onPress: () => void shareSession() },
  ];
  if (isHost && !isCompleted) {
    menuItems.push({ key: "invite", label: "Invite players", icon: "user-plus", onPress: () => setInviteOpen(true) });
  }
  if (canEditPhoto) {
    menuItems.push({
      key: "photo",
      label: heroPhoto ? "Change field photo" : "Add field photo",
      icon: "camera",
      onPress: () => setPhotoEditorOpen(true),
    });
  }

  function runMenuItem(action: () => void) {
    setMenuOpen(false);
    // iOS cannot present a sheet while the menu modal is still dismissing.
    setTimeout(action, Platform.OS === "ios" ? 350 : 0);
  }

  // Half-star peer ratings: same window as the top-3 ballot, opened from a second row.
  const canRatePlayers = isJoined && !isHost && (isCompleted || sessionStarted);

  async function openPeerRatings() {
    const tid = await ensureTierSessionId();
    if (!tid) return;
    (router.push as (href: string) => void)(`/peer-ratings/${tid}`);
  }

  function openVoteModal() {
    setVoteStep(hasVoted && !hasPotdVoted ? 2 : 1);
    setVoteOpen(true);
  }

  return (
    <>
      <View style={s.screen}>
        <Stack.Screen options={{ headerShown: false }} />
        <View pointerEvents="none" style={[s.statusBand, { height: insets.top }]} />
        <ScrollView
          style={s.root}
          contentContainerStyle={{ paddingBottom: (showJoinBar ? joinBarTotal : insets.bottom) + 32 }}
        >
          <View>
            <PhotoHeader uri={heroPhoto} aspect="tall" chalkSize="md" accessibilityLabel="Field photo" />
            <View style={[s.heroBar, { top: insets.top + 8 }]}>
              <Pressable
                onPress={() => router.back()}
                style={s.heroBtn}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Go back"
              >
                <FontAwesome name="chevron-left" size={16} color={themeColor().onPhoto} />
              </Pressable>
              <Pressable
                onPress={() => setMenuOpen(true)}
                style={s.heroBtn}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Session options"
              >
                <FontAwesome name="ellipsis-h" size={18} color={themeColor().onPhoto} />
              </Pressable>
            </View>
            {!isCompleted ? <SpotsBadge spotsLeft={spotsLeft} style={s.heroBadge} /> : null}
          </View>

          <View style={s.body}>
            {canEditPhoto && photoEditorOpen ? (
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
                <Pressable onPress={() => setPhotoEditorOpen(false)} hitSlop={8} accessibilityRole="button">
                  <Text style={s.linkText}>Done</Text>
                </Pressable>
              </View>
            ) : null}

            <Text style={s.when}>{fmtPickupSlotChipEt(run.start_at, runTimeTbd(run))}</Text>
            <Text style={s.fieldName}>{fieldName}</Text>
            {placeLine ? <Text style={s.place}>{placeLine}</Text> : null}

            <View style={s.chipRow}>
              {formatLabel ? (
                <View style={s.chip}><Text style={s.chipText}>{formatLabel}</Text></View>
              ) : null}
              <View style={s.chip}><Text style={s.chipText}>{levelLabel(minStar)}</Text></View>
              {isCompleted ? (
                <View style={s.chipMuted}><Text style={s.chipMutedText}>Completed</Text></View>
              ) : null}
              {isHost ? (
                <View style={s.chipMuted}><Text style={s.chipMutedText}>You&apos;re hosting</Text></View>
              ) : null}
            </View>

            <View style={s.progressWrap}>
              <View style={s.progressTrack}>
                <View style={[s.progressFill, { width: `${fillPct}%` }]} />
              </View>
              <Text style={s.progressText}>{run.spots_taken}/{run.capacity} spots</Text>
            </View>

            {canVote ? (
              <Pressable
                onPress={openVoteModal}
                style={s.rateBanner}
                accessibilityRole="button"
                accessibilityLabel={voteBtnLabel}
              >
                <FontAwesome name="star" size={14} color={themeColor().onAccent} />
                <Text style={s.rateBannerText}>{voteBtnLabel}</Text>
              </Pressable>
            ) : null}

            {canRatePlayers ? (
              <Pressable
                onPress={() => void openPeerRatings()}
                style={s.hostRateBtn}
                accessibilityRole="button"
                accessibilityLabel="Rate players with half stars"
              >
                <FontAwesome name="star-half-o" size={14} color={themeColor().accent} />
                <Text style={s.hostRateBtnText}>Rate players</Text>
              </Pressable>
            ) : null}

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
                <Text style={s.hostRatedDoneText}>Host rated</Text>
              </View>
            )}

            {(isCompleted || sessionStarted) && isJoined && !isHost && hasVoted && (
              <View style={s.hostRatedDone}>
                <Text style={s.hostRatedDoneText}>Votes submitted</Text>
              </View>
            )}

            <View style={s.sectionHeaderRow}>
              <Text style={s.sectionHeading}>Going ({attendees.length})</Text>
              {avgStar != null ? <Text style={s.sectionMeta}>Avg level {formatStars(avgStar)}</Text> : null}
            </View>
            <PlayedWithRow summary={playedWith} style={s.playedWith} />
            {attendees.length === 0 ? (
              <Text style={s.emptyLine}>Nobody has joined yet.</Text>
            ) : (
              <View style={s.goingRow}>
                {goingShown.map((a) => {
                  const star = stars.get(a.user_id);
                  return (
                    <Pressable
                      key={a.user_id}
                      onPress={() => (router.push as (href: string) => void)(`/player/${a.user_id}`)}
                      style={s.goingItem}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${playerName(a)} profile`}
                    >
                      <PlayerAvatar
                        person={{
                          first_name: a.profiles?.first_name ?? null,
                          last_name: a.profiles?.last_name ?? null,
                          avatar_url: a.profiles?.avatar_url ?? null,
                        }}
                        size={44}
                      />
                      <Text style={s.goingName} numberOfLines={1}>
                        {a.profiles?.first_name?.trim() || playerName(a)}
                      </Text>
                      {star != null ? <Text style={s.goingStar}>{formatStars(star)}</Text> : null}
                    </Pressable>
                  );
                })}
                {goingExtra > 0 ? (
                  <View style={s.goingItem}>
                    <View style={s.moreBubble}><Text style={s.moreBubbleText}>+{goingExtra}</Text></View>
                  </View>
                ) : null}
              </View>
            )}

            <View style={s.infoCard}>
              {host && hostName ? (
                <View style={s.infoRow}>
                  <PlayerAvatar person={host} size={44} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.infoTitle} numberOfLines={1}>Hosted by {hostName}</Text>
                    {hostScore != null ? <Text style={s.infoSub}>Host score {hostScore}/100</Text> : null}
                  </View>
                  <Pressable
                    onPress={() => (router.push as (href: string) => void)(`/player/${host.id}`)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`View ${hostName} profile`}
                  >
                    <Text style={s.linkText}>View profile</Text>
                  </Pressable>
                </View>
              ) : null}
              <View style={[s.infoRow, host && hostName ? s.infoDivider : null]}>
                <FontAwesome name="ticket" size={16} color={themeColor().muted} />
                <Text style={[s.infoTitle, { flex: 1 }]}>{formatFee(run.fee_cents)}</Text>
              </View>
            </View>

            {showFill && id ? <FillYourGameCard runId={id} preview={fixture?.fill ?? null} /> : null}

            {isHost && !isCompleted && (
              <>
                <Text style={[s.sectionHeading, s.hostToolsHeading]}>Host tools</Text>
                <View style={{ gap: 8 }}>
                  <Pressable onPress={() => setInviteOpen(true)} style={s.inviteBtn}>
                    <FontAwesome name="user-plus" size={14} color={themeColor().onAccent} />
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
                  <Pressable onPress={() => openResult(postedResult ? "edit" : "record")} style={s.shareBtn}>
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
              </>
            )}

            {isCompleted && canEditScore && (
              <Pressable onPress={() => openResult("edit")} style={[s.shareBtn, { marginTop: 16 }]}>
                <FontAwesome name="pencil" size={14} color={themeColor().accent} />
                <Text style={s.shareBtnText}>Edit score</Text>
              </Pressable>
            )}

            {canHostScore && (
              <Pressable onPress={() => void openHostScore()} style={[s.voteBtn, { marginTop: isHost && !isCompleted ? 8 : 16 }]}>
                <FontAwesome name="star" size={14} color={themeColor().onAccent} />
                <Text style={s.voteBtnText}>{hostScoreLabel}</Text>
              </Pressable>
            )}
          </View>
        </ScrollView>

        {toast ? (
          <Toast
            key={toast.id}
            id={toast.id}
            message={toast.text}
            bottom={(showJoinBar ? joinBarTotal : insets.bottom) + 12}
          />
        ) : null}

        {showJoinBar ? (
          <View style={[s.joinBar, { paddingBottom: joinBarBottom }]}>
            <Pressable
              onPress={join.onPress}
              disabled={rsvpBusy || !join.onPress}
              accessibilityRole="button"
              accessibilityLabel={join.label}
              style={({ pressed }) => [
                join.variant === "filled" ? s.joinFilled : s.joinOutline,
                (pressed || rsvpBusy) && { opacity: 0.85 },
              ]}
            >
              {rsvpBusy ? (
                <ActivityIndicator color={join.variant === "filled" ? themeColor().onAccent : themeColor().accent} />
              ) : (
                <Text style={join.variant === "filled" ? s.joinFilledText : s.joinOutlineText}>{join.label}</Text>
              )}
            </Pressable>
          </View>
        ) : null}
      </View>

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={s.menuBackdrop} onPress={() => setMenuOpen(false)} accessibilityLabel="Close menu">
          <View
            style={[s.menuSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}
            onStartShouldSetResponder={() => true}
          >
            {menuItems.map((item) => (
              <Pressable
                key={item.key}
                onPress={() => runMenuItem(item.onPress)}
                style={({ pressed }) => [s.menuRow, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
              >
                <FontAwesome name={item.icon} size={16} color={themeColor().text} />
                <Text style={s.menuText}>{item.label}</Text>
              </Pressable>
            ))}
            <Pressable
              onPress={() => setMenuOpen(false)}
              style={({ pressed }) => [s.menuRow, s.menuCancel, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
            >
              <Text style={s.menuCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

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
          <Text style={s.voteSubtitle}>Give each player the rating that best reflects how they played today.</Text>

          <View style={s.tierLegend}>
            {RATING_OPTIONS.map((o) => (
              <View key={o.value} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <Text style={{ color: themeColor().text, fontWeight: "700", fontSize: 13, fontFamily: "Inter_700Bold", width: 36 }}>{o.label}</Text>
                <Text style={{ color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular" }}>{o.desc}</Text>
              </View>
            ))}
          </View>

          <View style={{ padding: 16, gap: 16 }}>
            {attendees.filter((a) => a.user_id !== myUserId).map((a) => {
              const name = playerName(a);
              const selected = scores[a.user_id] ?? "";
              return (
                <View key={a.user_id} style={s.scoreRow}>
                  <View style={s.avatar}><Text style={s.avatarText}>{playerInitials(a)}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.playerName}>{name}</Text>
                    <View style={{ flexDirection: "row", gap: 4, marginTop: 8 }}>
                      {RATING_OPTIONS.map((o) => (
                        <Pressable
                          key={o.value}
                          onPress={() => setScores((prev) => ({ ...prev, [a.user_id]: o.value }))}
                          accessibilityLabel={`${o.label} ${o.desc}`}
                          style={{
                            width: 40, height: 40, borderRadius: 999,
                            borderWidth: 2,
                            borderColor: selected === o.value ? themeColor().text : themeColor().muted,
                            backgroundColor: selected === o.value ? themeColor().overlaySubtle : "transparent",
                            alignItems: "center", justifyContent: "center",
                          }}
                        >
                          <Text style={{ color: selected === o.value ? themeColor().text : themeColor().muted, fontWeight: "800", fontSize: 13, fontFamily: "Inter_700Bold" }}>
                            {o.label}
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
            <Text style={s.modalTitle}>{resultMode === "edit" ? "Edit score" : "Record result"}</Text>
            <Pressable onPress={() => setResultOpen(false)} hitSlop={10}>
              <FontAwesome name="times" size={18} color={themeColor().muted} />
            </Pressable>
          </View>

          {resultMode === "record" ? (
            <>
              <View style={{ marginHorizontal: 16, marginTop: 12, marginBottom: 4, backgroundColor: themeColor().overlaySubtle, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: themeColor().line }}>
                <Text style={{ color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 }}>You cannot receive awards for sessions you host.</Text>
              </View>
              <View style={{ marginHorizontal: 16, marginTop: 8, marginBottom: 4, backgroundColor: themeColor().pitch, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: themeColor().pitch }}>
                <Text style={{ color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 }}>
                  Player of the Day is voted by attendees. Pick Defender, Midfielder, Attacker, and Goalie awards below.
                </Text>
              </View>
            </>
          ) : (
            <Text style={s.voteSubtitle}>
              {isAdmin ? "Admins can change the score anytime." : "You can change the score for 24 hours after posting."} Awards stay as posted.
            </Text>
          )}

          <View style={{ padding: 16, paddingTop: 8 }}>
            <ResultScoreFields value={resultForm} onChange={setResultForm} scoresAvailable={scoresAvailable} disabled={resultBusy} />
          </View>

          {resultMode === "record" && [
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

          <Pressable onPress={() => void submitResult()} disabled={resultBusy || !resultFormBody(resultForm, scoresAvailable).ok}
            style={[s.publishBtn, (resultBusy || !resultFormBody(resultForm, scoresAvailable).ok) && { opacity: 0.4 }, { margin: 16 }]}>
            {resultBusy ? <ActivityIndicator color={themeColor().onPitch} /> :
              <Text style={s.publishBtnText}>{resultMode === "edit" ? "Save score" : "Save result & awards"}</Text>}
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
  screen: { flex: 1, backgroundColor: themeColor().bg },
  statusBand: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 10, backgroundColor: themeColor().bg },
  root: { flex: 1, backgroundColor: themeColor().bg },
  body: { paddingHorizontal: 20, paddingTop: 16 },
  heroBar: { position: "absolute", left: 16, right: 16, flexDirection: "row", justifyContent: "space-between" },
  heroBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: themeColor().photoScrim, alignItems: "center", justifyContent: "center" },
  heroBadge: { position: "absolute", left: 16, bottom: 16 },
  when: { color: themeColor().pitchText, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  fieldName: { color: themeColor().text, fontSize: 32, ...headline, marginTop: 4 },
  place: { color: themeColor().muted, fontSize: 16, fontFamily: "Inter_400Regular", marginTop: 4 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 },
  chip: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: themeColor().pitchPanel },
  chipText: { color: themeColor().onPitchPanel, fontSize: 13, fontFamily: "Inter_600SemiBold" },
  chipMuted: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: themeColor().line },
  chipMutedText: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_600SemiBold" },
  progressWrap: { marginTop: 20, marginBottom: 16, gap: 8 },
  progressTrack: { height: 8, borderRadius: radius.pill, backgroundColor: themeColor().overlay, overflow: "hidden" },
  progressFill: { height: 8, borderRadius: radius.pill, backgroundColor: themeColor().accent },
  progressText: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_600SemiBold" },
  sectionHeaderRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: 16, marginBottom: 12 },
  sectionHeading: { color: themeColor().text, fontSize: 20, ...headline },
  playedWith: { marginBottom: 12 },
  sectionMeta: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_600SemiBold" },
  hostToolsHeading: { marginTop: 24, marginBottom: 12 },
  emptyLine: { color: themeColor().muted, fontSize: 14, fontFamily: "Inter_400Regular", paddingVertical: 8 },
  goingRow: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  goingItem: { width: 56, alignItems: "center", gap: 4 },
  goingName: { width: 56, color: themeColor().text, fontSize: 13, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  goingStar: { color: themeColor().muted, fontSize: 11, fontFamily: "Inter_600SemiBold" },
  moreBubble: { width: 44, height: 44, borderRadius: 22, backgroundColor: themeColor().line, alignItems: "center", justifyContent: "center" },
  moreBubbleText: { color: themeColor().text, fontSize: 14, fontFamily: "Inter_700Bold" },
  infoCard: { marginTop: 24, backgroundColor: themeColor().card, borderRadius: radius.card, borderWidth: 1, borderColor: themeColor().line, paddingHorizontal: 16 },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  infoDivider: { borderTopWidth: 1, borderTopColor: themeColor().line },
  infoTitle: { color: themeColor().text, fontSize: 16, fontFamily: "Inter_600SemiBold" },
  infoSub: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  linkText: { color: themeColor().accent, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  joinBar: { position: "absolute", left: 0, right: 0, bottom: 0, paddingTop: 12, paddingHorizontal: 20, backgroundColor: themeColor().bg, borderTopWidth: 1, borderTopColor: themeColor().line },
  joinFilled: { height: 52, borderRadius: radius.button, backgroundColor: themeColor().accent, alignItems: "center", justifyContent: "center" },
  joinFilledText: { color: themeColor().onAccent, fontSize: 16, fontFamily: "Inter_700Bold" },
  joinOutline: { height: 52, borderRadius: radius.button, borderWidth: 1, borderColor: themeColor().accent, alignItems: "center", justifyContent: "center" },
  joinOutlineText: { color: themeColor().accent, fontSize: 16, fontFamily: "Inter_700Bold" },
  toast: { position: "absolute", left: 20, right: 20, borderRadius: radius.button, paddingVertical: 12, paddingHorizontal: 16, backgroundColor: themeColor().text },
  toastText: { color: themeColor().bg, fontSize: 14, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  menuBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: themeColor().scrim },
  menuSheet: { backgroundColor: themeColor().card, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card, paddingTop: 8, paddingHorizontal: 20 },
  menuRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 16 },
  menuText: { color: themeColor().text, fontSize: 16, fontFamily: "Inter_500Medium" },
  menuCancel: { justifyContent: "center", borderTopWidth: 1, borderTopColor: themeColor().line },
  menuCancelText: { color: themeColor().muted, fontSize: 16, fontFamily: "Inter_600SemiBold" },
  center: { flex: 1, backgroundColor: themeColor().bg, alignItems: "center", justifyContent: "center", padding: 24 },
  errorText: { color: themeColor().muted, fontSize: 16, fontFamily: "Inter_400Regular" },
  photoControls: { marginBottom: 16, gap: 8 },
  rateBanner: {
    backgroundColor: themeColor().accent,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 12,
  },
  rateBannerText: { color: themeColor().onAccent, fontWeight: "800", fontSize: 16, fontFamily: "Inter_700Bold" },
  voteBtn: { backgroundColor: themeColor().accent, borderRadius: 12, paddingVertical: 16, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: 12 },
  voteBtnText: { color: themeColor().onAccent, fontWeight: "800", fontSize: 16, fontFamily: "Inter_700Bold" },
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
  inviteBtn: { backgroundColor: themeColor().accent, borderRadius: 12, paddingVertical: 16, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 },
  inviteBtnText: { color: themeColor().onAccent, fontWeight: "800", fontSize: 16, fontFamily: "Inter_700Bold" },
  shareBtn: { borderRadius: 12, paddingVertical: 12, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: themeColor().accent },
  shareBtnText: { color: themeColor().accent, fontWeight: "700", fontSize: 16, fontFamily: "Inter_700Bold" },
  endBtn: { borderRadius: 12, paddingVertical: 12, alignItems: "center", borderWidth: 1, borderColor: themeColor().coral },
  endBtnText: { color: themeColor().coralText, fontWeight: "700", fontSize: 16, fontFamily: "Inter_700Bold" },
  sectionTitle: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700", marginBottom: 8 },
  avatar: { width: 36, height: 36, borderRadius: 12, backgroundColor: themeColor().pitchPanel, alignItems: "center", justifyContent: "center" },
  avatarText: { color: themeColor().onPitchPanel, fontWeight: "700", fontSize: 16, fontFamily: "Inter_700Bold" },
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

