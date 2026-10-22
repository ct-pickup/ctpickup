import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/context/AuthContext";
import { directionsUrl } from "@/lib/fields/directions";
import { loadFieldListing } from "@/lib/fields/venueStore";
import { radius, themeColor, useThemedStyles } from "@/theme";

/**
 * On a game page: when the game was created at a field, the field's name (tapping opens the field page) and Get directions.
 * Renders nothing for games without a field link, or if the link column is not there yet. Never blocks the game page.
 */
export function LinkedField({ runId }: { runId: string }) {
  useThemedStyles(publish_styles);
  const router = useRouter();
  const { supabase } = useAuth();
  const [field, setField] = useState<{ key: string; name: string; lat: number | null; lon: number | null } | null>(null);

  useEffect(() => {
    if (!supabase || !runId) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.from("pickup_runs").select("venue_key").eq("id", runId).maybeSingle();
      const key = !error ? (data as { venue_key?: string | null } | null)?.venue_key : null;
      if (!key) return;
      const listing = await loadFieldListing(supabase, key);
      if (!cancelled && listing) setField({ key, name: listing.venue.name, lat: listing.venue.lat, lon: listing.venue.lon });
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, runId]);

  if (!field) return null;
  const url = directionsUrl(Platform.OS, field.lat, field.lon, field.name);
  return (
    <View style={styles.row}>
      <Pressable onPress={() => router.push({ pathname: "/field/[id]", params: { id: field.key } })} accessibilityRole="link" accessibilityLabel={`Open the field page for ${field.name}`} hitSlop={8}>
        <Text style={styles.link}>{field.name} ›</Text>
      </Pressable>
      {url ? (
        <Pressable
          onPress={() => void Linking.openURL(url).catch(() => Alert.alert("Couldn\u2019t open maps", "Open your maps app and search for the address instead."))}
          style={styles.directions}
          accessibilityRole="link"
          accessibilityLabel={`Get directions to ${field.name}`}
        >
          <Text style={styles.directionsText}>Get directions</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 6 },
    link: { fontSize: 15, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: c.pitchText },
    directions: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: c.line, backgroundColor: c.card },
    directionsText: { fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: c.text },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
