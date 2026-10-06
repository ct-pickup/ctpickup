import { goBack } from "@/lib/goBack";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useRouter } from "expo-router";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import CtPlusPaywall from "@/components/ctplus/CtPlusPaywall";
import RatingTrend from "@/components/season/RatingTrend";
import { StarRating } from "@/components/StarRating";
import { useAuth } from "@/context/AuthContext";
import { useCtPlus } from "@/context/CtPlusContext";
import { directionWord, fetchGameLog, type GameLogEntry, type GameLogInsights } from "@/lib/gameLog";
import { fetchMyRecord, recordPoints, type PlayerRecord } from "@/lib/playerRecord";
import { seasonWindowFor } from "@/lib/pickup/seasonPrize";
import { longDateEt, outcomeWord } from "@/lib/season";
import { lastGames, seasonTotals } from "@/lib/seasonStats";
import { fetchPlayerCard, type PlayerCard } from "@/lib/starRatings";
import { radius, themeColor, useThemedStyles } from "@/theme";

const FREE_GAMES = 3;

/**
 * Season stats. Everyone sees this season's totals, their rating now and their last 3 results. With CT+ there is also
 * the full game log (every game with a posted result, with details when tapped) and insight cards. The detailed data
 * comes from /api/player/game-log, which only a CT+ player\u2019s screen requests; the free view never fetches it.
 */
export default function SeasonStatsScreen() {
  useThemedStyles(publish_styles);
  const router = useRouter();
  const { session, supabase } = useAuth();
  const { enabled, isPlus } = useCtPlus();
  const token = session?.access_token ?? null;
  const uid = session?.user?.id ?? null;
  const season = seasonWindowFor();

  const [record, setRecord] = useState<PlayerRecord | null>(null);
  const [card, setCard] = useState<PlayerCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [paywall, setPaywall] = useState(false);

  const [games, setGames] = useState<GameLogEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [insights, setInsights] = useState<GameLogInsights | null>(null);
  const [logFailed, setLogFailed] = useState(false);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const logStarted = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (!enabled || !token || !uid || !supabase) return;
      let live = true;
      void (async () => {
        const [rec, c] = await Promise.all([fetchMyRecord(token), fetchPlayerCard(supabase, uid)]);
        if (!live) return;
        setRecord(rec);
        setFailed(rec == null);
        setCard(c);
        setLoading(false);
      })();
      // The detailed log is only requested for a CT+ player, and only once.
      if (isPlus && !logStarted.current) {
        logStarted.current = true;
        void fetchGameLog(token, null).then((page) => {
          if (!live) return;
          if (!page) {
            setLogFailed(true);
            logStarted.current = false;
            return;
          }
          setGames(page.games);
          setCursor(page.nextCursor);
          setInsights(page.insights);
        });
      }
      return () => {
        live = false;
      };
    }, [enabled, isPlus, token, uid, supabase]),
  );

  async function showMore() {
    if (!token || !cursor || more) return;
    setMore(true);
    const page = await fetchGameLog(token, cursor);
    if (page) {
      setGames((g) => [...g, ...page.games]);
      setCursor(page.nextCursor);
    }
    setMore(false);
  }

  if (!enabled) {
    return (
      <View style={styles.center}>
        <Text style={styles.body}>This is not available yet.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={themeColor().text} />
      </View>
    );
  }

  const totals = seasonTotals(record?.log, season.label);
  const points = recordPoints(record, "season_points");
  const recent = lastGames(record?.log, FREE_GAMES);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{season.label}</Text>
      {failed ? <Text style={styles.body}>We couldn&apos;t load your stats. Pull back and try again.</Text> : null}

      <View style={styles.card}>
        <View style={styles.statRow}>
          <Stat value={String(totals.games)} label="Games" />
          <Stat value={String(totals.wins)} label="Wins" />
          <Stat value={points == null ? "–" : String(points)} label="Points" />
          <Stat value={String(totals.potd)} label="POTD" />
        </View>
        {totals.games === 0 ? <Text style={styles.note}>No games with a posted result yet this season.</Text> : null}
        {card ? (
          <View style={styles.nowRow}>
            <Text style={styles.cardLabel}>Rating now</Text>
            <StarRating value={card.star} provisional={card.provisional} size="sm" />
          </View>
        ) : null}
      </View>

      <Text style={styles.section}>Last {FREE_GAMES} games</Text>
      {recent.length === 0 ? (
        <Text style={styles.note}>No results yet.</Text>
      ) : (
        recent.map((g) => (
          <View key={g.run_id} style={styles.gameRow}>
            <Text style={styles.outcome}>{g.outcome ? outcomeWord(g.outcome) : ""}</Text>
            <Text style={styles.note}>{longDateEt(g.start_at)}</Text>
          </View>
        ))
      )}

      {!isPlus ? (
        <>
          <Text style={styles.section}>With CT+</Text>
          <View style={[styles.card, styles.locked]} accessibilityLabel="Locked preview">
            <Text style={styles.cardLabel}>Insights</Text>
            {["Win streaks", "Your record with each teammate", "Rating trend across the year"].map((t) => (
              <View key={t} style={styles.lockedRow}>
                <FontAwesome name="lock" size={12} color={themeColor().muted} />
                <View style={styles.lockedBar} />
                <Text style={styles.lockedText}>{t}</Text>
              </View>
            ))}
          </View>
          <View style={[styles.card, styles.locked]} accessibilityLabel="Locked preview">
            <Text style={styles.cardLabel}>Full game log</Text>
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.lockedRow}>
                <View style={styles.lockedDot} />
                <View style={[styles.lockedBar, { flex: 1 }]} />
              </View>
            ))}
            <Text style={styles.note}>Every game, with teammates, awards, points and how your rating moved.</Text>
          </View>
          <Pressable onPress={() => setPaywall(true)} style={({ pressed }) => [styles.btn, pressed && styles.pressed]} accessibilityRole="button">
            <Text style={styles.btnText}>Unlock with CT+</Text>
          </Pressable>
          <CtPlusPaywall design={null} data={null} visible={paywall} onClose={() => setPaywall(false)} onPurchased={() => setPaywall(false)} />
        </>
      ) : (
        <>
          <Text style={styles.section}>Insights</Text>
          {insights ? (
            <>
              <View style={styles.card}>
                <Text style={styles.cardLabel}>Win streak</Text>
                <View style={styles.statRow}>
                  <Stat value={String(insights.currentWinStreak)} label="Current" />
                  <Stat value={String(insights.longestWinStreak)} label="Longest" />
                </View>
              </View>

              <View style={styles.card}>
                <Text style={styles.cardLabel}>Record with teammates (3+ games together)</Text>
                {insights.teammates.length === 0 ? (
                  <Text style={styles.note}>Play three games with the same teammate and their record shows here.</Text>
                ) : (
                  insights.teammates.map((t) => (
                    <View key={t.name} style={styles.teamRow}>
                      <Text style={styles.name} numberOfLines={1}>
                        {t.name}
                      </Text>
                      <Text style={styles.note}>
                        {t.wins}W {t.draws}D {t.losses}L · {t.games} games
                      </Text>
                    </View>
                  ))
                )}
              </View>

              <View style={styles.card}>
                <Text style={styles.cardLabel}>Rating over the last year</Text>
                {insights.ratingTrend ? (
                  <>
                    <RatingTrend shape={insights.ratingTrend.shape} seasonBreaks={insights.ratingTrend.seasonBreaks} />
                    <Text style={styles.note}>Dashed lines mark a new season. Numbers aren&apos;t shown.</Text>
                  </>
                ) : (
                  <Text style={styles.note}>Your trend appears after a few rated games.</Text>
                )}
              </View>
            </>
          ) : logFailed ? (
            <Text style={styles.note}>We couldn&apos;t load your insights. Try again later.</Text>
          ) : (
            <ActivityIndicator color={themeColor().muted} />
          )}

          <Text style={styles.section}>Game log</Text>
          {games.length === 0 && !logFailed && insights == null ? null : games.length === 0 ? (
            <Text style={styles.note}>No games with a posted result yet.</Text>
          ) : null}
          {games.map((g) => {
            const on = open === g.run_id;
            const dir = directionWord(g.rating);
            return (
              <Pressable
                key={g.run_id}
                onPress={() => setOpen(on ? null : g.run_id)}
                style={styles.logRow}
                accessibilityRole="button"
                accessibilityState={{ expanded: on }}
                accessibilityLabel={`${g.outcome ? outcomeWord(g.outcome) : "Game"}, ${longDateEt(g.start_at)}`}
              >
                <View style={styles.logTop}>
                  <Text style={styles.outcome}>{g.outcome ? outcomeWord(g.outcome) : ""}</Text>
                  <View style={styles.gameBody}>
                    <Text style={styles.name} numberOfLines={1}>
                      {g.venue || "Game"}
                    </Text>
                    <Text style={styles.note}>
                      {longDateEt(g.start_at)}
                      {g.score ? ` · ${g.score}` : ""}
                    </Text>
                  </View>
                  <FontAwesome name={on ? "chevron-up" : "chevron-down"} size={12} color={themeColor().muted} />
                </View>
                {on ? (
                  <View style={styles.detail}>
                    <Text style={styles.note}>{g.teammates.length ? `Teammates: ${g.teammates.join(", ")}` : "Teammates: none recorded"}</Text>
                    {g.awards.length ? <Text style={styles.note}>Awards: {g.awards.join(", ")}</Text> : null}
                    {g.points != null ? <Text style={styles.note}>Points earned: {g.points}</Text> : null}
                    {dir ? <Text style={styles.note}>Rating after this game: {dir}</Text> : null}
                  </View>
                ) : null}
              </Pressable>
            );
          })}
          {cursor ? (
            <Pressable onPress={() => void showMore()} disabled={more} style={styles.moreBtn} accessibilityRole="button">
              {more ? <ActivityIndicator color={themeColor().muted} /> : <Text style={styles.link}>Show more games</Text>}
            </Pressable>
          ) : null}
        </>
      )}

      <Pressable onPress={() => goBack(router, "/(tabs)/account")} hitSlop={8} style={styles.back} accessibilityRole="button">
        <Text style={styles.link}>Back</Text>
      </Pressable>
    </ScrollView>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    center: { flex: 1, backgroundColor: c.bg, alignItems: "center", justifyContent: "center", padding: 24 },
    content: { padding: 16, paddingBottom: 48, gap: 12 },
    title: { color: c.text, fontSize: 22, fontFamily: "Inter_700Bold", fontWeight: "700" },
    body: { color: c.muted, fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 21 },
    section: { color: c.muted, fontSize: 12, fontFamily: "Inter_600SemiBold", fontWeight: "600", marginTop: 8 },
    card: { padding: 14, borderRadius: radius.card, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, gap: 10 },
    locked: { opacity: 0.75 },
    lockedRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    lockedBar: { height: 10, width: 90, borderRadius: 5, backgroundColor: c.overlaySubtle },
    lockedDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: c.overlaySubtle },
    lockedText: { color: c.muted, fontSize: 13, fontFamily: "Inter_500Medium" },
    cardLabel: { color: c.muted, fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    nowRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    statRow: { flexDirection: "row", gap: 8 },
    stat: { flex: 1 },
    statValue: { color: c.text, fontSize: 24, fontFamily: "Inter_700Bold", fontWeight: "700" },
    statLabel: { color: c.muted, fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 2 },
    note: { color: c.muted, fontSize: 13, fontFamily: "Inter_400Regular" },
    gameRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line },
    logRow: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line, gap: 6 },
    logTop: { flexDirection: "row", alignItems: "center", gap: 12 },
    detail: { paddingLeft: 56, gap: 3 },
    teamRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
    outcome: { width: 44, color: c.pitchText, fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "700" },
    gameBody: { flex: 1, minWidth: 0 },
    name: { color: c.text, fontSize: 15, fontFamily: "Inter_600SemiBold", fontWeight: "600", flexShrink: 1 },
    btn: { backgroundColor: c.pitch, borderRadius: radius.button, paddingVertical: 16, alignItems: "center", marginTop: 8 },
    btnText: { color: c.onPitch, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
    pressed: { opacity: 0.85 },
    moreBtn: { alignSelf: "center", paddingVertical: 12 },
    back: { alignSelf: "center", paddingVertical: 12 },
    link: { color: c.pitchText, fontSize: 15, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
