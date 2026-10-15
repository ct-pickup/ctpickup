import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Tag } from "@/components/fields/FieldBits";
import { fieldCountLabel, isTurf, permitChip, priceLabel, settingTag } from "@/lib/fields/presentation";
import type { FieldListing } from "@/lib/fields/types";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";

export function FieldCard({ item, onPress }: { item: FieldListing; onPress: () => void }) {
  useThemedStyles(publish_styles);
  const v = item.venue;
  const meta = [item.kind_label, fieldCountLabel(v), item.distance_mi != null ? `${item.distance_mi.toFixed(1)} mi` : null]
    .filter(Boolean)
    .join(" · ");
  const permit = permitChip(v);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${v.name}, ${priceLabel(v)}`}
    >
      <View style={styles.icon}>
        <FontAwesome name="futbol-o" size={20} color={themeColor().pitchText} />
      </View>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {v.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {meta}
        </Text>
        <View style={styles.tags}>
          <Tag label={priceLabel(v)} tone={v.price_status === "free" ? "good" : "neutral"} />
          {v.source === "player" ? <Tag label="Player-reported" /> : null}
          {settingTag(v) ? <Tag label={settingTag(v)!} /> : null}
          {isTurf(v) ? <Tag label="Turf" /> : null}
          {permit ? <Tag label={permit.label} tone={permit.tone} /> : null}
        </View>
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
    body: { flex: 1, gap: 4 },
    name: { fontSize: 16, ...headline, color: c.text },
    meta: { fontSize: 13, fontFamily: "Inter_400Regular", color: c.muted },
    tags: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
