import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import { useReduceMotion } from "@/hooks/useReduceMotion";
import { MOTION, staggerDelay } from "@/lib/motion";

/**
 * Fades and slides a list row in, a little after the row before it. Entering animations only run when a row mounts, so a
 * refresh that keeps the same keys does not replay it: first load only. Nothing animates under Reduce Motion.
 */
export function StaggerIn({ index, children, style }: { index: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduceMotion = useReduceMotion();
  if (reduceMotion) return <View style={style}>{children}</View>;
  return (
    <Animated.View entering={FadeInDown.duration(MOTION.duration.fast).delay(staggerDelay(index))} style={style}>
      {children}
    </Animated.View>
  );
}
