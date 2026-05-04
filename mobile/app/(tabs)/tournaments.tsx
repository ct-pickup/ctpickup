import { FieldTournamentCard } from "@/components/FieldTournamentCard";
import { RegionsPickerPanel } from "@/components/RegionsPickerPanel";
import { useSelectedRegion } from "@/context/SelectedRegionContext";
import { useFieldTournament } from "@/hooks/useFieldTournament";
import { serviceRegionName, type ServiceRegionCode } from "@/lib/serviceRegions";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function TournamentsScreen() {
  const router = useRouter();
  const { setRegion, region } = useSelectedRegion();
  const { loading: fieldLoading, error: fieldError, payload: fieldPayload } = useFieldTournament();
  const navigation = useNavigation();
  const [showStatePicker, setShowStatePicker] = useState(true);

  useEffect(() => {
    navigation.setOptions?.({
      title: showStatePicker ? "Tournament by state" : "Tournaments",
      headerTitleAlign: "center",
      headerStyle: {
        backgroundColor: "#0a0a0a",
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: "rgba(255,255,255,0.08)",
      },
      headerTintColor: "#fff",
      headerShadowVisible: false,
    });
  }, [navigation, showStatePicker]);

  const onPickState = useCallback(
    (code: ServiceRegionCode) => {
      void setRegion(code);
      setShowStatePicker(false);
    },
    [setRegion],
  );

  const body = useMemo(
    () => (
      <>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            Tournaments
          </Text>
          <Pressable
            onPress={() => setShowStatePicker(true)}
            style={({ pressed }) => [styles.statesChip, pressed && { opacity: 0.85 }]}
          >
            <FontAwesome name="map-marker" size={14} color="#a3e635" />
            <Text style={styles.statesChipText}> States</Text>
          </Pressable>
        </View>
        <Text style={styles.sub}>
          Outdoor / in-person bracket for {serviceRegionName(region)} ({region}). Online esports lives in its own tab.
        </Text>
        <FieldTournamentCard
          loading={fieldLoading}
          error={fieldError}
          payload={fieldPayload}
          style={{ marginTop: 18, marginBottom: 8 }}
          onPress={() => router.push("/field-tournament")}
        />
      </>
    ),
    [fieldLoading, fieldError, fieldPayload, region, router],
  );

  if (showStatePicker) {
    return (
      <SafeAreaView style={styles.pickerSafe} edges={["bottom"]}>
        <RegionsPickerPanel onSelectState={onPickState} />
      </SafeAreaView>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      {body}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pickerSafe: { flex: 1, backgroundColor: "#0a0a0a" },
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  scrollContent: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 40 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 4,
  },
  title: { fontSize: 28, fontWeight: "800", color: "#fff", letterSpacing: -0.2, flex: 1, minWidth: 0 },
  statesChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
    backgroundColor: "rgba(163,230,53,0.08)",
  },
  statesChipText: { fontSize: 13, fontWeight: "800", color: "#a3e635" },
  sub: { marginTop: 10, marginBottom: 4, color: "rgba(255,255,255,0.6)", fontSize: 15, lineHeight: 22 },
});
