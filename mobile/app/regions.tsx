import { RegionsPickerPanel } from "@/components/RegionsPickerPanel";
import { useSelectedRegion } from "@/context/SelectedRegionContext";
import { type ServiceRegionCode } from "@/lib/serviceRegions";
import { Stack, useRouter } from "expo-router";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function RegionsScreen() {
  const router = useRouter();
  const { setRegion } = useSelectedRegion();

  return (
    <>
      <Stack.Screen
        options={{
          title: "Pickup by state",
          headerStyle: { backgroundColor: "#0a0a0a" },
          headerTintColor: "#fff",
          headerShadowVisible: false,
          headerTitleAlign: "center",
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="More options"
              onPress={() => {
                // Placeholder for future actions menu.
              }}
              style={({ pressed }) => [styles.moreBtn, pressed && { opacity: 0.85 }]}
              hitSlop={10}
            >
              <FontAwesome name="ellipsis-h" size={18} color="#a3e635" />
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0a0a0a" },
  moreBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.28)",
    backgroundColor: "rgba(163,230,53,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
});
