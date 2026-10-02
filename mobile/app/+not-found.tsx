import { AnimatedPressScale } from "@/components/AnimatedPressScale";
import { Stack, useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { themeColor, useThemedStyles } from "@/theme";
export default function NotFoundScreen() {
  useThemedStyles(publish_styles);

  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <>
      <Stack.Screen
        options={{
          title: "Not found",
          headerStyle: { backgroundColor: themeColor().bg },
          headerTintColor: themeColor().text,
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

function make_styles() {
  return StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: themeColor().bg,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 12,
  },
  code: {
    fontSize: 56, fontFamily: "InstrumentSerif_400Regular",
    fontWeight: "900",
    color: themeColor().pitchText,
    lineHeight: 88,
  },
  title: {
    fontSize: 24, fontFamily: "InstrumentSerif_400Regular",
    fontWeight: "800",
    color: themeColor().text,
  },
  body: {
    fontSize: 16, fontFamily: "Inter_400Regular",
    color: themeColor().muted,
    textAlign: "center",
    lineHeight: 22,
  },
  btn: {
    marginTop: 12,
    backgroundColor: themeColor().pitch,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 36,
    alignItems: "center",
  },
  btnText: {
    color: themeColor().onPitch,
    fontSize: 16, fontFamily: "Inter_700Bold",
    fontWeight: "900",
  },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}

