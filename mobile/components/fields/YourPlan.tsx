import { Pressable, StyleSheet, Text } from "react-native";

import { usePlanStatus } from "@/hooks/usePlanStatus";
import { themeColor, useThemedStyles } from "@/theme";
import { yourPlanLine } from "@shared/fields/plans";

/** One compact line, "Do it yourself · Plans ›". Tapping opens the Plans screen. */
export function YourPlan({ onPress }: { onPress: () => void }) {
  useThemedStyles(publish_styles);
  const { status, seasons } = usePlanStatus();
  const line = yourPlanLine(status, seasons);
  return (
    <Pressable onPress={onPress} style={styles.row} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Your plan: ${line.title}. ${line.detail}. Open plans.`}>
      <Text style={styles.title} numberOfLines={1}>
        {line.title} · <Text style={styles.link}>Plans ›</Text>
      </Text>
    </Pressable>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    row: { alignSelf: "flex-start", minHeight: 24, justifyContent: "center" },
    title: { fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: c.muted },
    link: { color: c.pitchText },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
