import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Keyboard, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import MapView, { type Region } from "react-native-maps";

import { useAuth } from "@/context/AuthContext";
import { reverseLine, searchGeocoder, searchVenues } from "@/lib/fields/placeSearchApi";
import { quietUserLocation, requestUserLocation } from "@/lib/fields/venueStore";
import { FIELD_DELTA, fieldRegion, mapKindFor, mergeHits, MIN_QUERY, WIDE_VIEW_DELTA, type MapKind, type PlaceHit } from "@shared/fields/placeSearch";
import { radius, themeColor, useThemedStyles } from "@/theme";

type Props = {
  /** Where the screen was opened from. The map always opens zoomed in to field size around it. */
  start: Region;
  /** Called each time the map settles, with the point under the pin. */
  onCenter: (lat: number, lon: number) => void;
};

/**
 * The map step of Suggest a field: a search box (our own venues and schools, then the phone's geocoder), a pin fixed at the
 * centre, a Use my location button, a Satellite / Map toggle and the nearest street or town for the spot under the pin.
 */
export function PinPicker({ start, onCenter }: Props) {
  useThemedStyles(publish_styles);
  const { supabase } = useAuth();
  const mapRef = useRef<MapView>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [chosen, setChosen] = useState<MapKind | null>(null);
  const [delta, setDelta] = useState(FIELD_DELTA);
  const [spot, setSpot] = useState({ lat: start.latitude, lon: start.longitude });
  const [line, setLine] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // A screen opened from a wide map (a county view) centres on the player instead, when their location is already allowed.
  useEffect(() => {
    if (start.latitudeDelta <= WIDE_VIEW_DELTA) return;
    let cancelled = false;
    void quietUserLocation().then((u) => {
      if (u && !cancelled) mapRef.current?.animateToRegion(fieldRegion(u.lat, u.lon), 400);
    });
    return () => {
      cancelled = true;
    };
  }, [start.latitudeDelta]);

  // Search as the player types (after a short pause).
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY) return;
    let cancelled = false;
    const t = setTimeout(() => {
      setSearching(true);
      void Promise.all([supabase ? searchVenues(supabase, q) : Promise.resolve([]), searchGeocoder(q)]).then(([venues, places]) => {
        if (cancelled) return;
        setHits(mergeHits(venues, places));
        setSearching(false);
      });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, supabase]);

  // Name the spot under the pin once the map stops moving.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      void reverseLine(spot.lat, spot.lon).then((l) => {
        if (!cancelled) setLine(l);
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [spot]);

  function pick(h: PlaceHit) {
    Keyboard.dismiss();
    setHits([]);
    setQuery(h.label);
    setMessage(null);
    mapRef.current?.animateToRegion(fieldRegion(h.lat, h.lon), 500);
  }

  async function locate() {
    setMessage(null);
    const u = await requestUserLocation();
    if (!u) {
      setMessage("We couldn’t get your location. Allow it in Settings, or search for the place instead.");
      return;
    }
    mapRef.current?.animateToRegion(fieldRegion(u.lat, u.lon), 500);
  }

  const kind = mapKindFor(delta, chosen);
  const showList = query.trim().length >= MIN_QUERY && hits.length > 0;

  return (
    <View style={styles.box}>
      <View style={styles.search}>
        <FontAwesome name="search" size={14} color={themeColor().muted} />
        <TextInput
          value={query}
          onChangeText={(t) => {
            setQuery(t);
            if (t.trim().length < MIN_QUERY) setHits([]);
          }}
          placeholder="Search an address, school or town"
          placeholderTextColor={themeColor().muted}
          style={styles.searchInput}
          returnKeyType="search"
          autoCorrect={false}
          accessibilityLabel="Search an address, school or town"
        />
        {searching ? <ActivityIndicator size="small" color={themeColor().muted} /> : null}
      </View>
      {showList ? (
        <View style={styles.hits}>
          {hits.map((h, i) => (
            <Pressable key={h.key} onPress={() => pick(h)} style={[styles.hit, i > 0 && styles.hitDivider]} accessibilityRole="button" accessibilityLabel={h.label}>
              <Text style={styles.hitLabel} numberOfLines={1}>
                {h.label}
              </Text>
              {h.sub || h.source === "venue" ? (
                <Text style={styles.hitSub} numberOfLines={1}>
                  {[h.source === "venue" ? "Field in our list" : null, h.sub].filter(Boolean).join(" · ")}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.mapWrap}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          initialRegion={fieldRegion(start.latitude, start.longitude)}
          mapType={kind}
          onRegionChangeComplete={(r) => {
            setDelta(r.latitudeDelta);
            setSpot({ lat: r.latitude, lon: r.longitude });
            onCenter(r.latitude, r.longitude);
          }}
        />
        <View pointerEvents="none" style={styles.pinWrap}>
          <View style={styles.pinHead} />
          <View style={styles.pinTip} />
        </View>
        <View style={styles.toggle} accessibilityRole="tablist">
          {(["hybrid", "standard"] as const).map((k) => (
            <Pressable key={k} onPress={() => setChosen(k)} style={[styles.toggleBtn, kind === k && styles.toggleOn]} accessibilityRole="tab" accessibilityState={{ selected: kind === k }}>
              <Text style={[styles.toggleText, kind === k && styles.toggleTextOn]}>{k === "hybrid" ? "Satellite" : "Map"}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable onPress={() => void locate()} style={styles.locate} accessibilityRole="button" accessibilityLabel="Use my location">
          <FontAwesome name="location-arrow" size={13} color={themeColor().pitchText} />
          <Text style={styles.locateText}>Use my location</Text>
        </Pressable>
      </View>

      <Text style={styles.address} numberOfLines={2} accessibilityLiveRegion="polite">
        {line ? `Near ${line}` : "Move the map so the pin sits on the field."}
      </Text>
      {message ? (
        <Pressable onPress={() => void Linking.openSettings()} accessibilityRole="button">
          <Text style={styles.message}>{message} Open Settings</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    box: { gap: 10 },
    search: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, height: 46, backgroundColor: c.card, borderRadius: radius.card, borderWidth: 1, borderColor: c.line },
    searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", color: c.text, paddingVertical: 0 },
    hits: { backgroundColor: c.card, borderRadius: radius.card, borderWidth: 1, borderColor: c.line, overflow: "hidden" },
    hit: { paddingHorizontal: 14, paddingVertical: 11, gap: 2 },
    hitDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
    hitLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: c.text },
    hitSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: c.muted },
    mapWrap: { height: 380, borderRadius: radius.card, overflow: "hidden", borderWidth: 1, borderColor: c.line },
    pinWrap: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
    pinHead: { width: 26, height: 26, borderRadius: 13, backgroundColor: c.pitch, borderWidth: 4, borderColor: c.inkSurface, marginBottom: 14 },
    pinTip: { position: "absolute", width: 4, height: 18, backgroundColor: c.inkSurface },
    toggle: { position: "absolute", top: 10, right: 10, flexDirection: "row", backgroundColor: c.card, borderRadius: radius.pill, borderWidth: 1, borderColor: c.line, padding: 3 },
    toggleBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill },
    toggleOn: { backgroundColor: c.pitch },
    toggleText: { fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: c.text },
    toggleTextOn: { color: c.onPitch },
    locate: { position: "absolute", left: 10, bottom: 10, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, height: 40, borderRadius: radius.pill, backgroundColor: c.card, borderWidth: 1, borderColor: c.line },
    locateText: { fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: c.pitchText },
    address: { fontSize: 14, fontFamily: "Inter_500Medium", color: c.text, textAlign: "center" },
    message: { fontSize: 13, fontFamily: "Inter_500Medium", color: c.coralText, textAlign: "center" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
