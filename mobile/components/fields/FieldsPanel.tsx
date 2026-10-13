import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { FieldCard } from "@/components/fields/FieldCard";
import { FieldsMap } from "@/components/fields/FieldsMap";
import { useFieldListings } from "@/hooks/useFieldListings";
import { FIELDS_SAMPLE_DATA } from "@/lib/fields/config";
import { filterFields } from "@/lib/fields/presentation";
import { NO_FIELD_FILTERS, type FieldFilters } from "@/lib/fields/types";
import { radius, themeColor, useThemedStyles } from "@/theme";

const CHIPS: { key: Exclude<keyof FieldFilters, "query">; label: string }[] = [
  { key: "free", label: "Free" },
  { key: "turf", label: "Turf" },
  { key: "noPermit", label: "No permit" },
  { key: "lights", label: "Lights" },
];

/** List rows shown before "Show more". The map has its own pin cap (see FieldsMap). */
const PAGE_SIZE = 25;

type Props = {
  onOpen: (venueKey: string) => void;
  /** Opens the player's own requests. */
  onMyRequests?: () => void;
};

/** Search, filter chips, the map and the list of fields. Lives under the Fields toggle on the Games tab. */
export function FieldsPanel({ onOpen, onMyRequests }: Props) {
  useThemedStyles(publish_styles);
  const { fields, loading, error, user, reload } = useFieldListings();
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [filters, setFilters] = useState<FieldFilters>(NO_FIELD_FILTERS);
  const shown = useMemo(() => filterFields(fields, filters), [fields, filters]);

  return (
    <View style={styles.root}>
      <View style={styles.search}>
        <FontAwesome name="search" size={14} color={themeColor().muted} />
        <TextInput
          value={filters.query}
          onChangeText={(query) => {
            setFilters((f) => ({ ...f, query }));
            setLimit(PAGE_SIZE);
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

      {loading ? (
        <View style={[styles.mapWrap, styles.mapLoading]}>
          <ActivityIndicator color={themeColor().muted} />
        </View>
      ) : (
        <FieldsMap shown={shown} all={fields} user={user} onOpen={onOpen} />
      )}

      <View style={styles.listHead}>
        <Text style={styles.listTitle}>Fields near you</Text>
        {FIELDS_SAMPLE_DATA ? <Text style={styles.sample}>Sample data</Text> : <Text style={styles.sample}>{shown.length} {shown.length === 1 ? "field" : "fields"}</Text>}
      </View>
      {onMyRequests ? (
        <Pressable onPress={onMyRequests} accessibilityRole="link" hitSlop={8} style={styles.myRequests}>
          <Text style={styles.myRequestsText}>My requests</Text>
        </Pressable>
      ) : null}

      {error ? (
        <Pressable onPress={() => void reload()} accessibilityRole="button">
          <Text style={styles.error}>{error} Tap to retry.</Text>
        </Pressable>
      ) : null}
      {loading ? (
        <ActivityIndicator color={themeColor().muted} />
      ) : shown.length > 0 ? (
        <View style={styles.list}>
          {shown.slice(0, limit).map((f) => (
            <FieldCard key={f.venue.venue_key} item={f} onPress={() => onOpen(f.venue.venue_key)} />
          ))}
          {shown.length > limit ? (
            <Pressable onPress={() => setLimit((n) => n + PAGE_SIZE)} style={styles.more} accessibilityRole="button">
              <Text style={styles.moreText}>Show more ({shown.length - limit} left)</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <Text style={styles.empty}>{error ? "" : "No fields match. Try removing a filter."}</Text>
      )}
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
