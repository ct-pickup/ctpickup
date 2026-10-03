import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/context/AuthContext";
import { fetchMyRecord } from "@/lib/playerRecord";
import { seasonWindowFor, SEASON_PRIZE_MIN_GAMES, SEASON_PRIZE_USD } from "@/lib/pickup/seasonPrize";
import { fetchSeasonStanding, seasonDaysLeft, seasonGamesFromLog, type SeasonStanding } from "@/lib/seasonCard";
import { fetchSeasonEntered, SEASON_PRIZE_ENABLED } from "@/lib/seasonPrize";
import { radius, themeColor, useThemedStyles } from "@/theme";

type Props = {
  /**
   * The viewer's season standing when the caller already has the /api/leaderboards payload (the Points tab).
   * Leave it out and the card makes the one leaderboard call itself (Profile).
   */
  standing?: SeasonStanding | null;
};

/** Season prize summary. Renders nothing, and makes no request, unless SEASON_PRIZE_ENABLED. */
export function SeasonCard(props: Props) {
  if (!SEASON_PRIZE_ENABLED) return null;
  return <SeasonCardInner {...props} />;
}

function SeasonCardInner({ standing: given }: Props) {
  useThemedStyles(publish_styles);
  const router = useRouter();
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const userId = session?.user?.id ?? null;
  const season = seasonWindowFor();
  const daysLeft = seasonDaysLeft();

  const [fetched, setFetched] = useState<SeasonStanding | null>(null);
  const [games, setGames] = useState<number | null>(null);
  const [entered, setEntered] = useState<boolean | null>(null);

  // Refreshes when the screen regains focus, so the badge appears after entering from the intro.
  useFocusEffect(
    useCallback(() => {
      let live = true;
      if (!token) return;
      void fetchSeasonEntered(token).then((v) => live && setEntered(v));
      void fetchMyRecord(token).then((rec) => live && setGames(seasonGamesFromLog(rec?.log, season.label)));
      if (given === undefined) void fetchSeasonStanding(token, userId).then((v) => live && setFetched(v));
      return () => {
        live = false;
      };
    }, [token, userId, given, season.label]),
  );

  const standing = given === undefined ? fetched : given;
  const rankText = standing?.rank != null ? `#${standing.rank}${standing.total != null ? ` of ${standing.total}` : ""}` : "Unranked";

  return (
    <View style={styles.card} accessibilityLabel={`${season.label} season`}>
      <View style={styles.top}>
        <View style={styles.topText}>
          <Text style={styles.label} numberOfLines={1}>
            {season.label} · {daysLeft} {daysLeft === 1 ? "day" : "days"} left
          </Text>
          <Text style={styles.prize}>Win up to ${SEASON_PRIZE_USD}</Text>
        </View>
        {entered ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>In the season</Text>
          </View>
        ) : entered === false ? (
          <Pressable
            onPress={() => (router.push as (href: string) => void)("/season-prize")}
            style={({ pressed }) => [styles.enterBtn, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Text style={styles.enterText}>Enter the season</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.stats}>
        <Stat value={standing ? standing.points.toLocaleString() : "–"} label="Points" />
        <Stat value={standing ? rankText : "–"} label="Rank" />
        <Stat value={games == null ? "–" : `${games} of ${SEASON_PRIZE_MIN_GAMES}`} label="Games" />
      </View>
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    card: { padding: 12, borderRadius: radius.card, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, gap: 10 },
    top: { flexDirection: "row", alignItems: "center", gap: 10 },
    topText: { flex: 1, minWidth: 0 },
    label: { color: c.muted, fontSize: 12, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    prize: { color: c.text, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700", marginTop: 2 },
    badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, borderWidth: 1, borderColor: c.pitch },
    badgeText: { color: c.pitchText, fontSize: 12, fontFamily: "Inter_700Bold", fontWeight: "700" },
    enterBtn: { backgroundColor: c.pitch, borderRadius: radius.button, paddingHorizontal: 14, paddingVertical: 8 },
    enterText: { color: c.onPitch, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700" },
    pressed: { opacity: 0.85 },
    stats: { flexDirection: "row", gap: 8 },
    stat: { flex: 1, minWidth: 0 },
    statValue: { color: c.text, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
    statLabel: { color: c.muted, fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 1 },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
