import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ChalkEmptyState } from "@/components/chalk";
import { StarRating } from "@/components/StarRating";
import { hapticTap } from "@/lib/haptics";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";
import { DISCOVER_PICK_COUNT, type DiscoverPlayer } from "@shared/discover";

/** Static placeholders behind the locked teaser. No real player data sits under the blur. */
const TEASER_CARDS = [0, 1, 2];

type DiscoverPanelProps = {
  loading: boolean;
  error: string | null;
  players: DiscoverPlayer[];
  onRefresh: () => void;
  refreshing: boolean;
  searching: boolean;
  searchError: string | null;
  searchResults: DiscoverPlayer[] | null;
  onSearch: (query: string) => void;
};

export default function DiscoverPanel(props: DiscoverPanelProps) {
  useThemedStyles(publish_styles);

  const router = useRouter();
  const [query, setQuery] = useState("");

  const openPlayer = useCallback(
    (id: string) => {
      void hapticTap();
      router.push({ pathname: "/player/[id]", params: { id } });
    },
    [router],
  );

  const submit = useCallback(() => {
    props.onSearch(query.trim());
  }, [props, query]);

  const showing = props.searchResults;

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl refreshing={props.refreshing} onRefresh={props.onRefresh} tintColor={themeColor().muted} />
      }
    >
      <View style={styles.searchRow}>
        <FontAwesome name="search" size={15} color={themeColor().muted} style={styles.searchIcon} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={submit}
          placeholder="Search by name or @username"
          placeholderTextColor={themeColor().muted}
          style={styles.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search by name or username"
        />
        {query.length > 0 ? (
          <Pressable
            onPress={() => {
              setQuery("");
              props.onSearch("");
            }}
            hitSlop={8}
            accessibilityLabel="Clear search"
          >
            <FontAwesome name="times-circle" size={16} color={themeColor().muted} />
          </Pressable>
        ) : null}
      </View>

      {props.searching ? (
        <Text style={styles.note}>Searching.</Text>
      ) : props.searchError ? (
        <Text style={styles.error}>{props.searchError}</Text>
      ) : showing != null ? (
        showing.length === 0 ? (
          <Text style={styles.note}>No player with that exact name or username. Try their full name.</Text>
        ) : (
          <>
            <Text style={styles.sectionTitle}>Search results</Text>
            <Grid players={showing} onPress={openPlayer} />
          </>
        )
      ) : null}

      {showing == null ? (
        <>
          <Text style={styles.sectionTitle}>Your {DISCOVER_PICK_COUNT} this week</Text>

          {props.loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={themeColor().muted} />
              <Text style={styles.note}>Finding players near you.</Text>
            </View>
          ) : props.error ? (
            <Text style={styles.error}>{props.error}</Text>
          ) : props.players.length === 0 ? (
            <ChalkEmptyState
              graphic="circle"
              title="No picks yet"
              body="More players will appear as people join near you."
            />
          ) : (
            <>
              <Grid players={props.players} onPress={openPlayer} />
              {props.players.length < DISCOVER_PICK_COUNT ? (
                <Text style={styles.note}>More players will appear as people join near you.</Text>
              ) : null}
            </>
          )}

          <View style={styles.teaser}>
            <View style={styles.teaserRow}>
              {TEASER_CARDS.map((i) => (
                <View key={i} style={styles.teaserCard}>
                  <View style={styles.teaserAvatar} />
                  <View style={styles.teaserLineWide} />
                  <View style={styles.teaserLine} />
                </View>
              ))}
              <View style={styles.teaserVeil} />
            </View>

            <View style={styles.teaserFoot}>
              <FontAwesome name="lock" size={13} color={themeColor().muted} />
              <Text style={styles.teaserTitle}>See every player near you</Text>
            </View>
            <Text style={styles.teaserPitch}>Full directory, filters by position, level and distance</Text>
            <View style={styles.teaserBtn} accessibilityRole="text">
              <Text style={styles.teaserBtnText}>Coming soon</Text>
            </View>
          </View>

          <Text style={styles.footNote}>New picks every Monday.</Text>
        </>
      ) : null}
    </ScrollView>
  );
}

function Grid({ players, onPress }: { players: DiscoverPlayer[]; onPress: (id: string) => void }) {
  useThemedStyles(publish_styles);

  return (
    <View style={styles.grid}>
      {players.map((p) => (
        <PlayerTile key={p.id} player={p} onPress={() => onPress(p.id)} />
      ))}
    </View>
  );
}

function PlayerTile({ player, onPress }: { player: DiscoverPlayer; onPress: () => void }) {
  useThemedStyles(publish_styles);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${player.name}${player.town ? `, ${player.town}` : ""}`}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && { opacity: 0.9 }]}
    >
      {player.avatarUrl ? (
        <Image source={{ uri: player.avatarUrl }} alt="" style={styles.avatar} contentFit="cover" cachePolicy="memory-disk" />
      ) : (
        <View style={[styles.avatar, styles.avatarEmpty]} />
      )}

      <Text style={styles.name} numberOfLines={1}>
        {player.name}
      </Text>

      <View style={styles.ratingRow}>
        <StarRating value={player.star} size="sm" />
        {player.levelName ? (
          <Text style={styles.levelName} numberOfLines={1}>
            {player.levelName}
          </Text>
        ) : null}
      </View>

      <View style={styles.metaRow}>
        {player.position ? (
          <View style={styles.posChip}>
            <Text style={styles.posChipText}>{player.position}</Text>
          </View>
        ) : null}
        {player.town ? (
          <Text style={styles.town} numberOfLines={1}>
            {player.town}
          </Text>
        ) : null}
      </View>

      {player.reasons.length > 0 ? (
        <View style={styles.reasonRow}>
          {player.reasons.map((r) => (
            <View key={r} style={styles.reasonChip}>
              <Text style={styles.reasonText} numberOfLines={1}>
                {r}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    content: { padding: 12, paddingBottom: 32, gap: 12 },
    center: { alignItems: "center", gap: 8, paddingVertical: 24 },

    searchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 12,
      height: 42,
      borderRadius: radius.pill,
      backgroundColor: c.overlaySubtle,
    },
    searchIcon: { width: 16, textAlign: "center" },
    searchInput: { flex: 1, color: c.text, fontSize: 15, fontFamily: "Inter_500Medium" },

    sectionTitle: { fontFamily: headline.fontFamily, fontSize: 18, color: c.text },
    note: { fontSize: 13, color: c.muted, fontFamily: "Inter_500Medium" },
    error: { fontSize: 13, color: c.text, fontFamily: "Inter_500Medium" },
    footNote: { fontSize: 12, color: c.muted, fontFamily: "Inter_500Medium", textAlign: "center", marginTop: 4 },

    grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
    tile: {
      width: "47.5%",
      flexGrow: 1,
      padding: 10,
      borderRadius: radius.card,
      backgroundColor: c.overlaySubtle,
      gap: 6,
    },
    avatar: { width: "100%", aspectRatio: 1, borderRadius: radius.button, backgroundColor: c.overlayStrong },
    avatarEmpty: { opacity: 0.6 },
    name: { fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: c.text },
    ratingRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    levelName: { flex: 1, fontSize: 11, color: c.muted, fontFamily: "Inter_500Medium" },
    metaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    posChip: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill, backgroundColor: c.overlayStrong },
    posChipText: { fontSize: 10, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: c.text },
    town: { flex: 1, fontSize: 11, color: c.muted, fontFamily: "Inter_500Medium" },
    reasonRow: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
    reasonChip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line },
    reasonText: { fontSize: 10, color: c.muted, fontFamily: "Inter_500Medium" },

    teaser: { marginTop: 8, padding: 12, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line, gap: 8 },
    teaserRow: { flexDirection: "row", gap: 8, position: "relative" },
    teaserCard: { flex: 1, gap: 6, opacity: 0.35 },
    teaserAvatar: { width: "100%", aspectRatio: 1, borderRadius: radius.button, backgroundColor: c.overlayStrong },
    teaserLineWide: { height: 8, borderRadius: 999, backgroundColor: c.overlayStrong },
    teaserLine: { height: 8, width: "60%", borderRadius: 999, backgroundColor: c.overlayStrong },
    teaserVeil: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: c.bg, opacity: 0.55 },
    teaserFoot: { flexDirection: "row", alignItems: "center", gap: 6 },
    teaserTitle: { fontFamily: headline.fontFamily, fontSize: 16, color: c.text },
    teaserPitch: { fontSize: 12, color: c.muted, fontFamily: "Inter_500Medium" },
    teaserBtn: {
      alignSelf: "flex-start",
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: radius.pill,
      backgroundColor: c.overlaySubtle,
    },
    teaserBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: c.muted },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
