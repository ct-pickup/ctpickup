import { StyleSheet, Text, View } from "react-native";

import type { PlayerOutcome } from "@/lib/pickup/resultOutcome";
import { themeColor, useThemedStyles } from "@/theme";

const WORD: Record<PlayerOutcome, string> = { W: "Win", D: "Draw", L: "Loss" };

/** Last results as W/D/L pills, oldest first (the record helper's `form`). */
export default function FormPills({ form, dots = false }: { form: PlayerOutcome[]; dots?: boolean }) {
  useThemedStyles(publish_styles);
  return (
    <View style={[styles.row, dots && styles.rowDots]} accessible accessibilityLabel={`Last ${form.length}: ${form.map((o) => WORD[o]).join(", ")}`}>
      {form.map((o, i) => (
        <View key={i} style={[styles.pill, dots && styles.dot, styles[`pill_${o}`]]}>
          <Text style={[styles.text, dots && styles.textDot, styles[`text_${o}`]]}>{o}</Text>
        </View>
      ))}
    </View>
  );
}

function make_styles() {
  return StyleSheet.create({
    row: { flexDirection: "row", gap: 8 },
    rowDots: { flexWrap: "wrap", gap: 6 },
    dot: { minWidth: 0, width: 24, height: 24, paddingHorizontal: 0 },
    textDot: { fontSize: 11 },
    pill: { minWidth: 40, height: 32, paddingHorizontal: 12, borderRadius: 999, alignItems: "center", justifyContent: "center" },
    pill_W: { backgroundColor: themeColor().success },
    pill_D: { backgroundColor: themeColor().overlayStrong },
    pill_L: { borderWidth: 1.5, borderColor: themeColor().line },
    text: { fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "700" },
    text_W: { color: themeColor().onPitch },
    text_D: { color: themeColor().text },
    text_L: { color: themeColor().muted },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
