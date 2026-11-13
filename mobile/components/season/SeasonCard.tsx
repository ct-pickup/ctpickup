import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useDerivedValue, withSequence, withTiming } from "react-native-reanimated";

import { useReduceMotion } from "@/hooks/useReduceMotion";
import { useVisitKey } from "@/hooks/useVisitKey";
import { MOTION } from "@/lib/motion";
import { prizeProgress, seasonCountdownText, seasonTimeLeft } from "@/lib/motionCore";
import { AnimatedPressScale } from "@/components/AnimatedPressScale";

import { useAuth } from "@/context/AuthContext";
import { fetchMyRecord } from "@/lib/playerRecord";
import { seasonWindowFor, SEASON_PRIZE_MIN_GAMES, SEASON_PRIZE_USD } from "@/lib/pickup/seasonPrize";
import { RATING_LOAD_FAILED_TEXT, type StandingState } from "@/lib/pointsCopy";
import { StarsStatValue } from "@/components/season/StarsStatValue";
import { fetchSeasonStanding, seasonDaysLeft, seasonGamesFromLog, standingRankText, type SeasonStanding } from "@/lib/seasonCard";
import { fetchSeasonEntered, SEASON_PRIZE_ENABLED } from "@/lib/seasonPrize";
import { radius, themeColor, useThemedStyles } from "@/theme";
import { APPLE_DISCLAIMER } from "@shared/seasonRules";

type Props = {
  /**
   * The viewer's season standing when the caller already has the /api/leaderboards payload (the Points tab).
   * Leave it out and the card makes the one leaderboard call itself (Profile).
   */
  standing?: SeasonStanding | null;
};

/** Season prize summary. Renders nothing, and makes no request, unless SEASON_PRIZE_ENABLED. */
export function SeasonCard(props: Props) {
  if (!SEASON_PRIZE_ENABLED) return null;
  return <SeasonCardInner {...props} />;
}

function SeasonCardInner({ standing: given }: Props) {
  useThemedStyles(publish_styles);
  const router = useRouter();
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const userId = session?.user?.id ?? null;
  const season = seasonWindowFor();
  const daysLeft = seasonDaysLeft();
  const reduceMotion = useReduceMotion();
  const visit = useVisitKey();

  // Live countdown to the end of the season, refreshed every minute while the card is mounted.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const countdown = seasonCountdownText(seasonTimeLeft(now));

  const [fetched, setFetched] = useState<SeasonStanding | null>(null);
  const [standingState, setStandingState] = useState<StandingState>("loading");
  const [games, setGames] = useState<number | null>(null);
  const [entered, setEntered] = useState<boolean | null>(null);

  // Refreshes when the screen regains focus, so the badge appears after entering from the intro.
  useFocusEffect(
    useCallback(() => {
      let live = true;
      if (!token) return;
      void fetchSeasonEntered(token).then((v) => live && setEntered(v));
      void fetchMyRecord(token).then((rec) => live && setGames(seasonGamesFromLog(rec?.log, season.label)));
      if (given === undefined) {
        void fetchSeasonStanding(token, userId).then((v) => {
          if (!live) return;
          setFetched(v);
          setStandingState(v ? "ok" : "failed");
        });
      }
      return () => {
        live = false;
      };
    }, [token, userId, given, season.label]),
  );

  const standing = given === undefined ? fetched : given;

  // Progress toward the prize threshold; the bar fills in when the games count arrives (no animation with Reduce Motion).
  const progress = prizeProgress(games, SEASON_PRIZE_MIN_GAMES);
  const fill = useDerivedValue(
    () => (reduceMotion ? progress : withSequence(withTiming(0, { duration: 0 }), withTiming(progress, { duration: MOTION.duration.slow, easing: Easing.out(Easing.cubic) }))),
    [progress, reduceMotion, visit],
  );
  const fillStyle = useAnimatedStyle(() => ({ width: `${Math.round(fill.value * 100)}%` }));
  // A failed call is not "no rating": say so and let the player retry. "Unranked" only appears without a rating.
  const standingFailed = given === undefined && standingState === "failed" && !standing;

  function retryStanding() {
    if (!token) return;
    setStandingState("loading");
    void fetchSeasonStanding(token, userId).then((v) => {
      setFetched(v);
      setStandingState(v ? "ok" : "failed");
    });
  }
  const rankText = standingRankText(standing);

  return (
    <View style={styles.card} accessibilityLabel={`${season.label} season`}>
      <View style={styles.top}>
        <View style={styles.topText}>
          <Text style={styles.label} numberOfLines={1} accessibilityLabel={`${season.label}, ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left`}>
            {season.label} · {countdown}
          </Text>
          <Text style={styles.prize}>Win ${SEASON_PRIZE_USD}</Text>
        </View>
        {entered ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>In the season</Text>
          </View>
        ) : entered === false ? (
          <AnimatedPressScale
            onPress={() => (router.push as (href: string) => void)("/season-prize")}
            hapticOnPress
            pressedScale={MOTION.pressScale.button}
            style={styles.enterBtn}
            accessibilityRole="button"
          >
            <Text style={styles.enterText}>Enter the season</Text>
          </AnimatedPressScale>
        ) : null}
      </View>
      <View style={styles.stats}>
        {standingFailed ? (
          <Pressable onPress={retryStanding} style={styles.statWide} accessibilityRole="button" accessibilityLabel={RATING_LOAD_FAILED_TEXT}>
            <Text style={styles.retry}>{RATING_LOAD_FAILED_TEXT}</Text>
            <Text style={styles.statLabel}>Stars and rank</Text>
          </Pressable>
        ) : (
          <>
            <View style={styles.stat}>
              {standing ? (
                <StarsStatValue star={standing.star} exact={standing.exact} provisional={standing.provisional} />
              ) : (
                <Text style={styles.statValue}>–</Text>
              )}
              <Text style={styles.statLabel}>Stars</Text>
            </View>
            <Stat value={standing ? rankText : "–"} label="Rank" />
          </>
        )}
        <Stat value={games == null ? "–" : `${games} of ${SEASON_PRIZE_MIN_GAMES}`} label="Games toward prize" />
      </View>
      <View
        style={styles.track}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={`${games ?? 0} of ${SEASON_PRIZE_MIN_GAMES} games toward $${SEASON_PRIZE_USD}`}
        accessibilityValue={{ min: 0, max: SEASON_PRIZE_MIN_GAMES, now: games ?? 0 }}
      >
        <Animated.View style={[styles.fill, fillStyle]} />
      </View>
      <Pressable onPress={() => (router.push as (href: string) => void)("/season-rules")} hitSlop={6} accessibilityRole="link">
        <Text style={styles.rules}>Official rules · {APPLE_DISCLAIMER}</Text>
      </Pressable>
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    card: { padding: 12, borderRadius: radius.card, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, gap: 10 },
    top: { flexDirection: "row", alignItems: "center", gap: 10 },
    topText: { flex: 1, minWidth: 0 },
    label: { color: c.muted, fontSize: 12, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    prize: { color: c.text, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700", marginTop: 2 },
    badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, borderWidth: 1, borderColor: c.pitchText },
    badgeText: { color: c.pitchText, fontSize: 12, fontFamily: "Inter_700Bold", fontWeight: "700" },
    enterBtn: { backgroundColor: c.pitch, borderRadius: radius.button, paddingHorizontal: 14, paddingVertical: 8 },
    enterText: { color: c.onPitch, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700" },
    pressed: { opacity: 0.85 },
    rules: { color: c.muted, fontSize: 11, fontFamily: "Inter_500Medium" },
    stats: { flexDirection: "row", gap: 8 },
    track: { height: 6, borderRadius: 3, backgroundColor: c.overlay, overflow: "hidden" },
    fill: { height: 6, borderRadius: 3, backgroundColor: c.pitch },
    stat: { flex: 1, minWidth: 0 },
    statWide: { flex: 2, minWidth: 0 },
    retry: { color: c.pitchText, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700" },
    statValue: { color: c.text, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
    statLabel: { color: c.muted, fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 1 },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
