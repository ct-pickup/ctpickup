import { useId, useState } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { ZoomIn } from "react-native-reanimated";

import { useReduceMotion } from "@/hooks/useReduceMotion";
import { hapticTap } from "@/lib/haptics";
import { MOTION } from "@/lib/motion";

import { MAX_STARS, starFill, starValueFromTap } from "@/lib/halfStars";
import { StarGlyph } from "@/components/StarRating";

type Props = {
  value: number | null;
  onChange: (value: number) => void;
  px?: number;
  disabled?: boolean;
  label?: string;
  style?: StyleProp<ViewStyle>;
};

/** Five tappable stars. Tap the left half of a star for .5, the right half for a whole star. */
export function HalfStarInput({ value, onChange, px = 34, disabled, label, style }: Props) {
  const baseId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const shown = value ?? 0;
  const reduceMotion = useReduceMotion();
  // Each tap remounts the filled stars so they pop in one after another; a light tap on the finger.
  const [popKey, setPopKey] = useState(0);
  const pick = (v: number) => {
    void hapticTap();
    setPopKey((k) => k + 1);
    onChange(v);
  };
  return (
    <View
      style={[styles.row, style]}
      accessibilityRole="adjustable"
      accessibilityLabel={label ?? "Star rating"}
      accessibilityValue={{ min: 0.5, max: MAX_STARS, now: value ?? undefined, text: value ? `${value} stars` : "Not rated" }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) => {
        if (disabled) return;
        const next = e.nativeEvent.actionName === "increment" ? shown + 0.5 : shown - 0.5;
        pick(Math.min(MAX_STARS, Math.max(0.5, next)));
      }}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <Pressable
          key={i}
          disabled={disabled}
          hitSlop={{ top: 6, bottom: 6 }}
          onPress={(e) => pick(starValueFromTap(i, e.nativeEvent.locationX, px))}
          style={{ width: px, height: px }}
        >
          <Animated.View
            key={`${i}-${popKey}`}
            pointerEvents="none"
            entering={!reduceMotion && popKey > 0 && starFill(i, shown) > 0 ? ZoomIn.duration(MOTION.duration.fast).delay(i * MOTION.stagger.stepMs) : undefined}
          >
            <StarGlyph fill={starFill(i, shown)} px={px} clipId={`half-input-${baseId}-${i}`} tone="theme" />
          </Animated.View>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 6, alignItems: "center" },
});

export default HalfStarInput;
