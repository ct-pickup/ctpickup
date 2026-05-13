import { useAuth } from "@/context/AuthContext";
import { fetchPublicPlayerProfile, type PublicPlayerProfile } from "@/lib/siteApi";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { useEffect, useLayoutEffect, useState } from "react";
import {
  ActivityIndicator,
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

type Team = "A" | "B" | "C";

const VENUE_TO_REGION: Record<string, "CT" | "NY" | "NJ" | "MD"> = {
  // NJ
  "Sofive Meadowlands": "NJ",
  "Sofive Cherry Hill": "NJ",
  // NY
  "Sofive Brooklyn": "NY",
  "Hudson Sports Complex": "NY",
  "New Rochelle SoccerRoof": "NY",
  // MD
  "Sofive Rockville": "MD",
  "SoccerDome Jessup": "MD",
  "SoccerDome Harmans": "MD",
  // CT
  "New Haven SoccerRoof": "CT",
};

function regionFromVenue(venue: string | null): string | null {
  const v = (venue ?? "").trim();
  if (!v) return null;
  return VENUE_TO_REGION[v] ?? null;
}

function initials(displayName: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase().slice(0, 2);
  const w = parts[0] ?? "?";
  return w.slice(0, 2).toUpperCase();
}

export default function PlayerProfileScreen() {
  const { id: raw } = useLocalSearchParams<{ id: string | string[] }>();
  const userId = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : "";
  const navigation = useNavigation();
  const { session, supabase, isReady } = useAuth();
  const token = session?.access_token ?? null;

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [nameForTitle, setNameForTitle] = useState("Profile");
  const [profile, setProfile] = useState<PublicPlayerProfile | null>(null);

  const [nearestVenue, setNearestVenue] = useState<string | null>(null);

  const [statsLoading, setStatsLoading] = useState(false);
  const [games, setGames] = useState<number | null>(null);
  const [wins, setWins] = useState<number | null>(null);
  const [losses, setLosses] = useState<number | null>(null);
  const [winRatePct, setWinRatePct] = useState<number | null>(null);
  const [awardCounts, setAwardCounts] = useState<{ potd: number; gotd: number; def: number; mid: number; att: number } | null>(null);

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
        else setErr(r.error || "Couldn’t load profile.");
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
    if (!isReady || !supabase || !userId) return;
    let cancelled = false;
    void (async () => {
      setStatsLoading(true);
      try {
        const [{ data: profileData, error: profileErr }, { data: assignments, error: assignmentsError }] =
          await Promise.all([
            supabase
              .from("profiles")
              .select("nearest_venue, pickup_wins_count, pickup_losses_count")
              .eq("id", userId)
              .maybeSingle(),
            supabase.from("pickup_run_team_assignments").select("team,run_id").eq("user_id", userId).limit(2000),
          ]);

        if (cancelled) return;

        if (profileErr || !profileData) {
          setNearestVenue(null);
          setGames(null);
          setWins(null);
          setLosses(null);
          setWinRatePct(null);
        } else {
          const row = profileData as {
            nearest_venue?: unknown;
            pickup_wins_count?: unknown;
            pickup_losses_count?: unknown;
          };
          const v = row.nearest_venue;
          setNearestVenue(typeof v === "string" ? v : null);
          const w = Math.max(0, Math.trunc(Number(row.pickup_wins_count ?? 0)));
          const l = Math.max(0, Math.trunc(Number(row.pickup_losses_count ?? 0)));
          setWins(w);
          setLosses(l);
          const played = w + l;
          setGames(played);
          setWinRatePct(played > 0 ? Math.round((w / played) * 100) : null);
        }

        if (assignmentsError || !assignments) {
          setAwardCounts(null);
          return;
        }

        const rows = assignments as unknown as Array<{ team: Team; run_id: string }>;
        const runIds = Array.from(new Set(rows.map((r) => r.run_id).filter(Boolean)));
        if (runIds.length === 0) {
          setAwardCounts({ potd: 0, gotd: 0, def: 0, mid: 0, att: 0 });
          return;
        }

        // NOTE: Don't use Supabase relational selects here.
        // Both tables reference `pickup_runs.id` (via `run_id`), not each other.
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

        for (let i = 0; i < runIds.length; i += CHUNK) {
          const chunk = runIds.slice(i, i + CHUNK);
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
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isReady, supabase, userId]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: nameForTitle,
      headerStyle: { backgroundColor: BG },
      headerTintColor: "#fff",
      headerShadowVisible: false,
    });
  }, [navigation, nameForTitle]);

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
  const region = regionFromVenue(nearestVenue);

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

      <View style={styles.block}>
        <Text style={styles.label}>Tier</Text>
        {profile.tier ? (
          <Text style={styles.value}>
            {profile.tier}
            {profile.tier_rank != null ? ` · #${profile.tier_rank}` : ""}
          </Text>
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
      ) : !statsLoading && nearestVenue == null ? (
        <View style={styles.block}>
          <Text style={styles.label}>Region</Text>
          <Text style={styles.valueMuted}>No CT Pickup hub on file for this profile.</Text>
        </View>
      ) : null}

      <View style={styles.block}>
        <Text style={styles.label}>Stats</Text>
        {statsLoading ? (
          <Text style={styles.valueMuted}>Loading…</Text>
        ) : games == null ? (
          <Text style={styles.valueMuted}>—</Text>
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
              <Text style={styles.valueK}>🧤 Goalie of the Day</Text> {awardCounts.gotd}
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

      <Text style={styles.note}>Public info only. Contact details stay private.</Text>
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
  valueK: { color: "rgba(255,255,255,0.45)", fontWeight: "900" },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  linkText: { fontSize: 16, color: LIME },
  note: { marginTop: 8, fontSize: 13, color: "rgba(255,255,255,0.35)", lineHeight: 18 },
});

