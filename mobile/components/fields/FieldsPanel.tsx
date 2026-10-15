import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { Region } from "react-native-maps";

import { FieldCard } from "@/components/fields/FieldCard";
import { FieldsMap } from "@/components/fields/FieldsMap";
import { YourPlan } from "@/components/fields/YourPlan";
import { useNearbyFields } from "@/hooks/useNearbyFields";
import { fitRegion, initialRegion } from "@/lib/fields/clusters";
import { FIELDS_SAMPLE_DATA } from "@/lib/fields/config";
import { countLabel } from "@/lib/fields/nearby";
import { NO_FIELD_FILTERS, type FieldFilters, type FieldListing } from "@/lib/fields/types";
import { quietUserLocation } from "@/lib/fields/venueStore";
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
  /** Opens the player's own requests. */
  onMyRequests?: () => void;
  /** Opens the Plans screen. */
  onPlans?: () => void;
  /** Opens Suggest a field, centred on the map the player is looking at. */
  onSuggest?: (at: { lat: number; lon: number; dlat: number; dlon: number }) => void;
};

/**
 * Search, filter chips, the map and the list of fields. Lives under the Fields toggle on the Games tab. Venues are fetched
 * from the database for the visible map area as it moves (venues_nearby), never all at once.
 */
export function FieldsPanel({ onOpen, onMyRequests, onPlans, onSuggest }: Props) {
  useThemedStyles(publish_styles);
  // undefined while the player's location is being read, null when it is not available.
  const [user, setUser] = useState<{ lat: number; lon: number } | null | undefined>(undefined);
  const [region, setRegion] = useState<Region | null>(null);
  const [fit, setFit] = useState<{ region: Region; nonce: number } | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [filters, setFilters] = useState<FieldFilters>(NO_FIELD_FILTERS);
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

  function showMore() {
    if (limit < items.length) setLimit((n) => n + PAGE_SIZE);
    else if (hasMore) {
      void loadMore();
      setLimit((n) => n + PAGE_SIZE);
    }
  }

  return (
    <View style={styles.root}>
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

      <View style={styles.chips}>
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
      </View>

      {start == null ? (
        <View style={[styles.mapWrap, styles.mapLoading]}>
          <ActivityIndicator color={themeColor().muted} />
        </View>
      ) : (
        <FieldsMap shown={items} start={start} onRegionChange={setRegion} fit={fit} onOpen={onOpen} />
      )}

      <View style={styles.listHead}>
        <Text style={styles.listTitle}>{loading && items.length === 0 ? "Finding fields" : countLabel(total, searching)}</Text>
        {FIELDS_SAMPLE_DATA ? <Text style={styles.sample}>Sample data</Text> : null}
      </View>
      {onSuggest ? (
        <Pressable
          onPress={() => {
            const r = region ?? start ?? DEFAULT_REGION;
            onSuggest({ lat: r.latitude, lon: r.longitude, dlat: r.latitudeDelta, dlon: r.longitudeDelta });
          }}
          accessibilityRole="button"
          hitSlop={8}
          style={styles.myRequests}
        >
          <Text style={styles.myRequestsText}>Suggest a field</Text>
        </Pressable>
      ) : null}
      {onMyRequests ? (
        <Pressable onPress={onMyRequests} accessibilityRole="link" hitSlop={8} style={styles.myRequests}>
          <Text style={styles.myRequestsText}>My requests</Text>
        </Pressable>
      ) : null}

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
      ) : (
        <Text style={styles.empty}>{error ? "" : searching ? "No fields match that search." : "No fields in this area. Move the map or remove a filter."}</Text>
      )}

      <Pressable onPress={() => void Linking.openURL(OSM_COPYRIGHT_URL)} accessibilityRole="link" accessibilityLabel="Venue data © OpenStreetMap contributors. Opens the OpenStreetMap copyright page." hitSlop={8} style={styles.attribution}>
        <Text style={styles.attributionText}>Venue data © OpenStreetMap contributors</Text>
      </Pressable>
    </View>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    root: { gap: 14 },
    search: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 14,
      height: 46,
      backgroundColor: c.card,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: c.line,
    },
    searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", color: c.text, paddingVertical: 0 },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: c.card, borderWidth: 1, borderColor: c.line },
    chipOn: { backgroundColor: c.pitch, borderColor: c.pitch },
    chipText: { fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: c.text },
    chipTextOn: { color: c.onPitch },
    mapLoading: { alignItems: "center", justifyContent: "center", backgroundColor: themeColor().card },
    mapWrap: { height: 240, borderRadius: radius.card, overflow: "hidden", borderWidth: 1, borderColor: c.line },
    listHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
    listTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: c.text },
    myRequests: { alignSelf: "flex-start", marginTop: -6 },
    myRequestsText: { fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: c.pitchText },
    attribution: { alignSelf: "center", paddingVertical: 6 },
    attributionText: { fontSize: 12, fontFamily: "Inter_400Regular", color: c.muted, textDecorationLine: "underline" },
    sample: { fontSize: 12, fontFamily: "Inter_500Medium", color: c.muted },
    list: { gap: 10 },
    error: { fontSize: 14, fontFamily: "Inter_500Medium", color: c.coralText },
    more: { alignItems: "center", paddingVertical: 12, borderRadius: radius.button, borderWidth: 1, borderColor: c.line, backgroundColor: c.card },
    moreText: { fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: c.text },
    empty: { fontSize: 14, fontFamily: "Inter_400Regular", color: c.muted },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
