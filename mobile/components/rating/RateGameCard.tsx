import FontAwesome from "@expo/vector-icons/FontAwesome";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { AnimatedPressScale } from "@/components/AnimatedPressScale";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { MOTION } from "@/lib/motion";
import { ballotHref, cardSubtitle, RATE_CARD_TITLE } from "@/lib/pendingRatingCore";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";
import { useRouter } from "expo-router";
import type { PendingRating } from "@shared/ratingGate";

/**
 * "Rate your game" with the time left before it expires. Taps straight to that game's ballot. Shows only while a rating is
 * pending (the server says none when the require_ratings flag is off for this player, and for admins), and takes no space otherwise.
 * The screen owns usePendingRating and passes the answer in, so one screen asks the server once.
 */
export function RateGameCard({ pending, now }: { pending: PendingRating | null; now: number }) {
  useThemedStyles(publish_styles);
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  if (!pending) return null;
  const subtitle = cardSubtitle(pending, now);
  return (
    <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(MOTION.duration.base)} style={styles.wrap}>
      <AnimatedPressScale
        onPress={() => (router.push as (href: string) => void)(ballotHref(pending.run_id))}
        hapticOnPress
        pressedScale={MOTION.pressScale.card}
        style={styles.card}
        accessibilityRole="button"
        accessibilityLabel={`${RATE_CARD_TITLE}. ${subtitle}. Open the ballot.`}
      >
        <View style={styles.icon}>
          <FontAwesome name="star" size={18} color={themeColor().onPitchPanel} />
        </View>
        <View style={styles.body}>
          <Text style={styles.title}>{RATE_CARD_TITLE}</Text>
          <Text style={styles.sub} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        <FontAwesome name="chevron-right" size={12} color={themeColor().muted} />
      </AnimatedPressScale>
    </Animated.View>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    wrap: { marginTop: 4, marginBottom: 12 },
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 12,
      backgroundColor: c.pitchPanel,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: c.pitchText,
    },
    icon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: c.card },
    body: { flex: 1, gap: 2 },
    title: { fontSize: 16, ...headline, color: c.onPitchPanel },
    sub: { fontSize: 13, fontFamily: "Inter_500Medium", color: c.onPitchPanel, opacity: 0.85 },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
