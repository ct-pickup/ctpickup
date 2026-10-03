import { useAuth } from "@/context/AuthContext";
import { Stack, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { headline, themeColor, useThemedStyles } from "@/theme";
import {
  ActivityIndicator, ScrollView,
  StyleSheet, Text, View,
} from "react-native";

const RAKE = 0.20;

type Payment = {
  id: string;
  user_id: string;
  amount_cents: number;
  lifecycle_status: string;
  product_entity_id: string;
  created_at: string;
  profiles?: { first_name: string | null; last_name: string | null; username: string | null } | null;
};

type Run = {
  id: string;
  title: string;
  start_at: string;
  created_by: string | null;
  tiered_pricing: boolean | null;
  fee_cents: number;
  status: string;
  host?: { first_name: string | null; last_name: string | null; username: string | null } | null;
  payments: Payment[];
};

export default function SessionEconomicsScreen() {
  useThemedStyles(publish_s);

  const { supabase } = useAuth();
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    try {
      // Get recent host-created runs with fees
      const { data: runData } = await supabase
        .from("pickup_runs")
        .select("id,title,start_at,created_by,tiered_pricing,fee_cents,status")
        .gt("fee_cents", 0)
        .order("start_at", { ascending: false })
        .limit(20);

      if (!runData || runData.length === 0) { setRuns([]); return; }

      const runIds = runData.map((r: any) => r.id);
      const hostIds = [...new Set(runData.map((r: any) => r.created_by).filter(Boolean))];

      // Get payments
      const { data: payments } = await supabase
        .from("platform_payments")
        .select("id,user_id,amount_cents,lifecycle_status,product_entity_id,created_at")
        .in("product_entity_id", runIds)
        .eq("product_type", "pickup")
        .eq("lifecycle_status", "payment_received");

      const payerIds = [...new Set((payments ?? []).map((p: any) => p.user_id))];
      const allProfileIds = [...new Set([...hostIds, ...payerIds])];

      // Get profiles
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id,first_name,last_name,username")
        .in("id", allProfileIds);

      const profileMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p]));

      const merged: Run[] = runData.map((r: any) => {
        const runPayments = (payments ?? []).filter((p: any) => p.product_entity_id === r.id);
        return {
          ...r,
          host: profileMap[r.created_by] ?? null,
          payments: runPayments.map((p: any) => ({ ...p, profiles: profileMap[p.user_id] ?? null })),
        };
      });

      setRuns(merged);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (loading) {
    return <View style={s.center}><ActivityIndicator color={themeColor().pitchText} size="large" /></View>;
  }

  return (
    <ScrollView style={s.root} contentContainerStyle={{ paddingBottom: 60 }}>
      <Stack.Screen options={{ title: "Payouts", headerStyle: { backgroundColor: themeColor().bg }, headerTintColor: themeColor().text, headerShadowVisible: false }} />
      <Text style={s.title}>Payouts</Text>
      <Text style={s.sub}>Who to pay after each session settles.</Text>

      {runs.length === 0 && (
        <View style={s.emptyCard}>
          <Text style={s.emptyText}>No paid sessions yet.</Text>
        </View>
      )}

      {runs.map((run) => {
        const collected = run.payments.reduce((s, p) => s + p.amount_cents, 0);
        const rake = Math.round(collected * RAKE);
        const hostPayout = collected - rake;
        const hostName = run.host
          ? [run.host.first_name, run.host.last_name].filter(Boolean).join(" ") || run.host.username || "Host"
          : "Unknown host";

        return (
          <View key={run.id} style={s.card}>
            <View style={s.cardHeader}>
              <View style={{ flex: 1 }}>
                <Text style={s.runTitle}>{run.title}</Text>
                <Text style={s.runMeta}>
                  {new Date(run.start_at).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" })}
                  {" · "}{run.status}
                </Text>
              </View>
              <View style={[s.statusPill, run.status === "completed" ? { borderColor: themeColor().pitch } : { borderColor: themeColor().line, backgroundColor: themeColor().card }]}>
                <Text style={[s.statusText, { color: run.status === "completed" ? themeColor().onPitchPanel : themeColor().muted }]}>
                  {run.payments.length} paid
                </Text>
              </View>
            </View>

            {/* Economics breakdown */}
            <View style={s.breakdownCard}>
              {collected === 0 && (
                <Text style={s.freeNote}>Free session — no payments collected</Text>
              )}
              <View style={s.row}>
                <Text style={s.rowLabel}>Total collected</Text>
                <Text style={s.rowValue}>${(collected / 100).toFixed(2)}</Text>
              </View>
              <View style={s.row}>
                <Text style={s.rowLabel}>Your rake (20%)</Text>
                <Text style={[s.rowValue, { color: themeColor().pitchText }]}>+${(rake / 100).toFixed(2)}</Text>
              </View>
              <View style={[s.row, s.rowTotal]}>
                <Text style={[s.rowLabel, { color: themeColor().text, fontWeight: "700" }]}>Net to you</Text>
                <Text style={[s.rowValue, { color: themeColor().onPitchPanel, fontWeight: "800" }]}>
                  ${(rake / 100).toFixed(2)}
                </Text>
              </View>
            </View>

            {/* Host payout */}
            <View style={s.payoutRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.payoutLabel}>PAY HOST</Text>
                <Text style={s.payoutName}>{hostName}</Text>
              </View>
              <Text style={s.payoutAmount}>${(hostPayout / 100).toFixed(2)}</Text>
            </View>

            {/* Individual payments */}
            {run.payments.length > 0 && (
              <>
                <Text style={[s.payoutLabel, { marginTop: 12, marginBottom: 4 }]}>PAYMENTS RECEIVED</Text>
                {run.payments.map((p) => {
                  const name = [p.profiles?.first_name, p.profiles?.last_name].filter(Boolean).join(" ") || p.profiles?.username || "Player";
                  return (
                    <View key={p.id} style={s.payoutRow}>
                      <Text style={s.payoutName}>{name}</Text>
                      <Text style={[s.payoutAmount, { color: themeColor().pitchText }]}>+${(p.amount_cents / 100).toFixed(2)}</Text>
                    </View>
                  );
                })}
              </>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

function make_s() {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: themeColor().bg, padding: 16 },
  center: { flex: 1, backgroundColor: themeColor().bg, alignItems: "center", justifyContent: "center" },
  title: { color: themeColor().text, fontSize: 24, ...headline, marginBottom: 4, marginTop: 8 },
  sub: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 20 },
  emptyCard: { backgroundColor: themeColor().card, borderRadius: 12, padding: 20, alignItems: "center" },
  emptyText: { color: themeColor().muted, fontSize: 14, fontFamily: "Inter_400Regular" },
  card: { backgroundColor: themeColor().card, borderRadius: 12, borderWidth: 1, borderColor: themeColor().line, padding: 16, marginBottom: 16 },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 12 },
  runTitle: { color: themeColor().text, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
  runMeta: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, borderWidth: 1 },
  statusText: { fontSize: 11, fontFamily: "Inter_700Bold", fontWeight: "700" },
  breakdownCard: { backgroundColor: themeColor().bg, borderRadius: 10, padding: 12, marginBottom: 12, gap: 8 },
  row: { flexDirection: "row", justifyContent: "space-between" },
  rowTotal: { borderTopWidth: 1, borderTopColor: themeColor().line, paddingTop: 8, marginTop: 4 },
  rowLabel: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular" },
  rowValue: { color: themeColor().text, fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  payoutRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: themeColor().line },
  payoutLabel: { fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700", color: themeColor().muted, },
  payoutName: { color: themeColor().text, fontSize: 14, fontFamily: "Inter_500Medium", fontWeight: "500" },
  payoutAmount: { color: themeColor().text, fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "700" },
  freeNote: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", fontStyle: "italic", marginBottom: 8 },
});
}
let s = make_s();
function publish_s() {
  s = make_s();
}

