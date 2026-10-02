import StateShape from "@/components/StateShape";
import { AnimatedPressScale } from "@/components/AnimatedPressScale";
import { SERVICE_REGIONS, type ServiceRegionCode } from "@/lib/serviceRegions";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { themeColor, useThemedStyles } from "@/theme";
type Props = {
  /** Called after the row’s region is chosen (caller may also persist hub region). */
  onSelectState: (code: ServiceRegionCode) => void;
  /** Controls copy: pickup hub vs tournaments hub. Defaults to pickup. */
  variant?: "pickup" | "tournament";
};

export function RegionsPickerPanel({ onSelectState, variant = "pickup" }: Props) {
  useThemedStyles(publish_styles);

  const leadText =
    variant === "tournament"
      ? "We run tournaments in four states. Select your state to see what's coming up and register your team."
      : "We run pickup in four states. Select your state to see what's coming up and RSVP.";

  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <Text style={styles.kicker}>SERVICE AREA</Text>
      <Text style={styles.headline}>
        Where we <Text style={styles.headlineAccent}>run</Text>
      </Text>
      <Text style={styles.lead}>{leadText}</Text>

      <View style={styles.grid}>
        {SERVICE_REGIONS.map((r, i) => {
          return (
            <View key={r.code} style={i > 0 ? styles.cardGap : undefined}>
              <AnimatedPressScale
                accessibilityRole="button"
                accessibilityLabel={`${r.name} pickups`}
                hapticOnPress
                pressedScale={0.985}
                onPress={() => onSelectState(r.code)}
                style={styles.card}
              >
                <View style={styles.cardAccent} />
                <View style={styles.cardInner}>
                  <View style={styles.codeBadge}>
                    <StateShape state={r.code as "CT" | "NY" | "NJ" | "MD"} size={40} active />
                  </View>
                  <View style={styles.cardBody}>
                    <Text style={styles.stateName}>{r.name}</Text>
                    <Text style={styles.stateHint}>Runs & RSVPs</Text>
                  </View>
                  <FontAwesome name="chevron-right" size={14} color={themeColor().muted} />
                </View>
              </AnimatedPressScale>
            </View>
          );
        })}
      </View>

    </ScrollView>
  );
}

function make_styles() {
  return StyleSheet.create({
  scroll: { paddingHorizontal: 20, paddingBottom: 40, paddingTop: 8, backgroundColor: themeColor().bg },
  kicker: {
    fontSize: 13, fontFamily: "Inter_700Bold",
    fontWeight: "800",
    color: themeColor().pitchText,
    marginBottom: 8,
  },
  headline: { fontSize: 32, fontFamily: "InstrumentSerif_400Regular", fontWeight: "800", color: themeColor().text,},
  headlineAccent: { color: themeColor().pitchText },
  lead: {
    marginTop: 12,
    fontSize: 16, fontFamily: "Inter_400Regular",
    lineHeight: 24,
    color: themeColor().muted,
  },
  grid: { marginTop: 28 },
  cardGap: { marginTop: 12 },
  card: {
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().overlaySubtle,
  },
  cardAccent: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: themeColor().pitch,
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
    borderRadius: 12,
    backgroundColor: themeColor().pitchSoft,
    borderWidth: 1,
    borderColor: themeColor().pitch,
    alignItems: "center",
    justifyContent: "center",
  },
  codeText: { fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "900", color: themeColor().pitchText,},
  cardBody: { flex: 1, marginLeft: 16 },
  stateName: { fontSize: 20, fontFamily: "InstrumentSerif_400Regular", fontWeight: "700", color: themeColor().text },
  stateHint: { marginTop: 4, fontSize: 13, fontFamily: "Inter_400Regular", color: themeColor().muted },
  footerNote: {
    marginTop: 28,
    fontSize: 13, fontFamily: "Inter_400Regular",
    lineHeight: 20,
    color: themeColor().muted,
  },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}

