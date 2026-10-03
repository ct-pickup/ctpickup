import { useId } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

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
        onChange(Math.min(MAX_STARS, Math.max(0.5, next)));
      }}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <Pressable
          key={i}
          disabled={disabled}
          hitSlop={{ top: 6, bottom: 6 }}
          onPress={(e) => onChange(starValueFromTap(i, e.nativeEvent.locationX, px))}
          style={{ width: px, height: px }}
        >
          <View pointerEvents="none">
            <StarGlyph fill={starFill(i, shown)} px={px} clipId={`half-input-${baseId}-${i}`} tone="theme" />
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 6, alignItems: "center" },
});

export default HalfStarInput;
