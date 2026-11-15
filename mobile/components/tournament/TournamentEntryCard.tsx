import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { AnimatedPressScale } from "@/components/AnimatedPressScale";
import { LiveTag } from "@/components/tournament/LiveTag";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { MOTION } from "@/lib/motion";
import { subtitleText, type TournamentListItem } from "@/lib/tournamentEntryCore";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";

/** Opens the live bracket for a tournament. Same screen the Tournaments tab opens. */
export function useOpenTournamentBracket() {
  const router = useRouter();
  return (id: string) =>
    (router.push as (href: string) => void)(`/tournament-bracket-view?tournament_id=${encodeURIComponent(id)}`);
}

/** One tournament as a tappable card: trophy, title, when and where, and a Live tag while a match is being played. */
export function TournamentEntryCard({ item, now, onPress }: { item: TournamentListItem; now: number; onPress: () => void }) {
  useThemedStyles(publish_styles);
  const reduceMotion = useReduceMotion();
  const subtitle = subtitleText(item, now);
  return (
    <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(MOTION.duration.base)}>
      <AnimatedPressScale
        onPress={onPress}
        hapticOnPress
        pressedScale={MOTION.pressScale.card}
        style={styles.card}
        accessibilityRole="button"
        accessibilityLabel={`${item.title}. ${item.live ? "Live. " : ""}${subtitle}. Open the bracket.`}
      >
        <View style={styles.icon}>
          <FontAwesome name="trophy" size={18} color={themeColor().onPitchPanel} />
        </View>
        <View style={styles.body}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={1}>
              {item.title}
            </Text>
            {item.live ? <LiveTag /> : null}
          </View>
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
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 12,
      backgroundColor: c.card,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: c.line,
    },
    icon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: c.pitchPanel },
    body: { flex: 1, gap: 2 },
    titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    title: { flexShrink: 1, fontSize: 16, ...headline, color: c.text },
    sub: { fontSize: 13, fontFamily: "Inter_400Regular", color: c.muted },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
