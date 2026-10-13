import FontAwesome from "@expo/vector-icons/FontAwesome";
import { StyleSheet, Text, View } from "react-native";

import { confirmationLabel, type Confirmation } from "@/lib/fields/presentation";
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
      <Text style={[styles.badgeText, verified ? styles.badgeTextVerified : styles.badgeTextConfirming]}>{confirmationLabel(value)}</Text>
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
