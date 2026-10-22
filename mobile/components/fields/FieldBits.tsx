import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { confirmationLabel as verifiedLabel, type Confirmation } from "@/lib/fields/presentation";
import { confirmationLabel } from "@shared/fields/suggestions";
import { radius, themeColor, useThemedStyles } from "@/theme";

type Tone = "good" | "warn" | "neutral";

/** Small rounded label used on field cards and the detail screen. */
export function Tag({ label, tone = "neutral" }: { label: string; tone?: Tone }) {
  useThemedStyles(publish_styles);
  return (
    <View style={[styles.tag, tone === "good" && styles.tagGood, tone === "warn" && styles.tagWarn]}>
      <Text style={[styles.tagText, tone === "good" && styles.tagTextGood]}>{label}</Text>
    </View>
  );
}

/** "Verified" or "We're confirming". Never shows anything stronger than what the data supports. */
export function ConfirmationBadge({ value }: { value: Confirmation }) {
  useThemedStyles(publish_styles);
  const verified = value === "verified";
  return (
    <View style={[styles.badge, verified ? styles.badgeVerified : styles.badgeConfirming]}>
      <FontAwesome name={verified ? "check-circle" : "clock-o"} size={12} color={verified ? themeColor().pitchText : themeColor().muted} />
      <Text style={[styles.badgeText, verified ? styles.badgeTextVerified : styles.badgeTextConfirming]}>{verifiedLabel(value)}</Text>
    </View>
  );
}

/** "Player-reported" for a field a player added, and "Confirmed by N players" once players have said it looks right. */
const OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright";

/** Small footer credit for screens that show map data. Tapping opens the OpenStreetMap copyright page. */
export function OsmCredit() {
  useThemedStyles(publish_styles);
  return (
    <Pressable onPress={() => void Linking.openURL(OSM_COPYRIGHT_URL)} accessibilityRole="link" accessibilityLabel="Map data © OpenStreetMap contributors. Opens the OpenStreetMap copyright page." hitSlop={8} style={styles.credit}>
      <Text style={styles.creditText}>Map data © OpenStreetMap contributors</Text>
    </Pressable>
  );
}

/** Shown wherever a player is about to rely on a price, hours or access. */
export function VenueNotice() {
  useThemedStyles(publish_styles);
  return <Text style={styles.notice}>Fees, hours and access change. Confirm with the venue before you go.</Text>;
}

export function SourceBadges({ playerReported, confirmations }: { playerReported: boolean; confirmations: number }) {
  useThemedStyles(publish_styles);
  const label = confirmationLabel(confirmations);
  if (!playerReported && !label) return null;
  return (
    <View style={styles.badgeRow}>
      {playerReported ? (
        <View style={[styles.badge, styles.badgeConfirming]}>
          <FontAwesome name="user" size={12} color={themeColor().muted} />
          <Text style={[styles.badgeText, styles.badgeTextConfirming]}>Player-reported</Text>
        </View>
      ) : null}
      {label ? (
        <View style={[styles.badge, styles.badgeVerified]}>
          <FontAwesome name="check" size={12} color={themeColor().pitchText} />
          <Text style={[styles.badgeText, styles.badgeTextVerified]}>{label}</Text>
        </View>
      ) : null}
    </View>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: c.overlaySubtle },
    tagGood: { backgroundColor: c.pitchPanel },
    tagWarn: { backgroundColor: c.overlaySubtle, borderWidth: 1, borderColor: c.line },
    tagText: { fontSize: 12, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: c.text },
    tagTextGood: { color: c.onPitchPanel },
    credit: { alignSelf: "center", paddingVertical: 4 },
    creditText: { fontSize: 12, fontFamily: "Inter_400Regular", color: c.muted, textDecorationLine: "underline" },
    notice: { fontSize: 13, fontFamily: "Inter_400Regular", color: c.muted, lineHeight: 18 },
    badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
    badge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
    badgeVerified: { backgroundColor: c.pitchPanel },
    badgeConfirming: { backgroundColor: c.overlaySubtle },
    badgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    badgeTextVerified: { color: c.onPitchPanel },
    badgeTextConfirming: { color: c.muted },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
