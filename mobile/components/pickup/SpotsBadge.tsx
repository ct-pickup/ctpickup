import React from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { radius, themeColor, useThemedStyles } from "@/theme";

const URGENT_AT = 3;

export function spotsLeftLabel(spotsLeft: number): string {
  if (spotsLeft <= 0) return "Full";
  return `${spotsLeft} spot${spotsLeft === 1 ? "" : "s"} left`;
}

/** Spots-left pill. Coral when 3 or fewer remain, neutral otherwise. */
export default function SpotsBadge({ spotsLeft, style }: { spotsLeft: number; style?: StyleProp<ViewStyle> }) {
  useThemedStyles(publish_styles);
  const urgent = spotsLeft <= URGENT_AT;
  return (
    <View style={[styles.badge, urgent && styles.urgent, style]}>
      {urgent ? <View style={styles.dot} /> : null}
      <Text style={[styles.text, urgent && styles.urgentText]}>{spotsLeftLabel(spotsLeft)}</Text>
    </View>
  );
}

function make_styles() {
  return StyleSheet.create({
    badge: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: themeColor().line,
      backgroundColor: themeColor().card,
    },
    urgent: { borderColor: themeColor().coral },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: themeColor().coral },
    text: { fontSize: 11, fontFamily: "Inter_700Bold", color: themeColor().muted },
    urgentText: { color: themeColor().coralText },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
