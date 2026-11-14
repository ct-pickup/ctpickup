import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useState } from "react";
import { LayoutAnimation, Pressable, StyleSheet, Text, View } from "react-native";

import { useReduceMotion } from "@/hooks/useReduceMotion";
import { hapticTap } from "@/lib/haptics";
import { themeColor, useThemedStyles } from "@/theme";
import { STAR_LEVELS } from "@shared/starLevels";

/** Plain words for the levels whose shared description is blank. Mobile copy only; the shared catalog is mirrored in SQL and stays as is. */
const FALLBACK_DESCRIPTION: Record<string, string> = {
  "1.5": "Learning the game, comfortable in a casual kickaround",
  "1.0": "New to organized soccer",
  "0.5": "First games",
};

export function legendDescription(star: number, description: string): string {
  return description || FALLBACK_DESCRIPTION[star.toFixed(1)] || "";
}

/** Levels shown in the legend: 1.0 and up, strongest first. */
export const LEGEND_LEVELS = [...STAR_LEVELS].filter((l) => l.star >= 1).sort((a, b) => b.star - a.star);

export const LEGEND_TOGGLE_LABEL = "What do the ratings mean?";

/**
 * Collapsed row that expands into the rating scale. Two columns: a fixed width label column ("1.5  Developing") that never wraps
 * mid-label, and the description. Starts collapsed so the first player stays on screen.
 */
export function RatingScaleLegend({ style }: { style?: object }) {
  useThemedStyles(publish_styles);
  const reduceMotion = useReduceMotion();
  const [open, setOpen] = useState(false);
  const toggle = () => {
    void hapticTap();
    if (!reduceMotion) LayoutAnimation.configureNext(LayoutAnimation.create(200, "easeInEaseOut", "opacity"));
    setOpen((v) => !v);
  };
  return (
    <View style={[styles.card, style]}>
      <Pressable onPress={toggle} style={styles.toggleRow} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={LEGEND_TOGGLE_LABEL}>
        <Text style={styles.toggleText}>{LEGEND_TOGGLE_LABEL}</Text>
        <FontAwesome name={open ? "chevron-up" : "chevron-down"} size={12} color={themeColor().muted} />
      </Pressable>
      {open
        ? LEGEND_LEVELS.map((l) => (
            <View key={l.star} style={styles.row}>
              <View style={styles.labelCol}>
                <Text style={styles.star} allowFontScaling={false}>
                  {l.star.toFixed(1)}
                </Text>
                <Text style={styles.name} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
                  {l.name}
                </Text>
              </View>
              <Text style={styles.desc}>{legendDescription(l.star, l.description)}</Text>
            </View>
          ))
        : null}
    </View>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    card: { marginHorizontal: 16, marginBottom: 4, paddingHorizontal: 12, paddingVertical: 4, backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.line },
    toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10 },
    toggleText: { color: c.text, fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    row: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
    labelCol: { width: 118, flexDirection: "row", alignItems: "baseline", gap: 6 },
    star: { color: c.text, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700", width: 26 },
    name: { color: c.text, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700", flexShrink: 1 },
    desc: { flex: 1, color: c.muted, fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
