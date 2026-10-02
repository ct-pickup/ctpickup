import { useAuth } from "@/context/AuthContext";
import { fetchPublicPlayerProfile, type PublicPlayerProfile } from "@/lib/siteApi";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { useEffect, useLayoutEffect, useState } from "react";
import { themeColor, useThemedStyles } from "@/theme";
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

function initials(displayName: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase().slice(0, 2);
  const w = parts[0] ?? "?";
  return w.slice(0, 2).toUpperCase();
}

export default function PublicPlayerProfileScreen() {
  useThemedStyles(publish_styles);

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
            <FontAwesome name="instagram" size={18} color={themeColor().pitchText} />
            <Text style={styles.linkText}>@{ig}</Text>
          </Pressable>
        </View>
      ) : null}

      <Text style={styles.note}>Public info only contact details stay private.</Text>
    </ScrollView>
  );
}

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
  avatarImg: { width: 96, height: 96, borderRadius: 999, marginBottom: 14 },
  avatarPh: {
    width: 96,
    height: 96,
    borderRadius: 999,
    backgroundColor: themeColor().pitchPanel,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  avatarPhText: { fontSize: 32, fontFamily: "InstrumentSerif_400Regular", fontWeight: "800", color: themeColor().onPitchPanel },
  displayName: { fontSize: 24, fontFamily: "InstrumentSerif_400Regular", fontWeight: "700", color: themeColor().text, textAlign: "center" },
  username: { marginTop: 6, fontSize: 16, fontFamily: "Inter_400Regular", color: themeColor().muted },
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
    marginBottom: 6,
  },
  value: { fontSize: 16, fontFamily: "Inter_400Regular", color: themeColor().text },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  linkText: { fontSize: 16, fontFamily: "Inter_400Regular", color: themeColor().pitchText },
  note: { marginTop: 8, fontSize: 13, fontFamily: "Inter_400Regular", color: themeColor().muted, lineHeight: 18 },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}

