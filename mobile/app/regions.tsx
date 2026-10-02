import { RegionsPickerPanel } from "@/components/RegionsPickerPanel";
import { useSelectedRegion } from "@/context/SelectedRegionContext";
import { type ServiceRegionCode } from "@/lib/serviceRegions";
import { Stack, useRouter } from "expo-router";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { themeColor, useThemedStyles } from "@/theme";
export default function RegionsScreen() {
  useThemedStyles(publish_styles);

  const router = useRouter();
  const { setRegion } = useSelectedRegion();

  return (
    <>
      <Stack.Screen
        options={{
          title: "Pickup by state",
          headerStyle: { backgroundColor: themeColor().bg },
          headerTintColor: themeColor().text,
          headerShadowVisible: false,
          headerTitleAlign: "center",
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="More options"
              onPress={() => {}}
              style={({ pressed }) => [styles.moreBtn, pressed && { opacity: 0.85 }]}
              hitSlop={10}
            >
              <FontAwesome name="ellipsis-h" size={18} color={themeColor().pitchText} />
            </Pressable>
          ),
        }}
      />
      <SafeAreaView style={styles.safe} edges={["bottom"]}>
        <RegionsPickerPanel
          onSelectState={(code: ServiceRegionCode) => {
            void setRegion(code);
            router.push(`/region/${code}`);
          }}
        />
      </SafeAreaView>
    </>
  );
}

function make_styles() {
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: themeColor().bg },
  moreBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().pitch,
    backgroundColor: themeColor().pitchSoft,
    alignItems: "center",
    justifyContent: "center",
  },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}

