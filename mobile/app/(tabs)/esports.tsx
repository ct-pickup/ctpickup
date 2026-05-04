import { useAuth } from "@/context/AuthContext";
import { formatTournamentStartEt } from "@/lib/formatTournament";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";

type Row = {
  id: string;
  title: string;
  game: string;
  prize: string;
  start_date: string;
  status: string;
};

export default function EsportsTabScreen() {
  const router = useRouter();
  const { supabase, isReady } = useAuth();
  const navigation = useNavigation();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions?.({
      title: "Esports",
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

  const listHeader = useMemo(
    () => (
      <>
        <Text style={styles.title}>Online tournaments</Text>
        <Text style={styles.sub}>EA FC and other digital events — registration lines up with your pickup account.</Text>
      </>
    ),
    [],
  );

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
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.92 }]}
              accessibilityRole="button"
              accessibilityLabel={`${item.title}, open details`}
            >
              <View style={styles.row}>
                <View style={styles.iconWrap}>
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
  container: { flex: 1, backgroundColor: "#0a0a0a", paddingHorizontal: 20, paddingTop: 18 },
  title: { fontSize: 28, fontWeight: "800", color: "#fff", letterSpacing: -0.2 },
  sub: { marginTop: 10, marginBottom: 18, color: "rgba(255,255,255,0.6)", fontSize: 15, lineHeight: 22 },
  card: {
    marginBottom: 14,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.25)",
    backgroundColor: "rgba(163,230,53,0.06)",
  },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  iconWrap: {
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
