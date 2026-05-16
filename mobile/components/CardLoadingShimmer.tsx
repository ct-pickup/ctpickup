import { useReduceMotion } from "@/hooks/useReduceMotion";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useEffect } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

const LIME_DIM = "rgba(255,255,255,0.55)";

/** Tournament-style card skeleton with lime-adjacent breathing bars (respects Reduce motion). */
export function CardLoadingShimmer({ style }: { style?: StyleProp<ViewStyle> }) {
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
          <FontAwesome name="trophy" size={20} color={LIME_DIM} />
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

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(255,255,255,0.03)",
    alignItems: "center",
    justifyContent: "center",
  },
  statusKicker: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.6,
    color: "rgba(255,255,255,0.92)",
    marginBottom: 12,
  },
  barLg: {
    height: 18,
    borderRadius: 8,
    backgroundColor: "rgba(163,230,53,0.35)",
    width: "88%",
    marginBottom: 10,
  },
  barMd: {
    height: 14,
    borderRadius: 7,
    backgroundColor: "rgba(255,255,255,0.16)",
    width: "70%",
    marginBottom: 12,
  },
  barSm: {
    height: 12,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.1)",
    width: "55%",
  },
});
