import { useReduceMotion } from "@/hooks/useReduceMotion";
import { hapticTap } from "@/lib/haptics";
import type { ReactNode } from "react";
import type { GestureResponderEvent, PressableProps, StyleProp, ViewStyle } from "react-native";
import { Pressable } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

const SPRING_CFG = { damping: 17, stiffness: 420, mass: 0.35 } as const;

export type AnimatedPressScaleProps = Omit<PressableProps, "style"> & {
  style?: StyleProp<ViewStyle>;
  /** Default 0.97 */
  pressedScale?: number;
  /** Fire light haptic when press completes (navigation / primary tap). */
  hapticOnPress?: boolean;
  children: ReactNode;
};

/** Press feedback: subtle scale spring + optional haptic. Respects Reduce motion. */
export function AnimatedPressScale({
  children,
  style,
  disabled,
  pressedScale = 0.97,
  hapticOnPress,
  onPress,
  onPressIn,
  onPressOut,
  ...rest
}: AnimatedPressScaleProps) {
  const reduceMotion = useReduceMotion();
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const shrink = () => {
    if (disabled || reduceMotion) return;
    scale.value = withSpring(pressedScale, SPRING_CFG);
  };
  const restore = () => {
    if (disabled || reduceMotion) return;
    scale.value = withSpring(1, SPRING_CFG);
  };

  const wrappedOnPress = onPress
    ? (e: GestureResponderEvent) => {
        if (hapticOnPress) void hapticTap();
        onPress(e);
      }
    : undefined;

  return (
    <Pressable
      {...rest}
      disabled={disabled}
      onPress={wrappedOnPress}
      onPressIn={(e) => {
        shrink();
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        restore();
        onPressOut?.(e);
      }}
      style={[{ alignSelf: "stretch" }, style]}
    >
      <Animated.View style={[animStyle, { alignSelf: "stretch" }]}>{children}</Animated.View>
    </Pressable>
  );
}
