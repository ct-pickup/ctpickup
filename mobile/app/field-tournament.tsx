import { FieldTournamentCard } from "@/components/FieldTournamentCard";
import { useSelectedRegion } from "@/context/SelectedRegionContext";
import { useFieldTournament } from "@/hooks/useFieldTournament";
import { serviceRegionName } from "@/lib/serviceRegions";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useNavigation } from "expo-router";
import { useEffect } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

export default function FieldTournamentDetailScreen() {
  const navigation = useNavigation();
  const { region } = useSelectedRegion();
  const { loading, error, payload } = useFieldTournament();

  useEffect(() => {
    navigation.setOptions?.({
      title: "In-person tournament",
      headerTitleAlign: "center",
      headerStyle: {
        backgroundColor: "#0a0a0a",
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: "rgba(255,255,255,0.08)",
      },
      headerTintColor: "#fff",
      headerShadowVisible: false,
    });
  }, [navigation]);

  const t = payload?.tournament;

  useEffect(() => {
    if (t?.title) {
      navigation.setOptions?.({ title: String(t.title).slice(0, 42) });
    }
  }, [navigation, t?.title]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.kicker}>HUB · {serviceRegionName(region)}</Text>
      <Text style={styles.lead}>
        Outdoor bracket hub for this state — team counts and announcements match what staff publish online. Captain claims
        and roster slots follow tournament rules on the server.
      </Text>

      <FieldTournamentCard loading={loading} error={error} payload={payload} style={{ marginTop: 8 }} />

      {payload?.tournament && payload.tournament.announcement ? (
        <View style={styles.note}>
          <FontAwesome name="bullhorn" size={16} color="rgba(163,230,53,0.85)" />
          <Text style={styles.noteText}>{payload.tournament.announcement}</Text>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About this bracket</Text>
        <Text style={styles.body}>
          This screen is only for the in-person captain bracket. Online EA FC events are listed under the Tournaments tab.
          When staff post updates above, they appear here too.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0a0a0a" },
  content: { padding: 20, paddingBottom: 40 },
  kicker: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.4,
    color: "rgba(163,230,53,0.65)",
  },
  lead: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 22,
    color: "rgba(255,255,255,0.58)",
  },
  note: {
    marginTop: 18,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.22)",
    backgroundColor: "rgba(163,230,53,0.06)",
  },
  noteText: { flex: 1, fontSize: 14, lineHeight: 21, color: "rgba(255,255,255,0.78)" },
  section: { marginTop: 28 },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: "#fff" },
  body: {
    marginTop: 10,
    fontSize: 14,
    lineHeight: 21,
    color: "rgba(255,255,255,0.62)",
  },
});
