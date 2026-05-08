import { useAuth } from "@/context/AuthContext";
import { fetchAdminPickupAnalytics, type PickupAnalyticsResponse } from "@/lib/adminApi";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

const LIME = "#a3e635";

function pct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(1)}%`;
}

function num(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return String(v);
}

function BarRow({ label, value, max }: { label: string; value: number; max: number }) {
  const pctWidth = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <View style={styles.barRow}>
      <View style={styles.barLeft}>
        <Text style={styles.barLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.barValue}>{value}</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${Math.round(pctWidth * 100)}%` }]} />
      </View>
    </View>
  );
}

export default function AdminAnalyticsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const token = session?.access_token ?? null;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PickupAnalyticsResponse | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setError("Not signed in.");
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    const r = await fetchAdminPickupAnalytics(token);
    setLoading(false);
    if (!r.ok) {
      setError(r.error);
      setData(null);
      return;
    }
    setData(r.data);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const overall = data?.overall;
  const perRegion = data?.per_region ?? [];
  const top = data?.top_reliable ?? [];
  const bottom = data?.bottom_reliable ?? [];

  const regionBars = useMemo(() => {
    const maxRuns = Math.max(0, ...perRegion.map((r) => r.runs_created || 0));
    return { maxRuns };
  }, [perRegion]);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.h1}>Analytics</Text>
          <Pressable onPress={() => void load()} style={({ pressed }) => [styles.chip, pressed && { opacity: 0.88 }]}>
            <Text style={styles.chipText}>Refresh</Text>
          </Pressable>
        </View>
        <Text style={styles.sub}>Last {overall?.lookback_days ?? 30} days · admin only</Text>

        {loading ? <ActivityIndicator color="#fff" style={{ marginTop: 18 }} /> : null}
        {error ? <Text style={styles.err}>{error}</Text> : null}

        {overall ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Overall</Text>
            <View style={styles.metricGrid}>
              <View style={styles.metricCell}>
                <Text style={styles.metricLabel}>Runs created</Text>
                <Text style={styles.metricValue}>{overall.total_runs_created}</Text>
              </View>
              <View style={styles.metricCell}>
                <Text style={styles.metricLabel}>Avg attendance</Text>
                <Text style={styles.metricValue}>{num(overall.avg_attendance)}</Text>
              </View>
              <View style={styles.metricCell}>
                <Text style={styles.metricLabel}>RSVP→attended</Text>
                <Text style={styles.metricValue}>{pct(overall.rsvp_to_attended_pct)}</Text>
              </View>
              <View style={styles.metricCell}>
                <Text style={styles.metricLabel}>No-show rate</Text>
                <Text style={styles.metricValue}>{pct(overall.no_show_rate_pct)}</Text>
              </View>
              <View style={styles.metricCell}>
                <Text style={styles.metricLabel}>Late cancel rate</Text>
                <Text style={styles.metricValue}>{pct(overall.late_cancel_rate_pct)}</Text>
              </View>
            </View>
            <Text style={styles.note}>
              Rates are computed from attendance-marked pickups (attendance rows) within the lookback window.
            </Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Per-region</Text>
          {perRegion.length === 0 ? <Text style={styles.muted}>No runs in window.</Text> : null}
          {perRegion.map((r) => (
            <View key={r.region} style={styles.regionBlock}>
              <View style={styles.regionTopRow}>
                <Text style={styles.regionName}>{r.region}</Text>
                <Text style={styles.regionMeta}>{r.runs_created} runs</Text>
              </View>
              <BarRow label="Runs created" value={r.runs_created} max={regionBars.maxRuns || 1} />
              <View style={styles.regionMetricsRow}>
                <Text style={styles.regionMetric}>Avg: {num(r.avg_attendance)}</Text>
                <Text style={styles.regionMetric}>RSVP→Att: {pct(r.rsvp_to_attended_pct)}</Text>
                <Text style={styles.regionMetric}>No-show: {pct(r.no_show_rate_pct)}</Text>
                <Text style={styles.regionMetric}>Late: {pct(r.late_cancel_rate_pct)}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Most reliable (top 10)</Text>
          {top.length === 0 ? <Text style={styles.muted}>No players with 3+ tracked pickups yet.</Text> : null}
          {top.map((p, idx) => (
            <Pressable
              key={`top:${p.user_id}`}
              onPress={() => router.push(`/player/${encodeURIComponent(p.user_id)}`)}
              style={({ pressed }) => [styles.playerRow, pressed && { opacity: 0.9 }]}
            >
              <Text style={styles.playerRank}>{idx + 1}</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.playerName} numberOfLines={1}>
                  {p.full_name}
                </Text>
                <Text style={styles.playerSub}>
                  {p.reliability_score_pct.toFixed(1)}% · {p.tracked_pickups} tracked
                </Text>
              </View>
              <FontAwesome name="angle-right" size={16} color="rgba(255,255,255,0.35)" />
            </Pressable>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Most no-shows (bottom 10)</Text>
          {bottom.length === 0 ? <Text style={styles.muted}>No players with 3+ tracked pickups yet.</Text> : null}
          {bottom.map((p, idx) => (
            <Pressable
              key={`bot:${p.user_id}`}
              onPress={() => router.push(`/player/${encodeURIComponent(p.user_id)}`)}
              style={({ pressed }) => [styles.playerRow, pressed && { opacity: 0.9 }]}
            >
              <Text style={styles.playerRank}>{idx + 1}</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.playerName} numberOfLines={1}>
                  {p.full_name}
                </Text>
                <Text style={styles.playerSub}>
                  {p.reliability_score_pct.toFixed(1)}% · {p.no_show_count} no-shows
                </Text>
              </View>
              <FontAwesome name="angle-right" size={16} color="rgba(255,255,255,0.35)" />
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0a0a0a" },
  content: { padding: 16, paddingBottom: 48 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  h1: { fontSize: 28, fontWeight: "900", color: "#fff" },
  sub: { marginTop: 8, color: "rgba(255,255,255,0.55)", fontSize: 14 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
    backgroundColor: "rgba(163,230,53,0.08)",
  },
  chipText: { color: LIME, fontWeight: "900", fontSize: 13 },
  err: { marginTop: 14, color: "#fca5a5" },
  card: {
    marginTop: 14,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  cardTitle: { color: "#fff", fontWeight: "900", fontSize: 16 },
  muted: { marginTop: 10, color: "rgba(255,255,255,0.55)", fontSize: 14 },
  note: { marginTop: 10, color: "rgba(255,255,255,0.45)", fontSize: 12, lineHeight: 17 },
  metricGrid: { marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metricCell: {
    width: "48%",
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  metricLabel: { color: "rgba(255,255,255,0.55)", fontSize: 12, fontWeight: "800" },
  metricValue: { marginTop: 6, color: "#fff", fontSize: 18, fontWeight: "900" },
  regionBlock: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)" },
  regionTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  regionName: { color: "#fff", fontWeight: "900", fontSize: 14 },
  regionMeta: { color: "rgba(255,255,255,0.55)", fontWeight: "800", fontSize: 12 },
  regionMetricsRow: { marginTop: 8, flexDirection: "row", flexWrap: "wrap", gap: 10 },
  regionMetric: { color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: "700" },
  barRow: { marginTop: 10, gap: 8 },
  barLeft: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  barLabel: { color: "rgba(255,255,255,0.75)", fontSize: 12, fontWeight: "800", flex: 1, minWidth: 0 },
  barValue: { color: "#fff", fontSize: 12, fontWeight: "900" },
  barTrack: {
    width: "100%",
    height: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  barFill: { height: "100%", backgroundColor: LIME, borderRadius: 999 },
  playerRow: {
    marginTop: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(0,0,0,0.25)",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  playerRank: { width: 24, color: LIME, fontWeight: "900", fontSize: 14, textAlign: "center" },
  playerName: { color: "#fff", fontWeight: "800", fontSize: 14 },
  playerSub: { marginTop: 4, color: "rgba(255,255,255,0.55)", fontWeight: "700", fontSize: 12 },
});

