import { Pressable, StyleSheet, Text, View } from "react-native";

import { usePlanStatus } from "@/hooks/usePlanStatus";
import { radius, themeColor, useThemedStyles } from "@/theme";
import { yourPlanLine } from "@shared/fields/plans";

/** "Your plan" with requests left. Tapping opens the Plans screen. */
export function YourPlan({ onPress }: { onPress: () => void }) {
  useThemedStyles(publish_styles);
  const { status } = usePlanStatus();
  const line = yourPlanLine(status);
  return (
    <Pressable onPress={onPress} style={styles.card} accessibilityRole="button" accessibilityLabel={`Your plan: ${line.title}. ${line.detail}`}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.label}>Your plan</Text>
        <Text style={styles.title}>{line.title}</Text>
        <Text style={styles.detail}>{line.detail}</Text>
      </View>
      <Text style={styles.link}>Plans ›</Text>
    </Pressable>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    card: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, backgroundColor: c.card, borderRadius: radius.card, borderWidth: 1, borderColor: c.line },
    label: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: c.muted },
    title: { fontSize: 17, fontFamily: "Inter_700Bold", fontWeight: "700", color: c.text },
    detail: { fontSize: 13, fontFamily: "Inter_400Regular", color: c.muted },
    link: { fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: c.pitchText },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
