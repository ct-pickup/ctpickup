import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View, type LayoutChangeEvent } from "react-native";
import type { Region } from "react-native-maps";

import { FieldCard } from "@/components/fields/FieldCard";
import { FieldSheet } from "@/components/fields/FieldSheet";
import { FieldsMap } from "@/components/fields/FieldsMap";
import { YourPlan } from "@/components/fields/YourPlan";
import { useNearbyFields } from "@/hooks/useNearbyFields";
import { fitRegion, initialRegion } from "@/lib/fields/clusters";
import { FIELDS_SAMPLE_DATA } from "@/lib/fields/config";
import { countLabel } from "@/lib/fields/nearby";
import { NO_FIELD_FILTERS, type FieldFilters, type FieldListing } from "@/lib/fields/types";
import { quietUserLocation, requestUserLocation } from "@/lib/fields/venueStore";
import { radius, themeColor, useThemedStyles } from "@/theme";

const CHIPS: { key: Exclude<keyof FieldFilters, "query">; label: string }[] = [
  { key: "free", label: "Free" },
  { key: "turf", label: "Turf" },
  { key: "noPermit", label: "No permit" },
  { key: "lights", label: "Lights" },
  { key: "indoor", label: "Indoor" },
];

/** List rows shown before "Show more" (the next page is fetched from the database when the loaded ones run out). */
const PAGE_SIZE = 25;
/** Where the map opens when the player's location is not available: Fairfield County, Connecticut. */
const DEFAULT_REGION: Region = { latitude: 41.25, longitude: -73.25, latitudeDelta: 0.35, longitudeDelta: 0.5 };
const OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright";

type Props = {
  onOpen: (venueKey: string) => void;
  /** Opens the Plans screen. */
  onPlans?: () => void;
  /** Opens Suggest a field, centred on the map the player is looking at. */
  onSuggest?: (at: { lat: number; lon: number; dlat: number; dlon: number }) => void;
};

/**
 * Search, one row of filter chips, the map and a draggable sheet with the list of fields. Fills the space under the Games tab
 * header (no outer scroll), so the map and the list are both always on screen. Venues are fetched from the database for the
 * visible map area as it moves (venues_nearby), never all at once.
 */
export function FieldsPanel({ onOpen, onPlans, onSuggest }: Props) {
  useThemedStyles(publish_styles);
  const win = useWindowDimensions();
  // undefined while the player's location is being read, null when it is not available.
  const [user, setUser] = useState<{ lat: number; lon: number } | null | undefined>(undefined);
  const [region, setRegion] = useState<Region | null>(null);
  const [fit, setFit] = useState<{ region: Region; nonce: number } | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [filters, setFilters] = useState<FieldFilters>(NO_FIELD_FILTERS);
  const [areaH, setAreaH] = useState(0);
  const fittedFor = useRef("");

  useEffect(() => {
    let cancelled = false;
    void quietUserLocation().then((u) => {
      if (!cancelled) setUser(u);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const start: Region | null = user === undefined ? null : ((user ? initialRegion([], user) : null) ?? DEFAULT_REGION);
  const searching = filters.query.trim().length > 0;
  const activeFilters = CHIPS.filter((c) => filters[c.key]).length;

  const { items, total, loading, error, loadMore, reload, hasMore } = useNearbyFields({
    region: region ?? start,
    user: user ?? null,
    filters,
    enabled: start != null,
    // A search looks everywhere, so move the map to the best matches (once per search).
    onSearchResults: (found: FieldListing[], query: string) => {
      if (fittedFor.current === query) return;
      fittedFor.current = query;
      const pts = found
        .slice(0, 15)
        .filter((f) => f.venue.lat != null && f.venue.lon != null)
        .map((f) => ({ lat: f.venue.lat!, lon: f.venue.lon! }));
      const r = fitRegion(pts);
      if (r) setFit({ region: r, nonce: Date.now() });
    },
  });

  // Sheet positions (px from the top of the map area): open, half (map is about 40% of the screen) and tucked.
  const snaps = useMemo<[number, number, number]>(() => {
    const h = Math.max(areaH, 320);
    const half = Math.min(Math.max(win.height * 0.4, 200), h - 160);
    return [Math.min(110, half - 40), half, Math.max(h - 96, half + 40)];
  }, [areaH, win.height]);

  function showMore() {
    if (limit < items.length) setLimit((n) => n + PAGE_SIZE);
    else if (hasMore) {
      void loadMore();
      setLimit((n) => n + PAGE_SIZE);
    }
  }

  function suggest() {
    const r = region ?? start ?? DEFAULT_REGION;
    onSuggest?.({ lat: r.latitude, lon: r.longitude, dlat: r.latitudeDelta, dlon: r.longitudeDelta });
  }

  function zoomOut() {
    const r = region ?? start ?? DEFAULT_REGION;
    setFit({
      region: { ...r, latitudeDelta: Math.min(r.latitudeDelta * 2.5, 40), longitudeDelta: Math.min(r.longitudeDelta * 2.5, 40) },
      nonce: Date.now(),
    });
  }

  async function locateMe() {
    const u = await requestUserLocation();
    if (!u) {
      // Refused (or refused earlier, so the system will not ask again): send the player to Settings.
      void Linking.openSettings();
      return;
    }
    setUser(u);
    const r = initialRegion([], u);
    if (r) setFit({ region: r, nonce: Date.now() });
  }

  return (
    <View style={styles.root}>
      <View style={styles.top}>
        {onPlans ? <YourPlan onPress={onPlans} /> : null}
        <View style={styles.search}>
          <FontAwesome name="search" size={14} color={themeColor().muted} />
          <TextInput
            value={filters.query}
            onChangeText={(query) => {
              setFilters((f) => ({ ...f, query }));
              setLimit(PAGE_SIZE);
              if (!query.trim()) fittedFor.current = "";
            }}
            placeholder="Search fields, schools, towns"
            placeholderTextColor={themeColor().muted}
            style={styles.searchInput}
            returnKeyType="search"
            accessibilityLabel="Search fields, schools, towns"
          />
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
        {activeFilters > 0 ? (
          <Pressable
            onPress={() => {
              setFilters((f) => ({ ...NO_FIELD_FILTERS, query: f.query }));
              setLimit(PAGE_SIZE);
            }}
            style={styles.clear}
            accessibilityRole="button"
            accessibilityLabel={`${activeFilters} ${activeFilters === 1 ? "filter" : "filters"} on. Clear filters.`}
          >
            <Text style={styles.clearText}>{activeFilters}</Text>
            <FontAwesome name="times" size={11} color={themeColor().onPitch} />
          </Pressable>
        ) : null}
        {CHIPS.map((c) => {
          const on = filters[c.key];
          return (
            <Pressable
              key={c.key}
              onPress={() => {
                setFilters((f) => ({ ...f, [c.key]: !f[c.key] }));
                setLimit(PAGE_SIZE);
              }}
              style={[styles.chip, on && styles.chipOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{c.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.area} onLayout={(e: LayoutChangeEvent) => setAreaH(e.nativeEvent.layout.height)}>
        {start == null ? (
          <View style={[StyleSheet.absoluteFill, styles.mapLoading]}>
            <ActivityIndicator color={themeColor().muted} />
          </View>
        ) : (
          <FieldsMap shown={items} start={start} onRegionChange={setRegion} fit={fit} onOpen={onOpen} />
        )}

        {user === null ? (
          <Pressable onPress={() => void locateMe()} style={styles.locate} accessibilityRole="button" accessibilityLabel="Use my location">
            <FontAwesome name="location-arrow" size={13} color={themeColor().pitchText} />
            <Text style={styles.locateText}>Use my location</Text>
          </Pressable>
        ) : null}
        {onSuggest ? (
          <Pressable onPress={suggest} style={styles.plus} accessibilityRole="button" accessibilityLabel="Suggest a field">
            <FontAwesome name="plus" size={18} color={themeColor().onPitch} />
          </Pressable>
        ) : null}

        {areaH > 0 ? (
          <FieldSheet
            snaps={snaps}
            initial={1}
            header={
              <View style={styles.listHead}>
                <Text style={styles.listTitle}>{loading && items.length === 0 ? "Finding fields" : countLabel(total, searching)}</Text>
                {FIELDS_SAMPLE_DATA ? <Text style={styles.sample}>Sample data</Text> : null}
              </View>
            }
          >
            <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
              {error ? (
                <Pressable onPress={reload} accessibilityRole="button">
                  <Text style={styles.error}>{error} Tap to retry.</Text>
                </Pressable>
              ) : null}
              {loading && items.length === 0 ? (
                <ActivityIndicator color={themeColor().muted} />
              ) : items.length > 0 ? (
                <View style={styles.list}>
                  {items.slice(0, limit).map((f) => (
                    <FieldCard key={f.venue.venue_key} item={f} onPress={() => onOpen(f.venue.venue_key)} />
                  ))}
                  {items.length > limit || hasMore ? (
                    <Pressable onPress={showMore} style={styles.more} accessibilityRole="button">
                      <Text style={styles.moreText}>Show more ({Math.max(total - limit, 0).toLocaleString("en-US")} left)</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : error ? null : (
                <View style={styles.emptyBox}>
                  <Text style={styles.emptyTitle}>{searching ? "No fields match that search" : "No fields in this area"}</Text>
                  <Text style={styles.empty}>{activeFilters > 0 ? "Zoom out or turn off a filter." : "Zoom out to see more of the map."}</Text>
                  <View style={styles.emptyActions}>
                    <Pressable onPress={zoomOut} style={styles.emptyPrimary} accessibilityRole="button">
                      <Text style={styles.emptyPrimaryText}>Zoom out</Text>
                    </Pressable>
                    {onSuggest ? (
                      <Pressable onPress={suggest} style={styles.emptySecondary} accessibilityRole="button">
                        <Text style={styles.emptySecondaryText}>Suggest a field</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              )}

              <Pressable onPress={() => void Linking.openURL(OSM_COPYRIGHT_URL)} accessibilityRole="link" accessibilityLabel="Venue data © OpenStreetMap contributors. Opens the OpenStreetMap copyright page." hitSlop={8} style={styles.attribution}>
                <Text style={styles.attributionText}>Venue data © OpenStreetMap contributors</Text>
              </Pressable>
            </ScrollView>
          </FieldSheet>
        ) : null}
      </View>
    </View>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    root: { flex: 1 },
    top: { paddingHorizontal: 20, gap: 8, paddingBottom: 8 },
    search: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 14,
      height: 44,
      backgroundColor: c.card,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: c.line,
    },
    searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", color: c.text, paddingVertical: 0 },
    chipScroll: { flexGrow: 0, marginBottom: 10 },
    chips: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20 },
    chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: c.card, borderWidth: 1, borderColor: c.line },
    chipOn: { backgroundColor: c.pitch, borderColor: c.pitch },
    chipText: { fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: c.text },
    chipTextOn: { color: c.onPitch },
    clear: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 11, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: c.inkSurface },
    clearText: { fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700", color: c.onPitch },
    area: { flex: 1, overflow: "hidden" },
    mapLoading: { alignItems: "center", justifyContent: "center", backgroundColor: c.card },
    plus: {
      position: "absolute",
      top: 12,
      right: 16,
      width: 46,
      height: 46,
      borderRadius: 23,
      backgroundColor: c.pitch,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 2,
      borderColor: c.bg,
    },
    locate: {
      position: "absolute",
      top: 14,
      left: 16,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 14,
      height: 42,
      borderRadius: radius.pill,
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.line,
    },
    locateText: { fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: c.pitchText },
    listHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
    listTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: c.text },
    sheetContent: { paddingHorizontal: 20, paddingBottom: 32, gap: 10 },
    attribution: { alignSelf: "center", paddingVertical: 6 },
    attributionText: { fontSize: 12, fontFamily: "Inter_400Regular", color: c.muted, textDecorationLine: "underline" },
    sample: { fontSize: 12, fontFamily: "Inter_500Medium", color: c.muted },
    list: { gap: 10 },
    error: { fontSize: 14, fontFamily: "Inter_500Medium", color: c.coralText },
    more: { alignItems: "center", paddingVertical: 12, borderRadius: radius.button, borderWidth: 1, borderColor: c.line, backgroundColor: c.card },
    moreText: { fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: c.text },
    emptyBox: { alignItems: "center", gap: 6, paddingVertical: 16 },
    emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: c.text },
    empty: { fontSize: 14, fontFamily: "Inter_400Regular", color: c.muted, textAlign: "center" },
    emptyActions: { flexDirection: "row", gap: 10, marginTop: 8 },
    emptyPrimary: { paddingHorizontal: 20, paddingVertical: 11, borderRadius: radius.button, backgroundColor: c.pitch },
    emptyPrimaryText: { fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "700", color: c.onPitch },
    emptySecondary: { paddingHorizontal: 20, paddingVertical: 11, borderRadius: radius.button, borderWidth: 1, borderColor: c.line, backgroundColor: c.card },
    emptySecondaryText: { fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: c.text },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
