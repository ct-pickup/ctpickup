import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useDerivedValue, withDelay, withSequence, withTiming, type SharedValue } from "react-native-reanimated";

import { themeColor } from "@/theme";

const PIECES = 18;

/** One confetti piece: flies out from the centre, drifts down and fades. Pure theme colours, no images. */
function Piece({ index, progress }: { index: number; progress: SharedValue<number> }) {
  const c = themeColor();
  const colors = [c.pitch, c.accent, c.success, c.warning, c.medalGold];
  // Fixed per piece so the burst looks the same each time, with no randomness at render.
  const angle = (index / PIECES) * Math.PI * 2 + (index % 3) * 0.35;
  const distance = 54 + (index % 4) * 16;
  const size = 5 + (index % 3) * 2;
  const style = useAnimatedStyle(() => {
    const t = progress.value;
    return {
      opacity: t < 0.15 ? t / 0.15 : 1 - Math.max(0, (t - 0.55) / 0.45),
      transform: [
        { translateX: Math.cos(angle) * distance * t },
        { translateY: Math.sin(angle) * distance * t + 40 * t * t },
        { rotate: `${t * 540 * (index % 2 === 0 ? 1 : -1)}deg` },
        { scale: 1 - 0.3 * t },
      ],
    };
  });
  return <Animated.View pointerEvents="none" style={[styles.piece, { width: size, height: size * 1.6, backgroundColor: colors[index % colors.length] }, style]} />;
}

/**
 * A short confetti burst centred on its parent. Plays once per `playKey` change. The caller decides whether to show it at all
 * (it is never rendered under Reduce Motion), so this component only animates.
 */
export function ConfettiBurst({ playKey, delayMs = 0 }: { playKey: string | number; delayMs?: number }) {
  // Restarts from 0 whenever playKey changes.
  const progress = useDerivedValue(
    (): number => withSequence(withTiming(0, { duration: 0 }), withDelay(delayMs, withTiming(1, { duration: 1100, easing: Easing.out(Easing.quad) }))),
    [playKey, delayMs],
  );
  const pieces = useMemo(() => Array.from({ length: PIECES }, (_, i) => i), []);
  return (
    <View pointerEvents="none" style={styles.wrap} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {pieces.map((i) => (
        <Piece key={i} index={i} progress={progress} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  piece: { position: "absolute", borderRadius: 2 },
});
