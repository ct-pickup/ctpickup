import { useAuth } from "@/context/AuthContext";
import { fetchAdminMonthlyLeaders, type MonthlyLeadersResponse } from "@/lib/adminApi";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const LIME = "#a3e635";
const BG = "#0a0a0a";

function winnerLabel(reason: string, discountPct: number | null): string {
  if (reason === "monthly_pod") return "POD winner · Free run";
  if (reason === "monthly_attendance") {
    return discountPct ? `Attendance winner · ${discountPct}% off` : "Attendance winner";
  }
  return "Winner";
}

function LeaderList({
  rows,
  emptyText,
  countSuffix,
}: {
  rows: { user_id: string; name: string; count: number }[];
  emptyText: string;
  countSuffix?: string;
}) {
  if (rows.length === 0) {
    return <Text style={styles.muted}>{emptyText}</Text>;
  }
  return (
    <>
      {rows.map((row, i) => (
        <View key={row.user_id} style={styles.leaderRow}>
          <Text style={styles.rank}>{i + 1}</Text>
          <Text style={styles.leaderName} numberOfLines={1}>
            {row.name}
          </Text>
          <Text style={styles.leaderCount}>
            {row.count}
            {countSuffix ? ` ${countSuffix}` : ""}
          </Text>
        </View>
      ))}
    </>
  );
}

export default function MonthlyLeadersScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const token = session?.access_token ?? null;

  const [data, setData] = useState<MonthlyLeadersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (isRefresh = false) => {
      if (!token) {
        setError("Not signed in.");
        setData(null);
        setLoading(false);
        setRefreshing(false);
        return;
      }
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      const r = await fetchAdminMonthlyLeaders(token);
      if (isRefresh) setRefreshing(false);
      else setLoading(false);
      if (!r.ok) {
        setError(r.error);
        setData(null);
        return;
      }
      setData(r.data);
    },
    [token],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const podWinner = useMemo(
    () => data?.last_month_winners.find((w) => w.reason === "monthly_pod") ?? null,
    [data],
  );
  const attendanceWinner = useMemo(
    () => data?.last_month_winners.find((w) => w.reason === "monthly_attendance") ?? null,
    [data],
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.85 }]}>
          <FontAwesome name="chevron-left" size={18} color="#fff" />
          <Text style={styles.backBtnText}>Back</Text>
        </Pressable>
        <Text style={styles.topTitle}>Monthly Leaders</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load(true)}
            tintColor={LIME}
          />
        }
      >
        {loading && !data ? (
          <ActivityIndicator color={LIME} style={{ marginTop: 24 }} />
        ) : null}
        {error ? <Text style={styles.err}>{error}</Text> : null}

        {data ? (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>POD This Month</Text>
              <Text style={styles.cardSub}>Top 3 by Player of the Day awards</Text>
              <LeaderList rows={data.pod_top} emptyText="No POD awards yet." />
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Attendance This Month</Text>
              <Text style={styles.cardSub}>Top 3 by confirmed runs</Text>
              <LeaderList rows={data.attendance_top} emptyText="No confirmed runs yet." countSuffix="runs" />
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Last Month&apos;s Winners</Text>
              {data.previous_month_key ? (
                <Text style={styles.cardSub}>{data.previous_month_key}</Text>
              ) : null}
              {!podWinner && !attendanceWinner ? (
                <Text style={styles.muted}>Winners announced on the 1st.</Text>
              ) : (
                <>
                  {podWinner ? (
                    <View style={styles.winnerRow}>
                      <FontAwesome name="trophy" size={16} color={LIME} />
                      <View style={styles.winnerBody}>
                        <Text style={styles.winnerName}>{podWinner.name}</Text>
                        <Text style={styles.winnerMeta}>{winnerLabel(podWinner.reason, podWinner.discount_pct)}</Text>
                      </View>
                    </View>
                  ) : null}
                  {attendanceWinner ? (
                    <View style={[styles.winnerRow, podWinner ? { marginTop: 12 } : null]}>
                      <FontAwesome name="calendar-check-o" size={16} color={LIME} />
                      <View style={styles.winnerBody}>
                        <Text style={styles.winnerName}>{attendanceWinner.name}</Text>
                        <Text style={styles.winnerMeta}>
                          {winnerLabel(attendanceWinner.reason, attendanceWinner.discount_pct)}
                        </Text>
                      </View>
                    </View>
                  ) : null}
                </>
              )}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingRight: 8,
  },
  backBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  topTitle: { flex: 1, fontSize: 22, fontWeight: "800", color: "#fff" },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40, gap: 14 },
  err: { color: "#fca5a5", lineHeight: 20, marginBottom: 8 },
  card: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.25)",
    backgroundColor: "rgba(163,230,53,0.06)",
  },
  cardTitle: { color: LIME, fontSize: 16, fontWeight: "800" },
  cardSub: { color: "rgba(255,255,255,0.5)", fontSize: 12, marginTop: 4, marginBottom: 12 },
  leaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  rank: { width: 22, color: LIME, fontWeight: "800", fontSize: 15 },
  leaderName: { flex: 1, color: "#fff", fontSize: 15, fontWeight: "600" },
  leaderCount: { color: "rgba(255,255,255,0.65)", fontSize: 14, fontWeight: "700" },
  muted: { color: "rgba(255,255,255,0.45)", fontSize: 14, fontStyle: "italic" },
  winnerRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  winnerBody: { flex: 1, minWidth: 0 },
  winnerName: { color: "#fff", fontSize: 16, fontWeight: "700" },
  winnerMeta: { color: "rgba(255,255,255,0.55)", fontSize: 13, marginTop: 4 },
});
