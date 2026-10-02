import { useAuth } from "@/context/AuthContext";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PhotoHeader, useFieldPhotos } from "@/components/photo";
import { ResultPill } from "@/components/season/SeasonPieces";
import ShareStoryCard, { type ShareStoryData } from "@/components/season/ShareStoryCard";
import { StarRating } from "@/components/StarRating";
import { useDevPreview } from "@/lib/devPreview";
import { longDateEt } from "@/lib/season";
import { fetchMatchRecap, type MatchRecap } from "@/lib/seasonData";
import { canShareStory, shareStoryImage } from "@/lib/shareStory";
import { headline, radius, recordNumeral, themeColor, useThemedStyles } from "@/theme";
import type { DevFixtures } from "../../dev-fixtures";

// eslint-disable-next-line @typescript-eslint/no-require-imports -- must stay a __DEV__ require so release bundles drop dev-fixtures
const devFixtures: DevFixtures | null = __DEV__ ? require("../../dev-fixtures").default : null;

const SHARE_READY_TIMEOUT_MS = 4000;

export default function MatchRecapScreen() {
  useThemedStyles(publish_styles);

  const { id: raw } = useLocalSearchParams<{ id: string | string[] }>();
  const runId = typeof raw === "string" ? raw : Array.isArray(raw) ? (raw[0] ?? "") : "";
  const insets = useSafeAreaInsets();
  const { session, supabase, isReady } = useAuth();
  const uid = session?.user?.id ?? null;
  const preview = useDevPreview();
  const fixture = useMemo(() => (preview && devFixtures ? devFixtures.recap(runId) : null), [preview, runId]);

  const [liveRecap, setLiveRecap] = useState<MatchRecap | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const livePhotos = useFieldPhotos(fixture || !runId ? [] : [runId]);

  useEffect(() => {
    if (fixture) {
      setLoading(false);
      return;
    }
    if (!isReady || !supabase || !uid || !runId) {
      setLoading(false);
      if (isReady && !uid) setErr("Sign in to see this game.");
      return;
    }
    let cancelled = false;
    setLoading(true);
    void fetchMatchRecap(supabase, uid, runId, session?.access_token ?? null)
      .then((r) => {
        if (cancelled) return;
        setLiveRecap(r);
        setErr(r ? null : "Game not found.");
      })
      .catch((e) => {
        console.warn("[recap] load failed:", e);
        if (!cancelled) setErr("Something went wrong. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fixture, isReady, supabase, uid, runId, session?.access_token]);

  const recap: MatchRecap | null = fixture ? fixture.recap : liveRecap;
  const photo: string | null = fixture ? fixture.photo : (livePhotos[runId] ?? null);

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
  }, [photo]);

  const shareData: ShareStoryData | null = recap
    ? {
        field: recap.field,
        town: recap.town,
        start_at: recap.start_at,
        outcome: recap.outcome,
        score: recap.score,
        potd: recap.potd?.isMe === true,
        position: recap.position,
        star: recap.card?.star ?? null,
        starProvisional: recap.card?.provisional === true,
        photo,
      }
    : null;

  const onShare = useCallback(async () => {
    if (!cardRef.current) return;
    setSharing(true);
    try {
      await shareStoryImage(cardRef, "Share your game");
    } catch (e) {
      console.warn("[recap] share failed:", e);
      Alert.alert("Couldn't share", "Please try again.");
    } finally {
      setSharing(false);
    }
  }, []);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={themeColor().muted} />
      </View>
    );
  }

  if (err || !recap) {
    return (
      <View style={styles.center}>
        <Text style={styles.errText}>{err ?? "Game not found."}</Text>
      </View>
    );
  }

  const meta = [longDateEt(recap.start_at), recap.town, recap.format].filter(Boolean).join(" \u00b7 ");
  const stats: Array<[string, string]> = [
    ["Team", recap.myTeam ? `Team ${recap.myTeam}` : "\u2014"],
    ["Position", recap.position ?? "\u2014"],
    ...recap.myAwards.map((a): [string, string] => ["Award", a]),
  ];

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}>
        <View style={styles.heroWrap}>
          <PhotoHeader uri={photo} chalkSize="md" accessibilityLabel={`${recap.field} field photo`}>
            <Text style={styles.heroTitle} numberOfLines={2}>
              {recap.field}
            </Text>
            <Text style={styles.heroMeta} numberOfLines={1}>
              {meta}
            </Text>
          </PhotoHeader>
        </View>

        <View style={styles.scoreCard}>
          {recap.outcome ? (
            <>
              {recap.score ? <Text style={styles.score}>{recap.score}</Text> : null}
              <ResultPill outcome={recap.outcome} size="md" />
              {!recap.score ? <Text style={styles.scoreNote}>Score not recorded</Text> : null}
            </>
          ) : (
            <Text style={styles.scoreNote}>Result not posted yet</Text>
          )}
          {recap.card ? (
            <StarRating value={recap.card.star} provisional={recap.card.provisional} size="sm" style={styles.scoreStars} />
          ) : null}
        </View>

        {recap.potd ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Player of the Day</Text>
            <View style={[styles.card, styles.potdRow]}>
              <FontAwesome name="star" size={16} color={themeColor().accent} />
              <Text style={[styles.potdName, recap.potd.isMe && styles.potdMe]}>{recap.potd.name}</Text>
            </View>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your game</Text>
          <View style={styles.card}>
            {stats.map(([label, value], i) => (
              <View key={`${label}-${i}`} style={[styles.statRow, i > 0 && styles.statRowDivider]}>
                <Text style={styles.statLabel}>{label}</Text>
                <Text style={styles.statValue} numberOfLines={1}>
                  {value}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {recap.teams.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Teams</Text>
            <View style={styles.teamsRow}>
              {recap.teams.map((t) => (
                <View key={t.team} style={[styles.card, styles.teamCard, t.mine && styles.teamCardMine]}>
                  <View style={styles.teamHeader}>
                    <Text style={styles.teamName}>Team {t.team}</Text>
                    {t.won ? <Text style={styles.teamWon}>Won</Text> : null}
                  </View>
                  {t.players.map((p, i) => (
                    <Text key={`${p}-${i}`} style={[styles.teamPlayer, p === "You" && styles.teamYou]} numberOfLines={1}>
                      {p}
                    </Text>
                  ))}
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {canShare && shareData ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Share this game as a story image"
            disabled={sharing || !cardReady}
            onPress={() => void onShare()}
            style={({ pressed }) => [styles.shareBtn, (pressed || sharing || !cardReady) && styles.pressed]}
          >
            {sharing ? (
              <ActivityIndicator color={themeColor().onAccent} />
            ) : (
              <>
                <FontAwesome name="share" size={16} color={themeColor().onAccent} />
                <Text style={styles.shareText}>Share</Text>
              </>
            )}
          </Pressable>
        ) : null}
      </ScrollView>

      {canShare && shareData ? (
        <View style={styles.offscreen} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <ShareStoryCard ref={cardRef} data={shareData} onReady={onCardReady} />
        </View>
      ) : null}
    </View>
  );
}

function make_styles() {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: themeColor().bg },
    content: { padding: 20, gap: 24 },
    center: { flex: 1, backgroundColor: themeColor().bg, alignItems: "center", justifyContent: "center", padding: 24 },
    errText: { fontSize: 16, fontFamily: "Inter_400Regular", color: themeColor().coralText, textAlign: "center" },
    pressed: { opacity: 0.7 },

    heroWrap: { borderRadius: radius.card, overflow: "hidden" },
    heroTitle: { fontSize: 24, ...headline, color: themeColor().onPhoto },
    heroMeta: { marginTop: 4, fontSize: 14, fontFamily: "Inter_500Medium", color: themeColor().onPhoto },

    scoreCard: {
      alignItems: "center",
      gap: 12,
      paddingVertical: 20,
      paddingHorizontal: 16,
      backgroundColor: themeColor().card,
      borderWidth: 1,
      borderColor: themeColor().line,
      borderRadius: radius.card,
    },
    score: { ...recordNumeral, fontSize: 56, lineHeight: 60, color: themeColor().text },
    scoreNote: { fontSize: 14, fontFamily: "Inter_500Medium", color: themeColor().muted },
    scoreStars: { position: "absolute", top: 12, right: 12 },

    section: { gap: 12 },
    sectionTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: themeColor().text },
    card: {
      backgroundColor: themeColor().card,
      borderWidth: 1,
      borderColor: themeColor().line,
      borderRadius: radius.card,
    },
    potdRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
    potdName: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: themeColor().text },
    potdMe: { color: themeColor().pitchText },

    statRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, padding: 16 },
    statRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: themeColor().line },
    statLabel: { fontSize: 14, fontFamily: "Inter_500Medium", color: themeColor().muted },
    statValue: { flexShrink: 1, fontSize: 15, fontFamily: "Inter_600SemiBold", color: themeColor().text },

    teamsRow: { flexDirection: "row", gap: 12 },
    teamCard: { flex: 1, padding: 12, gap: 4 },
    teamCardMine: { borderColor: themeColor().accent },
    teamHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
    teamName: { fontSize: 15, fontFamily: "Inter_700Bold", color: themeColor().text },
    teamWon: { fontSize: 11, fontFamily: "Inter_700Bold", color: themeColor().pitchText },
    teamPlayer: { fontSize: 14, fontFamily: "Inter_400Regular", color: themeColor().text },
    teamYou: { fontFamily: "Inter_700Bold", color: themeColor().pitchText },

    shareBtn: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      backgroundColor: themeColor().accent,
      borderRadius: radius.button,
    },
    shareText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: themeColor().onAccent },

    offscreen: { position: "absolute", top: 0, left: -10000 },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
