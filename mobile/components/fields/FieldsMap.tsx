import { useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import MapView, { Marker, type Region } from "react-native-maps";

import { clusterListings, clusterSize, initialRegion, regionForCluster, type MapSize } from "@/lib/fields/clusters";
import { pinLabel } from "@/lib/fields/presentation";
import type { FieldListing } from "@/lib/fields/types";
import { radius, themeColor, useThemedStyles } from "@/theme";

const CT_REGION: Region = { latitude: 41.6, longitude: -72.75, latitudeDelta: 1.3, longitudeDelta: 1.5 };
/** Most markers (pins and cluster bubbles together) drawn at once. */
export const MAX_PINS = 60;

type Props = {
  /** Venues to draw: the filtered list. */
  shown: FieldListing[];
  /** Every venue, to pick the opening view (so a filter does not move the map on first load). */
  all: FieldListing[];
  user: { lat: number; lon: number } | null;
  onOpen: (venueKey: string) => void;
};

/**
 * The Fields map. Opens zoomed in near the user (or on the best venue's nearest neighbors), merges pins that would overlap
 * into numbered bubbles that zoom in when tapped, and shows individual price pins once they have room.
 */
export function FieldsMap({ shown, all, user, onOpen }: Props) {
  useThemedStyles(publish_styles);
  const mapRef = useRef<MapView>(null);
  const [start] = useState<Region>(() => initialRegion(all, user) ?? CT_REGION);
  const [region, setRegion] = useState<Region>(start);
  const [size, setSize] = useState<MapSize>({ width: 350, height: 240 });
  const items = useMemo(() => clusterListings(shown, region, size, { cap: MAX_PINS }), [shown, region, size]);

  function onLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) setSize({ width, height });
  }

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      <MapView ref={mapRef} style={StyleSheet.absoluteFill} initialRegion={start} onRegionChangeComplete={setRegion}>
        {items.map((it) =>
          it.kind === "cluster" ? (
            <Marker
              key={it.key}
              coordinate={{ latitude: it.lat, longitude: it.lon }}
              onPress={() => mapRef.current?.animateToRegion(regionForCluster(it.members, region), 350)}
              accessibilityLabel={`${it.count} fields, tap to zoom in`}
              tracksViewChanges={false}
            >
              <View style={[styles.cluster, { width: clusterSize(it.count), height: clusterSize(it.count), borderRadius: clusterSize(it.count) / 2 }]}>
                <Text style={styles.clusterText} allowFontScaling={false}>
                  {it.count}
                </Text>
              </View>
            </Marker>
          ) : (
            <Marker
              key={it.key}
              coordinate={{ latitude: it.lat, longitude: it.lon }}
              onPress={() => onOpen(it.listing.venue.venue_key)}
              accessibilityLabel={it.listing.venue.name}
              tracksViewChanges={false}
            >
              <View style={[styles.pin, it.listing.venue.price_status === "free" && styles.pinFree]}>
                <Text style={[styles.pinText, it.listing.venue.price_status === "free" && styles.pinTextFree]} allowFontScaling={false}>
                  {pinLabel(it.listing.venue)}
                </Text>
              </View>
            </Marker>
          ),
        )}
      </MapView>
    </View>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    wrap: { height: 240, borderRadius: radius.card, overflow: "hidden", borderWidth: 1, borderColor: c.line },
    pin: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: c.inkSurface },
    pinFree: { backgroundColor: c.pitch },
    pinText: { fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700", color: c.onInk },
    pinTextFree: { color: c.onPitch },
    cluster: { alignItems: "center", justifyContent: "center", backgroundColor: c.pitch, borderWidth: 3, borderColor: c.inkSurface },
    clusterText: { fontSize: 15, fontFamily: "Inter_700Bold", fontWeight: "700", color: c.onPitch },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
