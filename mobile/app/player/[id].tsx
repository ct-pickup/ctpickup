import { useAuth } from "@/context/AuthContext";
import { postPlayerProfileReportViaApi } from "@/lib/chatApi";
import { displayRegionNameFromZip } from "@/lib/zipRegion";
import { fetchPlayerFollowStats, fetchPublicPlayerProfile, togglePlayerFollow, type PublicPlayerProfile } from "@/lib/siteApi";
import { siteOrigin } from "@/lib/env";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Stack, useLocalSearchParams, useNavigation, useRouter, type Href } from "expo-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useLayoutEffect, useState } from "react";
import { PhotoHeader } from "@/components/photo";
import { StarRating } from "@/components/StarRating";
import { fetchActionPhotoUrl } from "@/lib/photoUpload";
import { fetchPlayerCard, hostScore, topPercentLabel, type PlayerCard } from "@/lib/starRatings";
import { headline, themeColor, useThemedStyles } from "@/theme";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

type HostRatingAgg = {
  avg_overall: number | null;
  avg_field_secured: number | null;
  avg_organization: number | null;
  avg_player_quality: number | null;
  avg_safety: number | null;
  avg_would_play_again: number | null;
  total_ratings: number;
  sessions_hosted: number;
};

function fmtHostScore(avg: number | null): string {
  const n = hostScore(avg);
  return n == null ? "—" : String(n);
}

const PROFILE_REPORT_REASONS = [
  "Inappropriate profile",
  "Harassment or abuse",
  "Fake or impersonation",
  "Spam",
] as const;

type Team = "A" | "B" | "C";

function initials(displayName: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase().slice(0, 2);
  const w = parts[0] ?? "?";
  return w.slice(0, 2).toUpperCase();
}

type HeadToHeadStats = {
  sharedCount: number;
  facedOff: number;
  playedTogether: number;
  viewerWins: number;
  profileWins: number;
};

type H2hAssignRow = { run_id?: unknown; user_id?: unknown; team?: unknown };

async function fetchConfirmedRsvpRunIds(supabase: SupabaseClient, uid: string): Promise<string[] | null> {
  const RSVP_PAGE = 1000;
  const ids: string[] = [];
  for (let from = 0; ; from += RSVP_PAGE) {
    const { data: rpage, error } = await supabase
      .from("pickup_run_rsvps")
      .select("run_id")
      .eq("user_id", uid)
      .eq("status", "confirmed")
      .range(from, from + RSVP_PAGE - 1);
    if (error) return null;
    if (!rpage?.length) break;
    for (const row of rpage as { run_id?: unknown }[]) {
      const id = typeof row.run_id === "string" ? row.run_id : null;
      if (id) ids.push(id);
    }
    if (rpage.length < RSVP_PAGE) break;
  }
  return ids;
}

export default function PlayerProfileScreen() {
  useThemedStyles(publish_styles);

  const { id: raw } = useLocalSearchParams<{ id: string | string[] }>();
  const userId = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : "";
  const navigation = useNavigation();
  const router = useRouter();
  const { session, supabase, isReady } = useAuth();
  const token = session?.access_token ?? null;
  const viewerId = session?.user?.id ?? null;
  const isOwnProfile = viewerId !== null && viewerId === userId;
  const [actionPhotoUrl, setActionPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase || !userId) return;
    let cancelled = false;
    void fetchActionPhotoUrl(supabase, userId).then((url) => {
      if (!cancelled) setActionPhotoUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, userId]);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [nameForTitle, setNameForTitle] = useState("Profile");
  const [profile, setProfile] = useState<PublicPlayerProfile | null>(null);

  const [zipCode, setZipCode] = useState<string | null>(null);

  const [statsLoading, setStatsLoading] = useState(false);
  const [games, setGames] = useState<number | null>(null);
  const [wins, setWins] = useState<number | null>(null);
  const [losses, setLosses] = useState<number | null>(null);
  const [winRatePct, setWinRatePct] = useState<number | null>(null);
  const [sessionsPlayed, setSessionsPlayed] = useState<number | null>(null);
  const [tournamentsPlayed, setTournamentsPlayed] = useState<number | null>(null);
  const [awardCounts, setAwardCounts] = useState<{ potd: number; gotd: number; def: number; mid: number; att: number } | null>(null);
  const [currentStreak, setCurrentStreak] = useState<number | null>(null);
  const [longestStreak, setLongestStreak] = useState<number | null>(null);
  const [h2hLoading, setH2hLoading] = useState(false);
  const [headToHead, setHeadToHead] = useState<HeadToHeadStats | null>(null);

  const [followStatsLoading, setFollowStatsLoading] = useState(false);
  const [followersCount, setFollowersCount] = useState<number | null>(null);
  const [followingCount, setFollowingCount] = useState<number | null>(null);
  const [isFollowingThem, setIsFollowingThem] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [hostRating, setHostRating] = useState<HostRatingAgg | null>(null);
  const [card, setCard] = useState<PlayerCard | null>(null);

  useEffect(() => {
    setCard(null);
    if (!supabase || !userId) return;
    let cancelled = false;
    void fetchPlayerCard(supabase, userId).then((c) => {
      if (!cancelled) setCard(c);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, userId]);

  useEffect(() => {
    if (!userId || !token) {
      setLoading(false);
      setErr(!token ? "Sign in to view profiles." : "Missing player.");
      return;
    }
    // Reset synchronously so stale profile data never flashes during a re-fetch
    setProfile(null);
    setLoading(true);
    setErr(null);
    let cancelled = false;
    void (async () => {
      const r = await fetchPublicPlayerProfile(token, userId);
      if (cancelled) return;
      if (!r.ok) {
        setProfile(null);
        if (r.status === 404) setErr("Player not found or not visible.");
        else if (r.status === 403) setErr("You need an approved account to view profiles.");
        else {
          console.warn("[player profile] load failed", r.status, r.error);
          setErr("Something went wrong. Please try again.");
        }
      } else {
        setProfile(r.profile);
        setNameForTitle(r.profile.display_name || "Profile");
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, token]);

  useEffect(() => {
    if (!userId || !token) return;
    let cancelled = false;
    void (async () => {
      setFollowStatsLoading(true);
      const r = await fetchPlayerFollowStats(token, userId);
      if (cancelled) return;
      if (r.ok) {
        setFollowersCount(r.stats.followers_count);
        setFollowingCount(r.stats.following_count);
        setIsFollowingThem(r.stats.is_following);
      } else {
        setFollowersCount(null);
        setFollowingCount(null);
        setIsFollowingThem(false);
      }
      setFollowStatsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, token]);

  useEffect(() => {
    if (!userId) {
      setHostRating(null);
      return;
    }
    const origin = siteOrigin();
    if (!origin) {
      setHostRating(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const headers: Record<string, string> = {};
        if (token) headers.Authorization = `Bearer ${token}`;
        const r = await fetch(
          `${origin}/api/sessions/host-rating?host_id=${encodeURIComponent(userId)}`,
          { headers },
        );
        const j = (await r.json().catch(() => null)) as Partial<HostRatingAgg> | null;
        if (cancelled) return;
        if (!r.ok || !j) {
          setHostRating(null);
          return;
        }
        if ((j.total_ratings ?? 0) < 1) {
          setHostRating(null);
          return;
        }
        setHostRating({
          avg_overall: typeof j.avg_overall === "number" ? j.avg_overall : null,
          avg_field_secured: typeof j.avg_field_secured === "number" ? j.avg_field_secured : null,
          avg_organization: typeof j.avg_organization === "number" ? j.avg_organization : null,
          avg_player_quality: typeof j.avg_player_quality === "number" ? j.avg_player_quality : null,
          avg_safety: typeof j.avg_safety === "number" ? j.avg_safety : null,
          avg_would_play_again:
            typeof j.avg_would_play_again === "number" ? j.avg_would_play_again : null,
          total_ratings: Number(j.total_ratings ?? 0),
          sessions_hosted: Number(j.sessions_hosted ?? 0),
        });
      } catch {
        if (!cancelled) setHostRating(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, token]);

  useEffect(() => {
    if (!isReady || !supabase || !userId) return;
    let cancelled = false;
    void (async () => {
      setStatsLoading(true);
      setSessionsPlayed(null);
      setTournamentsPlayed(null);
      try {
        const [{ data: profileData, error: profileErr }, { data: assignments, error: assignmentsError }] =
          await Promise.all([
            supabase
              .from("profiles")
              .select("zip_code, pickup_wins_count, pickup_losses_count, current_streak, longest_streak")
              .eq("id", userId)
              .maybeSingle(),
            supabase.from("pickup_run_team_assignments").select("team,run_id").eq("user_id", userId).limit(2000),
          ]);

        if (cancelled) return;

        if (profileErr || !profileData) {
          setZipCode(null);
          setGames(null);
          setWins(null);
          setLosses(null);
          setWinRatePct(null);
          setCurrentStreak(null);
          setLongestStreak(null);
        } else {
          const row = profileData as {
            zip_code?: unknown;
            pickup_wins_count?: unknown;
            pickup_losses_count?: unknown;
            current_streak?: unknown;
            longest_streak?: unknown;
          };
          const z = row.zip_code;
          const zipRaw = typeof z === "string" ? z : z != null ? String(z) : null;
          setZipCode(zipRaw);
          if (__DEV__) {
            console.log("[player profile] profiles.zip_code", {
              userId,
              zipRaw,
              regionFromZip: zipRaw ? displayRegionNameFromZip(zipRaw) : null,
            });
          }
          const w = Math.max(0, Math.trunc(Number(row.pickup_wins_count ?? 0)));
          const l = Math.max(0, Math.trunc(Number(row.pickup_losses_count ?? 0)));
          setWins(w);
          setLosses(l);
          const played = w + l;
          setGames(played);
          setWinRatePct(played > 0 ? Math.round((w / played) * 100) : null);
          setCurrentStreak(Math.max(0, Math.trunc(Number(row.current_streak ?? 0))));
          setLongestStreak(Math.max(0, Math.trunc(Number(row.longest_streak ?? 0))));
        }

        const RSVP_PAGE = 1000;
        const rsvpRunIds: string[] = [];
        let rsvpFetchFailed = false;
        for (let from = 0; ; from += RSVP_PAGE) {
          const { data: rpage, error: rsvpErr } = await supabase
            .from("pickup_run_rsvps")
            .select("run_id")
            .eq("user_id", userId)
            .eq("status", "confirmed")
            .range(from, from + RSVP_PAGE - 1);
          if (cancelled) return;
          if (rsvpErr) {
            rsvpFetchFailed = true;
            break;
          }
          if (!rpage?.length) break;
          for (const row of rpage as { run_id?: unknown }[]) {
            const id = typeof row.run_id === "string" ? row.run_id : null;
            if (id) rsvpRunIds.push(id);
          }
          if (rpage.length < RSVP_PAGE) break;
        }
        if (!cancelled) {
          if (rsvpFetchFailed) {
            setSessionsPlayed(null);
          } else if (rsvpRunIds.length === 0) {
            setSessionsPlayed(0);
          } else {
            const uniqueRunIds = Array.from(new Set(rsvpRunIds));
            const CHUNK_RUNS = 250;
            const completedRunIds = new Set<string>();
            for (let i = 0; i < uniqueRunIds.length; i += CHUNK_RUNS) {
              const chunk = uniqueRunIds.slice(i, i + CHUNK_RUNS);
              const { data: runRows, error: runErr } = await supabase
                .from("pickup_runs")
                .select("id,status,is_completed")
                .in("id", chunk);
              if (cancelled) return;
              if (runErr || !runRows) continue;
              for (const r of runRows as { id?: unknown; status?: unknown; is_completed?: unknown }[]) {
                const id = typeof r.id === "string" ? r.id : null;
                if (!id) continue;
                const st = typeof r.status === "string" ? r.status.trim() : "";
                const done = r.is_completed === true || st === "completed";
                if (done) completedRunIds.add(id);
              }
            }
            const n = rsvpRunIds.filter((rid) => completedRunIds.has(rid)).length;
            setSessionsPlayed(n);
          }
        }

        const ROSTER_PAGE = 1000;
        const tournamentIds: string[] = [];
        let rosterFetchFailed = false;
        for (let from = 0; ; from += ROSTER_PAGE) {
          const { data: tpage, error: rosterErr } = await supabase
            .from("tournament_roster")
            .select("tournament_id")
            .eq("user_id", userId)
            .eq("status", "accepted")
            .range(from, from + ROSTER_PAGE - 1);
          if (cancelled) return;
          if (rosterErr) {
            rosterFetchFailed = true;
            break;
          }
          if (!tpage?.length) break;
          for (const row of tpage as { tournament_id?: unknown }[]) {
            const id = typeof row.tournament_id === "string" ? row.tournament_id : null;
            if (id) tournamentIds.push(id);
          }
          if (tpage.length < ROSTER_PAGE) break;
        }
        if (!cancelled) {
          if (rosterFetchFailed) setTournamentsPlayed(null);
          else setTournamentsPlayed(new Set(tournamentIds).size);
        }

        if (assignmentsError || !assignments) {
          setAwardCounts(null);
        } else {
          const rows = assignments as unknown as Array<{ team: Team; run_id: string }>;
          const assignRunIds = Array.from(new Set(rows.map((r) => r.run_id).filter(Boolean)));
          if (assignRunIds.length === 0) {
            setAwardCounts({ potd: 0, gotd: 0, def: 0, mid: 0, att: 0 });
          } else {
            const CHUNK = 250;
            const resultsByRunId = new Map<
              string,
              {
                winning_team: Team | null;
                player_of_day: string | null;
                goalie_of_the_day: string | null;
                defender_of_day: string | null;
                midfielder_of_day: string | null;
                attacker_of_day: string | null;
              }
            >();

            for (let i = 0; i < assignRunIds.length; i += CHUNK) {
              const chunk = assignRunIds.slice(i, i + CHUNK);
              const { data: resRows, error: resErr } = await supabase
                .from("pickup_run_results")
                .select("run_id,winning_team,player_of_day,goalie_of_the_day,defender_of_day,midfielder_of_day,attacker_of_day")
                .in("run_id", chunk);
              if (cancelled) return;
              if (resErr || !resRows) continue;
              for (const r of resRows as unknown as Array<{
                run_id: string;
                winning_team: Team | null;
                player_of_day: string | null;
                goalie_of_the_day: string | null;
                defender_of_day: string | null;
                midfielder_of_day: string | null;
                attacker_of_day: string | null;
              }>) {
                if (!r?.run_id) continue;
                resultsByRunId.set(r.run_id, {
                  winning_team: r.winning_team ?? null,
                  player_of_day: r.player_of_day ?? null,
                  goalie_of_the_day: r.goalie_of_the_day ?? null,
                  defender_of_day: r.defender_of_day ?? null,
                  midfielder_of_day: r.midfielder_of_day ?? null,
                  attacker_of_day: r.attacker_of_day ?? null,
                });
              }
            }

            let potd = 0;
            let gotd = 0;
            let def = 0;
            let mid = 0;
            let att = 0;

            for (const row of rows) {
              const res = resultsByRunId.get(row.run_id) ?? null;
              if (!res?.winning_team) continue;
              if (res.player_of_day === userId) potd += 1;
              if (res.goalie_of_the_day === userId) gotd += 1;
              if (res.defender_of_day === userId) def += 1;
              if (res.midfielder_of_day === userId) mid += 1;
              if (res.attacker_of_day === userId) att += 1;
            }

            if (!cancelled) setAwardCounts({ potd, gotd, def, mid, att });
          }
        }
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isReady, supabase, userId]);

  useEffect(() => {
    if (!isReady || !supabase || !userId || !viewerId || viewerId === userId) {
      setH2hLoading(false);
      setHeadToHead(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      setH2hLoading(true);
      setHeadToHead(null);
      try {
        const [profileRsvpIds, viewerRsvpIds] = await Promise.all([
          fetchConfirmedRsvpRunIds(supabase, userId),
          fetchConfirmedRsvpRunIds(supabase, viewerId),
        ]);
        if (cancelled) return;
        if (profileRsvpIds === null || viewerRsvpIds === null) {
          setHeadToHead(null);
          return;
        }
        const viewerSet = new Set(viewerRsvpIds);
        const intersection = Array.from(new Set(profileRsvpIds.filter((id) => viewerSet.has(id))));
        if (intersection.length === 0) {
          setHeadToHead(null);
          return;
        }

        const CHUNK_RUNS = 250;
        const completedSharedRunIds: string[] = [];
        for (let i = 0; i < intersection.length; i += CHUNK_RUNS) {
          const chunk = intersection.slice(i, i + CHUNK_RUNS);
          const { data: runRows, error: runErr } = await supabase
            .from("pickup_runs")
            .select("id")
            .in("id", chunk)
            .eq("is_completed", true);
          if (cancelled) return;
          if (runErr || !runRows) continue;
          for (const r of runRows as { id?: unknown }[]) {
            const id = typeof r.id === "string" ? r.id : null;
            if (id) completedSharedRunIds.push(id);
          }
        }
        if (cancelled) return;
        if (completedSharedRunIds.length === 0) {
          setHeadToHead(null);
          return;
        }

        const uniqueCompletedShared = Array.from(new Set(completedSharedRunIds));

        const profileTeamByRun = new Map<string, Team>();
        const viewerTeamByRun = new Map<string, Team>();
        const winningByRun = new Map<string, Team>();

        for (let i = 0; i < uniqueCompletedShared.length; i += CHUNK_RUNS) {
          const chunk = uniqueCompletedShared.slice(i, i + CHUNK_RUNS);
          const [{ data: rawAssignRows, error: assignErr }, { data: resRows, error: resErr }] = await Promise.all([
            supabase
              .from("pickup_run_team_assignments")
              .select("run_id,user_id,team")
              .in("run_id", chunk)
              .in("user_id", [userId, viewerId]),
            supabase.from("pickup_run_results").select("run_id,winning_team").in("run_id", chunk),
          ]);
          if (cancelled) return;
          if (!assignErr) {
            const assignRows: H2hAssignRow[] = Array.isArray(rawAssignRows) ? (rawAssignRows as H2hAssignRow[]) : [];
            for (const row of assignRows) {
              const rid = typeof row.run_id === "string" ? row.run_id : null;
              const uidRow = typeof row.user_id === "string" ? row.user_id : null;
              const tm = row.team === "A" || row.team === "B" || row.team === "C" ? row.team : null;
              if (!rid || !uidRow || !tm) continue;
              if (uidRow === userId) profileTeamByRun.set(rid, tm);
              else if (uidRow === viewerId) viewerTeamByRun.set(rid, tm);
            }
          }

          if (!resErr && resRows) {
            for (const row of resRows as { run_id?: unknown; winning_team?: unknown }[]) {
              const rid = typeof row.run_id === "string" ? row.run_id : null;
              const wt = row.winning_team === "A" || row.winning_team === "B" || row.winning_team === "C" ? row.winning_team : null;
              if (rid && wt) winningByRun.set(rid, wt);
            }
          }
        }

        if (cancelled) return;

        let facedOff = 0;
        let playedTogether = 0;
        let viewerWins = 0;
        let profileWins = 0;

        for (const runId of uniqueCompletedShared) {
          const pTeam = profileTeamByRun.get(runId);
          const vTeam = viewerTeamByRun.get(runId);
          if (!pTeam || !vTeam) continue;
          if (pTeam === vTeam) {
            playedTogether += 1;
            continue;
          }
          const wt = winningByRun.get(runId);
          if (!wt) continue;
          facedOff += 1;
          if (wt === vTeam) viewerWins += 1;
          else if (wt === pTeam) profileWins += 1;
        }

        setHeadToHead({
          sharedCount: uniqueCompletedShared.length,
          facedOff,
          playedTogether,
          viewerWins,
          profileWins,
        });
      } finally {
        if (!cancelled) setH2hLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isReady, supabase, userId, viewerId]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: nameForTitle,
      headerStyle: { backgroundColor: themeColor().bg },
      headerTintColor: themeColor().text,
      headerShadowVisible: false,
    });
  }, [navigation, nameForTitle]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={themeColor().pitchText} />
      </View>
    );
  }

  if (err || !profile) {
    return (
      <View style={styles.center}>
        <Text style={styles.errText}>{err ?? "Couldn’t load profile."}</Text>
      </View>
    );
  }

  const ig = profile.instagram?.replace(/^@/, "").trim();
  const regionFromApi = profile.region?.trim() || null;
  const regionFromZip = zipCode ? displayRegionNameFromZip(zipCode) : null;
  const region = regionFromApi ?? regionFromZip;

  function submitProfileReport(reason: string) {
    if (!token) return;
    void (async () => {
      const r = await postPlayerProfileReportViaApi(token, userId, reason);
      if (r.ok) Alert.alert("", "Report submitted. We'll review it shortly.");
      else Alert.alert("Couldn't send report", r.error);
    })();
  }

  const topPercent = topPercentLabel(card);
  const verified = !!profile.verification_level && profile.verification_level !== "self";

  return (
    <>
      <Stack.Screen
        options={{
          headerBackTitle: "",
          title: nameForTitle,
          headerStyle: { backgroundColor: themeColor().bg },
          headerTintColor: themeColor().text,
          headerShadowVisible: false,
          headerRight: isOwnProfile
            ? () => (
                <Pressable
                  onPress={() => router.push("/(tabs)/account")}
                  accessibilityRole="button"
                  accessibilityLabel="Account settings"
                  hitSlop={10}
                  style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1, paddingHorizontal: 12 })}
                >
                  <FontAwesome name="cog" size={20} color={themeColor().text} />
                </Pressable>
              )
            : undefined,
        }}
      />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      {actionPhotoUrl ? (
        <PhotoHeader uri={actionPhotoUrl} aspect="wide" style={styles.banner} accessibilityLabel="Action photo" />
      ) : null}
      <View style={styles.hero}>
        <View style={[styles.avatarContainer, actionPhotoUrl ? styles.avatarOverBanner : null]}>
          {profile.avatar_url ? (
            <Image source={{ uri: profile.avatar_url }} style={styles.avatarCircle} />
          ) : (
            <View style={[styles.avatarCircle, styles.avatarPlaceholder]}>
              <Text style={styles.avatarInitialsText}>{initials(profile.display_name)}</Text>
            </View>
          )}
        </View>
        <Text style={styles.heroLabel}>Full name</Text>
        <Text style={styles.displayName}>{profile.display_name}</Text>
        {verified ? (
          <View style={styles.verifiedBadge} accessibilityLabel="Verified">
            <FontAwesome name="check" size={12} color={themeColor().pitchText} />
            <Text style={styles.verifiedText}>Verified</Text>
          </View>
        ) : null}
        {followStatsLoading && followersCount == null && followingCount == null ? (
          <Text style={styles.followCountsMuted}>…</Text>
        ) : followersCount != null && followingCount != null ? (
          <Pressable
            onPress={() => {
              if (isOwnProfile) {
                router.push("/following" as Href);
              } else {
                router.push({ pathname: "/following", params: { profileId: userId } } as unknown as Href);
              }
            }}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="View followers and following"
          >
            <Text style={styles.followCountsMuted}>
              {followersCount} follower{followersCount === 1 ? "" : "s"} · {followingCount} following
            </Text>
          </Pressable>
        ) : !followStatsLoading ? (
          <Text style={styles.followCountsMuted}>—</Text>
        ) : null}
        {!isOwnProfile && token ? (
          <Pressable
            onPress={() => {
              if (followBusy || !token) return;
              void (async () => {
                setFollowBusy(true);
                const r = await togglePlayerFollow(token, userId);
                if (r.ok) {
                  setIsFollowingThem(r.following);
                  setFollowersCount(r.followers_count);
                }
                setFollowBusy(false);
              })();
            }}
            disabled={followBusy}
            style={({ pressed }) => [
              isFollowingThem ? styles.followBtnFollowing : styles.followBtn,
              { opacity: followBusy ? 0.6 : pressed ? 0.85 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={isFollowingThem ? "Unfollow" : "Follow"}
          >
            <Text style={isFollowingThem ? styles.followBtnFollowingText : styles.followBtnText}>
              {isFollowingThem ? "Unfollow" : "Follow"}
            </Text>
          </Pressable>
        ) : null}
      </View>



      {/* Soccer Background */}
      {(profile.primary_position || profile.experience_level || profile.club_name || profile.age || card) && (
        <View style={{ marginHorizontal: 16, marginBottom: 16, backgroundColor: themeColor().overlaySubtle, borderRadius: 12, borderWidth: 1, borderColor: themeColor().line, overflow: "hidden" }}>
          {card && (
            <View style={{ paddingHorizontal: 16, paddingVertical: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: themeColor().line }}>
              <Text style={{ color: themeColor().muted, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700", }}>Rating</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <StarRating value={card.star} provisional={card.provisional} size="md" />
                {topPercent ? (
                  <Text style={{ color: themeColor().muted, fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600" }}>
                    · {topPercent}
                  </Text>
                ) : null}
              </View>
            </View>
          )}
          {(profile.primary_position || profile.experience_level || profile.club_name || profile.age) ? (
          <View style={{ padding: 12, gap: 8 }}>
            {profile.primary_position && (
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={styles.label}>Position</Text>
                <Text style={styles.value}>
                  {profile.primary_position}{profile.secondary_positions?.length > 0 ? ` · ${profile.secondary_positions.join(" · ")}` : ""}
                </Text>
              </View>
            )}
            {profile.experience_level && (
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={styles.label}>Level</Text>
                <Text style={styles.value}>
                  {profile.experience_level === "hs_varsity" ? "HS Varsity" : profile.experience_level === "semi_pro" ? "Semi-Pro" : profile.experience_level.charAt(0).toUpperCase() + profile.experience_level.slice(1)}
                </Text>
              </View>
            )}
            {profile.age ? (
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={styles.label}>Age</Text>
                <Text style={styles.value}>{profile.age}</Text>
              </View>
            ) : null}
            {profile.club_name && (
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={styles.label}>Club</Text>
                <Text style={styles.value}>{profile.club_name}</Text>
              </View>
            )}
          </View>
          ) : null}
        </View>
      )}

      {hostRating && hostRating.total_ratings >= 1 ? (
        <View
          style={{
            marginHorizontal: 16,
            marginBottom: 16,
            backgroundColor: themeColor().overlaySubtle,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: themeColor().line,
            padding: 16,
          }}
        >
          <Text
            style={{
              color: themeColor().muted,
              fontSize: 13, fontFamily: "Inter_700Bold",
              fontWeight: "700",
              marginBottom: 12,
            }}
          >
            Host score
          </Text>
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4, marginBottom: 4 }}>
            <Text style={{ color: themeColor().text, fontSize: 40, ...headline }}>
              {fmtHostScore(hostRating.avg_overall)}
            </Text>
            <Text style={{ color: themeColor().muted, fontSize: 16, fontFamily: "Inter_600SemiBold", fontWeight: "600" }}>
              /100
            </Text>
          </View>
          <Text style={{ color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 12 }}>
            {hostRating.sessions_hosted} session{hostRating.sessions_hosted === 1 ? "" : "s"} hosted
          </Text>
          {(
            [
              { label: "Field", avg: hostRating.avg_field_secured },
              { label: "Organization", avg: hostRating.avg_organization },
              { label: "Player Quality", avg: hostRating.avg_player_quality },
              { label: "Safety", avg: hostRating.avg_safety },
            ] as const
          ).map((row) => (
            <View
              key={row.label}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingVertical: 4,
              }}
            >
              <Text style={{ color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 }}>
                {row.label}
              </Text>
              <Text style={{ color: themeColor().text, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700", textAlign: "right" }}>
                {fmtHostScore(row.avg)}
                <Text style={{ color: themeColor().muted, fontFamily: "Inter_400Regular", fontWeight: "400" }}>/100</Text>
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.block}>
        <Text style={styles.label}>Username</Text>
        {profile.username ? (
          <Text style={styles.value}>@{profile.username}</Text>
        ) : (
          <Text style={styles.valueMuted}>—</Text>
        )}
      </View>

      <View style={styles.block}>
        <Text style={styles.label}>Instagram</Text>
        {ig ? (
          <Pressable
            onPress={() => void Linking.openURL(`https://instagram.com/${encodeURIComponent(ig)}`)}
            style={styles.linkRow}
          >
            <FontAwesome name="instagram" size={18} color={themeColor().pitchText} />
            <Text style={styles.linkText}>@{ig}</Text>
          </Pressable>
        ) : (
          <Text style={styles.valueMuted}>—</Text>
        )}
      </View>

      <View style={styles.block}>
        <Text style={styles.label}>Position</Text>
        {profile.playing_position ? (
          <Text style={styles.value}>{profile.playing_position}</Text>
        ) : (
          <Text style={styles.valueMuted}>—</Text>
        )}
      </View>

      {profile.plays_goalie === true ? (
        <View style={styles.block}>
          <Text style={styles.label}>Goalie</Text>
          <Text style={styles.value}>Willing to play goalie</Text>
        </View>
      ) : null}

      {region ? (
        <View style={styles.block}>
          <Text style={styles.label}>Region</Text>
          <Text style={styles.value}>{region}</Text>
        </View>
      ) : !statsLoading && !region ? (
        <View style={styles.block}>
          <Text style={styles.label}>Region</Text>
          <Text style={styles.valueMuted}>No region on file.</Text>
        </View>
      ) : null}

      <View style={styles.block}>
        <Text style={styles.label}>Stats</Text>
        {statsLoading ? (
          <Text style={styles.valueMuted}>Loading…</Text>
        ) : (
          <>
            <Text style={styles.valueLine}>
              <Text style={styles.valueK}>Tournaments</Text> {tournamentsPlayed == null ? "—" : tournamentsPlayed}
            </Text>
            {/* Sessions from attended_count (authoritative pickup count) */}
            <Text style={styles.valueLine}>
              <Text style={styles.valueK}>Sessions</Text>{" "}
              {profile.attended_count != null ? profile.attended_count : "—"}
            </Text>
            {/* W/L record */}
            {games == null ? (
              <>
                <Text style={styles.valueLine}>
                  <Text style={styles.valueK}>Wins</Text> —
                </Text>
                <Text style={styles.valueLine}>
                  <Text style={styles.valueK}>Losses</Text> —
                </Text>
                <Text style={styles.valueLine}>
                  <Text style={styles.valueK}>Win rate</Text> —
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.valueLine}>
                  <Text style={styles.valueK}>Wins</Text> {wins ?? 0}
                </Text>
                <Text style={styles.valueLine}>
                  <Text style={styles.valueK}>Losses</Text> {losses ?? 0}
                </Text>
                <Text style={styles.valueLine}>
                  <Text style={styles.valueK}>Win rate</Text> {winRatePct == null ? "—" : `${winRatePct}%`}
                </Text>
              </>
            )}
            {!statsLoading && currentStreak != null && longestStreak != null ? (
              <>
                {currentStreak >= 5 ? (
                  <Text style={styles.streakHotLime}>
                    <FontAwesome name="fire" size={16} color={themeColor().pitchText} /> {currentStreak} run streak
                  </Text>
                ) : currentStreak >= 1 ? (
                  <Text style={styles.streakHotWhite}>
                    <FontAwesome name="fire" size={16} color={themeColor().text} /> {currentStreak} run streak
                  </Text>
                ) : null}
                {longestStreak > 0 ? (
                  <Text style={styles.streakBest}>Best streak: {longestStreak}</Text>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </View>

      <View style={styles.block}>
        <Text style={styles.label}>Awards</Text>
        {statsLoading ? (
          <Text style={styles.valueMuted}>Loading…</Text>
        ) : !awardCounts ? (
          <Text style={styles.valueMuted}>—</Text>
        ) : (
          <>
            <Text style={styles.valueLine}>
              <Text style={styles.valueK}>Player of the Day</Text> {awardCounts.potd}
            </Text>
            <Text style={styles.valueLine}>
              <Text style={styles.valueK}>Goalie of the Day</Text> {awardCounts.gotd}
            </Text>
            <Text style={styles.valueLine}>
              <Text style={styles.valueK}>Defender of the Day</Text> {awardCounts.def}
            </Text>
            <Text style={styles.valueLine}>
              <Text style={styles.valueK}>Midfielder of the Day</Text> {awardCounts.mid}
            </Text>
            <Text style={styles.valueLine}>
              <Text style={styles.valueK}>Attacker of the Day</Text> {awardCounts.att}
            </Text>
          </>
        )}
      </View>

      {!isOwnProfile && (h2hLoading || headToHead != null) ? (
        <View style={styles.block}>
          <View style={styles.h2hHairline} />
          <Text style={styles.label}>Head to Head</Text>
          <View style={styles.h2hHairline} />
          {h2hLoading ? (
            <Text style={styles.valueMuted}>Loading…</Text>
          ) : headToHead ? (
            headToHead.facedOff === 0 && headToHead.playedTogether > 0 ? (
              <>
                <Text style={styles.valueLine}>
                  <Text style={styles.valueK}>Played together</Text> {headToHead.playedTogether}{" "}
                  {headToHead.playedTogether === 1 ? "time" : "times"}
                </Text>
                <Text style={[styles.valueLine, styles.h2hNeverFaced]}>Never faced off</Text>
              </>
            ) : (
              <>
                <Text style={styles.valueLine}>
                  <Text style={styles.valueK}>Faced off</Text> {headToHead.facedOff}{" "}
                  {headToHead.facedOff === 1 ? "time" : "times"}
                </Text>
                <Text
                  style={[
                    styles.valueLine,
                    headToHead.viewerWins > 0 ? styles.h2hYouWon : null,
                  ]}
                >
                  <Text style={[styles.valueK, headToHead.viewerWins > 0 ? styles.h2hYouWonK : null]}>You won</Text>{" "}
                  {headToHead.viewerWins}
                </Text>
                <Text style={[styles.valueLine, styles.h2hTheyWon]}>
                  <Text style={[styles.valueK, styles.h2hTheyWon]}>They won</Text> {headToHead.profileWins}
                </Text>
                <Text style={styles.valueLine}>
                  <Text style={styles.valueK}>Played together</Text> {headToHead.playedTogether}{" "}
                  {headToHead.playedTogether === 1 ? "time" : "times"}
                </Text>
              </>
            )
          ) : null}
          <View style={styles.h2hHairline} />
        </View>
      ) : null}

      <Text style={styles.note}>Public info only. Contact details stay private.</Text>
      {!isOwnProfile && token ? (
        <Pressable
          onPress={() => {
            Alert.alert("Report player", "Why are you reporting this profile?", [
              ...PROFILE_REPORT_REASONS.map((label) => ({
                text: label,
                onPress: () => submitProfileReport(label),
              })),
              { text: "Cancel", style: "cancel" },
            ]);
          }}
          hitSlop={10}
          style={({ pressed }) => ({ marginTop: 20, opacity: pressed ? 0.7 : 1, alignSelf: "center" })}
          accessibilityRole="button"
          accessibilityLabel="Report this player"
        >
          <Text style={styles.reportLink}>⚑ Report this player</Text>
        </Pressable>
      ) : null}
    </ScrollView>
    </>
  );
}

const AVATAR_SIZE = 96;

function make_styles() {
  return StyleSheet.create({
  scroll: { flex: 1, backgroundColor: themeColor().bg },
  content: { padding: 20, paddingBottom: 40 },
  center: {
    flex: 1,
    backgroundColor: themeColor().bg,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  errText: { color: themeColor().coralText, fontSize: 16, fontFamily: "Inter_400Regular", textAlign: "center" },
  hero: { alignItems: "center", marginBottom: 28 },
  banner: { marginTop: -20, marginHorizontal: -20 },
  avatarOverBanner: { marginTop: -AVATAR_SIZE / 2 },

  avatarContainer: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    marginBottom: 12,
  },
  avatarCircle: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    borderWidth: 1,
    borderColor: themeColor().line,
  },
  avatarPlaceholder: {
    backgroundColor: themeColor().overlaySubtle,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitialsText: { fontSize: 24, ...headline, color: themeColor().text },
  heroLabel: {
    marginTop: 4,
    fontSize: 13, fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: themeColor().muted,
    marginBottom: 4,
  },
  displayName: { fontSize: 24, ...headline, color: themeColor().text, textAlign: "center" },
  verifiedBadge: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
  verifiedText: { fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: themeColor().pitchText },
  followCountsMuted: {
    marginTop: 8,
    fontSize: 13, fontFamily: "Inter_400Regular",
    color: themeColor().muted,
    textAlign: "center",
  },
  followBtn: {
    marginTop: 12,
    alignSelf: "center",
    paddingVertical: 8,
    paddingHorizontal: 28,
    borderRadius: 10,
    backgroundColor: themeColor().pitch,
  },
  followBtnText: { fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "800", color: themeColor().onPitch },
  followBtnFollowing: {
    marginTop: 12,
    alignSelf: "center",
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: "transparent",
  },
  followBtnFollowingText: { fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700", color: themeColor().text },
  block: {
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: themeColor().line,
  },
  label: {
    fontSize: 13, fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: themeColor().muted,
    marginBottom: 4,
  },
  value: { fontSize: 16, fontFamily: "Inter_400Regular", color: themeColor().text },
  valueMuted: { fontSize: 16, fontFamily: "Inter_700Bold", color: themeColor().muted, fontWeight: "700" },
  valueLine: { fontSize: 16, fontFamily: "Inter_700Bold", color: themeColor().text, fontWeight: "700", marginTop: 8 },
  streakHotLime: {
    marginTop: 8,
    fontSize: 16, fontFamily: "Inter_700Bold",
    fontWeight: "800",
    color: themeColor().pitchText,
  },
  streakHotWhite: {
    marginTop: 8,
    fontSize: 16, fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: themeColor().text,
  },
  streakBest: {
    marginTop: 4,
    fontSize: 13, fontFamily: "Inter_600SemiBold",
    color: themeColor().muted,
    fontWeight: "600",
  },
  valueK: { color: themeColor().muted, fontWeight: "900" },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  linkText: { fontSize: 16, fontFamily: "Inter_400Regular", color: themeColor().accent },
  h2hHairline: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: themeColor().overlay,
    marginVertical: 8,
  },
  h2hYouWon: { color: themeColor().pitchText },
  h2hYouWonK: { color: themeColor().pitchText },
  h2hTheyWon: { color: themeColor().muted },
  h2hNeverFaced: { color: themeColor().muted, marginTop: 8 },
  note: { marginTop: 8, fontSize: 13, fontFamily: "Inter_400Regular", color: themeColor().muted, lineHeight: 18 },
  reportLink: {
    fontSize: 13, fontFamily: "Inter_500Medium",
    color: themeColor().muted,
    fontWeight: "500",
    textAlign: "center",
  },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}


