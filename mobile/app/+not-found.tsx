import { AnimatedPressScale } from "@/components/AnimatedPressScale";
import { Stack, useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const BG = "#0a0a0a";
const LIME = "#a3e635";

export default function NotFoundScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <>
      <Stack.Screen
        options={{
          title: "Not found",
          headerStyle: { backgroundColor: BG },
          headerTintColor: "#fff",
          headerShadowVisible: false,
        }}
      />
      <View style={[styles.root, { paddingBottom: insets.bottom + 24 }]}>
        <Text style={styles.code}>404</Text>
        <Text style={styles.title}>Page not found</Text>
        <Text style={styles.body}>
          This screen doesn&apos;t exist or has been moved.
        </Text>
        <AnimatedPressScale
          hapticOnPress
          pressedScale={0.97}
          onPress={() => router.replace("/(tabs)")}
          style={styles.btn}
        >
          <Text style={styles.btnText}>Go home</Text>
        </AnimatedPressScale>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 12,
  },
  code: {
    fontSize: 80,
    fontWeight: "900",
    color: LIME,
    letterSpacing: -3,
    lineHeight: 88,
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: -0.4,
  },
  body: {
    fontSize: 15,
    color: "rgba(255,255,255,0.5)",
    textAlign: "center",
    lineHeight: 22,
  },
  btn: {
    marginTop: 12,
    backgroundColor: LIME,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 36,
    alignItems: "center",
  },
  btnText: {
    color: "#0a0a0a",
    fontSize: 16,
    fontWeight: "900",
  },
});
