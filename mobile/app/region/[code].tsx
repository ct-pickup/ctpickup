import { useSelectedRegion } from "@/context/SelectedRegionContext";
import {
  isServiceRegionCode,
  serviceRegionName,
  type ServiceRegionCode,
} from "@/lib/serviceRegions";
import { useNavigation } from "@react-navigation/native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useLayoutEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const LIME = "#a3e635";

export default function RegionDetailScreen() {
  const { code: raw } = useLocalSearchParams<{ code: string }>();
  const code = typeof raw === "string" ? raw.toUpperCase() : "";
  const router = useRouter();
  const navigation = useNavigation();
  const { setRegion } = useSelectedRegion();

  const valid = isServiceRegionCode(code);
  const name = valid ? serviceRegionName(code) : "";

  useEffect(() => {
    if (valid) void setRegion(code as ServiceRegionCode);
  }, [valid, code, setRegion]);

  useLayoutEffect(() => {
    if (!valid) return;
    navigation.setOptions({
      title: name,
      headerStyle: { backgroundColor: "#0a0a0a" },
      headerTintColor: "#fff",
      headerShadowVisible: false,
      headerBackTitle: "States",
    });
  }, [navigation, valid, name]);

  if (!valid) {
    return <Redirect href="/(tabs)/runs" />;
  }

  const c = code as ServiceRegionCode;

  return (
      <SafeAreaView style={styles.safe} edges={["bottom"]}>
        <View style={styles.hero}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroCode}>{c}</Text>
          </View>
          <Text style={styles.heroTitle}>{name}</Text>
          <Text style={styles.heroSub}>Your pickup hub in this state shares the same account and Runs tab as everywhere else.</Text>
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Coming into focus</Text>
          <Text style={styles.panelBody}>
            State-specific schedules and fields will appear here as each hub publishes runs tagged to {name}. Until then, use{" "}
            <Text style={styles.bold}>Runs</Text> for this week’s featured game and RSVPs.
          </Text>
        </View>

        <Pressable style={styles.primary} onPress={() => router.replace("/(tabs)/runs")}>
          <FontAwesome name="futbol-o" size={18} color="#0a0a0a" />
          <Text style={styles.primaryText}> Open Runs</Text>
        </Pressable>

        <Pressable style={styles.secondary} onPress={() => router.replace("/(tabs)/runs")}>
          <Text style={styles.secondaryText}>All states</Text>
          <FontAwesome name="map" size={14} color={LIME} style={{ marginLeft: 8 }} />
        </Pressable>
      </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0a0a0a", paddingHorizontal: 20 },
  hero: { alignItems: "center", paddingTop: 12, paddingBottom: 8 },
  heroBadge: {
    width: 88,
    height: 88,
    borderRadius: 24,
    backgroundColor: "rgba(163,230,53,0.1)",
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroCode: { fontSize: 36, fontWeight: "900", color: LIME, letterSpacing: 2 },
  heroTitle: { marginTop: 20, fontSize: 26, fontWeight: "800", color: "#fff", textAlign: "center" },
  heroSub: {
    marginTop: 12,
    fontSize: 16,
    lineHeight: 24,
    color: "rgba(255,255,255,0.55)",
    textAlign: "center",
    maxWidth: 340,
  },
  panel: {
    marginTop: 28,
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  panelTitle: { fontSize: 13, fontWeight: "800", letterSpacing: 1, color: "rgba(255,255,255,0.45)" },
  panelBody: { marginTop: 10, fontSize: 15, lineHeight: 23, color: "rgba(255,255,255,0.72)" },
  bold: { fontWeight: "700", color: "#fff" },
  primary: {
    marginTop: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: LIME,
  },
  primaryText: { color: "#0a0a0a", fontWeight: "800", fontSize: 17 },
  secondary: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
  },
  secondaryText: { color: LIME, fontWeight: "700", fontSize: 16 },
});
