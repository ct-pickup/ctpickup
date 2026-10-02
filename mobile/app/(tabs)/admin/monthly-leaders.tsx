import { useAuth } from "@/context/AuthContext";
import { fetchAdminMonthlyLeaders, type MonthlyLeadersResponse } from "@/lib/adminApi";
import { goToAdminMenu } from "@/lib/adminNavigation";
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

import { themeColor, useThemedStyles } from "@/theme";
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
  useThemedStyles(publish_styles);

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
  useThemedStyles(publish_styles);

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
        <Pressable onPress={() => goToAdminMenu(router)} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.85 }]}>
          <FontAwesome name="chevron-left" size={18} color={themeColor().text} />
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
            tintColor={themeColor().pitchText}
          />
        }
      >
        {loading && !data ? (
          <ActivityIndicator color={themeColor().pitchText} style={{ marginTop: 24 }} />
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
                      <FontAwesome name="trophy" size={16} color={themeColor().pitchText} />
                      <View style={styles.winnerBody}>
                        <Text style={styles.winnerName}>{podWinner.name}</Text>
                        <Text style={styles.winnerMeta}>{winnerLabel(podWinner.reason, podWinner.discount_pct)}</Text>
                      </View>
                    </View>
                  ) : null}
                  {attendanceWinner ? (
                    <View style={[styles.winnerRow, podWinner ? { marginTop: 12 } : null]}>
                      <FontAwesome name="calendar-check-o" size={16} color={themeColor().pitchText} />
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

function make_styles() {
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: themeColor().bg },
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
    gap: 4,
    paddingVertical: 8,
    paddingRight: 8,
  },
  backBtnText: { color: themeColor().text, fontSize: 16, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  topTitle: { flex: 1, fontSize: 24, fontFamily: "InstrumentSerif_400Regular", fontWeight: "800", color: themeColor().text },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  err: { color: themeColor().coralText, lineHeight: 20, marginBottom: 8 },
  card: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().pitch,
    backgroundColor: themeColor().pitchPanel,
  },
  cardTitle: { color: themeColor().pitchText, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "800" },
  cardSub: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4, marginBottom: 12 },
  leaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: themeColor().line,
  },
  rank: { width: 22, color: themeColor().pitchText, fontWeight: "800", fontSize: 16, fontFamily: "Inter_700Bold" },
  leaderName: { flex: 1, color: themeColor().text, fontSize: 16, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  leaderCount: { color: themeColor().muted, fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "700" },
  muted: { color: themeColor().muted, fontSize: 14, fontFamily: "Inter_400Regular", fontStyle: "italic" },
  winnerRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  winnerBody: { flex: 1, minWidth: 0 },
  winnerName: { color: themeColor().text, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
  winnerMeta: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4 },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}

