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

import { themeColor, useThemedStyles } from "@/theme";
export default function RegionDetailScreen() {
  useThemedStyles(publish_styles);

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
      headerStyle: { backgroundColor: themeColor().bg },
      headerTintColor: themeColor().text,
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
          <FontAwesome name="futbol-o" size={18} color={themeColor().onPitch} />
          <Text style={styles.primaryText}> Open Runs</Text>
        </Pressable>

        <Pressable style={styles.secondary} onPress={() => router.replace("/(tabs)/runs")}>
          <Text style={styles.secondaryText}>All states</Text>
          <FontAwesome name="map" size={14} color={themeColor().pitchText} style={{ marginLeft: 8 }} />
        </Pressable>
      </SafeAreaView>
  );
}

function make_styles() {
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: themeColor().bg, paddingHorizontal: 20 },
  hero: { alignItems: "center", paddingTop: 12, paddingBottom: 8 },
  heroBadge: {
    width: 88,
    height: 88,
    borderRadius: 999,
    backgroundColor: themeColor().pitchPanel,
    borderWidth: 1,
    borderColor: themeColor().pitch,
    alignItems: "center",
    justifyContent: "center",
  },
  heroCode: { fontSize: 40, fontFamily: "InstrumentSerif_400Regular", fontWeight: "900", color: themeColor().pitchText,},
  heroTitle: { marginTop: 20, fontSize: 24, fontFamily: "InstrumentSerif_400Regular", fontWeight: "800", color: themeColor().text, textAlign: "center" },
  heroSub: {
    marginTop: 12,
    fontSize: 16, fontFamily: "Inter_400Regular",
    lineHeight: 24,
    color: themeColor().muted,
    textAlign: "center",
    maxWidth: 340,
  },
  panel: {
    marginTop: 28,
    padding: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().card,
  },
  panelTitle: { fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "800", color: themeColor().muted },
  panelBody: { marginTop: 10, fontSize: 16, fontFamily: "Inter_400Regular", lineHeight: 23, color: themeColor().muted },
  bold: { fontWeight: "700", color: themeColor().text },
  primary: {
    marginTop: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: themeColor().pitch,
  },
  primaryText: { color: themeColor().onPitch, fontWeight: "800", fontSize: 16, fontFamily: "Inter_700Bold" },
  secondary: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
  },
  secondaryText: { color: themeColor().pitchText, fontWeight: "700", fontSize: 16, fontFamily: "Inter_700Bold" },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}

