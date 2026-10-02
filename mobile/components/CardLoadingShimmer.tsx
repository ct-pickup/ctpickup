import { useReduceMotion } from "@/hooks/useReduceMotion";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useEffect } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { themeColor, useThemedStyles } from "@/theme";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

/** Tournament-style card skeleton with lime-adjacent breathing bars (respects Reduce motion). */
export function CardLoadingShimmer({ style }: { style?: StyleProp<ViewStyle> }) {
  useThemedStyles(publish_styles);

  const reduceMotion = useReduceMotion();
  const pulse = useSharedValue(0.38);

  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(pulse);
      pulse.value = 0.52;
      return;
    }
    pulse.value = withRepeat(
      withSequence(
        withTiming(0.62, { duration: 700, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.36, { duration: 700, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(pulse);
  }, [reduceMotion]);

  const barA = useAnimatedStyle(() => ({ opacity: pulse.value }));
  const barB = useAnimatedStyle(() => ({ opacity: pulse.value + 0.08 }));
  const barC = useAnimatedStyle(() => ({ opacity: Math.max(0.22, pulse.value - 0.12) }));

  return (
    <View style={[styles.card, style]}>
      <View style={styles.row}>
        <View style={styles.iconWrap}>
          <FontAwesome name="trophy" size={20} color={themeColor().text} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.statusKicker}>Checking…</Text>
          <Animated.View style={[styles.barLg, barA]} />
          <Animated.View style={[styles.barMd, barB]} />
          <Animated.View style={[styles.barSm, barC]} />
        </View>
      </View>
    </View>
  );
}

function make_styles() {
  return StyleSheet.create({
  card: {
    borderRadius: 12,
    padding: 18,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().card,
  },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: themeColor().line,
    backgroundColor: themeColor().overlaySubtle,
    alignItems: "center",
    justifyContent: "center",
  },
  statusKicker: {
    fontSize: 13, fontFamily: "Inter_700Bold",
    fontWeight: "800",
    color: themeColor().text,
    marginBottom: 12,
  },
  barLg: {
    height: 18,
    borderRadius: 10,
    backgroundColor: themeColor().pitch,
    width: "88%",
    marginBottom: 10,
  },
  barMd: {
    height: 14,
    borderRadius: 10,
    backgroundColor: themeColor().overlay,
    width: "70%",
    marginBottom: 12,
  },
  barSm: {
    height: 12,
    borderRadius: 10,
    backgroundColor: themeColor().overlay,
    width: "55%",
  },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}

