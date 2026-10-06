import { goBack } from "@/lib/goBack";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import CtPlusPaywall from "@/components/ctplus/CtPlusPaywall";
import RatingTrend from "@/components/season/RatingTrend";
import { StarRating } from "@/components/StarRating";
import { useAuth } from "@/context/AuthContext";
import { useCtPlus } from "@/context/CtPlusContext";
import { useFocusEffect } from "expo-router";
import { fetchMyRecord, recordPoints, type PlayerRecord } from "@/lib/playerRecord";
import { seasonWindowFor } from "@/lib/pickup/seasonPrize";
import { longDateEt, outcomeWord } from "@/lib/season";
import { lastGames, seasonTotals, trendShape } from "@/lib/seasonStats";
import { fetchPlayerCard, type PlayerCard } from "@/lib/starRatings";
import { radius, themeColor, useThemedStyles } from "@/theme";

const LAST_N = 10;

/**
 * CT+ screen: this season's totals, a rating trend and the last games. Read-only, from the player's own data:
 * /api/player/record (game log and ledger points) and their own rating_events. Rating history is only the shape of
 * the line, because players never see the underlying score.
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
  const [trend, setTrend] = useState<number[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [paywall, setPaywall] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!enabled || !isPlus || !token || !uid || !supabase) return;
      let live = true;
      void (async () => {
        const [rec, c, ev] = await Promise.all([
          fetchMyRecord(token),
          fetchPlayerCard(supabase, uid),
          // Own rows only (RLS read_own_events). Empty or an error reads as "no history yet".
          supabase.from("rating_events").select("score_after,created_at").eq("user_id", uid).order("created_at", { ascending: true }).limit(200),
        ]);
        if (!live) return;
        setRecord(rec);
        setFailed(rec == null);
        setCard(c);
        setTrend(ev.error ? null : trendShape(((ev.data ?? []) as Array<{ score_after: number | string }>).map((r) => Number(r.score_after))));
        setLoading(false);
      })();
      return () => {
        live = false;
      };
    }, [enabled, isPlus, token, uid, supabase]),
  );

  if (!enabled) {
    return (
      <View style={styles.center}>
        <Text style={styles.body}>This is not available yet.</Text>
      </View>
    );
  }

  if (!isPlus) {
    return (
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>Season stats and rating history</Text>
          <Text style={styles.body}>With CT+ you see your totals for the season, how your rating has moved over your rated games, and your latest results in one place.</Text>
          <View style={[styles.card, styles.locked]}>
            <FontAwesome name="lock" size={14} color={themeColor().muted} />
            <Text style={styles.cardLabel}>Games · Wins · Points · Player of the Day</Text>
          </View>
          <View style={[styles.card, styles.locked]}>
            <FontAwesome name="lock" size={14} color={themeColor().muted} />
            <Text style={styles.cardLabel}>Rating over time</Text>
          </View>
          <Pressable onPress={() => setPaywall(true)} style={({ pressed }) => [styles.btn, pressed && styles.pressed]} accessibilityRole="button">
            <Text style={styles.btnText}>Unlock with CT+</Text>
          </Pressable>
        </ScrollView>
        <CtPlusPaywall design={null} data={null} visible={paywall} lead="See your season at a glance." onClose={() => setPaywall(false)} onPurchased={() => setPaywall(false)} />
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
  const games = lastGames(record?.log, LAST_N);

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
      </View>

      <Text style={styles.section}>Rating over time</Text>
      <View style={styles.card}>
        {card ? (
          <View style={styles.nowRow}>
            <Text style={styles.cardLabel}>Now</Text>
            <StarRating value={card.star} provisional={card.provisional} size="sm" />
          </View>
        ) : null}
        {trend ? (
          <>
            <RatingTrend shape={trend} />
            <Text style={styles.note}>The direction of your rating across your rated games. Numbers aren&apos;t shown.</Text>
          </>
        ) : (
          <Text style={styles.note}>Your rating history appears after you have played a few rated games.</Text>
        )}
      </View>

      <Text style={styles.section}>Last {LAST_N} games</Text>
      {games.length === 0 ? (
        <Text style={styles.note}>No results yet.</Text>
      ) : (
        games.map((g) => (
          <View key={g.run_id} style={styles.gameRow}>
            <Text style={styles.outcome}>{g.outcome ? outcomeWord(g.outcome) : ""}</Text>
            <View style={styles.gameBody}>
              <Text style={styles.gameTitle} numberOfLines={1}>
                {g.location_text?.split(/\r?\n/)[0] || g.title || "Game"}
              </Text>
              <Text style={styles.note}>
                {longDateEt(g.start_at)}
                {g.score ? ` · ${g.score}` : ""}
                {g.potd ? " · Player of the Day" : ""}
              </Text>
            </View>
          </View>
        ))
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
    locked: { flexDirection: "row", alignItems: "center", gap: 10 },
    cardLabel: { color: c.muted, fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    nowRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    statRow: { flexDirection: "row", gap: 8 },
    stat: { flex: 1 },
    statValue: { color: c.text, fontSize: 24, fontFamily: "Inter_700Bold", fontWeight: "700" },
    statLabel: { color: c.muted, fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 2 },
    note: { color: c.muted, fontSize: 13, fontFamily: "Inter_400Regular" },
    gameRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line },
    outcome: { width: 44, color: c.pitchText, fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "700" },
    gameBody: { flex: 1, minWidth: 0 },
    gameTitle: { color: c.text, fontSize: 15, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    btn: { backgroundColor: c.pitch, borderRadius: radius.button, paddingVertical: 16, alignItems: "center", marginTop: 8 },
    btnText: { color: c.onPitch, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
    pressed: { opacity: 0.85 },
    back: { alignSelf: "center", paddingVertical: 12 },
    link: { color: c.accent, fontSize: 15, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
