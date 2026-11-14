import { StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useDerivedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";

import { useReduceMotion } from "@/hooks/useReduceMotion";
import { MOTION } from "@/lib/motion";
import { themeColor, useThemedStyles } from "@/theme";

/** A small dot and "Live". The dot breathes while a match is being played, and holds still under Reduce Motion. */
export function LiveTag({ pulsing = true }: { pulsing?: boolean }) {
  useThemedStyles(publish_styles);
  const reduceMotion = useReduceMotion();
  const dot = useDerivedValue(
    (): number =>
      pulsing && !reduceMotion
        ? withRepeat(withSequence(withTiming(0.3, { duration: MOTION.duration.slow }), withTiming(1, { duration: MOTION.duration.slow })), -1)
        : 1,
    [pulsing, reduceMotion],
  );
  const dotStyle = useAnimatedStyle(() => ({ opacity: dot.value }));
  return (
    <View style={styles.badge} accessible accessibilityLabel="Live. A match is being played.">
      <Animated.View style={[styles.dot, dotStyle]} />
      <Text style={styles.text}>Live</Text>
    </View>
  );
}

function make_styles() {
  return StyleSheet.create({
    badge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingVertical: 4,
      paddingHorizontal: 10,
      borderRadius: 999,
      backgroundColor: themeColor().overlaySubtle,
      borderWidth: 1,
      borderColor: themeColor().line,
    },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: themeColor().coralText },
    text: { color: themeColor().text, fontSize: 12, fontFamily: "Inter_700Bold", fontWeight: "700" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
