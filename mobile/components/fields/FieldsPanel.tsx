import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import MapView, { Marker, type Region } from "react-native-maps";

import { FieldCard } from "@/components/fields/FieldCard";
import { filterFields, pinLabel } from "@/lib/fields/presentation";
import { NO_FIELD_FILTERS, type FieldFilters, type FieldListing } from "@/lib/fields/types";
import { radius, themeColor, useThemedStyles } from "@/theme";

const CHIPS: { key: Exclude<keyof FieldFilters, "query">; label: string }[] = [
  { key: "free", label: "Free" },
  { key: "turf", label: "Turf" },
  { key: "noPermit", label: "No permit" },
  { key: "lights", label: "Lights" },
];

const CT_REGION: Region = { latitude: 41.17, longitude: -73.27, latitudeDelta: 0.28, longitudeDelta: 0.28 };

type Props = {
  fields: FieldListing[];
  /** "Sample data" tag until the venues table is live. */
  sample?: boolean;
  onOpen: (venueKey: string) => void;
};

/** Search, filter chips, the map and the list of fields. Lives under the Fields toggle on the Games tab. */
export function FieldsPanel({ fields, sample, onOpen }: Props) {
  useThemedStyles(publish_styles);
  const [filters, setFilters] = useState<FieldFilters>(NO_FIELD_FILTERS);
  const shown = useMemo(() => filterFields(fields, filters), [fields, filters]);
  const pinned = shown.filter((f) => f.venue.lat != null && f.venue.lon != null);

  return (
    <View style={styles.root}>
      <View style={styles.search}>
        <FontAwesome name="search" size={14} color={themeColor().muted} />
        <TextInput
          value={filters.query}
          onChangeText={(query) => setFilters((f) => ({ ...f, query }))}
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
              onPress={() => setFilters((f) => ({ ...f, [c.key]: !f[c.key] }))}
              style={[styles.chip, on && styles.chipOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{c.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.mapWrap}>
        <MapView style={StyleSheet.absoluteFill} initialRegion={CT_REGION}>
          {pinned.map((f) => (
            <Marker
              key={f.venue.venue_key}
              coordinate={{ latitude: f.venue.lat!, longitude: f.venue.lon! }}
              onPress={() => onOpen(f.venue.venue_key)}
              accessibilityLabel={f.venue.name}
            >
              <View style={[styles.pin, f.venue.price_status === "free" && styles.pinFree]}>
                <Text style={[styles.pinText, f.venue.price_status === "free" && styles.pinTextFree]} allowFontScaling={false}>
                  {pinLabel(f.venue)}
                </Text>
              </View>
            </Marker>
          ))}
        </MapView>
      </View>

      <View style={styles.listHead}>
        <Text style={styles.listTitle}>Fields near you</Text>
        {sample ? <Text style={styles.sample}>Sample data</Text> : null}
      </View>

      {shown.length > 0 ? (
        <View style={styles.list}>
          {shown.map((f) => (
            <FieldCard key={f.venue.venue_key} item={f} onPress={() => onOpen(f.venue.venue_key)} />
          ))}
        </View>
      ) : (
        <Text style={styles.empty}>No fields match. Try removing a filter.</Text>
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
    mapWrap: { height: 240, borderRadius: radius.card, overflow: "hidden", borderWidth: 1, borderColor: c.line },
    pin: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: c.inkSurface },
    pinFree: { backgroundColor: c.pitch },
    pinText: { fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700", color: c.onInk },
    pinTextFree: { color: c.onPitch },
    listHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
    listTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: c.text },
    sample: { fontSize: 12, fontFamily: "Inter_500Medium", color: c.muted },
    list: { gap: 10 },
    empty: { fontSize: 14, fontFamily: "Inter_400Regular", color: c.muted },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
