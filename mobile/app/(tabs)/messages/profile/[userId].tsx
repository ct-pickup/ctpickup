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

export default function PublicPlayerProfileScreen() {
  const { userId: raw } = useLocalSearchParams<{ userId: string | string[] }>();
  const userId = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : "";
  const navigation = useNavigation();
  const { session } = useAuth();
  const token = session?.access_token ?? null;

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [nameForTitle, setNameForTitle] = useState("Profile");
  const [profile, setProfile] = useState<PublicPlayerProfile | null>(null);

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

  useLayoutEffect(() => {
    navigation.setOptions({
      title: nameForTitle,
      headerStyle: { backgroundColor: "#0a0a0a" },
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

      <Text style={styles.note}>Public info only — contact details stay private.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: "#0a0a0a" },
  content: { padding: 20, paddingBottom: 40 },
  center: {
    flex: 1,
    backgroundColor: "#0a0a0a",
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
  linkRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  linkText: { fontSize: 16, color: LIME },
  note: { marginTop: 8, fontSize: 13, color: "rgba(255,255,255,0.35)", lineHeight: 18 },
});
