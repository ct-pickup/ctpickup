import { FieldTournamentCard } from "@/components/FieldTournamentCard";
import { RegionsPickerPanel } from "@/components/RegionsPickerPanel";
import { useAuth } from "@/context/AuthContext";
import { useSelectedRegion } from "@/context/SelectedRegionContext";
import { useFieldTournament } from "@/hooks/useFieldTournament";
import { formatTournamentStartEt } from "@/lib/formatTournament";
import { serviceRegionName, type ServiceRegionCode } from "@/lib/serviceRegions";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Row = {
  id: string;
  title: string;
  game: string;
  prize: string;
  start_date: string;
  status: string;
};

export default function TournamentsScreen() {
  const router = useRouter();
  const { supabase, isReady } = useAuth();
  const { setRegion, region } = useSelectedRegion();
  const { loading: fieldLoading, error: fieldError, payload: fieldPayload } = useFieldTournament();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

  const load = useCallback(async () => {
    if (!supabase) {
      setError(!isReady ? "Loading…" : "Configure Supabase env in mobile/.env");
      setLoading(false);
      return;
    }
    setError(null);
    const { data, error: qErr } = await supabase
      .from("esports_tournaments")
      .select("id, title, game, prize, start_date, status")
      .in("status", ["upcoming", "active"])
      .order("start_date", { ascending: true });

    if (qErr) {
      setError(qErr.message);
      setRows([]);
    } else {
      setRows((data as Row[]) ?? []);
    }
    setLoading(false);
  }, [supabase, isReady]);

  useEffect(() => {
    void load();
  }, [load]);

  const onPickState = useCallback(
    (code: ServiceRegionCode) => {
      void setRegion(code);
      setShowStatePicker(false);
    },
    [setRegion],
  );

  const listHeader = useMemo(
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
          In-person bracket for {serviceRegionName(region)} ({region}) plus EA FC online events — same hub as the site.
        </Text>
        <FieldTournamentCard
          loading={fieldLoading}
          error={fieldError}
          payload={fieldPayload}
          style={{ marginTop: 18, marginBottom: 22 }}
          onPress={() => router.push("/field-tournament")}
        />
        <Text style={styles.sectionEsports}>Esports (online)</Text>
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
    <View style={styles.container}>
      {loading ? (
        <>
          {listHeader}
          <ActivityIndicator size="large" color="#fff" style={{ marginTop: 24 }} />
        </>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={<Text style={styles.empty}>{error ?? "No upcoming or active esports tournaments."}</Text>}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/esports/${item.id}`)}
              style={({ pressed }) => [styles.esportsCard, pressed && { opacity: 0.92 }]}
              accessibilityRole="button"
              accessibilityLabel={`${item.title}, open details`}
            >
              <View style={styles.esportsRow}>
                <View style={styles.esportsIconWrap}>
                  <FontAwesome name="gamepad" size={18} color="#a3e635" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  <Text style={styles.meta}>{item.game}</Text>
                </View>
                <FontAwesome name="chevron-right" size={14} color="rgba(255,255,255,0.35)" />
              </View>
              <View style={{ marginTop: 12 }}>
                <Text style={styles.meta}>
                  <FontAwesome name="calendar" size={14} color="rgba(163,230,53,0.9)" />{" "}
                  <Text>Starts {formatTournamentStartEt(item.start_date)}</Text>
                </Text>
                <Text style={styles.meta}>
                  <FontAwesome name="trophy" size={14} color="rgba(163,230,53,0.85)" />{" "}
                  <Text>Prize: {item.prize}</Text>
                </Text>
              </View>
              <View style={styles.pill}>
                <Text style={styles.pillText}>{item.status === "active" ? "Live" : "Upcoming"}</Text>
              </View>
            </Pressable>
          )}
          contentContainerStyle={
            rows.length === 0 ? { flexGrow: 1, paddingTop: 0, paddingBottom: 40 } : { paddingTop: 0, paddingBottom: 40 }
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pickerSafe: { flex: 1, backgroundColor: "#0a0a0a" },
  container: { flex: 1, backgroundColor: "#0a0a0a", paddingHorizontal: 20, paddingTop: 18 },
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
  sectionEsports: {
    marginBottom: 14,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: "rgba(255,255,255,0.45)",
  },
  esportsCard: {
    marginBottom: 14,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.25)",
    backgroundColor: "rgba(163,230,53,0.06)",
  },
  esportsRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  esportsIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
    backgroundColor: "rgba(10,10,10,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: { fontSize: 20, fontWeight: "800", color: "#fff", lineHeight: 26 },
  meta: { marginTop: 6, color: "rgba(255,255,255,0.6)", fontSize: 14, lineHeight: 20 },
  pill: {
    alignSelf: "flex-start",
    marginTop: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
    backgroundColor: "rgba(163,230,53,0.12)",
  },
  pillText: { color: "rgba(163,230,53,0.95)", fontSize: 12, fontWeight: "800", textTransform: "capitalize" },
  empty: { color: "rgba(255,255,255,0.55)", fontSize: 15, marginTop: 8 },
});
