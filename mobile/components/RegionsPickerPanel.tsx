import { SERVICE_REGIONS, type ServiceRegionCode } from "@/lib/serviceRegions";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

const LIME = "#a3e635";
const BG = "#0a0a0a";

type Props = {
  /** Called after the row’s region is chosen (caller may also persist hub region). */
  onSelectState: (code: ServiceRegionCode) => void;
};

export function RegionsPickerPanel({ onSelectState }: Props) {
  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <Text style={styles.kicker}>SERVICE AREA</Text>
      <Text style={styles.headline}>
        Where we <Text style={styles.headlineAccent}>run</Text>
      </Text>
      <Text style={styles.lead}>
        CT Pickup operates across four states. Choose yours for local context. Per-state schedules grow as hubs come online.
      </Text>

      <View style={styles.grid}>
        {SERVICE_REGIONS.map((r, i) => (
          <Pressable
            key={r.code}
            accessibilityRole="button"
            accessibilityLabel={`${r.name} pickups`}
            onPress={() => onSelectState(r.code)}
            style={({ pressed }) => [
              styles.card,
              pressed && { opacity: 0.88, transform: [{ scale: 0.985 }] },
              i > 0 && styles.cardGap,
            ]}
          >
            <View style={styles.cardAccent} />
            <View style={styles.cardInner}>
              <View style={styles.codeBadge}>
                <Text style={styles.codeText}>{r.code}</Text>
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.stateName}>{r.name}</Text>
                <Text style={styles.stateHint}>Runs & RSVPs</Text>
              </View>
              <FontAwesome name="chevron-right" size={14} color="rgba(255,255,255,0.35)" />
            </View>
          </Pressable>
        ))}
      </View>

      <Text style={styles.footerNote}>Featured runs and your RSVP status live on the Runs tab—signed in with your account.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 20, paddingBottom: 40, paddingTop: 8, backgroundColor: BG },
  kicker: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
    color: "rgba(163,230,53,0.65)",
    marginBottom: 8,
  },
  headline: { fontSize: 30, fontWeight: "800", color: "#fff", letterSpacing: -0.6 },
  headlineAccent: { color: LIME },
  lead: {
    marginTop: 12,
    fontSize: 16,
    lineHeight: 24,
    color: "rgba(255,255,255,0.58)",
  },
  grid: { marginTop: 28 },
  cardGap: { marginTop: 12 },
  card: {
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.035)",
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 2,
  },
  cardAccent: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: LIME,
    borderTopLeftRadius: 18,
    borderBottomLeftRadius: 18,
  },
  cardInner: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingLeft: 22,
    paddingRight: 16,
  },
  codeBadge: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: "rgba(163,230,53,0.12)",
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  codeText: { fontSize: 17, fontWeight: "900", color: LIME, letterSpacing: 0.5 },
  cardBody: { flex: 1, marginLeft: 16 },
  stateName: { fontSize: 18, fontWeight: "700", color: "#fff" },
  stateHint: { marginTop: 4, fontSize: 13, color: "rgba(255,255,255,0.45)" },
  footerNote: {
    marginTop: 28,
    fontSize: 13,
    lineHeight: 20,
    color: "rgba(255,255,255,0.38)",
  },
});
