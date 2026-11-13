import { useId } from "react";
import { StyleSheet, Text, View } from "react-native";

import { StarGlyph } from "@/components/StarRating";
import { starNumberText } from "@/lib/starFillCore";
import { themeColor, useThemedStyles } from "@/theme";

/**
 * The "Stars" stat: one star glyph, the rating with the same value and rounding as the Players > Stars leaderboard, and a "New" chip
 * while the rating is provisional. "No rating yet" (muted) without a rating.
 */
export function StarsStatValue({ star, exact, provisional, size = 16 }: { star: number | null; exact?: number | null; provisional?: boolean; size?: number }) {
  useThemedStyles(publish_styles);
  const clipId = `stars-stat-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  if (star == null) {
    return (
      <Text style={styles.none} numberOfLines={1}>
        No rating yet
      </Text>
    );
  }
  const text = starNumberText(star, exact);
  return (
    <View style={styles.row} accessible accessibilityLabel={`${text} stars${provisional ? ", new player" : ""}`}>
      <StarGlyph fill={1} px={size} clipId={clipId} tone="theme" />
      <Text style={[styles.value, { fontSize: size }]} numberOfLines={1}>
        {text}
      </Text>
      {provisional ? (
        <View style={styles.chip}>
          <Text style={styles.chipText}>New</Text>
        </View>
      ) : null}
    </View>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: 4 },
    value: { color: c.text, fontFamily: "Inter_700Bold", fontWeight: "700" },
    none: { color: c.muted, fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    chip: { marginLeft: 2, paddingHorizontal: 6, borderRadius: 999, borderWidth: 1, borderColor: c.line },
    chipText: { color: c.muted, fontSize: 10, lineHeight: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
