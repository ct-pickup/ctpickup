import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AnimatedPressScale } from "@/components/AnimatedPressScale";
import { SheetModal } from "@/components/motion/SheetModal";
import { MOTION } from "@/lib/motion";
import { RATING_SHEET_BODY, RATING_SHEET_BUTTON, RATING_SHEET_TITLE } from "@/lib/pendingRatingCore";
import { headline, themeColor, useThemedStyles } from "@/theme";

/** "Rate your last game first": the title, one line, and a single button that goes straight to that game's ballot. Nothing else. */
export function RatingRequiredSheet({ visible, onGo, onClose }: { visible: boolean; onGo: () => void; onClose: () => void }) {
  useThemedStyles(publish_styles);
  const insets = useSafeAreaInsets();
  return (
    <SheetModal visible={visible} onClose={onClose}>
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
        <View style={styles.handle} />
        <Text style={styles.title} accessibilityRole="header">
          {RATING_SHEET_TITLE}
        </Text>
        <Text style={styles.body}>{RATING_SHEET_BODY}</Text>
        <AnimatedPressScale onPress={onGo} hapticOnPress pressedScale={MOTION.pressScale.button} style={styles.button} accessibilityRole="button" accessibilityLabel={RATING_SHEET_BUTTON}>
          <Text style={styles.buttonText}>{RATING_SHEET_BUTTON}</Text>
        </AnimatedPressScale>
      </View>
    </SheetModal>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    sheet: { backgroundColor: c.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 8 },
    handle: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: c.line, marginBottom: 14 },
    title: { color: c.text, fontSize: 22, ...headline, marginBottom: 6 },
    body: { color: c.muted, fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 21, marginBottom: 18 },
    button: { backgroundColor: c.pitch, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
    buttonText: { color: c.onPitch, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
