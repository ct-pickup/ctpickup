import { useAuth } from "@/context/AuthContext";
import { fetchAdminAnalyticsDashboard, type AdminAnalyticsDashboardResponse } from "@/lib/adminApi";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

const LIME = "#a3e635";
const GREEN = "#22c55e";
const RED = "#ef4444";
const AMBER = "#fbbf24";

function utcMonthKey(d = new Date()): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

function shiftMonthKey(key: string, delta: number): string {
  const [ys, ms] = key.split("-");
  const y0 = Number(ys);
  const m0 = Number(ms);
  if (!Number.isFinite(y0) || m0 < 1 || m0 > 12) return utcMonthKey();
  const d = new Date(Date.UTC(y0, m0 - 1 + delta, 1));
  return utcMonthKey(d);
}

function formatMonthHeading(key: string): string {
  const [ys, ms] = key.split("-");
  const y = Number(ys);
  const m = Number(ms);
  if (!Number.isFinite(y) || m < 1 || m > 12) return key;
  const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return label;
}

function formatUsdFromCents(cents: number): string {
  const n = Number(cents || 0);
  const abs = Math.abs(n);
  const dollars = abs / 100;
  const sign = n < 0 ? "-" : "";
  return `${sign}$${dollars.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function pctVsPrev(cur: number, prev: number): { text: string; up: boolean | null } {
  if (prev === 0) {
    if (cur === 0) return { text: "flat vs last month", up: null };
    return { text: "↑ new vs last month", up: true };
  }
  const raw = ((cur - prev) / prev) * 100;
  const rounded = Math.round(raw * 10) / 10;
  const up = rounded > 0;
  const down = rounded < 0;
  const arrow = up ? "↑" : down ? "↓" : "→";
  return {
    text: `${arrow} ${Math.abs(rounded)}% vs last month`,
    up: up ? true : down ? false : null,
  };
}

function displayName(p: {
  first_name: string | null;
  last_name: string | null;
}): string {
  const a = String(p.first_name || "").trim();
  const b = String(p.last_name || "").trim();
  const full = `${a} ${b}`.trim();
  return full || "Player";
}

function daysSinceIso(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 864e5));
}

const DOW_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const SCHEDULE_REGION_OPTIONS = [
  { key: "", label: "All" },
  { key: "CT", label: "CT" },
  { key: "NY", label: "NY" },
  { key: "NJ", label: "NJ" },
  { key: "MD", label: "MD" },
] as const;

function formatHourEt(hour: number): string {
  if (hour === 0) return "12:00 AM ET";
  if (hour === 12) return "12:00 PM ET";
  if (hour < 12) return `${hour}:00 AM ET`;
  return `${hour - 12}:00 PM ET`;
}

function dowName(dayOfWeek: number): string {
  if (dayOfWeek < 0 || dayOfWeek > 6) return "Day";
  return DOW_NAMES[dayOfWeek] ?? "Day";
}

function RegionBar({
  label,
  value,
  max,
}: {
  label: string;
  value: number;
  max: number;
}) {
  const pctWidth = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <View style={styles.barRow}>
      <View style={styles.barLeft}>
        <Text style={styles.barLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.barValue}>{value} runs</Text>
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

  const [monthKey, setMonthKey] = useState(utcMonthKey);
  const [scheduleRegion, setScheduleRegion] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AdminAnalyticsDashboardResponse | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setError("Not signed in.");
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    const r = await fetchAdminAnalyticsDashboard(token, {
      month: monthKey,
      schedule_region: scheduleRegion || null,
    });
    setLoading(false);
    if (!r.ok) {
      setError(r.error);
      setData(null);
      return;
    }
    if (!r.data.ok) {
      setError(r.data.error || "load_failed");
      setData(null);
      return;
    }
    setData(r.data);
  }, [token, monthKey, scheduleRegion]);

  useEffect(() => {
    void load();
  }, [load]);

  const rev = data?.revenue;
  const revCompare = useMemo(() => {
    if (!rev) return null;
    return pctVsPrev(rev.current_month_cents, rev.prev_month_cents);
  }, [rev]);

  const maxRegion = useMemo(() => {
    const rows = data?.runs_per_region ?? [];
    return Math.max(0, ...rows.map((r) => r.count));
  }, [data?.runs_per_region]);

  const avgRate = data?.attendance?.avg_attendance_rate;

  const bestTimes = data?.best_times ?? [];
  const maxBestAvg = useMemo(() => {
    if (!bestTimes.length) return 0;
    return Math.max(...bestTimes.map((s) => s.avg_confirmed));
  }, [bestTimes]);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.monthRow}>
          <Pressable
            onPress={() => setMonthKey((k) => shiftMonthKey(k, -1))}
            style={({ pressed }) => [styles.monthArrow, pressed && { opacity: 0.75 }]}
          >
            <Text style={styles.monthArrowText}>‹</Text>
          </Pressable>
          <Text style={styles.monthTitle}>{formatMonthHeading(monthKey)}</Text>
          <Pressable
            onPress={() => setMonthKey((k) => shiftMonthKey(k, 1))}
            style={({ pressed }) => [styles.monthArrow, pressed && { opacity: 0.75 }]}
          >
            <Text style={styles.monthArrowText}>›</Text>
          </Pressable>
        </View>

        <Pressable onPress={() => void load()} style={({ pressed }) => [styles.refresh, pressed && { opacity: 0.88 }]}>
          <Text style={styles.refreshText}>Refresh</Text>
        </Pressable>

        {loading ? <ActivityIndicator color="#fff" style={{ marginTop: 16 }} /> : null}
        {error ? <Text style={styles.err}>{error}</Text> : null}

        {rev ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Revenue</Text>
            <Text style={styles.revenueMain}>{formatUsdFromCents(rev.current_month_cents)} this month</Text>
            {revCompare ? (
              <Text
                style={[
                  styles.revenueSub,
                  revCompare.up === true && { color: GREEN },
                  revCompare.up === false && { color: RED },
                  revCompare.up === null && { color: "rgba(255,255,255,0.55)" },
                ]}
              >
                {revCompare.text}
              </Text>
            ) : null}
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Runs per region</Text>
          {(data?.runs_per_region ?? []).length === 0 ? (
            <Text style={styles.muted}>No completed runs this month.</Text>
          ) : (
            (data?.runs_per_region ?? []).map((r) => (
              <RegionBar key={r.region} label={r.region} value={r.count} max={maxRegion || 1} />
            ))
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Attendance rate</Text>
          <Text style={styles.attBig}>
            {avgRate != null && Number.isFinite(avgRate) ? `${Math.round(avgRate * 100)}%` : "—"} avg attendance
          </Text>
          <Text style={styles.attSub}>across all completed runs</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Most active players</Text>
          {(data?.most_active_players ?? []).length === 0 ? (
            <Text style={styles.muted}>No sessions recorded for this month.</Text>
          ) : (
            (data?.most_active_players ?? []).map((p, idx) => (
              <Pressable
                key={p.user_id}
                onPress={() => router.push(`/player/${encodeURIComponent(p.user_id)}`)}
                style={({ pressed }) => [styles.playerRow, pressed && { opacity: 0.9 }]}
              >
                <Text style={styles.playerRank}>{idx + 1}</Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.playerName} numberOfLines={1}>
                    {displayName(p)}
                  </Text>
                  <Text style={styles.playerIg} numberOfLines={1}>
                    {p.instagram ? `@${String(p.instagram).replace(/^@/, "")}` : "—"}
                  </Text>
                </View>
                <Text style={styles.sessionCt}>{p.sessions_this_month}</Text>
              </Pressable>
            ))
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>At risk (churn)</Text>
          <Text style={styles.churnHint}>
            Active in the 60 days before this month, no completed pickup attendance in the last 30 days.
          </Text>
          {(data?.churn_at_risk ?? []).length === 0 ? (
            <Text style={styles.muted}>No players match this window.</Text>
          ) : (
            (data?.churn_at_risk ?? []).map((p) => {
              const days = daysSinceIso(p.last_attended_at);
              const seen =
                days == null ? "Last seen: unknown" : `Last seen: ${days} days ago`;
              return (
                <Pressable
                  key={p.user_id}
                  onPress={() => router.push(`/player/${encodeURIComponent(p.user_id)}`)}
                  style={({ pressed }) => [styles.churnRow, pressed && { opacity: 0.92 }]}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.churnName} numberOfLines={1}>
                      {displayName(p)}
                    </Text>
                    <Text style={styles.churnIg} numberOfLines={1}>
                      {p.instagram ? `@${String(p.instagram).replace(/^@/, "")}` : "—"}
                    </Text>
                    <Text style={styles.churnSeen}>{seen}</Text>
                  </View>
                </Pressable>
              );
            })
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Best Times to Run 📅</Text>
          <View style={styles.regionChips}>
            {SCHEDULE_REGION_OPTIONS.map((opt) => {
              const selected = scheduleRegion === opt.key;
              return (
                <Pressable
                  key={opt.key || "all"}
                  onPress={() => setScheduleRegion(opt.key)}
                  style={({ pressed }) => [
                    styles.regionChip,
                    selected && styles.regionChipSelected,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text style={[styles.regionChipText, selected && styles.regionChipTextSelected]}>{opt.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {bestTimes.length === 0 ? (
            <Text style={styles.muted}>
              Not enough run history yet for this region. Run more sessions to see scheduling suggestions.
            </Text>
          ) : (
            bestTimes.map((slot) => {
              const barPct = maxBestAvg > 0 ? Math.max(0.08, Math.min(1, slot.avg_confirmed / maxBestAvg)) : 0;
              return (
                <View key={`${slot.day_of_week}-${slot.hour}`} style={styles.bestTimeCard}>
                  <Text style={styles.bestTimeDay}>{dowName(slot.day_of_week)}</Text>
                  <Text style={styles.bestTimeClock}>{formatHourEt(slot.hour)}</Text>
                  <Text style={styles.bestTimeAvg}>
                    Avg{" "}
                    {Number.isInteger(slot.avg_confirmed)
                      ? String(slot.avg_confirmed)
                      : slot.avg_confirmed.toFixed(1)}{" "}
                    players
                  </Text>
                  <Text style={styles.bestTimeRuns}>Based on {slot.run_count} runs</Text>
                  <View style={styles.bestTimeBarTrack}>
                    <View style={[styles.bestTimeBarFill, { width: `${Math.round(barPct * 100)}%` }]} />
                  </View>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0a0a0a" },
  content: { padding: 16, paddingBottom: 48 },
  monthRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
    marginTop: 4,
  },
  monthArrow: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  monthArrowText: { color: "#fff", fontSize: 22, fontWeight: "900", marginTop: -2 },
  monthTitle: { color: "#fff", fontSize: 20, fontWeight: "900", minWidth: 160, textAlign: "center" },
  refresh: {
    alignSelf: "center",
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
    backgroundColor: "rgba(163,230,53,0.08)",
  },
  refreshText: { color: LIME, fontWeight: "900", fontSize: 13 },
  err: { marginTop: 14, color: "#fca5a5", textAlign: "center" },
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
  revenueMain: { marginTop: 10, color: LIME, fontSize: 30, fontWeight: "900" },
  revenueSub: { marginTop: 8, fontSize: 15, fontWeight: "800" },
  attBig: { marginTop: 10, color: "#fff", fontSize: 32, fontWeight: "900" },
  attSub: { marginTop: 8, color: "rgba(255,255,255,0.55)", fontSize: 14 },
  barRow: { marginTop: 12, gap: 8 },
  barLeft: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  barLabel: { color: "rgba(255,255,255,0.75)", fontSize: 13, fontWeight: "800", flex: 1, minWidth: 0 },
  barValue: { color: "#fff", fontSize: 13, fontWeight: "900" },
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
  playerRank: { width: 26, color: LIME, fontWeight: "900", fontSize: 14, textAlign: "center" },
  playerName: { color: "#fff", fontWeight: "800", fontSize: 14 },
  playerIg: { marginTop: 4, color: "rgba(255,255,255,0.5)", fontSize: 12, fontWeight: "700" },
  sessionCt: { color: LIME, fontWeight: "900", fontSize: 16, minWidth: 28, textAlign: "right" },
  churnHint: {
    marginTop: 8,
    color: "rgba(255,255,255,0.45)",
    fontSize: 12,
    lineHeight: 17,
  },
  churnRow: {
    marginTop: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.35)",
    backgroundColor: "rgba(251,191,36,0.08)",
  },
  churnName: { color: AMBER, fontWeight: "900", fontSize: 14 },
  churnIg: { marginTop: 4, color: "rgba(251,191,36,0.75)", fontSize: 12, fontWeight: "700" },
  churnSeen: { marginTop: 6, color: "rgba(251,191,36,0.9)", fontSize: 12, fontWeight: "800" },
  regionChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
    marginBottom: 4,
  },
  regionChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  regionChipSelected: {
    borderColor: "rgba(163,230,53,0.45)",
    backgroundColor: "rgba(163,230,53,0.12)",
  },
  regionChipText: { color: "rgba(255,255,255,0.75)", fontWeight: "800", fontSize: 13 },
  regionChipTextSelected: { color: LIME },
  bestTimeCard: {
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(0,0,0,0.22)",
  },
  bestTimeDay: { color: "#fff", fontWeight: "900", fontSize: 16 },
  bestTimeClock: { marginTop: 4, color: "rgba(255,255,255,0.7)", fontSize: 14, fontWeight: "700" },
  bestTimeAvg: { marginTop: 10, color: LIME, fontSize: 15, fontWeight: "900" },
  bestTimeRuns: { marginTop: 4, color: "rgba(255,255,255,0.45)", fontSize: 12, fontWeight: "600" },
  bestTimeBarTrack: {
    marginTop: 10,
    height: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.07)",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  bestTimeBarFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "rgba(163,230,53,0.45)",
  },
});
