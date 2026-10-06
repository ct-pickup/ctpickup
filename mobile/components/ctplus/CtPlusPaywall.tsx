import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useState } from "react";
import { ActivityIndicator, Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { PlayerCardData } from "@/components/profile/PlayerCard";
import PremiumShareCard from "@/components/profile/PremiumShareCard";
import { useCtPlus } from "@/context/CtPlusContext";
import type { CardDesignId } from "@/lib/cardDesigns";
import { annualSaving, FALLBACK_PRICE, PLAN_IDS, PLAN_META, renewLine, type PlanId } from "@/lib/ctplus/plans";
import { siteOrigin } from "@/lib/env";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";

/** Every CT+ perk, and only real ones, directory first. The same list shows wherever the paywall is opened from. */
export const CTPLUS_PERKS = [
  "Full game log with details: teammates, awards, points and rating direction",
  "Record with each teammate you have played with 3+ times",
  "Win streaks and your rating trend across the year",
  "Player directory with filters (position, level, distance)",
  "Premium share card designs (Dark, Gold, Club)",
  "Story and square sizes",
  "Your action photo on the card",
];
const SUBLINE = "One subscription unlocks everything below.";

/** CT+ paywall: one headline and one perks list wherever it is opened from, with monthly and yearly plans. */
export default function CtPlusPaywall({
  design,
  data,
  visible,
  onClose,
  onPurchased,
}: {
  /** The locked design to preview; with no preview, pass `visible` to open the paywall anyway. */
  design: Exclude<CardDesignId, "classic"> | null;
  data: PlayerCardData | null;
  /** Overrides the default "open when a design is set". */
  visible?: boolean;
  /** @deprecated Ignored. The paywall has one fixed headline wherever it is opened from. */
  lead?: string;
  onClose: () => void;
  onPurchased: () => void;
}) {
  useThemedStyles(publish_styles);
  const insets = useSafeAreaInsets();
  const { plans, offering, reloadOffering, busy, canPurchase, purchase, restorePurchases } = useCtPlus();
  const [selected, setSelected] = useState<PlanId>("annual");
  const priceOf = (id: PlanId) => plans[id]?.priceString ?? FALLBACK_PRICE[id];
  const saving = annualSaving(plans.monthly?.price, plans.annual?.price, plans.annual?.currencyCode);
  const plan = plans[selected];
  const price = priceOf(selected);

  async function subscribe() {
    const outcome = await purchase(selected);
    if (outcome === "purchased") onPurchased();
    else if (outcome === "failed") Alert.alert("Couldn't complete the purchase", "Please try again.");
    else if (outcome === "unavailable") Alert.alert("Not available yet", "Purchases aren't available in this build.");
  }

  /** Terms and Privacy are the site pages (/terms, /privacy), opened in the browser so they show over this sheet. */
  function openLegal(path: "/terms" | "/privacy") {
    const origin = siteOrigin();
    if (origin) void Linking.openURL(`${origin}${path}`);
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
          <Text style={styles.lead}>{SUBLINE}</Text>
          <View style={styles.perks}>
            {CTPLUS_PERKS.map((p) => (
              <View key={p} style={styles.perkRow}>
                <FontAwesome name="check" size={14} color={themeColor().pitchText} />
                <Text style={styles.perk}>{p}</Text>
              </View>
            ))}
          </View>

          {offering === "loading" ? (
            <ActivityIndicator color={themeColor().muted} />
          ) : offering === "unavailable" ? (
            <View style={styles.unavailable}>
              <Text style={styles.note}>Plans aren&apos;t available right now. Check your connection and try again.</Text>
              <Pressable onPress={() => void reloadOffering()} hitSlop={8} style={styles.retry} accessibilityRole="button">
                <Text style={styles.restoreText}>Try again</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.plans}>
                {PLAN_IDS.filter((id) => plans[id]).map((id) => {
                  const on = selected === id;
                  return (
                    <Pressable
                      key={id}
                      onPress={() => setSelected(id)}
                      style={[styles.planCard, on && styles.planCardOn]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`${PLAN_META[id].label}, ${priceOf(id)} per ${PLAN_META[id].period}`}
                    >
                      {id === "annual" ? (
                        <View style={styles.badge}>
                          <Text style={styles.badgeText}>Best value</Text>
                        </View>
                      ) : null}
                      <Text style={styles.planName}>{PLAN_META[id].label}</Text>
                      <Text style={styles.planPrice}>{priceOf(id)}</Text>
                      <Text style={styles.planPeriod}>per {PLAN_META[id].period}</Text>
                      {id === "annual" && saving ? <Text style={styles.planSave}>Save {saving.percent}% vs monthly</Text> : null}
                    </Pressable>
                  );
                })}
              </View>
              <Pressable
                onPress={() => void subscribe()}
                disabled={busy || !plan}
                style={({ pressed }) => [styles.cta, (pressed || busy) && styles.dim]}
                accessibilityRole="button"
              >
                {busy ? (
                  <ActivityIndicator color={themeColor().onPitch} />
                ) : (
                  <Text style={styles.ctaText}>
                    Subscribe · {price} / {PLAN_META[selected].period}
                  </Text>
                )}
              </Pressable>
              <Text style={styles.renew}>{renewLine(selected, price)}</Text>
            </>
          )}
          {!canPurchase ? <Text style={styles.note}>Purchases aren&apos;t available in this build.</Text> : null}
          <Pressable onPress={() => void restore()} disabled={busy} hitSlop={8} style={styles.restore} accessibilityRole="button">
            <Text style={styles.restoreText}>Restore purchases</Text>
          </Pressable>
          <Text style={styles.fine}>
            {price} per {PLAN_META[selected].period}, billed to your Apple ID. Renews automatically unless canceled at least 24 hours before the
            period ends. Manage or cancel in your App Store account settings. Your free card is always free.
          </Text>
          <View style={styles.legalRow}>
            <Pressable onPress={() => openLegal("/terms")} hitSlop={8} accessibilityRole="link">
              <Text style={styles.legalLink}>Terms of Use</Text>
            </Pressable>
            <Text style={styles.legalDot}>·</Text>
            <Pressable onPress={() => openLegal("/privacy")} hitSlop={8} accessibilityRole="link">
              <Text style={styles.legalLink}>Privacy Policy</Text>
            </Pressable>
          </View>
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
    plans: { alignSelf: "stretch", flexDirection: "row", gap: 10 },
    planCard: { flex: 1, alignItems: "center", gap: 2, paddingVertical: 16, paddingHorizontal: 8, borderRadius: radius.card, borderWidth: 1.5, borderColor: c.line, backgroundColor: c.card },
    planCardOn: { borderColor: c.pitch, backgroundColor: c.pitchPanel },
    badge: { position: "absolute", top: -10, backgroundColor: c.pitch, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2 },
    badgeText: { color: c.onPitch, fontSize: 11, fontFamily: "Inter_700Bold", fontWeight: "700" },
    planName: { color: c.muted, fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600", marginTop: 4 },
    planPrice: { color: c.text, fontSize: 22, ...headline },
    planPeriod: { color: c.muted, fontSize: 12, fontFamily: "Inter_400Regular" },
    planSave: { color: c.pitchText, fontSize: 12, fontFamily: "Inter_700Bold", fontWeight: "700", marginTop: 4 },
    unavailable: { alignItems: "center", gap: 6 },
    retry: { paddingVertical: 4 },
    renew: { color: c.text, fontSize: 13, fontFamily: "Inter_500Medium", textAlign: "center" },
    legalRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    legalLink: { color: c.accent, fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600", textDecorationLine: "underline" },
    legalDot: { color: c.muted, fontSize: 13 },
    fine: { color: c.muted, fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16, textAlign: "center" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
