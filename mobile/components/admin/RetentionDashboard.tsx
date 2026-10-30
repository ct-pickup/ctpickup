import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Polyline } from "react-native-svg";

import { fetchAdminRetention, type AdminRetentionReport } from "@/lib/adminApi";
import { headline, themeColor, useThemedStyles } from "@/theme";

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "not_ready" } | { kind: "ready"; report: AdminRetentionReport };

const pct = (v: number | null | undefined) => (v == null ? "—" : `${v}%`);
const shortWeek = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};

/**
 * Retention for admins: the first-game funnel, the 30 day second-game rate with its trend, the cohort heatmap, run health by region
 * and how well each kind of push works. Everything here is a count of players, never a name.
 */
export function RetentionDashboard({ token }: { token: string | null }) {
  useThemedStyles(publish_styles);
  const [state, setState] = useState<State>({ kind: "loading" });

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const done = (next: State) => {
      if (!cancelled) setState(next);
    };
    if (!token) {
      void Promise.resolve().then(() => done({ kind: "error", message: "Not signed in." }));
    } else {
      void fetchAdminRetention(token).then((r) => {
        if (!r.ok || (r.data.ready !== false && !r.data.report)) done({ kind: "error", message: "We couldn’t load retention numbers. Try again." });
        else if (r.data.ready === false) done({ kind: "not_ready" });
        else done({ kind: "ready", report: r.data.report! });
      });
    }
    return () => {
      cancelled = true;
    };
  }, [token, attempt]);

  const retryNow = () => {
    setState({ kind: "loading" });
    setAttempt((n) => n + 1);
  };

  if (state.kind === "loading") return <ActivityIndicator color={themeColor().text} style={styles.loading} />;
  if (state.kind === "error") {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Retention</Text>
        <Text style={styles.muted}>{state.message}</Text>
        <Pressable onPress={retryNow} style={styles.retry} accessibilityRole="button">
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
  if (state.kind === "not_ready") {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Retention</Text>
        <Text style={styles.muted}>The analytics tables are not set up on this database yet.</Text>
      </View>
    );
  }
  const r = state.report;
  const noData = r.funnel.every((s) => s.players === 0) && r.second_game.length === 0;
  if (noData) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Retention</Text>
        <Text style={styles.muted}>No events yet. Numbers appear after players are approved, join games and play.</Text>
      </View>
    );
  }
  return (
    <View>
      {r.biggest_drop ? (
        <View style={[styles.card, styles.callout]}>
          <Text style={styles.title}>Where people drop off</Text>
          <Text style={styles.big}>
            {r.biggest_drop.from_label} to {r.biggest_drop.to_label}
          </Text>
          <Text style={styles.muted}>
            {r.biggest_drop.lost} of {r.biggest_drop.from_players} players ({r.biggest_drop.drop_pct}%) stop here. This is the biggest loss in the first-game funnel.
          </Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.title}>First-game funnel</Text>
        <Text style={styles.muted}>Players approved in the last 90 days, and how far they got.</Text>
        {r.funnel.map((s) => {
          const top = r.funnel[0]?.players || 0;
          const share = top > 0 ? Math.min(1, s.players / top) : 0;
          return (
            <View key={s.step} style={styles.funnelRow}>
              <View style={styles.rowTop}>
                <Text style={styles.rowLabel}>{s.label}</Text>
                <Text style={styles.rowValue}>{s.players}</Text>
              </View>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${Math.round(share * 100)}%` }]} />
              </View>
            </View>
          );
        })}
        {!r.has_app_steps ? <Text style={styles.note}>Looked, opened and started appear once players share usage data.</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>Played a second game within 30 days</Text>
        {r.second_game_headline ? (
          <>
            <Text style={styles.big}>{pct(r.second_game_headline.rate_pct)}</Text>
            <Text style={styles.muted}>
              {r.second_game_headline.returned} of {r.second_game_headline.players} players, over {r.second_game_headline.weeks} finished weeks.
            </Text>
          </>
        ) : (
          <Text style={styles.muted}>No week has had 30 days to play out yet.</Text>
        )}
        <TrendLine rows={r.second_game} />
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>Cohort retention</Text>
        <Text style={styles.muted}>Share of each week’s new players who played again, by weeks since their first game.</Text>
        <Heatmap cells={r.cohorts} />
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>Game health by region</Text>
        <Text style={styles.muted}>Games from the last 60 days.</Text>
        {r.run_health.length === 0 ? (
          <Text style={styles.muted}>No finished games yet.</Text>
        ) : (
          r.run_health.map((h) => (
            <View key={h.region} style={styles.healthRow}>
              <Text style={styles.rowLabel}>{h.region}</Text>
              <Text style={styles.healthMeta}>
                {h.games} games, {pct(h.avg_fill_pct)} full, {pct(h.no_show_pct)} no-show, {pct(h.cancel_pct)} cancel
              </Text>
            </View>
          ))
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>Notifications</Text>
        <Text style={styles.muted}>Last 30 days. Opens count only players who share usage data.</Text>
        {r.notifications.length === 0 ? (
          <Text style={styles.muted}>No pushes recorded yet.</Text>
        ) : (
          r.notifications.map((n) => (
            <View key={n.kind} style={styles.healthRow}>
              <Text style={styles.rowLabel}>{n.kind}</Text>
              <Text style={styles.healthMeta}>
                {n.sent} sent, {pct(n.open_pct)} opened, {pct(n.joined_within_day_pct)} joined a game within a day
              </Text>
            </View>
          ))
        )}
      </View>
    </View>
  );
}

const TREND_W = 280;
const TREND_H = 80;

function TrendLine({ rows }: { rows: AdminRetentionReport["second_game"] }) {
  const done = rows.filter((x) => x.mature && x.rate_pct != null);
  if (done.length < 2) return <Text style={styles.note}>The trend shows once two weeks have finished.</Text>;
  const max = Math.max(10, ...done.map((x) => x.rate_pct as number));
  const pts = done.map((x, i) => ({ x: 6 + (i * (TREND_W - 12)) / (done.length - 1), y: TREND_H - 6 - ((x.rate_pct as number) / max) * (TREND_H - 12) }));
  return (
    <View style={styles.trend} accessibilityLabel={`Second game rate by week, ${done.map((d) => `${shortWeek(d.cohort_week)} ${d.rate_pct} percent`).join(", ")}`}>
      <Svg width="100%" height={TREND_H} viewBox={`0 0 ${TREND_W} ${TREND_H}`}>
        <Polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={themeColor().pitch} strokeWidth={2} />
        {pts.map((p, i) => (
          <Circle key={i} cx={p.x} cy={p.y} r={3} fill={themeColor().pitch} />
        ))}
      </Svg>
      <View style={styles.rowTop}>
        <Text style={styles.axis}>{shortWeek(done[0]!.cohort_week)}</Text>
        <Text style={styles.axis}>{shortWeek(done[done.length - 1]!.cohort_week)}</Text>
      </View>
    </View>
  );
}

function Heatmap({ cells }: { cells: AdminRetentionReport["cohorts"] }) {
  if (cells.length === 0) return <Text style={styles.muted}>No first games recorded yet.</Text>;
  const weeks = [...new Set(cells.map((c) => c.cohort_week))].sort().reverse().slice(0, 10);
  const offsets = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const byKey = new Map(cells.map((c) => [`${c.cohort_week}|${c.week_offset}`, c]));
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View>
        <View style={styles.heatRow}>
          <Text style={[styles.heatHead, styles.heatLabel]}>Week</Text>
          {offsets.map((o) => (
            <Text key={o} style={[styles.heatHead, styles.heatCell]}>
              +{o}
            </Text>
          ))}
        </View>
        {weeks.map((w) => {
          const size = byKey.get(`${w}|0`)?.cohort_size ?? 0;
          return (
            <View key={w} style={styles.heatRow}>
              <Text style={[styles.heatLabelText, styles.heatLabel]}>
                {shortWeek(w)} ({size})
              </Text>
              {offsets.map((o) => {
                const c = byKey.get(`${w}|${o}`);
                if (!c) return <View key={o} style={[styles.heatCell, styles.heatEmpty]} />;
                const v = Math.max(0, Math.min(100, c.rate_pct ?? 0));
                return (
                  <View key={o} style={[styles.heatCell, styles.heatBase]} accessibilityLabel={`Week of ${shortWeek(w)}, ${o} weeks later: ${v} percent`}>
                    <View style={[styles.heatFill, { opacity: 0.12 + (v / 100) * 0.88 }]} />
                    <Text style={styles.heatText}>{Math.round(v)}</Text>
                  </View>
                );
              })}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

function make_styles() {
  return StyleSheet.create({
    loading: { marginTop: 16 },
    card: { marginTop: 16, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: themeColor().line, backgroundColor: themeColor().card, gap: 8 },
    callout: { borderColor: themeColor().pitch },
    title: { color: themeColor().text, fontSize: 16, ...headline },
    big: { color: themeColor().text, fontSize: 28, ...headline },
    muted: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
    note: { color: themeColor().muted, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 16 },
    retry: { alignSelf: "flex-start", paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: themeColor().line },
    retryText: { color: themeColor().text, fontSize: 13, fontFamily: "Inter_600SemiBold" },
    funnelRow: { gap: 4 },
    rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    rowLabel: { color: themeColor().text, fontSize: 14, fontFamily: "Inter_600SemiBold" },
    rowValue: { color: themeColor().text, fontSize: 14, fontFamily: "Inter_700Bold" },
    track: { height: 8, borderRadius: 4, backgroundColor: themeColor().overlaySubtle, overflow: "hidden" },
    fill: { height: 8, borderRadius: 4, backgroundColor: themeColor().pitch },
    trend: { marginTop: 8 },
    axis: { color: themeColor().muted, fontSize: 11, fontFamily: "Inter_400Regular" },
    healthRow: { gap: 2, paddingVertical: 4 },
    healthMeta: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular" },
    heatRow: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
    heatLabel: { width: 96 },
    heatLabelText: { color: themeColor().text, fontSize: 12, fontFamily: "Inter_600SemiBold" },
    heatHead: { color: themeColor().muted, fontSize: 11, fontFamily: "Inter_600SemiBold" },
    heatCell: { width: 34, height: 28, marginRight: 4, alignItems: "center", justifyContent: "center", borderRadius: 6, overflow: "hidden" },
    heatBase: { backgroundColor: themeColor().overlaySubtle },
    heatEmpty: { backgroundColor: themeColor().bg },
    heatFill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: themeColor().pitch },
    heatText: { color: themeColor().text, fontSize: 11, fontFamily: "Inter_700Bold" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
