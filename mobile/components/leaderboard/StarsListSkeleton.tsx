import { StyleSheet, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useDerivedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";

import { useReduceMotion } from "@/hooks/useReduceMotion";
import { radius, themeColor, useThemedStyles } from "@/theme";

/** Placeholder rows for the Stars list while it loads: the row shape (rank, avatar, two lines, number) with a soft pulse. */
export function StarsListSkeleton({ rows = 5 }: { rows?: number }) {
  useThemedStyles(publish_styles);
  const reduceMotion = useReduceMotion();
  const pulse = useDerivedValue(
    () =>
      reduceMotion
        ? 0.5
        : withRepeat(
            withSequence(withTiming(0.7, { duration: 650, easing: Easing.inOut(Easing.sin) }), withTiming(0.4, { duration: 650, easing: Easing.inOut(Easing.sin) })),
            -1,
            false,
          ),
    [reduceMotion],
  );
  const fade = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <View style={{ gap: 8 }} accessibilityLabel="Loading players" accessible>
      {Array.from({ length: rows }, (_, i) => (
        <Animated.View key={i} style={[styles.row, fade]}>
          <View style={styles.rank} />
          <View style={styles.avatar} />
          <View style={{ flex: 1, gap: 6 }}>
            <View style={[styles.bar, { width: `${55 + (i % 3) * 12}%` }]} />
            <View style={[styles.bar, styles.barShort]} />
          </View>
          <View style={styles.num} />
        </Animated.View>
      ))}
    </View>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: radius.card, borderWidth: 1, borderColor: c.line },
    rank: { width: 22, height: 14, borderRadius: 4, backgroundColor: c.overlay },
    avatar: { width: 46, height: 46, borderRadius: 999, backgroundColor: c.overlay },
    bar: { height: 12, borderRadius: 6, backgroundColor: c.overlay },
    barShort: { width: "35%", height: 10 },
    num: { width: 40, height: 22, borderRadius: 6, backgroundColor: c.overlay },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
