import AsyncStorage from "@react-native-async-storage/async-storage";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import PlayerAvatar from "@/components/PlayerAvatar";
import { PhotoHeader, PhotoUploadField } from "@/components/photo";
import ProfileShareCard, { type ProfileShareData } from "@/components/profile/ProfileShareCard";
import { StarLevelsSheet } from "@/components/StarLevels";
import { StarRating } from "@/components/StarRating";
import { useAuth } from "@/context/AuthContext";
import { useProfileAdmin } from "@/context/ProfileAdminContext";
import { useAvatarPhoto } from "@/hooks/useAvatarPhoto";
import { useHubVenueResolve } from "@/hooks/useHubVenueResolve";
import { fetchActionPhotoUrl } from "@/lib/photoUpload";
import { positionAbbreviation, positionTownLine, townFromZip } from "@/lib/playerIdentity";
import { fetchMyRecord, winPercent } from "@/lib/playerRecord";
import { canShareStory, shareStoryImage } from "@/lib/shareStory";
import { fetchPlayerCard, topPercentLabel, type PlayerCard } from "@/lib/starRatings";
import { profileName, radius, themeColor, useThemedStyles } from "@/theme";

const SHARE_READY_TIMEOUT_MS = 4000;
const STATS_CACHE_KEY = "cached_profile_stats.v2";
const AVATAR_SIZE = 96;

type ProfileRow = {
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  primary_position: string | null;
  playing_position: string | null;
  zip_code: string | null;
  nearest_venue: string | null;
  max_drive_minutes: number | null;
  verification_level: string | null;
};

const PROFILE_SELECT =
  "first_name,last_name,username,primary_position,playing_position,zip_code,nearest_venue,max_drive_minutes,verification_level";

type ProfileStats = { games: number; winPct: number | null; potd: number };

// Last loaded card and stats, so re-mounts render instantly.
let _cachedCard: PlayerCard | null | undefined;
let _cachedStats: ProfileStats | null = null;

export default function ProfileScreen() {
  useThemedStyles(publish_s);

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, supabase, isReady } = useAuth();
  const { isReady: profileAdminReady } = useProfileAdmin();
  const accessToken = session?.access_token ?? null;
  const uid = session?.user?.id ?? null;

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [card, setCard] = useState<PlayerCard | null | undefined>(_cachedCard);
  const [stats, setStats] = useState<ProfileStats | null>(_cachedStats);
  const [actionPhotoUrl, setActionPhotoUrl] = useState<string | null>(null);
  const { avatarUrl, setAvatarUrl, avatarUploading, pickAndUploadAvatar } = useAvatarPhoto();
  const [editing, setEditing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [levelsOpen, setLevelsOpen] = useState(false);

  useHubVenueResolve(profile, (venue) => setProfile((p) => (p ? { ...p, nearest_venue: venue } : p)));

  const loadProfile = useCallback(async () => {
    if (!isReady || !supabase || !uid) return;
    const [profileRes, avatarRes, photo] = await Promise.all([
      supabase.from("profiles").select(PROFILE_SELECT).eq("id", uid).maybeSingle(),
      supabase.from("profiles").select("avatar_url").eq("id", uid).maybeSingle(),
      fetchActionPhotoUrl(supabase, uid),
    ]);
    if (profileRes.error) {
      console.error("[profile] load error", JSON.stringify(profileRes.error));
    } else {
      setProfile((profileRes.data as ProfileRow | null) ?? null);
    }
    if (!avatarRes.error && avatarRes.data) {
      setAvatarUrl((avatarRes.data as { avatar_url: string | null }).avatar_url?.trim() || null);
    }
    setActionPhotoUrl(photo);
  }, [isReady, supabase, uid, setAvatarUrl]);

  const loadStats = useCallback(async () => {
    if (!isReady || !supabase || !uid) return;
    try {
      const [nextCard, record] = await Promise.all([
        fetchPlayerCard(supabase, uid),
        accessToken ? fetchMyRecord(accessToken) : Promise.resolve(null),
      ]);
      _cachedCard = nextCard;
      setCard(nextCard);
      if (record) {
        const next = { games: record.games, winPct: winPercent(record), potd: record.potd_count };
        _cachedStats = next;
        setStats(next);
        AsyncStorage.setItem(STATS_CACHE_KEY, JSON.stringify(next)).catch(() => {});
      }
    } catch (e) {
      console.error("[profile] loadStats exception", e);
    }
  }, [isReady, supabase, uid, accessToken]);

  useEffect(() => {
    AsyncStorage.multiRemove(["cached_tier_info", "cached_rating_info", "cached_record_stats"]).catch(() => {});
    if (_cachedStats) return;
    AsyncStorage.getItem(STATS_CACHE_KEY)
      .then((raw) => {
        if (!raw) return;
        const parsed = JSON.parse(raw) as Partial<ProfileStats>;
        if (typeof parsed.games === "number" && typeof parsed.potd === "number") {
          setStats({ games: parsed.games, winPct: parsed.winPct ?? null, potd: parsed.potd });
        }
      })
      .catch(() => {});
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadProfile();
      void loadStats();
    }, [loadProfile, loadStats]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadProfile(), loadStats()]);
    } finally {
      setRefreshing(false);
    }
  }, [loadProfile, loadStats]);

  const saveActionPhoto = useCallback(
    async (url: string | null) => {
      if (!supabase || !uid) throw new Error("Please sign in again.");
      const { error } = await supabase.from("profiles").update({ action_photo_url: url }).eq("id", uid);
      if (error) throw new Error(error.message || "Could not save the action photo.");
      setActionPhotoUrl(url);
    },
    [supabase, uid],
  );

  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void canShareStory().then((ok) => {
      if (!cancelled) setCanShare(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const cardRef = useRef<View>(null);
  const [cardReady, setCardReady] = useState(false);
  const [sharing, setSharing] = useState(false);
  const onCardReady = useCallback(() => setCardReady(true), []);
  useEffect(() => {
    setCardReady(false);
    const t = setTimeout(() => setCardReady(true), SHARE_READY_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [actionPhotoUrl]);

  const onShare = useCallback(async () => {
    if (!cardRef.current) return;
    setSharing(true);
    try {
      await shareStoryImage(cardRef, "Share my card");
    } catch (e) {
      console.warn("[profile] share failed:", e);
      Alert.alert("Couldn't share", "Please try again.");
    } finally {
      setSharing(false);
    }
  }, []);

  if (!isReady || !profileAdminReady || !session?.user?.email) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={themeColor().text} />
      </View>
    );
  }

  const fullName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() ||
    (profile?.username ? `@${profile.username}` : "Player");
  const positionTown = positionTownLine(
    positionAbbreviation(profile?.primary_position, profile?.playing_position),
    townFromZip(profile?.zip_code),
  );
  const topPct = topPercentLabel(card);
  const verified = !!profile?.verification_level && profile.verification_level !== "self";
  const winPct = stats?.winPct ?? null;

  const shareData: ProfileShareData = {
    name: fullName,
    star: card?.star ?? null,
    starProvisional: card?.provisional === true,
    positionTown,
    games: stats?.games ?? 0,
    winPct,
    potd: stats?.potd ?? 0,
    photo: actionPhotoUrl,
  };

  return (
    <View style={s.screen}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={themeColor().pitchText} />
        }
      >
        {/* 1. Hero */}
        <View>
          {actionPhotoUrl ? (
            <PhotoHeader uri={actionPhotoUrl} aspect="wide" accessibilityLabel="Action photo" />
          ) : (
            <View style={s.bannerFallback} />
          )}
          <View style={[s.heroBar, { top: insets.top + 8 }]}>
            <Pressable
              onPress={() => setEditing((v) => !v)}
              hitSlop={10}
              style={({ pressed }) => [s.heroBtn, pressed && s.pressed]}
              accessibilityRole="button"
              accessibilityLabel={editing ? "Done editing" : "Edit photos"}
            >
              <Text style={s.heroBtnText}>{editing ? "Done" : "Edit"}</Text>
            </Pressable>
            <Pressable
              onPress={() => (router.push as (href: string) => void)("/settings")}
              hitSlop={10}
              style={({ pressed }) => [s.heroBtn, pressed && s.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Settings"
            >
              <FontAwesome name="cog" size={18} color={themeColor().onPhoto} />
            </Pressable>
          </View>
          <Pressable
            onPress={editing ? pickAndUploadAvatar : undefined}
            disabled={!editing || avatarUploading}
            style={s.avatarWrap}
            accessibilityRole={editing ? "button" : undefined}
            accessibilityLabel={editing ? "Change profile photo" : undefined}
          >
            <PlayerAvatar
              person={{ first_name: profile?.first_name ?? null, last_name: profile?.last_name ?? null, avatar_url: avatarUrl }}
              size={AVATAR_SIZE}
              ringColor={themeColor().bg}
            />
            {avatarUploading ? (
              <View style={s.avatarBusy}>
                <ActivityIndicator color={themeColor().onPhoto} />
              </View>
            ) : null}
            {editing ? (
              <View style={s.cameraBadge}>
                <FontAwesome name="camera" size={12} color={themeColor().onPitch} />
              </View>
            ) : null}
          </Pressable>
          {editing ? (
            <View style={s.editPanel}>
              <PhotoUploadField
                bucket="action-photos"
                name="action"
                label="Banner photo"
                hint="A shot of you playing. Tap your avatar to change your profile photo."
                aspect="wide"
                preview={false}
                value={actionPhotoUrl}
                onChange={saveActionPhoto}
              />
            </View>
          ) : null}
        </View>

        <View style={s.body}>
          {/* 2. Identity */}
          <View>
            <Text style={s.name} numberOfLines={2}>
              {fullName}
            </Text>
            {positionTown ? <Text style={s.positionTown}>{positionTown}</Text> : null}
            {card ? (
              <Pressable
                onPress={() => setLevelsOpen(true)}
                accessibilityRole="button"
                accessibilityHint="Shows what each star level means"
                style={({ pressed }) => [s.ratingLine, pressed && s.pressed]}
              >
                <StarRating value={card.star} provisional={card.provisional} size="md" />
                {topPct ? <Text style={s.ratingMeta}>{topPct}</Text> : null}
                {verified ? (
                  <View style={s.verifiedChip}>
                    <FontAwesome name="check" size={10} color={themeColor().onPitchPanel} />
                    <Text style={s.verifiedText}>Verified</Text>
                  </View>
                ) : null}
                <FontAwesome name="question-circle-o" size={15} color={themeColor().muted} />
              </Pressable>
            ) : null}
          </View>

          <StarLevelsSheet visible={levelsOpen} onClose={() => setLevelsOpen(false)} />

          {/* 3. Stats */}
          <View style={s.statsRow}>
            <Stat value={String(stats?.games ?? 0)} label="Games" />
            <Stat value={winPct == null ? "—" : `${winPct}%`} label="Win %" />
            <Stat value={String(stats?.potd ?? 0)} label="POTD" />
          </View>

          {/* 4. Share */}
          {canShare ? (
            <Pressable
              onPress={() => void onShare()}
              disabled={sharing || !cardReady}
              style={({ pressed }) => [s.shareBtn, (pressed || sharing || !cardReady) && s.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Share my player card"
            >
              {sharing ? (
                <ActivityIndicator color={themeColor().accent} />
              ) : (
                <Text style={s.shareBtnText}>Share my card</Text>
              )}
            </Pressable>
          ) : null}
        </View>
      </ScrollView>

      {canShare ? (
        <View style={s.offscreen} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <ProfileShareCard ref={cardRef} data={shareData} onReady={onCardReady} />
        </View>
      ) : null}
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function make_s() {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: themeColor().bg },
    center: { flex: 1, backgroundColor: themeColor().bg, justifyContent: "center", alignItems: "center" },
    bannerFallback: { aspectRatio: 16 / 9, backgroundColor: themeColor().pitchPanel },
    heroBar: {
      position: "absolute",
      left: 16,
      right: 16,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    heroBtn: {
      minWidth: 36,
      height: 36,
      paddingHorizontal: 12,
      borderRadius: radius.pill,
      backgroundColor: themeColor().photoScrim,
      alignItems: "center",
      justifyContent: "center",
    },
    heroBtnText: { color: themeColor().onPhoto, fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    pressed: { opacity: 0.7 },
    avatarWrap: { marginTop: -AVATAR_SIZE / 2, marginLeft: 20, width: AVATAR_SIZE, height: AVATAR_SIZE },
    avatarBusy: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      borderRadius: AVATAR_SIZE / 2,
      backgroundColor: themeColor().scrim,
      alignItems: "center",
      justifyContent: "center",
    },
    cameraBadge: {
      position: "absolute",
      right: 2,
      bottom: 2,
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: themeColor().pitch,
      borderWidth: 2,
      borderColor: themeColor().bg,
      alignItems: "center",
      justifyContent: "center",
    },
    editPanel: { paddingHorizontal: 20, paddingTop: 12 },
    body: { paddingHorizontal: 20, paddingTop: 12, gap: 24 },
    name: { ...profileName, color: themeColor().text },
    positionTown: { marginTop: 4, color: themeColor().muted, fontSize: 15, fontFamily: "Inter_500Medium", fontWeight: "500" },
    ratingLine: { marginTop: 12, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
    ratingMeta: { color: themeColor().muted, fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    verifiedChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: radius.pill,
      backgroundColor: themeColor().pitchPanel,
    },
    verifiedText: { color: themeColor().onPitchPanel, fontSize: 11, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    statsRow: { flexDirection: "row" },
    stat: { flex: 1 },
    statValue: { ...profileName, color: themeColor().text },
    statLabel: { marginTop: 4, color: themeColor().muted, fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    shareBtn: {
      paddingVertical: 14,
      borderRadius: radius.button,
      borderWidth: 1.5,
      borderColor: themeColor().accent,
      alignItems: "center",
    },
    shareBtnText: { color: themeColor().accent, fontSize: 16, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    offscreen: { position: "absolute", top: 0, left: -10000 },
  });
}
let s = make_s();
function publish_s() {
  s = make_s();
}
