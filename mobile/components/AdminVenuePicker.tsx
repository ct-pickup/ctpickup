import { ADMIN_CT_PICKUP_VENUES, CUSTOM_VENUE_OPTION } from "@/lib/adminCtPickupVenues";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { themeColor, useThemedStyles } from "@/theme";
type Props = {
  label?: string;
  value: string;
  onChange: (venueName: string) => void;
  hint?: string;
};

export default function AdminVenuePicker({ label = "Venue", value, onChange, hint }: Props) {
  useThemedStyles(publish_styles);

  const selected = value.trim();

  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {selected ? (
        <View style={styles.selectedRow}>
          <Text style={styles.selectedText} numberOfLines={2}>
            {selected}
          </Text>
        </View>
      ) : (
        <Text style={styles.placeholder}>Tap a venue below</Text>
      )}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        nestedScrollEnabled
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {ADMIN_CT_PICKUP_VENUES.map((v) => {
          const active = selected === v.name;
          return (
            <Pressable
              key={v.name}
              onPress={() => onChange(v.name)}
              style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && { opacity: 0.9 }]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={2}>
                {v.name}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          key={CUSTOM_VENUE_OPTION}
          onPress={() => onChange(CUSTOM_VENUE_OPTION)}
          style={({ pressed }) => [
            styles.chip,
            selected === CUSTOM_VENUE_OPTION && styles.chipActive,
            pressed && { opacity: 0.9 },
          ]}
        >
          <Text
            style={[styles.chipText, selected === CUSTOM_VENUE_OPTION && styles.chipTextActive]}
            numberOfLines={2}
          >
            {CUSTOM_VENUE_OPTION}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function make_styles() {
  return StyleSheet.create({
  label: { marginTop: 12, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700", color: themeColor().muted },
  hint: { marginTop: 4, fontSize: 13, fontFamily: "Inter_400Regular", color: themeColor().muted, lineHeight: 18 },
  selectedRow: {
    marginTop: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().pitchText,
    backgroundColor: themeColor().pitchPanel,
  },
  selectedText: { color: themeColor().text, fontWeight: "800", fontSize: 16, fontFamily: "Inter_700Bold" },
  placeholder: { marginTop: 8, fontSize: 14, fontFamily: "Inter_400Regular", color: themeColor().muted },
  scroll: { marginTop: 8 },
  scrollContent: { flexDirection: "row", alignItems: "stretch", gap: 8, paddingRight: 8 },
  chip: {
    maxWidth: 168,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().overlaySubtle,
  },
  chipActive: {
    borderColor: themeColor().pitchText,
    backgroundColor: themeColor().pitchPanel,
  },
  chipText: { fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700", color: themeColor().muted },
  chipTextActive: { color: themeColor().pitchText },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}

