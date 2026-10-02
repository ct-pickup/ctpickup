import { useReviewMode } from "@/context/ReviewModeContext";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { themeColor, useThemedStyles } from "@/theme";
export function ReviewModeBanner() {
  useThemedStyles(publish_styles);

  const insets = useSafeAreaInsets();
  const { enabled, isReady, setEnabled } = useReviewMode();

  if (!isReady || !enabled) return null;

  return (
    <View style={[styles.wrap, { paddingTop: Math.max(insets.top, 8) }]} pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="App Review Mode Active. Tap to turn off."
        onPress={() => void setEnabled(false)}
        style={styles.banner}
      >
        <Text style={styles.text}>App Review Mode Active</Text>
        <Text style={styles.hint}>Tap to turn off</Text>
      </Pressable>
    </View>
  );
}

function make_styles() {
  return StyleSheet.create({
  wrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    alignItems: "center",
  },
  banner: {
    backgroundColor: themeColor().pitch,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: "center",
  },
  text: {
    color: themeColor().onPitch,
    fontSize: 13, fontFamily: "Inter_700Bold",
    fontWeight: "800",
  },
  hint: {
    color: themeColor().onPitch,
    fontSize: 13, fontFamily: "Inter_400Regular",
    marginTop: 4,
  },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}

