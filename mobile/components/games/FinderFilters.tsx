import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { FINDER_HUBS, finderHubById } from "@/lib/finderHubs";
import {
  activeFilterCount,
  NO_FINDER_FILTERS,
  type DayFilter,
  type FinderFilters,
  type PriceFilter,
  type StarRange,
  type TimeOfDay,
} from "@/lib/finderFilters";
import { addDays } from "@/lib/homeCalendar";
import { etDateKey } from "@/lib/pickup/runStartAtDisplay";
import { SKILL_STAR_RANGE } from "@/lib/starRatings";
import { radius, themeColor, useThemedStyles } from "@/theme";

const TIMES: Array<{ id: TimeOfDay; label: string }> = [
  { id: "morning", label: "Morning" },
  { id: "afternoon", label: "Afternoon" },
  { id: "evening", label: "Evening" },
];

const PRICES: Array<{ id: PriceFilter; label: string }> = [
  { id: "free", label: "Free" },
  { id: "paid", label: "Paid" },
];

const STAR_RANGES: StarRange[] = Object.values(SKILL_STAR_RANGE).sort((a, b) => a.low - b.low);

const sameRange = (a: StarRange | null, b: StarRange) => a != null && a.low === b.low && a.high === b.high;
const rangeLabel = (r: StarRange) => `${r.low.toFixed(1)}–${r.high.toFixed(1)} ★`;

/** "Sat, Oct 10" for a YYYY-MM-DD key. */
function dayText(key: string): string {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}

function dayLabel(d: DayFilter): string {
  return d.kind === "today" ? "Today" : d.kind === "week" ? "This week" : dayText(d.key);
}

/** The removable chips for what is currently on, in a stable order. */
function chipsFor(f: FinderFilters): Array<{ key: keyof FinderFilters; label: string }> {
  const out: Array<{ key: keyof FinderFilters; label: string }> = [];
  const hub = finderHubById(f.hubId);
  if (hub) out.push({ key: "hubId", label: hub.name });
  if (f.day) out.push({ key: "day", label: dayLabel(f.day) });
  if (f.timeOfDay) out.push({ key: "timeOfDay", label: TIMES.find((t) => t.id === f.timeOfDay)?.label ?? f.timeOfDay });
  if (f.stars) out.push({ key: "stars", label: rangeLabel(f.stars) });
  if (f.price) out.push({ key: "price", label: f.price === "free" ? "Free" : "Paid" });
  return out;
}

/** The Filters button plus one removable chip per active filter and a Clear all. */
export function FinderFilterBar({ filters, onOpen, onChange }: { filters: FinderFilters; onOpen: () => void; onChange: (next: FinderFilters) => void }) {
  useThemedStyles(publish_styles);
  const chips = chipsFor(filters);
  return (
    <View style={styles.bar}>
      <Pressable onPress={onOpen} style={[styles.chip, styles.chipOn]} accessibilityRole="button" accessibilityLabel="Filters">
        <FontAwesome name="sliders" size={12} color={themeColor().bg} />
        <Text style={[styles.chipText, styles.chipTextOn]}>{chips.length ? `Filters · ${chips.length}` : "Filters"}</Text>
      </Pressable>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroll}>
        {chips.map((c) => (
          <Pressable
            key={c.key}
            onPress={() => onChange({ ...filters, [c.key]: null })}
            style={styles.chip}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${c.label}`}
          >
            <Text style={styles.chipText}>{c.label}</Text>
            <FontAwesome name="times" size={11} color={themeColor().muted} />
          </Pressable>
        ))}
        {chips.length > 1 ? (
          <Pressable onPress={() => onChange(NO_FINDER_FILTERS)} style={styles.chip} accessibilityRole="button">
            <Text style={styles.chipText}>Clear all</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Option({ label, sub, on, onPress }: { label: string; sub?: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.opt, on && styles.optOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
      <Text style={[styles.optText, on && styles.optTextOn]}>{label}</Text>
      {sub ? <Text style={[styles.optSub, on && styles.optTextOn]}>{sub}</Text> : null}
    </Pressable>
  );
}

/** Hub, day, time of day, level and price. Each choice applies at once; tapping the chosen one again clears it. */
export function FinderFilterSheet({
  visible,
  onClose,
  filters,
  onChange,
  onPickHub,
}: {
  visible: boolean;
  onClose: () => void;
  filters: FinderFilters;
  onChange: (next: FinderFilters) => void;
  onPickHub: (hubId: string | null) => void;
}) {
  useThemedStyles(publish_styles);
  const [todayKey] = useState(() => etDateKey(Date.now()) ?? "");
  const days = todayKey ? Array.from({ length: 14 }, (_, i) => addDays(todayKey, i)) : [];
  const set = (patch: Partial<FinderFilters>) => onChange({ ...filters, ...patch });

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.sheetHead}>
          <Text style={styles.sheetTitle}>Filters</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button">
            <Text style={styles.done}>Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.sheetBody}>
          <Text style={styles.label}>Where</Text>
          <Option label="Nearby" sub="Around you" on={filters.hubId == null} onPress={() => onPickHub(null)} />
          {FINDER_HUBS.map((h) => (
            <Option key={h.id} label={h.name} sub={`${h.subtitle} · ${h.radiusMiles} mi`} on={filters.hubId === h.id} onPress={() => onPickHub(h.id)} />
          ))}

          <Text style={styles.label}>Day</Text>
          <View style={styles.wrap}>
            <Option label="Today" on={filters.day?.kind === "today"} onPress={() => set({ day: filters.day?.kind === "today" ? null : { kind: "today" } })} />
            <Option label="This week" on={filters.day?.kind === "week"} onPress={() => set({ day: filters.day?.kind === "week" ? null : { kind: "week" } })} />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayRow}>
            {days.map((key) => {
              const on = filters.day?.kind === "date" && filters.day.key === key;
              return <Option key={key} label={dayText(key)} on={on} onPress={() => set({ day: on ? null : { kind: "date", key } })} />;
            })}
          </ScrollView>

          <Text style={styles.label}>Time of day</Text>
          <View style={styles.wrap}>
            {TIMES.map((t) => (
              <Option key={t.id} label={t.label} on={filters.timeOfDay === t.id} onPress={() => set({ timeOfDay: filters.timeOfDay === t.id ? null : t.id })} />
            ))}
          </View>

          <Text style={styles.label}>Level</Text>
          <View style={styles.wrap}>
            {STAR_RANGES.map((r) => (
              <Option key={r.low} label={rangeLabel(r)} on={sameRange(filters.stars, r)} onPress={() => set({ stars: sameRange(filters.stars, r) ? null : r })} />
            ))}
          </View>

          <Text style={styles.label}>Price</Text>
          <View style={styles.wrap}>
            {PRICES.map((p) => (
              <Option key={p.id} label={p.label} on={filters.price === p.id} onPress={() => set({ price: filters.price === p.id ? null : p.id })} />
            ))}
          </View>

          {activeFilterCount(filters) > 0 ? (
            <Pressable onPress={() => onChange(NO_FINDER_FILTERS)} style={styles.clear} accessibilityRole="button">
              <Text style={styles.clearText}>Clear all filters</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    bar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, marginTop: 8 },
    chipScroll: { gap: 8, alignItems: "center", paddingRight: 16 },
    chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: c.card, borderWidth: 1, borderColor: c.line },
    chipOn: { backgroundColor: c.text, borderColor: c.text },
    chipText: { color: c.text, fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    chipTextOn: { color: c.bg },
    sheet: { flex: 1, backgroundColor: c.bg },
    sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 20, paddingBottom: 8 },
    sheetTitle: { color: c.text, fontSize: 20, fontFamily: "Inter_700Bold", fontWeight: "700" },
    done: { color: c.pitchText, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
    sheetBody: { padding: 20, paddingTop: 4, gap: 8, paddingBottom: 48 },
    label: { color: c.muted, fontSize: 12, fontFamily: "Inter_600SemiBold", fontWeight: "600", marginTop: 14, marginBottom: 2 },
    wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    dayRow: { gap: 8, paddingTop: 2 },
    opt: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.card, backgroundColor: c.card, borderWidth: 1, borderColor: c.line },
    optOn: { backgroundColor: c.pitch, borderColor: c.pitchText },
    optText: { color: c.text, fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    optSub: { color: c.muted, fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
    optTextOn: { color: c.onPitch },
    clear: { alignSelf: "center", paddingVertical: 14 },
    clearText: { color: c.pitchText, fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
