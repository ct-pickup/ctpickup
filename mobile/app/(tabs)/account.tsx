import AsyncStorage from "@react-native-async-storage/async-storage";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PhotoUploadField } from "@/components/photo";
import BadgeShelf from "@/components/profile/BadgeShelf";
import FormPills from "@/components/profile/FormPills";
import PlayerCard, { type PlayerCardData } from "@/components/profile/PlayerCard";
import ProfileCard from "@/components/profile/ProfileCard";
import { SeasonCard } from "@/components/season/SeasonCard";
import CtPlusPaywall from "@/components/ctplus/CtPlusPaywall";
import ShareCardSheet from "@/components/ctplus/ShareCardSheet";
import { useCtPlus } from "@/context/CtPlusContext";
import { CTPLUS_ENABLED } from "@/lib/ctplus/config";
import PositionPitch from "@/components/profile/PositionPitch";
import { tabBarContentPadding } from "@/lib/tabBar";
import { StarLevelsSheet } from "@/components/StarLevels";
import { useAuth } from "@/context/AuthContext";
import { useProfileAdmin } from "@/context/ProfileAdminContext";
import { useAvatarPhoto } from "@/hooks/useAvatarPhoto";
import { useHubVenueResolve } from "@/hooks/useHubVenueResolve";
import type { PlayerOutcome } from "@/lib/pickup/resultOutcome";
import { primaryPitchSpot, type PitchSpot } from "@/lib/pitchPosition";
import { fetchActionPhotoUrl } from "@/lib/photoUpload";
import { fetchMyBadges, unearnedBadges, type ProfileBadge } from "@/lib/playerBadges";
import { positionAbbreviation, positionTownLine, townFromZip } from "@/lib/playerIdentity";
import { fetchMyRecord, winPercent } from "@/lib/playerRecord";
import { canShareStory, shareStoryImage } from "@/lib/shareStory";
import { fetchPlayerCard, type PlayerCard as StarCard } from "@/lib/starRatings";
import { radius, themeColor, useThemedStyles } from "@/theme";
import { isVerifiedLevel } from "@shared/badges";
import { INSTAGRAM_VERIFICATION_HANDLE } from "@/lib/brand";
import { SEASON_PRIZE_ENABLED } from "@/lib/seasonPrize";

const SHARE_READY_TIMEOUT_MS = 4000;
const STATS_CACHE_KEY = "cached_profile_stats.v3";

type ProfileRow = {
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  primary_position: string | null;
  secondary_positions: string[] | null;
  playing_position: string | null;
  zip_code: string | null;
  nearest_venue: string | null;
  max_drive_minutes: number | null;
  verification_level: string | null;
};

const PROFILE_SELECT =
  "first_name,last_name,username,primary_position,secondary_positions,playing_position,zip_code,nearest_venue,max_drive_minutes,verification_level";

type ProfileStats = { games: number; winPct: number | null; potd: number; form: PlayerOutcome[] };

// Last loaded card, stats and badges, so re-mounts render instantly.
let _cachedCard: StarCard | null | undefined;
let _cachedStats: ProfileStats | null = null;
let _cachedBadges: ProfileBadge[] | null = null;

/** Apple's subscriptions page, where a CT+ subscriber manages or cancels. */
const MANAGE_SUBSCRIPTIONS_URL = "https://apps.apple.com/account/subscriptions";

export default function ProfileScreen() {
  useThemedStyles(publish_s);

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, supabase, isReady } = useAuth();
  const { isReady: profileAdminReady } = useProfileAdmin();
  const accessToken = session?.access_token ?? null;
  const uid = session?.user?.id ?? null;

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [card, setCard] = useState<StarCard | null | undefined>(_cachedCard);
  const [stats, setStats] = useState<ProfileStats | null>(_cachedStats);
  const [badges, setBadges] = useState<ProfileBadge[]>(_cachedBadges ?? unearnedBadges());
  const [actionPhotoUrl, setActionPhotoUrl] = useState<string | null>(null);
  const { avatarUrl, setAvatarUrl, avatarUploading, pickAndUploadAvatar } = useAvatarPhoto();
  const [editing, setEditing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [levelsOpen, setLevelsOpen] = useState(false);
  const { isPlus } = useCtPlus();
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [shareSheetOpen, setShareSheetOpen] = useState(false);

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
      const [nextCard, record, nextBadges] = await Promise.all([
        fetchPlayerCard(supabase, uid),
        accessToken ? fetchMyRecord(accessToken) : Promise.resolve(null),
        accessToken ? fetchMyBadges(accessToken) : Promise.resolve(null),
      ]);
      _cachedCard = nextCard;
      setCard(nextCard);
      if (record) {
        const next: ProfileStats = {
          games: record.games,
          winPct: winPercent(record),
          potd: record.potd_count,
          form: Array.isArray(record.form) ? record.form : [],
        };
        _cachedStats = next;
        setStats(next);
        AsyncStorage.setItem(STATS_CACHE_KEY, JSON.stringify(next)).catch(() => {});
      }
      if (nextBadges) {
        _cachedBadges = nextBadges;
        setBadges(nextBadges);
      }
    } catch (e) {
      console.error("[profile] loadStats exception", e);
    }
  }, [isReady, supabase, uid, accessToken]);

  useEffect(() => {
    AsyncStorage.multiRemove(["cached_tier_info", "cached_rating_info", "cached_record_stats", "cached_profile_stats.v2"]).catch(
      () => {},
    );
    if (_cachedStats) return;
    AsyncStorage.getItem(STATS_CACHE_KEY)
      .then((raw) => {
        if (!raw) return;
        const parsed = JSON.parse(raw) as Partial<ProfileStats>;
        if (typeof parsed.games === "number" && typeof parsed.potd === "number") {
          setStats({
            games: parsed.games,
            winPct: parsed.winPct ?? null,
            potd: parsed.potd,
            form: Array.isArray(parsed.form) ? parsed.form : [],
          });
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

  const cardData: PlayerCardData = {
    name: fullName,
    firstName: profile?.first_name ?? null,
    lastName: profile?.last_name ?? null,
    avatarUrl,
    positionTown: positionTownLine(
      positionAbbreviation(profile?.primary_position, profile?.playing_position),
      townFromZip(profile?.zip_code),
    ),
    star: card?.star ?? null,
    provisional: card?.provisional === true,
    verified: isVerifiedLevel(profile?.verification_level),
    games: stats?.games ?? 0,
    winPct: stats?.winPct ?? null,
    potd: stats?.potd ?? 0,
    photo: actionPhotoUrl,
  };
  const spot = primaryPitchSpot(profile?.primary_position, profile?.playing_position);
  // Plain computation, not a hook: this sits after the loading early-returns.
  const otherSpots = Array.from(
    new Set(
      (Array.isArray(profile?.secondary_positions) ? profile.secondary_positions : [])
        .map((p) => primaryPitchSpot(p, null))
        .filter((p): p is PitchSpot => p != null),
    ),
  ).filter((p) => p !== spot);
  const form = stats && stats.games >= 1 ? stats.form : [];

  return (
    <View style={s.screen}>
      {/* Solid band behind the status bar so the clock and Dynamic Island never sit on the card. */}
      <View style={[s.statusBand, { height: insets.top }]} />
      <ScrollView
        contentContainerStyle={{ paddingBottom: tabBarContentPadding(insets.bottom, 8) }}
        alwaysBounceVertical
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={themeColor().pitchText} />
        }
      >
        <View style={s.topBar}>
          <Pressable
            onPress={() => setEditing((v) => !v)}
            hitSlop={10}
            style={({ pressed }) => [s.topBtn, pressed && s.pressed]}
            accessibilityRole="button"
            accessibilityLabel={editing ? "Done editing" : "Edit photos"}
          >
            <Text style={s.topBtnText}>{editing ? "Done" : "Edit"}</Text>
          </Pressable>
          <Pressable
            onPress={() => (router.push as (href: string) => void)("/settings")}
            hitSlop={10}
            style={({ pressed }) => [s.topBtn, pressed && s.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Settings"
          >
            <FontAwesome name="cog" size={18} color={themeColor().text} />
          </Pressable>
        </View>

        <View style={s.cardWrap}>
          <ProfileCard
            data={cardData}
            onPressAvatar={editing ? pickAndUploadAvatar : undefined}
            onPressRating={() => setLevelsOpen(true)}
            avatarBusy={avatarUploading}
            avatarBadge={
              editing ? (
                <View style={s.cameraBadge}>
                  <FontAwesome name="camera" size={12} color={themeColor().onPitch} />
                </View>
              ) : null
            }
            onShare={canShare ? (CTPLUS_ENABLED ? () => setShareSheetOpen(true) : () => void onShare()) : undefined}
            shareBusy={sharing}
            shareDisabled={!cardReady}
          />
        </View>

        {SEASON_PRIZE_ENABLED ? (
          <View style={s.seasonWrap}>
            <SeasonCard />
          </View>
        ) : null}

        {editing ? (
          <View style={s.editPanel}>
            <PhotoUploadField
              bucket="action-photos"
              name="action"
              label="Card photo"
              hint="A shot of you playing, used as the background of your shared card image. Tap your avatar to change your profile photo."
              aspect="wide"
              preview={false}
              value={actionPhotoUrl}
              onChange={saveActionPhoto}
            />
          </View>
        ) : null}

        <View style={s.tiles}>
          <View style={s.tile}>
            <Text style={s.tileLabel}>Position</Text>
            <PositionPitch primary={spot} others={otherSpots} compact />
          </View>
          <View style={s.tile}>
            <Text style={s.tileLabel}>Form</Text>
            {form.length > 0 ? <FormPills form={form} dots /> : <Text style={s.tileEmpty}>No games yet</Text>}
          </View>
        </View>

        {CTPLUS_ENABLED ? (
          <>
          <Pressable
            onPress={() => (router.push as (href: string) => void)("/season-stats")}
            style={({ pressed }) => [s.verifyRow, pressed && s.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Season stats and rating history"
          >
            <FontAwesome name="line-chart" size={18} color={themeColor().text} />
            <View style={s.verifyText}>
              <Text style={s.verifyTitle}>Season stats and rating history</Text>
            </View>
            <FontAwesome name="chevron-right" size={12} color={themeColor().muted} />
          </Pressable>
          <Pressable
            onPress={() => (isPlus ? void Linking.openURL(MANAGE_SUBSCRIPTIONS_URL) : setPaywallOpen(true))}
            style={({ pressed }) => [s.verifyRow, pressed && s.pressed]}
            accessibilityRole={isPlus ? "link" : "button"}
            accessibilityLabel={isPlus ? "CT+ active. Manage subscription" : "CT+"}
          >
            <FontAwesome name="star" size={18} color={themeColor().text} />
            <View style={s.verifyText}>
              <Text style={s.verifyTitle}>{isPlus ? "CT+ active" : "CT+"}</Text>
            </View>
            {isPlus ? <Text style={s.manageLink}>Manage</Text> : <FontAwesome name="chevron-right" size={12} color={themeColor().muted} />}
          </Pressable>
          </>
        ) : null}

        <Pressable
          onPress={() => (router.push as (href: string) => void)("/instagram-verification")}
          style={({ pressed }) => [s.verifyRow, pressed && s.pressed]}
          accessibilityRole="button"
          accessibilityLabel={isVerifiedLevel(profile?.verification_level) ? "Verified. Open Instagram verification" : "Get verified with Instagram"}
        >
          <FontAwesome name="instagram" size={18} color={themeColor().text} />
          <View style={s.verifyText}>
            {isVerifiedLevel(profile?.verification_level) ? (
              <Text style={s.verifyTitle}>{profile?.verification_level === "instagram" ? "Instagram verified" : "Verified"}</Text>
            ) : (
              <>
                <Text style={s.verifyTitle}>Get verified with Instagram</Text>
                <Text style={s.verifySub}>Instagram: @{INSTAGRAM_VERIFICATION_HANDLE}</Text>
              </>
            )}
          </View>
          {isVerifiedLevel(profile?.verification_level) ? (
            <FontAwesome name="check-circle" size={18} color={themeColor().pitchText} />
          ) : (
            <FontAwesome name="chevron-right" size={12} color={themeColor().muted} />
          )}
        </Pressable>

        <View style={s.sectionBleed}>
          <Text style={[s.sectionLabel, s.sectionLabelInset]}>Badges</Text>
          <BadgeShelf badges={badges} />
        </View>
      </ScrollView>

      <StarLevelsSheet visible={levelsOpen} onClose={() => setLevelsOpen(false)} />

      {CTPLUS_ENABLED ? (
        <CtPlusPaywall design={null} data={null} visible={paywallOpen} onClose={() => setPaywallOpen(false)} onPurchased={() => setPaywallOpen(false)} />
      ) : null}

      {CTPLUS_ENABLED && canShare ? (
        <ShareCardSheet
          visible={shareSheetOpen}
          onClose={() => setShareSheetOpen(false)}
          data={cardData}
          onShareClassic={onShare}
          classicBusy={sharing}
          classicDisabled={!cardReady}
        />
      ) : null}

      {canShare ? (
        <View style={s.offscreen} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <PlayerCard ref={cardRef} variant="share" data={cardData} onReady={onCardReady} />
        </View>
      ) : null}
    </View>
  );
}

function make_s() {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: themeColor().bg },
    center: { flex: 1, backgroundColor: themeColor().bg, justifyContent: "center", alignItems: "center" },
    statusBand: { backgroundColor: themeColor().bg },
    topBar: {
      paddingHorizontal: 16,
      paddingVertical: 4,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    topBtn: {
      minWidth: 32,
      height: 32,
      paddingHorizontal: 12,
      borderRadius: radius.pill,
      backgroundColor: themeColor().overlay,
      alignItems: "center",
      justifyContent: "center",
    },
    topBtnText: { color: themeColor().text, fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    pressed: { opacity: 0.7 },
    cardWrap: { paddingHorizontal: 16 },
    seasonWrap: { paddingHorizontal: 16, marginTop: 10 },
    cameraBadge: {
      position: "absolute",
      right: 2,
      bottom: 2,
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: themeColor().pitch,
      borderWidth: 2,
      borderColor: themeColor().onPitch,
      alignItems: "center",
      justifyContent: "center",
    },
    editPanel: { paddingHorizontal: 20, paddingTop: 16 },
    tiles: { flexDirection: "row", gap: 10, paddingHorizontal: 16, marginTop: 10 },
    tile: {
      flex: 1,
      padding: 12,
      borderRadius: radius.card,
      backgroundColor: themeColor().card,
      borderWidth: 1,
      borderColor: themeColor().line,
    },
    tileLabel: { marginBottom: 8, color: themeColor().muted, fontSize: 11, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    tileEmpty: { color: themeColor().muted, fontSize: 12, fontFamily: "Inter_400Regular" },
    manageLink: { color: themeColor().pitchText, fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    verifyRow: {
      marginTop: 10,
      marginHorizontal: 16,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
      minHeight: 44,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: themeColor().line,
      backgroundColor: themeColor().card,
    },
    verifyText: { flex: 1 },
    verifyTitle: { color: themeColor().text, fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    verifySub: { color: themeColor().muted, fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
    sectionBleed: { marginTop: 12 },
    sectionLabel: {
      marginBottom: 6,
      color: themeColor().text,
      fontSize: 14,
      fontFamily: "Inter_600SemiBold",
      fontWeight: "600",
    },
    sectionLabelInset: { paddingHorizontal: 16 },
    offscreen: { position: "absolute", top: 0, left: -10000 },
  });
}
let s = make_s();
function publish_s() {
  s = make_s();
}
