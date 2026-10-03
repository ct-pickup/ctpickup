import FontAwesome from "@expo/vector-icons/FontAwesome";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dimensions, FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { splitLocation } from "@/components/games/GameCards";
import SpotsBadge from "@/components/pickup/SpotsBadge";
import {
  addDays,
  dayLabel,
  dayNumber,
  monthGrid,
  monthLabel,
  monthOf,
  monthsBetween,
  shiftMonth,
  weekDays,
  weekdayShort,
  weekStart,
  weeksBetween,
  WEEKDAY_LETTERS,
  type DateKey,
  type YearMonth,
} from "@/lib/homeCalendar";
import { etDateKey, fmtPickupTimeEt, runTimeTbd } from "@/lib/pickup/runStartAtDisplay";
import { fetchRunTimeTbdIds } from "@/lib/pickup/runTimeTbd";
import { fetchRunMinStars, levelLabel } from "@/lib/starRatings";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";

/** Weeks the strip can swipe either side of the current one. */
const WEEKS_EACH_WAY = 52;
const WEEK_PAGES = Array.from({ length: WEEKS_EACH_WAY * 2 + 1 }, (_, i) => i - WEEKS_EACH_WAY);
/** Months the month sheet can move either side of the current one. */
const MONTHS_EACH_WAY = 12;
/** Games are fetched this many days beyond the visible range so small swipes need no refetch. */
const FETCH_PAD_DAYS = 35;

const RUN_COLUMNS = "id,title,start_at,location_text,capacity,spots_taken,status,created_by";
/** Same definition of "going" as Home's crowd query: a held spot. */
const GOING_STATUSES = ["confirmed", "pending_payment"];

type MyGame = {
  id: string;
  title: string | null;
  start_at: string;
  location_text: string | null;
  capacity: number;
  spots_taken: number;
  status: string | null;
  created_by: string | null;
  time_tbd: boolean;
  min_star: number | null;
  hosting: boolean;
};

type Range = { from: DateKey; to: DateKey };

/**
 * The player's games (joined or hosting, not canceled) in a date range.
 *   1. pickup_run_rsvps: run_id where user_id = me and status in (confirmed, pending_payment).
 *      Canceled and declined RSVPs are excluded by that filter.
 *   2. pickup_runs: id in those RSVPs OR created_by = me, start_at inside the range, status not canceled.
 * Day grouping happens in the component with etDateKey().
 */
function useMyGames(supabase: SupabaseClient | null, myUserId: string | null, visible: Range) {
  const [games, setGames] = useState<MyGame[]>([]);
  const loaded = useRef<Range | null>(null);
  const inFlight = useRef(0);

  const fetchRange = useCallback(
    async (range: Range) => {
      if (!supabase || !myUserId) return;
      const ticket = ++inFlight.current;
      const lo = new Date(`${addDays(range.from, -1)}T00:00:00Z`).toISOString();
      const hi = new Date(`${addDays(range.to, 2)}T00:00:00Z`).toISOString();

      const rsvpRes = await supabase
        .from("pickup_run_rsvps")
        .select("run_id")
        .eq("user_id", myUserId)
        .in("status", GOING_STATUSES)
        .limit(500);
      if (rsvpRes.error) {
        console.warn("[home calendar] rsvps:", rsvpRes.error.message);
        return;
      }
      const ids = Array.from(
        new Set(((rsvpRes.data ?? []) as Array<{ run_id: string | null }>).map((r) => r.run_id).filter((v): v is string => Boolean(v))),
      );
      const mine = ids.length > 0 ? `id.in.(${ids.join(",")}),created_by.eq.${myUserId}` : `created_by.eq.${myUserId}`;
      const runsRes = await supabase
        .from("pickup_runs")
        .select(RUN_COLUMNS)
        .or(mine)
        .gte("start_at", lo)
        .lte("start_at", hi)
        .not("status", "in", "(canceled,cancelled)")
        .order("start_at", { ascending: true })
        .limit(200);
      if (runsRes.error) {
        console.warn("[home calendar] runs:", runsRes.error.message);
        return;
      }
      const rows = (runsRes.data ?? []) as unknown as Array<Omit<MyGame, "time_tbd" | "min_star" | "hosting">>;
      const runIds = rows.map((r) => r.id);
      const [tbd, minStars] = await Promise.all([fetchRunTimeTbdIds(supabase, runIds), fetchRunMinStars(supabase, runIds)]);
      if (ticket !== inFlight.current) return;
      loaded.current = range;
      setGames(
        rows.map((r) => ({
          ...r,
          time_tbd: tbd.has(r.id),
          min_star: minStars.get(r.id) ?? null,
          hosting: r.created_by === myUserId,
        })),
      );
    },
    [supabase, myUserId],
  );

  const refresh = useCallback(() => {
    if (loaded.current) void fetchRange(loaded.current);
  }, [fetchRange]);

  /**
   * The player's first game after `afterKey` (an Eastern day), for when none is in the fetched window.
   * Same two-step filter as fetchRange, but no upper bound and limit 5.
   */
  const [beyond, setBeyond] = useState<MyGame | null>(null);
  const lookupNextAfter = useCallback(
    async (afterKey: DateKey) => {
      if (!supabase || !myUserId) return;
      const lo = new Date(`${addDays(afterKey, 0)}T00:00:00Z`).toISOString();
      const rsvpRes = await supabase.from("pickup_run_rsvps").select("run_id").eq("user_id", myUserId).in("status", GOING_STATUSES).limit(500);
      if (rsvpRes.error) return;
      const ids = Array.from(
        new Set(((rsvpRes.data ?? []) as Array<{ run_id: string | null }>).map((r) => r.run_id).filter((v): v is string => Boolean(v))),
      );
      const mine = ids.length > 0 ? `id.in.(${ids.join(",")}),created_by.eq.${myUserId}` : `created_by.eq.${myUserId}`;
      const runsRes = await supabase
        .from("pickup_runs")
        .select(RUN_COLUMNS)
        .or(mine)
        .gte("start_at", lo)
        .not("status", "in", "(canceled,cancelled)")
        .order("start_at", { ascending: true })
        .limit(5);
      if (runsRes.error) return;
      const rows = (runsRes.data ?? []) as unknown as Array<Omit<MyGame, "time_tbd" | "min_star" | "hosting">>;
      const row = rows.find((r) => {
        const k = etDateKey(r.start_at);
        return k != null && k > afterKey;
      });
      if (!row) {
        setBeyond(null);
        return;
      }
      const tbd = await fetchRunTimeTbdIds(supabase, [row.id]);
      setBeyond({ ...row, time_tbd: tbd.has(row.id), min_star: null, hosting: row.created_by === myUserId });
    },
    [supabase, myUserId],
  );

  // Fetch (with padding) whenever the visible range leaves what is loaded.
  useFocusEffect(
    useCallback(() => {
      const have = loaded.current;
      if (have && visible.from >= have.from && visible.to <= have.to) return;
      void fetchRange({ from: addDays(visible.from, -FETCH_PAD_DAYS), to: addDays(visible.to, FETCH_PAD_DAYS) });
    }, [visible.from, visible.to, fetchRange]),
  );

  useFocusEffect(
    useCallback(() => {
      if (loaded.current) void fetchRange(loaded.current);
    }, [fetchRange]),
  );

  return { games, refresh, beyond, lookupNextAfter };
}

/** Eastern calendar day today, kept fresh when the screen regains focus. */
function useTodayKey(): DateKey {
  const [today, setToday] = useState<DateKey>(() => etDateKey(Date.now()) ?? new Date().toISOString().slice(0, 10));
  useFocusEffect(
    useCallback(() => {
      setToday(etDateKey(Date.now()) ?? new Date().toISOString().slice(0, 10));
    }, []),
  );
  return today;
}

export type HomeCalendarHandle = { refresh: () => void };

export default function HomeCalendar({
  supabase,
  myUserId,
  onOpenRun,
  onGetGame,
  registerRefresh,
}: {
  supabase: SupabaseClient | null;
  myUserId: string | null;
  onOpenRun: (id: string) => void;
  onGetGame: () => void;
  /** Lets Home's pull-to-refresh reload the calendar too. */
  registerRefresh?: (refresh: () => void) => void;
}) {
  useThemedStyles(publish_styles);
  const insets = useSafeAreaInsets();
  const today = useTodayKey();
  const currentWeek = weekStart(today);

  const [selected, setSelected] = useState<DateKey>(today);
  const [weekOffset, setWeekOffset] = useState(0);
  const [stripWidth, setStripWidth] = useState(() => Dimensions.get("window").width - 40);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMonth, setSheetMonth] = useState<YearMonth>(() => monthOf(today));
  const stripRef = useRef<FlatList<number>>(null);

  const visibleWeek = addDays(currentWeek, weekOffset * 7);
  const week: Range = { from: visibleWeek, to: addDays(visibleWeek, 6) };
  const grid = sheetOpen ? monthGrid(sheetMonth) : null;
  const visible: Range = grid
    ? { from: grid[0] < week.from ? grid[0] : week.from, to: grid[41] > week.to ? grid[41] : week.to }
    : week;

  const { games, refresh, beyond, lookupNextAfter } = useMyGames(supabase, myUserId, visible);
  useEffect(() => {
    registerRefresh?.(refresh);
  }, [registerRefresh, refresh]);

  const byDay = useMemo(() => {
    const map = new Map<DateKey, MyGame[]>();
    for (const g of games) {
      const key = etDateKey(g.start_at);
      if (!key) continue;
      const list = map.get(key);
      if (list) list.push(g);
      else map.set(key, [g]);
    }
    return map;
  }, [games]);

  // Next game after the selected day, from what is already fetched; one extra lookup only when none is in range.
  const laterInRange = useMemo(() => {
    let best: { key: DateKey; game: MyGame } | null = null;
    for (const g of games) {
      const k = etDateKey(g.start_at);
      if (k && k > selected && (!best || g.start_at < best.game.start_at)) best = { key: k, game: g };
    }
    return best;
  }, [games, selected]);
  const asked = useRef<DateKey | null>(null);
  const selectedHasGames = byDay.has(selected);
  useFocusEffect(
    useCallback(() => {
      if (selectedHasGames || laterInRange || asked.current === selected) return;
      asked.current = selected;
      void lookupNextAfter(selected);
    }, [selectedHasGames, laterInRange, selected, lookupNextAfter]),
  );
  const beyondKey = beyond ? etDateKey(beyond.start_at) : null;
  const nextLater =
    laterInRange ?? (beyond && beyondKey && beyondKey > selected ? { key: beyondKey, game: beyond } : null);

  const goToWeek = (offset: number, animated = true) => {
    const clamped = Math.max(-WEEKS_EACH_WAY, Math.min(WEEKS_EACH_WAY, offset));
    setWeekOffset(clamped);
    stripRef.current?.scrollToIndex({ index: clamped + WEEKS_EACH_WAY, animated });
  };

  const selectDay = (key: DateKey) => {
    setSelected(key);
    goToWeek(weeksBetween(currentWeek, weekStart(key)));
  };

  const goToday = () => {
    setSelected(today);
    goToWeek(0);
  };

  const openSheet = () => {
    setSheetMonth(monthOf(selected));
    setSheetOpen(true);
  };

  const headerMonth = monthLabel(monthOf(addDays(visibleWeek, 3)));
  const dayGames = byDay.get(selected) ?? [];
  const isToday = selected === today;
  const sheetBase = monthOf(today);
  const sheetDelta = monthsBetween(sheetBase, sheetMonth);

  return (
    <View>
      <View style={styles.headerRow}>
        <Pressable
          onPress={openSheet}
          hitSlop={8}
          style={styles.monthBtn}
          accessibilityRole="button"
          accessibilityLabel={`${headerMonth}, open month view`}
        >
          <Text style={styles.monthText}>{headerMonth}</Text>
          <FontAwesome name="chevron-down" size={11} color={themeColor().muted} />
        </Pressable>
        {weekOffset !== 0 ? (
          <Pressable onPress={goToday} hitSlop={8} style={styles.todayBtn} accessibilityRole="button" accessibilityLabel="Back to today">
            <Text style={styles.todayText}>Today</Text>
          </Pressable>
        ) : null}
      </View>

      <View onLayout={(e) => setStripWidth(e.nativeEvent.layout.width)}>
        <FlatList
          ref={stripRef}
          horizontal
          pagingEnabled
          data={WEEK_PAGES}
          keyExtractor={(o) => String(o)}
          initialScrollIndex={WEEKS_EACH_WAY}
          getItemLayout={(_, index) => ({ length: stripWidth, offset: stripWidth * index, index })}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setWeekOffset(Math.round(e.nativeEvent.contentOffset.x / stripWidth) - WEEKS_EACH_WAY)}
          renderItem={({ item: offset }) => (
            <View style={{ width: stripWidth, flexDirection: "row" }}>
              {weekDays(addDays(currentWeek, offset * 7)).map((key) => (
                <DayCell
                  key={key}
                  dayKey={key}
                  today={today}
                  selected={selected}
                  hasGame={byDay.has(key)}
                  onPress={() => setSelected(key)}
                  showLetter
                />
              ))}
            </View>
          )}
        />
      </View>

      <View style={styles.dayHeader}>
        <Text style={styles.dayTitle}>{isToday ? "Today" : dayLabel(selected)}</Text>
      </View>
      {dayGames.length > 0 ? (
        dayGames.map((g) => <DayGameRow key={g.id} game={g} onPress={() => onOpenRun(g.id)} />)
      ) : (
        <View style={[styles.card, styles.emptyCard]}>
          <Text style={styles.emptyTitle} numberOfLines={1}>
            Nothing booked
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={onGetGame}
            style={({ pressed }) => [styles.accentBtn, pressed && styles.pressed]}
          >
            <Text style={styles.accentBtnText}>Get a game</Text>
          </Pressable>
        </View>
      )}
      {dayGames.length === 0 && nextLater ? (
        <Pressable
          onPress={() => selectDay(nextLater.key)}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Go to your next game"
        >
          <Text style={styles.nextLine} numberOfLines={1}>
            Next: {weekdayShort(nextLater.key)} {fmtPickupTimeEt(nextLater.game.start_at, runTimeTbd(nextLater.game))} ·{" "}
            {splitLocation(nextLater.game.location_text, nextLater.game.title).field}
          </Text>
        </Pressable>
      ) : null}

      <Modal visible={sheetOpen} transparent animationType="slide" onRequestClose={() => setSheetOpen(false)}>
        <View style={styles.sheetRoot}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSheetOpen(false)} accessibilityLabel="Close month view" />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
            <View style={styles.handle} />
            <View style={styles.sheetHeader}>
              <Pressable
                onPress={() => setSheetMonth((m) => shiftMonth(m, -1))}
                disabled={sheetDelta <= -MONTHS_EACH_WAY}
                hitSlop={10}
                style={sheetDelta <= -MONTHS_EACH_WAY && styles.disabled}
                accessibilityRole="button"
                accessibilityLabel="Previous month"
              >
                <FontAwesome name="chevron-left" size={14} color={themeColor().text} />
              </Pressable>
              <Text style={styles.sheetTitle}>{monthLabel(sheetMonth)}</Text>
              <Pressable
                onPress={() => setSheetMonth((m) => shiftMonth(m, 1))}
                disabled={sheetDelta >= MONTHS_EACH_WAY}
                hitSlop={10}
                style={sheetDelta >= MONTHS_EACH_WAY && styles.disabled}
                accessibilityRole="button"
                accessibilityLabel="Next month"
              >
                <FontAwesome name="chevron-right" size={14} color={themeColor().text} />
              </Pressable>
            </View>
            <View style={styles.weekRow}>
              {WEEKDAY_LETTERS.map((l, i) => (
                <Text key={i} style={styles.letter}>
                  {l}
                </Text>
              ))}
            </View>
            {Array.from({ length: 6 }, (_, row) => (
              <View key={row} style={styles.weekRow}>
                {monthGrid(sheetMonth)
                  .slice(row * 7, row * 7 + 7)
                  .map((key) => (
                    <DayCell
                      key={key}
                      dayKey={key}
                      today={today}
                      selected={selected}
                      hasGame={byDay.has(key)}
                      dim={monthOf(key).month !== sheetMonth.month}
                      compact
                      onPress={() => {
                        selectDay(key);
                        setSheetOpen(false);
                      }}
                    />
                  ))}
              </View>
            ))}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function DayCell({
  dayKey,
  today,
  selected,
  hasGame,
  dim,
  showLetter,
  compact,
  onPress,
}: {
  dayKey: DateKey;
  today: DateKey;
  selected: DateKey;
  hasGame: boolean;
  dim?: boolean;
  showLetter?: boolean;
  compact?: boolean;
  onPress: () => void;
}) {
  useThemedStyles(publish_styles);
  const isToday = dayKey === today;
  const isSelected = dayKey === selected;
  const letter = WEEKDAY_LETTERS[new Date(`${dayKey}T00:00:00Z`).getUTCDay()];
  return (
    <Pressable
      onPress={onPress}
      style={[styles.cell, compact && styles.cellCompact]}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={`${dayLabel(dayKey)}${isToday ? ", today" : ""}${hasGame ? ", has a game" : ""}`}
    >
      {showLetter ? <Text style={styles.cellLetter}>{letter}</Text> : null}
      <View style={[styles.datePill, isToday && styles.datePillToday, isSelected && !isToday && styles.datePillSelected]}>
        <Text style={[styles.dateText, dim && styles.dim, isToday && styles.dateTextToday]}>{dayNumber(dayKey)}</Text>
      </View>
      <View style={[styles.dot, hasGame && styles.dotOn]} />
    </Pressable>
  );
}

function DayGameRow({ game, onPress }: { game: MyGame; onPress: () => void }) {
  useThemedStyles(publish_styles);
  const left = Math.max(game.capacity - game.spots_taken, 0);
  const { field, town } = splitLocation(game.location_text, game.title);
  const time = fmtPickupTimeEt(game.start_at, runTimeTbd(game));
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, styles.gameCard, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${field}, ${time}`}
    >
      <View style={styles.gameTop}>
        <Text style={styles.when} numberOfLines={1}>
          {time}
          {game.hosting ? " · Hosting" : ""}
        </Text>
        <SpotsBadge spotsLeft={left} />
      </View>
      <Text style={styles.gameTitle} numberOfLines={1}>
        {field}
      </Text>
      <Text style={styles.gameSub} numberOfLines={1}>
        {[town, levelLabel(game.min_star)].filter(Boolean).join(" · ")}
      </Text>
    </Pressable>
  );
}

const CELL_H = 62;

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    pressed: { opacity: 0.88 },
    disabled: { opacity: 0.3 },
    headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 16, marginBottom: 6 },
    monthBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
    monthText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: c.text },
    todayBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: c.accent },
    todayText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: c.accent },

    cell: { flex: 1, height: CELL_H, alignItems: "center", justifyContent: "flex-start", gap: 2 },
    cellCompact: { height: 46 },
    cellLetter: { fontSize: 12, fontFamily: "Inter_500Medium", color: c.muted },
    letter: { flex: 1, textAlign: "center", fontSize: 12, fontFamily: "Inter_500Medium", color: c.muted, paddingBottom: 4 },
    datePill: { width: 34, height: 34, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
    datePillToday: { backgroundColor: c.pitch },
    datePillSelected: { borderWidth: 1.5, borderColor: c.accent },
    dateText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: c.text },
    dateTextToday: { color: c.onPitch },
    dim: { opacity: 0.35 },
    dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "transparent" },
    dotOn: { backgroundColor: c.accent },

    dayHeader: { marginTop: 10, marginBottom: 8 },
    dayTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: c.text },
    card: { backgroundColor: c.card, borderWidth: 1, borderColor: c.line, borderRadius: radius.card, overflow: "hidden", marginBottom: 8 },
    gameCard: { padding: 14, gap: 3 },
    gameTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
    when: { flexShrink: 1, fontSize: 13, fontFamily: "Inter_600SemiBold", color: c.pitchText },
    gameTitle: { fontSize: 18, ...headline, color: c.text },
    gameSub: { fontSize: 13, fontFamily: "Inter_400Regular", color: c.muted },
    emptyCard: { minHeight: 64, paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
    nextLine: { marginTop: 2, marginBottom: 8, fontSize: 13, fontFamily: "Inter_600SemiBold", color: c.pitchText },
    emptyTitle: { flexShrink: 1, fontSize: 15, fontFamily: "Inter_600SemiBold", color: c.text },
    accentBtn: { backgroundColor: c.accent, borderRadius: radius.button, paddingVertical: 8, paddingHorizontal: 16 },
    accentBtnText: { color: c.onAccent, fontSize: 14, fontFamily: "Inter_600SemiBold" },

    sheetRoot: { flex: 1, justifyContent: "flex-end", backgroundColor: c.scrim },
    sheet: { backgroundColor: c.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingTop: 8 },
    handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 10, backgroundColor: c.overlay, marginBottom: 12 },
    sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8, paddingHorizontal: 8 },
    sheetTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: c.text },
    weekRow: { flexDirection: "row" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
