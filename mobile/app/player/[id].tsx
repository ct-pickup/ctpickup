import { useAuth } from "@/context/AuthContext";
import { postPlayerProfileReportViaApi } from "@/lib/chatApi";
import { displayRegionNameFromZip } from "@/lib/zipRegion";
import { fetchPlayerFollowStats, fetchPublicPlayerProfile, togglePlayerFollow, type PublicPlayerProfile } from "@/lib/siteApi";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useLocalSearchParams, useNavigation, useRouter, type Href } from "expo-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useLayoutEffect, useState } from "react";
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

const LIME = "#a3e635";
const BG = "#0a0a0a";

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
  const { id: raw } = useLocalSearchParams<{ id: string | string[] }>();
  const userId = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : "";
  const navigation = useNavigation();
  const router = useRouter();
  const { session, supabase, isReady } = useAuth();
  const token = session?.access_token ?? null;
  const viewerId = session?.user?.id ?? null;
  const isOwnProfile = viewerId !== null && viewerId === userId;

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

  useEffect(() => {
    if (!userId || !token) {
      setLoading(false);
      setErr(!token ? "Sign in to view profiles." : "Missing player.");
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setErr(null);
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
              profileErr: profileErr?.message ?? null,
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
      headerStyle: { backgroundColor: BG },
      headerTintColor: "#fff",
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
              <FontAwesome name="cog" size={20} color="#fff" />
            </Pressable>
          )
        : undefined,
    });
  }, [navigation, nameForTitle, isOwnProfile, router]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={LIME} />
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

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        {profile.avatar_url ? (
          <Image source={{ uri: profile.avatar_url }} style={styles.avatarImg} />
        ) : (
          <View style={styles.avatarPh}>
            <Text style={styles.avatarPhText}>{initials(profile.display_name)}</Text>
          </View>
        )}
        <Text style={styles.heroLabel}>Full name</Text>
        <Text style={styles.displayName}>{profile.display_name}</Text>
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
            <FontAwesome name="instagram" size={18} color={LIME} />
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
              <Text style={styles.valueK}>Sessions</Text> {sessionsPlayed == null ? "—" : sessionsPlayed}
            </Text>
            <Text style={styles.valueLine}>
              <Text style={styles.valueK}>Tournaments</Text> {tournamentsPlayed == null ? "—" : tournamentsPlayed}
            </Text>
            {games == null ? (
              <>
                <Text style={styles.valueLine}>
                  <Text style={styles.valueK}>Games</Text> —
                </Text>
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
                  <Text style={styles.valueK}>Games</Text> {games}
                </Text>
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
                    🔥 {currentStreak} run streak
                  </Text>
                ) : currentStreak >= 1 ? (
                  <Text style={styles.streakHotWhite}>
                    🔥 {currentStreak} run streak
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
              <Text style={styles.valueK}>🏆 Player of the Day</Text> {awardCounts.potd}
            </Text>
            <Text style={styles.valueLine}>
              <Text style={styles.valueK}>🧤 Goalie of the Day</Text> {awardCounts.gotd}
            </Text>
            <Text style={styles.valueLine}>
              <Text style={styles.valueK}>🛡️ Defender of the Day</Text> {awardCounts.def}
            </Text>
            <Text style={styles.valueLine}>
              <Text style={styles.valueK}>🎯 Midfielder of the Day</Text> {awardCounts.mid}
            </Text>
            <Text style={styles.valueLine}>
              <Text style={styles.valueK}>⚡ Attacker of the Day</Text> {awardCounts.att}
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
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: BG },
  content: { padding: 20, paddingBottom: 40 },
  center: {
    flex: 1,
    backgroundColor: BG,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  errText: { color: "#fca5a5", fontSize: 15, textAlign: "center" },
  hero: { alignItems: "center", marginBottom: 28 },
  avatarImg: { width: 96, height: 96, borderRadius: 48, marginBottom: 14 },
  avatarPh: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "rgba(163,230,53,0.2)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  avatarPhText: { fontSize: 32, fontWeight: "800", color: LIME },
  heroLabel: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: "rgba(255,255,255,0.45)",
    marginBottom: 6,
  },
  displayName: { fontSize: 22, fontWeight: "700", color: "#fff", textAlign: "center" },
  followCountsMuted: {
    marginTop: 8,
    fontSize: 13,
    color: "rgba(255,255,255,0.45)",
    textAlign: "center",
  },
  followBtn: {
    marginTop: 14,
    alignSelf: "center",
    paddingVertical: 10,
    paddingHorizontal: 28,
    borderRadius: 10,
    backgroundColor: LIME,
  },
  followBtnText: { fontSize: 15, fontWeight: "800", color: "#0a0a0a" },
  followBtnFollowing: {
    marginTop: 14,
    alignSelf: "center",
    paddingVertical: 10,
    paddingHorizontal: 22,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    backgroundColor: "transparent",
  },
  followBtnFollowingText: { fontSize: 15, fontWeight: "700", color: "rgba(255,255,255,0.85)" },
  block: {
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: "rgba(255,255,255,0.45)",
    marginBottom: 6,
  },
  value: { fontSize: 16, color: "rgba(255,255,255,0.92)" },
  valueMuted: { fontSize: 16, color: "rgba(255,255,255,0.55)", fontWeight: "700" },
  valueLine: { fontSize: 15, color: "rgba(255,255,255,0.9)", fontWeight: "700", marginTop: 8 },
  streakHotLime: {
    marginTop: 10,
    fontSize: 17,
    fontWeight: "800",
    color: LIME,
  },
  streakHotWhite: {
    marginTop: 10,
    fontSize: 15,
    fontWeight: "700",
    color: "#fff",
  },
  streakBest: {
    marginTop: 6,
    fontSize: 12,
    color: "rgba(255,255,255,0.4)",
    fontWeight: "600",
  },
  valueK: { color: "rgba(255,255,255,0.45)", fontWeight: "900" },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  linkText: { fontSize: 16, color: LIME },
  h2hHairline: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.12)",
    marginVertical: 10,
  },
  h2hYouWon: { color: LIME },
  h2hYouWonK: { color: LIME },
  h2hTheyWon: { color: "rgba(255,255,255,0.55)" },
  h2hNeverFaced: { color: "rgba(255,255,255,0.55)", marginTop: 8 },
  note: { marginTop: 8, fontSize: 13, color: "rgba(255,255,255,0.35)", lineHeight: 18 },
  reportLink: {
    fontSize: 12,
    color: "rgba(255,255,255,0.38)",
    fontWeight: "500",
    textAlign: "center",
  },
});

