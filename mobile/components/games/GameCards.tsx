import { FlatList, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { type AvatarPerson } from "@/components/PlayerAvatar";
import { PhotoHeader } from "@/components/photo";
import PlayedWithRow from "@/components/pickup/PlayedWithRow";
import SpotsBadge from "@/components/pickup/SpotsBadge";
import type { BestGame, PlayedWithSummary } from "@/lib/matchApi";
import { fmtPickupSlotChipEt, runTimeTbd } from "@/lib/pickup/runStartAtDisplay";
import { formatStars } from "@/lib/starRatings";
import { radius, themeColor, useThemedStyles } from "@/theme";

export type GameCardRun = {
  id: string;
  title: string | null;
  start_at: string;
  location_text: string | null;
  capacity: number;
  spots_taken: number;
  format: string | null;
  time_tbd?: boolean;
};

export type RunCrowd = { people: AvatarPerson[]; avgStar: number | null };

export const EMPTY_CROWD: RunCrowd = { people: [], avgStar: null };

/** "Colt Park, Hartford" → field "Colt Park", town "Hartford". */
export function splitLocation(locationText: string | null, title: string | null): { field: string; town: string | null } {
  const parts = (locationText ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  return { field: parts[0] || title?.trim() || "Pickup game", town: parts[1] ?? null };
}

export function crowdLine(avgStar: number | null, going: number): string {
  const parts: string[] = [];
  if (avgStar != null) parts.push(`Avg level ${formatStars(avgStar)}`);
  parts.push(`${going} going`);
  return parts.join(" · ");
}

/** Compact photo card used in Home strips and the Games tab upcoming list. */
export function GameCard({
  run,
  photo,
  crowd,
  playedWith,
  onPress,
  style,
  shortSocial = false,
}: {
  run: GameCardRun;
  photo: string | undefined;
  crowd: RunCrowd;
  playedWith: PlayedWithSummary | undefined;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  /** Home: one-line "Played with Kofi +2" copy. */
  shortSocial?: boolean;
}) {
  useThemedStyles(publish_styles);

  const left = Math.max(run.capacity - run.spots_taken, 0);
  const going = Math.max(run.spots_taken, crowd.people.length);
  const { field } = splitLocation(run.location_text, run.title);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, styles.gameCard, style, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${field}, ${fmtPickupSlotChipEt(run.start_at, runTimeTbd(run))}`}
    >
      <View>
        {photo ? (
          <PhotoHeader uri={photo} accessibilityLabel={`${field} field photo`} />
        ) : (
          <View style={styles.thumbFallback} />
        )}
        <SpotsBadge spotsLeft={left} style={styles.photoBadge} />
      </View>
      <View style={styles.gameBody}>
        <Text style={styles.when} numberOfLines={1}>
          {fmtPickupSlotChipEt(run.start_at, runTimeTbd(run))}
        </Text>
        <Text style={styles.gameTitle} numberOfLines={1}>
          {field}
        </Text>
        <View style={styles.gameMetaRow}>
          {run.format ? (
            <View style={styles.chip}>
              <Text style={styles.chipText}>{run.format}</Text>
            </View>
          ) : null}
          <Text style={styles.gameMeta} numberOfLines={1}>
            {crowdLine(crowd.avgStar, going)}
          </Text>
        </View>
        <PlayedWithRow summary={playedWith} short={shortSocial} style={styles.playedWith} />
      </View>
    </Pressable>
  );
}

export function BestGameCard({
  game,
  photo,
  onPress,
  shortSocial = false,
}: {
  game: BestGame;
  photo: string | undefined;
  onPress: () => void;
  shortSocial?: boolean;
}) {
  useThemedStyles(publish_styles);

  const left = Math.max(game.capacity - game.spots_taken, 0);
  const { field } = splitLocation(game.location_text, game.title);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, styles.gameCard, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${field}, ${fmtPickupSlotChipEt(game.start_at, runTimeTbd(game))}`}
    >
      {photo ? (
        <View>
          <PhotoHeader uri={photo} accessibilityLabel={`${field} field photo`} />
          <SpotsBadge spotsLeft={left} style={styles.photoBadge} />
        </View>
      ) : null}
      <View style={styles.gameBody}>
        <View style={styles.cardTopRow}>
          <Text style={styles.when} numberOfLines={1}>
            {fmtPickupSlotChipEt(game.start_at, runTimeTbd(game))}
          </Text>
          {photo ? null : <SpotsBadge spotsLeft={left} />}
        </View>
        <Text style={styles.gameTitle} numberOfLines={1}>
          {field}
        </Text>
        {game.reasons.length > 0 ? (
          <View style={styles.reasonRow}>
            {game.reasons.map((r) => (
              <View key={r} style={styles.reasonChip}>
                <Text style={styles.reasonText} numberOfLines={1}>
                  {r}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        <PlayedWithRow summary={game.played_with} short={shortSocial} style={styles.playedWith} />
      </View>
    </Pressable>
  );
}

/** Horizontal "Best games for you" strip. `bleed` is the parent's horizontal padding so cards run edge to edge. */
export function BestGamesCarousel({
  games,
  photos,
  onOpen,
  bleed,
}: {
  games: BestGame[];
  photos: Record<string, string>;
  onOpen: (id: string) => void;
  bleed: number;
}) {
  useThemedStyles(publish_styles);

  return (
    <FlatList
      horizontal
      data={games}
      keyExtractor={(g) => g.id}
      showsHorizontalScrollIndicator={false}
      style={{ marginHorizontal: -bleed }}
      contentContainerStyle={[styles.stripContent, { paddingHorizontal: bleed }]}
      renderItem={({ item }) => <BestGameCard game={item} photo={photos[item.id]} onPress={() => onOpen(item.id)} />}
    />
  );
}

function make_styles() {
  return StyleSheet.create({
    pressed: { opacity: 0.88 },
    card: {
      backgroundColor: themeColor().card,
      borderWidth: 1,
      borderColor: themeColor().line,
      borderRadius: radius.card,
      overflow: "hidden",
    },
    photoBadge: { position: "absolute", top: 12, left: 12 },
    cardTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
    when: { flexShrink: 1, fontSize: 13, fontFamily: "Inter_600SemiBold", color: themeColor().pitchText },
    stripContent: { gap: 12 },
    gameCard: { width: 232 },
    thumbFallback: { aspectRatio: 16 / 9, backgroundColor: themeColor().pitchPanel },
    gameBody: { padding: 12, gap: 4 },
    gameTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: themeColor().text },
    gameMetaRow: { marginTop: 4, flexDirection: "row", alignItems: "center", gap: 8 },
    gameMeta: { flexShrink: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: themeColor().muted },
    chip: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: radius.pill,
      backgroundColor: themeColor().pitchPanel,
    },
    chipText: { fontSize: 11, fontFamily: "Inter_700Bold", color: themeColor().onPitchPanel },
    reasonRow: { marginTop: 4, flexDirection: "row", flexWrap: "wrap", gap: 4 },
    reasonChip: {
      maxWidth: "100%",
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: radius.pill,
      backgroundColor: themeColor().pitchPanel,
    },
    reasonText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: themeColor().onPitchPanel },
    playedWith: { marginTop: 8 },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
