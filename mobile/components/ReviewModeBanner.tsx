import { useReviewMode } from "@/context/ReviewModeContext";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const LIME = "#a3e635";

export function ReviewModeBanner() {
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

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    alignItems: "center",
  },
  banner: {
    backgroundColor: LIME,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: "center",
  },
  text: {
    color: "#0a0a0a",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  hint: {
    color: "rgba(10,10,10,0.65)",
    fontSize: 10,
    marginTop: 2,
  },
});
