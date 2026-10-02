import { Image as CachedImage } from "expo-image";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { StarRating } from "@/components/StarRating";
import { dateBlockEt, recordCaption, recordLine, type Outcome } from "@/lib/season";
import type { PastGame } from "@/lib/seasonData";
import type { PlayerCard } from "@/lib/starRatings";
import { headline, radius, recordNumeral, themeColor, useThemedStyles } from "@/theme";

export function ResultPill({ outcome, size = "sm" }: { outcome: Outcome; size?: "sm" | "md" }) {
  useThemedStyles(publish_styles);
  const label = outcome === "W" ? "Win" : outcome === "L" ? "Loss" : "Draw";
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={[
        styles.pill,
        size === "md" && styles.pillMd,
        outcome === "W" ? styles.pillWin : outcome === "L" ? styles.pillLoss : styles.pillDraw,
      ]}
    >
      <Text
        style={[
          styles.pillText,
          size === "md" && styles.pillTextMd,
          outcome === "W" ? styles.pillTextWin : outcome === "L" ? styles.pillTextLoss : styles.pillTextDraw,
        ]}
      >
        {size === "md" ? label : outcome}
      </Text>
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  useThemedStyles(publish_styles);
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function SeasonHeaderCard({
  wins,
  losses,
  draws,
  games,
  potdCount,
  points,
  card,
  form,
}: {
  wins: number;
  losses: number;
  draws: number;
  games: number;
  potdCount: number;
  points: number | null;
  card: PlayerCard | null;
  form: Outcome[];
}) {
  useThemedStyles(publish_styles);
  return (
    <View style={styles.headerCard}>
      {card ? (
        <StarRating value={card.star} provisional={card.provisional} size="sm" style={styles.cornerStars} />
      ) : null}
      <Text style={styles.record} accessibilityLabel={`Record ${wins} wins, ${losses} losses${draws ? `, ${draws} draws` : ""}`}>
        {recordLine(wins, losses, draws)}
      </Text>
      <Text style={styles.recordCaption}>{recordCaption(draws)}</Text>

      <View style={styles.statsRow}>
        <Stat value={String(games)} label="Games" />
        <View style={styles.statDivider} />
        <Stat value={String(potdCount)} label="Player of the Day" />
        <View style={styles.statDivider} />
        <Stat value={points == null ? "\u2014" : points.toLocaleString()} label="Season pts" />
      </View>

      {form.length > 0 ? (
        <View style={styles.formRow}>
          <Text style={styles.formLabel}>Last {form.length}</Text>
          <View style={styles.formPills} accessibilityLabel={`Recent form, oldest to newest: ${form.join(" ")}`}>
            {form.map((o, i) => (
              <ResultPill key={`${i}-${o}`} outcome={o} />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

export function MatchLogRow({
  game,
  photo,
  onPress,
  first,
}: {
  game: PastGame;
  photo: string | undefined;
  onPress: () => void;
  first: boolean;
}) {
  useThemedStyles(publish_styles);
  const date = dateBlockEt(game.start_at);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.logRow, !first && styles.logRowDivider, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${game.field}, ${date.month} ${date.day}${game.outcome ? `, ${game.outcome === "W" ? "win" : game.outcome === "L" ? "loss" : "draw"}` : ""}${game.score ? ` ${game.score}` : ""}. Open recap`}
    >
      <View style={styles.dateBlock}>
        <Text style={styles.dateMonth}>{date.month}</Text>
        <Text style={styles.dateDay}>{date.day}</Text>
      </View>

      <View style={styles.logMiddle}>
        <Text style={styles.logField} numberOfLines={1}>
          {game.field}
        </Text>
        {game.town ? (
          <Text style={styles.logMuted} numberOfLines={1}>
            {game.town}
          </Text>
        ) : null}
        {game.position || game.potd ? (
          <View style={styles.logMetaRow}>
            {game.position ? (
              <Text style={styles.logMuted} numberOfLines={1}>
                {game.position}
              </Text>
            ) : null}
            {game.potd ? (
              <View style={styles.potdBadge}>
                <Text style={styles.potdText}>POTD</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={styles.logResult}>
        {game.score ? <Text style={styles.logScore}>{game.score}</Text> : null}
        {game.outcome ? <ResultPill outcome={game.outcome} /> : null}
      </View>

      {photo ? (
        <CachedImage source={{ uri: photo }} style={styles.thumb} contentFit="cover" cachePolicy="memory-disk" transition={150} />
      ) : null}
    </Pressable>
  );
}

function make_styles() {
  return StyleSheet.create({
    pressed: { opacity: 0.88 },

    pill: {
      minWidth: 24,
      height: 24,
      paddingHorizontal: 6,
      borderRadius: radius.pill,
      borderWidth: 1.5,
      alignItems: "center",
      justifyContent: "center",
    },
    pillMd: { height: 28, paddingHorizontal: 12 },
    pillWin: { backgroundColor: themeColor().accent, borderColor: themeColor().accent },
    pillLoss: { backgroundColor: themeColor().overlay, borderColor: themeColor().overlay },
    pillDraw: { backgroundColor: "transparent", borderColor: themeColor().muted },
    pillText: { fontSize: 11, fontFamily: "Inter_700Bold" },
    pillTextMd: { fontSize: 13 },
    pillTextWin: { color: themeColor().onAccent },
    pillTextLoss: { color: themeColor().text },
    pillTextDraw: { color: themeColor().text },

    headerCard: {
      backgroundColor: themeColor().card,
      borderWidth: 1,
      borderColor: themeColor().line,
      borderRadius: radius.card,
      padding: 16,
    },
    cornerStars: { position: "absolute", top: 16, right: 16 },
    record: { ...recordNumeral, color: themeColor().text },
    recordCaption: { marginTop: 4, fontSize: 13, fontFamily: "Inter_500Medium", color: themeColor().muted },
    statsRow: {
      marginTop: 12,
      paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: themeColor().line,
      flexDirection: "row",
      alignItems: "center",
    },
    stat: { flex: 1, alignItems: "center", gap: 2 },
    statValue: { fontSize: 20, ...headline, color: themeColor().text },
    statLabel: { fontSize: 12, fontFamily: "Inter_500Medium", color: themeColor().muted },
    statDivider: { width: StyleSheet.hairlineWidth, alignSelf: "stretch", backgroundColor: themeColor().line },
    formRow: { marginTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    formLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: themeColor().muted },
    formPills: { flexDirection: "row", gap: 4 },

    logRow: { minHeight: 72, paddingHorizontal: 12, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 12 },
    logRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: themeColor().line },
    dateBlock: { width: 36, alignItems: "center" },
    dateMonth: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: themeColor().muted },
    dateDay: { fontSize: 22, ...headline, color: themeColor().text },
    logMiddle: { flex: 1, minWidth: 0, gap: 2 },
    logField: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: themeColor().text },
    logMuted: { flexShrink: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: themeColor().muted },
    logMetaRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    potdBadge: {
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: radius.pill,
      backgroundColor: themeColor().pitchPanel,
    },
    potdText: { fontSize: 11, fontFamily: "Inter_700Bold", color: themeColor().onPitchPanel },
    logResult: { alignItems: "flex-end", gap: 4 },
    logScore: { fontSize: 17, ...headline, color: themeColor().text },
    thumb: { width: 44, height: 44, borderRadius: radius.button, backgroundColor: themeColor().pitchPanel },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
