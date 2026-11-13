import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useDerivedValue, withSequence, withTiming } from "react-native-reanimated";

import { AnimatedPressScale } from "@/components/AnimatedPressScale";
import { StarRating } from "@/components/StarRating";
import { useVisitKey } from "@/hooks/useVisitKey";
import { MOTION } from "@/lib/motion";
import { useAuth } from "@/context/AuthContext";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { homeSeasonModel } from "@/lib/homeSeasonCore";
import { prizeProgress, seasonCountdownText, seasonTimeLeft } from "@/lib/motionCore";
import { seasonWindowFor, SEASON_PRIZE_MIN_GAMES, SEASON_PRIZE_USD } from "@/lib/pickup/seasonPrize";
import { fetchMyRecord } from "@/lib/playerRecord";
import { fetchSeasonStanding, seasonGamesFromLog, type SeasonStanding } from "@/lib/seasonCard";
import { SEASON_PRIZE_ENABLED } from "@/lib/seasonPrize";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";

/**
 * Home season card: rating with stars, Stars rank, games toward the prize with its bar, and time left in the season. Reads the
 * same two calls the Profile season card uses (leaderboards own row, my record); no new endpoints. Any piece with no data is hidden,
 * and the whole card is hidden until something has loaded. Tap opens the profile.
 */
export function HomeSeasonCard({ onPress }: { onPress: () => void }) {
  useThemedStyles(publish_styles);
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const userId = session?.user?.id ?? null;
  const reduceMotion = useReduceMotion();
  const visit = useVisitKey();
  const season = seasonWindowFor();

  const [standing, setStanding] = useState<SeasonStanding | null>(null);
  const [games, setGames] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      if (!token) return;
      void fetchSeasonStanding(token, userId).then((v) => live && v && setStanding(v));
      void fetchMyRecord(token).then((rec) => live && rec && setGames(seasonGamesFromLog(rec.log, season.label)));
      return () => {
        live = false;
      };
    }, [token, userId, season.label]),
  );

  const model = homeSeasonModel(standing, games, SEASON_PRIZE_ENABLED);
  const progress = prizeProgress(model?.games, SEASON_PRIZE_MIN_GAMES);
  const fill = useDerivedValue(
    () => (reduceMotion ? progress : withSequence(withTiming(0, { duration: 0 }), withTiming(progress, { duration: MOTION.duration.slow, easing: Easing.out(Easing.cubic) }))),
    [progress, reduceMotion, visit],
  );
  const fillStyle = useAnimatedStyle(() => ({ width: `${Math.round(fill.value * 100)}%` }));
  if (!model) return null;

  const countdown = seasonCountdownText(seasonTimeLeft(now));
  return (
    <AnimatedPressScale
      onPress={onPress}
      pressedScale={MOTION.pressScale.card}
      style={styles.card}
      accessibilityRole="button"
      accessibilityLabel={`${season.label}. ${model.starsText ? `Rating ${model.starsText}. ` : ""}${model.rankText ? `Rank ${model.rankText}. ` : ""}${countdown}. Opens your profile.`}
    >
      <View style={styles.top}>
        <Text style={styles.label} numberOfLines={1}>
          {season.label} · {countdown}
        </Text>
        <FontAwesome name="chevron-right" size={12} color={themeColor().muted} />
      </View>
      {model.star != null ? (
        <View style={styles.ratingRow}>
          <StarRating value={model.star} exact={model.exact} provisional={model.provisional} size="md" showLevel={false} style={styles.stars} />
          {model.rankText ? <Text style={styles.rank}>{model.rankText}</Text> : null}
        </View>
      ) : null}
      {model.games != null ? (
        <View style={styles.prize}>
          <View style={styles.prizeRow}>
            <Text style={styles.prizeText} numberOfLines={1}>
              {model.games} of {SEASON_PRIZE_MIN_GAMES} games toward ${SEASON_PRIZE_USD}
            </Text>
          </View>
          <View
            style={styles.track}
            accessible
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: SEASON_PRIZE_MIN_GAMES, now: model.games }}
          >
            <Animated.View style={[styles.fill, fillStyle]} />
          </View>
        </View>
      ) : null}
    </AnimatedPressScale>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    card: { marginTop: 16, padding: 12, borderRadius: radius.card, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, gap: 10 },
    top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
    label: { flex: 1, color: c.muted, fontSize: 12, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    ratingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" },
    stars: { flexShrink: 1, flexWrap: "wrap" },
    rank: { color: c.text, fontSize: 18, ...headline },
    prize: { gap: 6 },
    prizeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    prizeText: { color: c.text, fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    track: { height: 6, borderRadius: 3, backgroundColor: c.overlay, overflow: "hidden" },
    fill: { height: 6, borderRadius: 3, backgroundColor: c.pitch },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
