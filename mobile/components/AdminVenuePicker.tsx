import { ADMIN_CT_PICKUP_VENUES } from "@/lib/adminCtPickupVenues";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

const LIME = "#a3e635";

type Props = {
  label?: string;
  value: string;
  onChange: (venueName: string) => void;
  hint?: string;
};

export default function AdminVenuePicker({ label = "Venue", value, onChange, hint }: Props) {
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
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { marginTop: 12, fontSize: 12, fontWeight: "700", color: "rgba(255,255,255,0.55)" },
  hint: { marginTop: 6, fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 18 },
  selectedRow: {
    marginTop: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
    backgroundColor: "rgba(163,230,53,0.08)",
  },
  selectedText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  placeholder: { marginTop: 8, fontSize: 14, color: "rgba(255,255,255,0.4)" },
  scroll: { marginTop: 10 },
  scrollContent: { flexDirection: "row", alignItems: "stretch", gap: 8, paddingRight: 8 },
  chip: {
    maxWidth: 168,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  chipActive: {
    borderColor: "rgba(163,230,53,0.45)",
    backgroundColor: "rgba(163,230,53,0.12)",
  },
  chipText: { fontSize: 13, fontWeight: "700", color: "rgba(255,255,255,0.65)" },
  chipTextActive: { color: LIME },
});
