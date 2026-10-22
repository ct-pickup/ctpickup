import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { detailLine, townLine } from "@/lib/fields/presentation";
import type { FieldListing } from "@/lib/fields/types";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";

export function FieldCard({ item, onPress }: { item: FieldListing; onPress: () => void }) {
  useThemedStyles(publish_styles);
  const v = item.venue;
  const town = [townLine(v), item.distance_mi != null ? `${item.distance_mi.toFixed(1)} mi` : null].filter(Boolean).join(" · ");
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${v.name}, ${town}. ${detailLine(v)}`}
    >
      <View style={styles.icon}>
        <FontAwesome name="futbol-o" size={20} color={themeColor().pitchText} />
      </View>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {v.name}
        </Text>
        {town ? (
          <Text style={styles.meta} numberOfLines={1}>
            {town}
          </Text>
        ) : null}
        <Text style={[styles.detail, v.price_status === "free" && styles.detailFree]} numberOfLines={1}>
          {detailLine(v)}
        </Text>
      </View>
    </Pressable>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    card: {
      flexDirection: "row",
      gap: 12,
      padding: 12,
      backgroundColor: c.card,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: c.line,
    },
    pressed: { opacity: 0.88 },
    icon: { width: 44, height: 44, borderRadius: 10, backgroundColor: c.pitchPanel, alignItems: "center", justifyContent: "center" },
    body: { flex: 1, gap: 2 },
    name: { fontSize: 16, ...headline, color: c.text },
    meta: { fontSize: 13, fontFamily: "Inter_400Regular", color: c.muted },
    detail: { fontSize: 13, fontFamily: "Inter_500Medium", color: c.text },
    detailFree: { color: c.pitchText },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
