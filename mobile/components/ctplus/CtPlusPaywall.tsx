import FontAwesome from "@expo/vector-icons/FontAwesome";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { PlayerCardData } from "@/components/profile/PlayerCard";
import PremiumShareCard from "@/components/profile/PremiumShareCard";
import { useCtPlus } from "@/context/CtPlusContext";
import type { CardDesignId } from "@/lib/cardDesigns";
import { CTPLUS_PERIOD_LABEL } from "@/lib/ctplus/config";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";

const PERKS = ["3 premium card designs: Dark, Gold and Club", "Story and square sizes for every design", "Your action photo on the card"];

/** CT+ paywall: one annual plan, with a preview of the player's own card in the design they tapped. */
export default function CtPlusPaywall({
  design,
  data,
  visible,
  lead,
  onClose,
  onPurchased,
}: {
  /** The locked design to preview; with no preview, pass `visible` to open the paywall anyway. */
  design: Exclude<CardDesignId, "classic"> | null;
  data: PlayerCardData | null;
  /** Overrides the default "open when a design is set". */
  visible?: boolean;
  /** Headline when the paywall is opened from somewhere other than the card picker. */
  lead?: string;
  onClose: () => void;
  onPurchased: () => void;
}) {
  useThemedStyles(publish_styles);
  const insets = useSafeAreaInsets();
  const { priceLabel, busy, canPurchase, purchase, restorePurchases } = useCtPlus();

  async function subscribe() {
    const outcome = await purchase();
    if (outcome === "purchased") onPurchased();
    else if (outcome === "failed") Alert.alert("Couldn't complete the purchase", "Please try again.");
    else if (outcome === "unavailable") Alert.alert("Not available yet", "Purchases aren't available in this build.");
  }

  async function restore() {
    const ok = await restorePurchases();
    if (ok) onPurchased();
    else Alert.alert("Nothing to restore", "We couldn't find an active CT+ subscription on this Apple ID.");
  }

  return (
    <Modal visible={visible ?? design != null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.title}>CT+</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
            <FontAwesome name="times" size={18} color={themeColor().muted} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={[styles.body, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}>
          {design && data ? (
            <View style={styles.preview}>
              <PremiumShareCard design={design} size="story" data={data} width={190} />
            </View>
          ) : null}
          <Text style={styles.lead}>{lead ?? "Share your card your way."}</Text>
          <View style={styles.perks}>
            {PERKS.map((p) => (
              <View key={p} style={styles.perkRow}>
                <FontAwesome name="check" size={14} color={themeColor().pitchText} />
                <Text style={styles.perk}>{p}</Text>
              </View>
            ))}
          </View>

          <Pressable
            onPress={() => void subscribe()}
            disabled={busy}
            style={({ pressed }) => [styles.cta, (pressed || busy) && styles.dim]}
            accessibilityRole="button"
          >
            {busy ? (
              <ActivityIndicator color={themeColor().onPitch} />
            ) : (
              <Text style={styles.ctaText}>
                Subscribe · {priceLabel} / {CTPLUS_PERIOD_LABEL}
              </Text>
            )}
          </Pressable>
          {!canPurchase ? <Text style={styles.note}>Purchases aren&apos;t available in this build.</Text> : null}
          <Pressable onPress={() => void restore()} disabled={busy} hitSlop={8} style={styles.restore} accessibilityRole="button">
            <Text style={styles.restoreText}>Restore purchases</Text>
          </Pressable>
          <Text style={styles.fine}>
            {priceLabel} per {CTPLUS_PERIOD_LABEL}, billed to your Apple ID. Renews automatically unless canceled at least 24 hours before the
            period ends. Manage or cancel in your App Store account settings. Your free card is always free.
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 20, paddingTop: 24 },
    title: { color: c.text, fontSize: 24, ...headline },
    body: { paddingHorizontal: 24, alignItems: "center", gap: 16 },
    preview: { borderRadius: radius.card, overflow: "hidden", borderWidth: 1, borderColor: c.line },
    lead: { color: c.text, fontSize: 22, ...headline, textAlign: "center" },
    perks: { alignSelf: "stretch", gap: 10 },
    perkRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    perk: { flex: 1, color: c.text, fontSize: 15, fontFamily: "Inter_500Medium" },
    cta: { alignSelf: "stretch", backgroundColor: c.pitch, borderRadius: radius.button, paddingVertical: 16, alignItems: "center" },
    ctaText: { color: c.onPitch, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
    dim: { opacity: 0.6 },
    note: { color: c.muted, fontSize: 13, fontFamily: "Inter_400Regular" },
    restore: { paddingVertical: 4 },
    restoreText: { color: c.accent, fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    fine: { color: c.muted, fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16, textAlign: "center" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
