import { useAuth } from "@/context/AuthContext";
import { useFeatureFlag } from "@/context/FeatureFlagsContext";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BestGamesCarousel, EMPTY_CROWD, GameCard, type GameCardRun, type RunCrowd } from "@/components/games/GameCards";
import { EventsPanel } from "@/components/fields/EventsPanel";
import { FieldsPanel } from "@/components/fields/FieldsPanel";
import { useFieldPhotos } from "@/components/photo";
import { usePlayedWith } from "@/components/pickup/PlayedWithRow";
import { MatchLogRow, SeasonHeaderCard } from "@/components/season/SeasonPieces";
import { toggleDevPreview, useDevPreview } from "@/lib/devPreview";
import { fetchBestGames, type BestGame, type PlayedWithSummary } from "@/lib/matchApi";
import { groupByMonthEt } from "@/lib/season";
import { fetchSeason, type PastGame, type SeasonData } from "@/lib/seasonData";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";
import type { DevFixtures, SeasonFixtureVariant } from "../../dev-fixtures";

// eslint-disable-next-line @typescript-eslint/no-require-imports -- must stay a __DEV__ require so release bundles drop dev-fixtures
const devFixtures: DevFixtures | null = __DEV__ ? require("../../dev-fixtures").default : null;

const PAGE_PADDING = 20;
const BEST_GAMES_LIMIT = 3;
const FIXTURE_VARIANTS: SeasonFixtureVariant[] = ["booked", "empty-upcoming", "new-player"];

const EMPTY_SEASON: SeasonData = {
  wins: 0,
  losses: 0,
  draws: 0,
  games: 0,
  potdCount: 0,
  form: [],
  points: null,
  card: null,
  upcoming: [],
  crowds: new Map(),
  past: [],
};

function useSeasonData(skip: boolean) {
  const { session, supabase, isReady } = useAuth();
  const uid = session?.user?.id ?? null;
  const accessToken = session?.access_token ?? null;
  const [data, setData] = useState<SeasonData>(EMPTY_SEASON);
  const [bestGames, setBestGames] = useState<BestGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (skip) return;
    if (!isReady || !supabase || !uid) {
      setData(EMPTY_SEASON);
      setLoading(false);
      return;
    }
    try {
      const next = await fetchSeason(supabase, uid, accessToken);
      setData(next);
      setError(false);
      if (next.upcoming.length === 0 && accessToken) {
        const best = await fetchBestGames(accessToken, BEST_GAMES_LIMIT);
        setBestGames(best.ok ? best.data : []);
        if (!best.ok) console.warn("[games tab] best games:", best.error);
      } else {
        setBestGames([]);
      }
    } catch (e) {
      console.error("[games tab load]", e);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [skip, isReady, supabase, uid, accessToken]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return { data, bestGames, loading, error, reload: load };
}

export default function GamesTabScreen() {
  useThemedStyles(publish_styles);

  const insets = useSafeAreaInsets();
  const router = useRouter();
  const push = router.push as (href: string) => void;
  const preview = useDevPreview();
  const params = useLocalSearchParams<{ view?: string }>();
  // Fields is behind the remote 'fields' switch (admins and the allowlist see it first; unreadable means off).
  const fieldsOn = useFeatureFlag("fields");
  const plansOn = useFeatureFlag("paid_plans");
  const [chosenView, setView] = useState<"season" | "fields" | "events">(params.view === "fields" ? "fields" : params.view === "events" ? "events" : "season");
  useEffect(() => {
    if (params.view === "fields" || params.view === "events") setView(params.view);
  }, [params.view]);
  const view = fieldsOn ? chosenView : "season";
  const [variantIndex, setVariantIndex] = useState(0);
  const variant = FIXTURE_VARIANTS[variantIndex % FIXTURE_VARIANTS.length]!;
  const fixture = useMemo(
    () => (preview && devFixtures ? devFixtures.season(variant) : null),
    [preview, variant],
  );
  const live = useSeasonData(Boolean(fixture));
  const [refreshing, setRefreshing] = useState(false);

  const season: SeasonData = fixture ?? live.data;
  const upcoming: GameCardRun[] = season.upcoming;
  const crowds: Map<string, RunCrowd> = season.crowds;
  const bestGames: BestGame[] = fixture ? fixture.bestGames : live.bestGames;
  const loading = fixture ? false : live.loading;

  const photoIds = useMemo(
    () => [...upcoming.map((r) => r.id), ...season.past.map((g) => g.run_id), ...bestGames.map((g) => g.id)],
    [upcoming, season.past, bestGames],
  );
  const livePhotos = useFieldPhotos(fixture ? [] : photoIds);
  const photos: Record<string, string> = fixture ? fixture.photos : livePhotos;
  const livePlayedWith = usePlayedWith(
    upcoming.map((r) => r.id),
    { skip: Boolean(fixture) },
  );
  const playedWith: Record<string, PlayedWithSummary> = fixture ? fixture.playedWith : livePlayedWith.byRun;

  const form = season.form;
  const hasPlayed = season.games > 0 || season.past.length > 0;
  // Only a request that really failed is an error. A player with no games yet gets the empty state, not a message.
  const showSeasonError = live.error || (Boolean(live.data.recordFailed) && !loading && upcoming.length > 0);
  const months = useMemo(() => groupByMonthEt<PastGame>(season.past), [season.past]);

  const reload = live.reload;
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  }, [reload]);

  const openGame = (id: string) => push(`/session/${encodeURIComponent(id)}`);
  const openRecap = (id: string) => push(`/recap/${encodeURIComponent(id)}`);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.headerRow}>
        <Text style={styles.header} onLongPress={__DEV__ ? toggleDevPreview : undefined}>
          {view === "fields" ? "Fields" : view === "events" ? "Games" : "Your season"}
        </Text>
        {view === "fields" ? (
          <Pressable onPress={() => push("/field-requests")} hitSlop={10} accessibilityRole="link" accessibilityLabel="My requests" style={styles.headerLink}>
            <Text style={styles.headerLinkText}>My requests</Text>
          </Pressable>
        ) : null}
      </View>

      {fieldsOn ? (
      <View style={styles.toggle} accessibilityRole="tablist">
        {(["season", "fields", "events"] as const).map((v) => (
          <Pressable
            key={v}
            onPress={() => setView(v)}
            style={[styles.toggleBtn, view === v && styles.toggleBtnOn]}
            accessibilityRole="tab"
            accessibilityState={{ selected: view === v }}
          >
            <Text style={[styles.toggleText, view === v && styles.toggleTextOn]}>{v === "season" ? "Season" : v === "fields" ? "Fields" : "Events"}</Text>
          </Pressable>
        ))}
      </View>
      ) : null}

      {view === "events" ? (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}>
          <EventsPanel />
        </ScrollView>
      ) : view === "fields" ? (
        <View style={{ flex: 1 }}>
          <FieldsPanel
            onOpen={(key) => push(`/field/${encodeURIComponent(key)}`)}
            onPlans={plansOn ? () => push("/plans") : undefined}
            onSuggest={(a) => push(`/suggest-field?lat=${a.lat}&lon=${a.lon}&dlat=${a.dlat}&dlon=${a.dlon}`)}
          />
        </View>
      ) : (
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={themeColor().muted} />
        }
      >
        {__DEV__ && fixture ? (
          <Pressable onPress={() => setVariantIndex((i) => i + 1)} accessibilityRole="button">
            <Text style={styles.devLine}>
              Preview data: {variant}. Tap to switch, long-press the title to exit.
            </Text>
          </Pressable>
        ) : null}
        {!fixture && showSeasonError ? (
          <Text style={styles.errorLine}>Your games did not load. Pull down to try again.</Text>
        ) : null}

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={themeColor().muted} />
          </View>
        ) : (
          <>
            {hasPlayed ? (
              <SeasonHeaderCard
                wins={season.wins}
                losses={season.losses}
                draws={season.draws}
                games={season.games}
                potdCount={season.potdCount}
                points={season.points}
                card={season.card}
                form={form}
              />
            ) : upcoming.length === 0 ? (
              <View style={styles.firstGame}>
                <Text style={styles.firstGameTitle}>Your season starts with your first game</Text>
                <Text style={styles.firstGameText}>Join a pickup game and your record, points and results will show up here.</Text>
                <Pressable accessibilityRole="button" onPress={() => push("/session-map")} style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}>
                  <Text style={styles.primaryBtnText}>Get a game</Text>
                </Pressable>
              </View>
            ) : null}

            {upcoming.length > 0 || hasPlayed ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Upcoming</Text>
              {upcoming.length > 0 ? (
                upcoming.map((run) => (
                  <GameCard
                    key={run.id}
                    run={run}
                    photo={photos[run.id]}
                    crowd={crowds.get(run.id) ?? EMPTY_CROWD}
                    playedWith={playedWith[run.id]}
                    onPress={() => openGame(run.id)}
                    style={styles.fullWidth}
                  />
                ))
              ) : hasPlayed ? (
                <View style={styles.noGamesRow}>
                  <Text style={styles.noGamesText} numberOfLines={1}>
                    No games booked
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => push("/session-map")}
                    style={({ pressed }) => [styles.accentBtn, pressed && styles.pressed]}
                  >
                    <Text style={styles.accentBtnText}>Get a game</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
            ) : null}

            {upcoming.length === 0 && bestGames.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Best games for you</Text>
                <BestGamesCarousel games={bestGames} photos={photos} onOpen={openGame} bleed={PAGE_PADDING} />
              </View>
            ) : null}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Past games</Text>
              {months.length === 0 ? (
                <Text style={styles.emptyLine}>Games you play will show up here with your results.</Text>
              ) : (
                months.map((m) => (
                  <View key={m.label} style={styles.monthGroup}>
                    <Text style={styles.monthLabel}>{m.label}</Text>
                    <View style={styles.logCard}>
                      {m.games.map((g, i) => (
                        <MatchLogRow
                          key={g.run_id}
                          game={g}
                          photo={photos[g.run_id]}
                          first={i === 0}
                          onPress={() => openRecap(g.run_id)}
                        />
                      ))}
                    </View>
                  </View>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
      )}
    </View>
  );
}

function make_styles() {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: themeColor().bg },
    pressed: { opacity: 0.88 },
    toggle: {
      flexDirection: "row",
      alignSelf: "flex-start",
      marginHorizontal: PAGE_PADDING,
      marginBottom: 12,
      padding: 3,
      borderRadius: radius.pill,
      backgroundColor: themeColor().card,
      borderWidth: 1,
      borderColor: themeColor().line,
    },
    toggleBtn: { paddingHorizontal: 18, paddingVertical: 7, borderRadius: radius.pill },
    toggleBtnOn: { backgroundColor: themeColor().pitch },
    toggleText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: themeColor().text },
    toggleTextOn: { color: themeColor().onPitch },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: PAGE_PADDING,
      paddingTop: 12,
      paddingBottom: 12,
    },
    header: {
      color: themeColor().text,
      fontSize: 32,
      ...headline,
    },
    headerLink: { paddingVertical: 6 },
    headerLinkText: { fontSize: 15, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: themeColor().pitchText },
    content: { paddingHorizontal: PAGE_PADDING, gap: 24 },
    devLine: { fontSize: 13, fontFamily: "Inter_500Medium", color: themeColor().muted },
    errorLine: { fontSize: 14, fontFamily: "Inter_400Regular", color: themeColor().coralText },
    loadingWrap: { paddingVertical: 40, alignItems: "center" },
    section: { gap: 12 },
    sectionTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: themeColor().text },
    fullWidth: { width: "100%" },
    noGamesRow: {
      minHeight: 64,
      paddingHorizontal: 16,
      paddingVertical: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      backgroundColor: themeColor().card,
      borderWidth: 1,
      borderColor: themeColor().line,
      borderRadius: radius.card,
    },
    noGamesText: { flexShrink: 1, fontSize: 15, fontFamily: "Inter_600SemiBold", color: themeColor().text },
    firstGame: { gap: 10, padding: 20, backgroundColor: themeColor().card, borderWidth: 1, borderColor: themeColor().line, borderRadius: radius.card },
    firstGameTitle: { fontSize: 20, ...headline, color: themeColor().text },
    firstGameText: { fontSize: 14, fontFamily: "Inter_400Regular", color: themeColor().muted },
    primaryBtn: { marginTop: 6, backgroundColor: themeColor().pitch, borderRadius: radius.button, paddingVertical: 14, alignItems: "center" },
    primaryBtnText: { color: themeColor().onPitch, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
    accentBtn: {
      backgroundColor: themeColor().pitch,
      borderRadius: radius.button,
      paddingVertical: 10,
      paddingHorizontal: 18,
    },
    accentBtnText: { color: themeColor().onPitch, fontSize: 15, fontFamily: "Inter_700Bold", fontWeight: "700" },
    emptyLine: { fontSize: 14, fontFamily: "Inter_400Regular", color: themeColor().muted },
    monthGroup: { gap: 8 },
    monthLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: themeColor().muted },
    logCard: {
      backgroundColor: themeColor().card,
      borderWidth: 1,
      borderColor: themeColor().line,
      borderRadius: radius.card,
      overflow: "hidden",
    },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
