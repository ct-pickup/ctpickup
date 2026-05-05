import { useAuth } from "@/context/AuthContext";
import { formatTournamentStartEt } from "@/lib/formatTournament";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useNavigation, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";

const LIME = "#a3e635";

type Row = {
  id: string;
  title: string;
  game: string;
  prize: string;
  start_date: string;
  end_date: string | null;
  description: string | null;
  status: string;
};

export default function EsportsTabScreen() {
  const router = useRouter();
  const { supabase, session, isReady } = useAuth();
  const navigation = useNavigation();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [registerBusy, setRegisterBusy] = useState<Record<string, boolean>>({});

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
      .select("id, title, game, prize, start_date, end_date, description, status")
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

  const handleRegister = useCallback(
    async (item: Row) => {
      const token = session?.access_token;
      if (!token) {
        Alert.alert("Sign in required", "Sign in to register for this tournament.");
        return;
      }
      const base = process.env.EXPO_PUBLIC_SITE_URL?.replace(/\/$/, "");
      if (!base) {
        Alert.alert("Configuration error", "Registration is not available right now.");
        return;
      }

      setRegisterBusy((prev) => ({ ...prev, [item.id]: true }));
      try {
        const res = await fetch(`${base}/api/esports/tournament-registration/checkout`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ tournament_id: item.id }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          checkout_url?: string;
          error?: string;
        };

        if (res.ok && data.ok && typeof data.checkout_url === "string" && data.checkout_url) {
          await WebBrowser.openBrowserAsync(data.checkout_url);
          return;
        }

        const errMsg = typeof data.error === "string" ? data.error : `Could not start registration (${res.status}).`;
        const lower = errMsg.toLowerCase();
        if (lower.includes("consent")) {
          Alert.alert("Consent required", "Complete the consent step on the registration page first");
        } else if (lower.includes("waiver")) {
          Alert.alert("Waiver required", "Accept the waiver first");
        } else {
          Alert.alert("Can’t register", errMsg);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Network error.";
        Alert.alert("Can’t register", msg);
      } finally {
        setRegisterBusy((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
      }
    },
    [session],
  );

  const listHeader = useMemo(
    () => (
      <>
        <Text style={styles.title}>Online tournaments</Text>
        <Text style={styles.sub}>EA FC and other digital events registration lines up with your pickup account.</Text>
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
          renderItem={({ item }) => {
            const busy = !!registerBusy[item.id];
            return (
              <View style={styles.card}>
                <View style={styles.row}>
                  <View style={styles.iconWrap}>
                    <FontAwesome name="gamepad" size={18} color={LIME} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{item.title}</Text>
                    <Text style={styles.meta}>{item.game}</Text>
                  </View>
                </View>
                <View style={{ marginTop: 12 }}>
                  <Text style={styles.meta}>
                    <FontAwesome name="calendar" size={14} color="rgba(163,230,53,0.9)" />{" "}
                    <Text>
                      Starts {formatTournamentStartEt(item.start_date)}
                      {item.end_date ? ` — Ends ${formatTournamentStartEt(item.end_date)}` : ""}
                    </Text>
                  </Text>
                  <Text style={styles.meta}>
                    <FontAwesome name="trophy" size={14} color="rgba(163,230,53,0.85)" />{" "}
                    <Text>Prize: {item.prize}</Text>
                  </Text>
                  {item.description ? (
                    <Text style={styles.description} numberOfLines={3}>
                      {item.description}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.pill}>
                  <Text style={styles.pillText}>{item.status === "active" ? "Live" : "Upcoming"}</Text>
                </View>
                <View style={styles.actions}>
                  <Pressable
                    onPress={() => router.push(`/esports/${item.id}`)}
                    style={({ pressed }) => [styles.btn, styles.btnOutline, pressed && { opacity: 0.85 }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Open details for ${item.title}`}
                  >
                    <Text style={styles.btnOutlineText}>Details</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void handleRegister(item)}
                    disabled={busy}
                    style={({ pressed }) => [
                      styles.btn,
                      styles.btnPrimary,
                      busy && { opacity: 0.5 },
                      pressed && !busy && { opacity: 0.9 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Register for ${item.title}`}
                  >
                    {busy ? (
                      <ActivityIndicator color="#111" size="small" />
                    ) : (
                      <Text style={styles.btnPrimaryText}>Register</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            );
          }}
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
  description: { marginTop: 10, color: "rgba(255,255,255,0.72)", fontSize: 14, lineHeight: 20 },
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
  actions: { flexDirection: "row", gap: 10, marginTop: 14 },
  btn: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  btnOutline: {
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.55)",
    backgroundColor: "transparent",
  },
  btnOutlineText: { color: LIME, fontSize: 14, fontWeight: "800" },
  btnPrimary: { backgroundColor: LIME },
  btnPrimaryText: { color: "#111", fontSize: 14, fontWeight: "800" },
});
