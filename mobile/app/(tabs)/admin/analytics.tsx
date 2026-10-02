import { PlayerLocationBreakdown } from "@/components/admin/PlayerLocationBreakdown";
import { useAuth } from "@/context/AuthContext";
import { fetchAdminAnalyticsDashboard, type AdminAnalyticsDashboardResponse } from "@/lib/adminApi";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { headline, themeColor, useThemedStyles } from "@/theme";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

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

const ANALYTICS_LOAD_FAILED_MESSAGE =
  "Couldn't load analytics. Pull down to refresh.";

function userFacingAnalyticsError(raw: string): string {
  const t = String(raw || "").trim();
  if (t === "load_failed" || t === "") return ANALYTICS_LOAD_FAILED_MESSAGE;
  return raw;
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
  useThemedStyles(publish_styles);

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
  useThemedStyles(publish_styles);

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
      setError(userFacingAnalyticsError(r.error || "load_failed"));
      setData(null);
      return;
    }
    if (!r.data.ok) {
      setError(userFacingAnalyticsError(r.data.error || "load_failed"));
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

        {error ? <Text style={styles.errSubtitle}>{error}</Text> : null}

        <Pressable onPress={() => void load()} style={({ pressed }) => [styles.refresh, pressed && { opacity: 0.88 }]}>
          <Text style={styles.refreshText}>Refresh</Text>
        </Pressable>

        {loading ? <ActivityIndicator color={themeColor().text} style={{ marginTop: 16 }} /> : null}

        {rev ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Revenue</Text>
            <Text style={styles.revenueMain}>{formatUsdFromCents(rev.current_month_cents)} this month</Text>
            {revCompare ? (
              <Text
                style={[
                  styles.revenueSub,
                  revCompare.up === true && { color: themeColor().pitchText },
                  revCompare.up === false && { color: themeColor().coralText },
                  revCompare.up === null && { color: themeColor().muted },
                ]}
              >
                {revCompare.text}
              </Text>
            ) : null}
          </View>
        ) : null}

        {data ? (
          <PlayerLocationBreakdown
            playersByVenue={data.players_by_venue ?? []}
            playersByZip={data.players_by_zip ?? []}
          />
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

function make_styles() {
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: themeColor().bg },
  content: { padding: 16, paddingBottom: 48 },
  monthRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    marginTop: 4,
  },
  monthArrow: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().line,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: themeColor().overlaySubtle,
  },
  monthArrowText: { color: themeColor().text, fontSize: 24, ...headline, marginTop: -2 },
  monthTitle: { color: themeColor().text, fontSize: 20, ...headline, minWidth: 160, textAlign: "center" },
  errSubtitle: {
    marginTop: 8,
    paddingHorizontal: 12,
    color: themeColor().muted,
    fontSize: 13, fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 18,
  },
  refresh: {
    alignSelf: "center",
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: themeColor().pitch,
    backgroundColor: themeColor().pitchPanel,
  },
  refreshText: { color: themeColor().onPitchPanel, fontWeight: "900", fontSize: 13, fontFamily: "Inter_700Bold" },
  card: {
    marginTop: 12,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().card,
  },
  cardTitle: { color: themeColor().text, fontWeight: "900", fontSize: 16, fontFamily: "Inter_700Bold" },
  muted: { marginTop: 8, color: themeColor().muted, fontSize: 14, fontFamily: "Inter_400Regular" },
  revenueMain: { marginTop: 8, color: themeColor().pitchText, fontSize: 24, ...headline },
  revenueSub: { marginTop: 8, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "800" },
  attBig: { marginTop: 8, color: themeColor().text, fontSize: 32, ...headline },
  attSub: { marginTop: 8, color: themeColor().muted, fontSize: 14, fontFamily: "Inter_400Regular" },
  barRow: { marginTop: 12, gap: 8 },
  barLeft: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  barLabel: { color: themeColor().text, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "800", flex: 1, minWidth: 0 },
  barValue: { color: themeColor().text, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "900" },
  barTrack: {
    width: "100%",
    height: 10,
    borderRadius: 999,
    backgroundColor: themeColor().overlay,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: themeColor().line,
  },
  barFill: { height: "100%", backgroundColor: themeColor().pitch, borderRadius: 999 },
  playerRow: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().bg,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  playerRank: { width: 26, color: themeColor().pitchText, fontWeight: "900", fontSize: 14, fontFamily: "Inter_700Bold", textAlign: "center" },
  playerName: { color: themeColor().text, fontWeight: "800", fontSize: 14, fontFamily: "Inter_700Bold" },
  playerIg: { marginTop: 4, color: themeColor().muted, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700" },
  sessionCt: { color: themeColor().pitchText, fontWeight: "900", fontSize: 16, fontFamily: "Inter_700Bold", minWidth: 28, textAlign: "right" },
  churnHint: {
    marginTop: 8,
    color: themeColor().muted,
    fontSize: 13, fontFamily: "Inter_400Regular",
    lineHeight: 17,
  },
  churnRow: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().card,
  },
  churnName: { color: themeColor().muted, fontWeight: "900", fontSize: 14, fontFamily: "Inter_700Bold" },
  churnIg: { marginTop: 4, color: themeColor().muted, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700" },
  churnSeen: { marginTop: 4, color: themeColor().muted, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "800" },
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
    borderColor: themeColor().line,
    backgroundColor: themeColor().overlaySubtle,
  },
  regionChipSelected: {
    borderColor: themeColor().pitch,
    backgroundColor: themeColor().pitchPanel,
  },
  regionChipText: { color: themeColor().text, fontWeight: "800", fontSize: 13, fontFamily: "Inter_700Bold" },
  regionChipTextSelected: { color: themeColor().pitchText },
  bestTimeCard: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().bg,
  },
  bestTimeDay: { color: themeColor().text, fontWeight: "900", fontSize: 16, fontFamily: "Inter_700Bold" },
  bestTimeClock: { marginTop: 4, color: themeColor().muted, fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "700" },
  bestTimeAvg: { marginTop: 8, color: themeColor().pitchText, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "900" },
  bestTimeRuns: { marginTop: 4, color: themeColor().muted, fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  bestTimeBarTrack: {
    marginTop: 8,
    height: 6,
    borderRadius: 999,
    backgroundColor: themeColor().overlay,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: themeColor().line,
  },
  bestTimeBarFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: themeColor().pitch,
  },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}

