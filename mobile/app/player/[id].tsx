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

function tierLabel(tier: string | null, tierRank: number | null): string | null {
  if (tier && String(tier).trim()) return String(tier).trim();
  if (tierRank === null || tierRank === undefined) return null;
  const map: Record<number, string> = {
    1: "Tier 1A",
    2: "Tier 1B",
    3: "Tier 2",
    4: "Tier 3",
    5: "Tier 4",
    6: "Public",
  };
  return map[tierRank] ?? `Tier rank ${tierRank}`;
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
  const [awardCounts, setAwardCounts] = useState<{ potd: number; def: number; mid: number; att: number } | null>(null);

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
      const { data } = await supabase.from("profiles").select("nearest_venue").eq("id", userId).maybeSingle();
      if (cancelled) return;
      const v = data && typeof data === "object" ? (data as { nearest_venue?: unknown }).nearest_venue : null;
      setNearestVenue(typeof v === "string" ? v : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [isReady, supabase, userId]);

  useEffect(() => {
    if (!isReady || !supabase || !userId) return;
    let cancelled = false;
    void (async () => {
      setStatsLoading(true);
      const { data, error } = await supabase
        .from("pickup_run_team_assignments")
        .select(
          "team,run_id,pickup_run_results(winning_team,player_of_day,defender_of_day,midfielder_of_day,attacker_of_day)",
        )
        .eq("user_id", userId)
        .limit(2000);
      if (cancelled) return;
      if (error || !data) {
        setGames(null);
        setWins(null);
        setLosses(null);
        setWinRatePct(null);
        setAwardCounts(null);
        setStatsLoading(false);
        return;
      }
      let played = 0;
      let w = 0;
      let l = 0;
      let potd = 0;
      let def = 0;
      let mid = 0;
      let att = 0;

      for (const row of data as unknown as Array<{
        team: Team;
        pickup_run_results?: {
          winning_team: Team | null;
          player_of_day: string | null;
          defender_of_day: string | null;
          midfielder_of_day: string | null;
          attacker_of_day: string | null;
        } | null;
      }>) {
        const res = row.pickup_run_results;
        if (!res?.winning_team) continue;
        played += 1;
        if (row.team === res.winning_team) w += 1;
        else l += 1;
        if (res.player_of_day === userId) potd += 1;
        if (res.defender_of_day === userId) def += 1;
        if (res.midfielder_of_day === userId) mid += 1;
        if (res.attacker_of_day === userId) att += 1;
      }

      setGames(played);
      setWins(w);
      setLosses(l);
      setWinRatePct(played > 0 ? Math.round((w / played) * 100) : null);
      setAwardCounts({ potd, def, mid, att });
      setStatsLoading(false);
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

  const tier = tierLabel(profile.tier, profile.tier_rank);
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
        <Text style={styles.displayName}>{profile.display_name}</Text>
        {profile.username ? <Text style={styles.username}>@{profile.username}</Text> : null}
      </View>

      {tier ? (
        <View style={styles.block}>
          <Text style={styles.label}>Pickup tier</Text>
          <Text style={styles.value}>{tier}</Text>
        </View>
      ) : null}

      {profile.playing_position ? (
        <View style={styles.block}>
          <Text style={styles.label}>Position</Text>
          <Text style={styles.value}>{profile.playing_position}</Text>
        </View>
      ) : null}

      {profile.plays_goalie === true ? (
        <View style={styles.block}>
          <Text style={styles.label}>Goalie</Text>
          <Text style={styles.value}>Willing to play goalie</Text>
        </View>
      ) : null}

      {ig ? (
        <View style={styles.block}>
          <Text style={styles.label}>Instagram</Text>
          <Pressable
            onPress={() => void Linking.openURL(`https://instagram.com/${encodeURIComponent(ig)}`)}
            style={styles.linkRow}
          >
            <FontAwesome name="instagram" size={18} color={LIME} />
            <Text style={styles.linkText}>@{ig}</Text>
          </Pressable>
        </View>
      ) : null}

      {region ? (
        <View style={styles.block}>
          <Text style={styles.label}>Region</Text>
          <Text style={styles.value}>{region}</Text>
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
  displayName: { fontSize: 22, fontWeight: "700", color: "#fff", textAlign: "center" },
  username: { marginTop: 6, fontSize: 16, color: "rgba(255,255,255,0.55)" },
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

