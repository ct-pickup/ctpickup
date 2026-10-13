import { Stack, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { FieldScreenShell } from "@/components/fields/FieldScreenShell";
import { useAuth } from "@/context/AuthContext";
import { useProfileAdmin } from "@/context/ProfileAdminContext";
import { usePlanStatus } from "@/hooks/usePlanStatus";
import { startPlanCheckout } from "@/lib/fields/plansApi";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";
import {
  CREDIT_COPY,
  extraRequestLine,
  FIELD_FEES_COPY,
  FIRST_REQUEST_FREE_COPY,
  formatPlanPrice,
  PLAN_IDS,
  planPriceSuffix,
  PLANS,
  yourPlanLine,
} from "@shared/fields/plans";

/**
 * Plans (board 11): Book my season (highlighted, one-time), Concierge (monthly) and Do it yourself (free).
 * Concierge opens Stripe Checkout (test mode) in an in-app browser sheet and refreshes the plan status when it closes.
 * Book my season first collects the field, weekday, time and weeks. Admin only for now. No Apple in-app purchase.
 */
export default function PlansScreen() {
  useThemedStyles(publish_styles);
  const router = useRouter();
  const { session } = useAuth();
  const { isAdmin } = useProfileAdmin();
  const { status, seasons, refresh } = usePlanStatus();
  const [busy, setBusy] = useState(false);
  const isConcierge = status?.plan === "concierge";
  const line = yourPlanLine(status, seasons);

  async function chooseConcierge() {
    const token = session?.access_token;
    if (!token) return;
    setBusy(true);
    try {
      const res = await startPlanCheckout(token, { plan: "concierge" });
      if (!res.ok) {
        Alert.alert(res.code === "already_subscribed" ? "You already have Concierge" : "Couldn’t start checkout", res.message);
        return;
      }
      await WebBrowser.openBrowserAsync(res.url);
      // The sheet closed. The webhook may take a moment, so check now and once more shortly after.
      await refresh();
      setTimeout(() => void refresh(), 3000);
    } finally {
      setBusy(false);
    }
  }

  if (!isAdmin) {
    return (
      <FieldScreenShell fallback="/(tabs)/sessions?view=fields">
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.title}>Plans</Text>
        <Text style={styles.muted}>Plans aren’t available yet.</Text>
      </FieldScreenShell>
    );
  }

  return (
    <FieldScreenShell fallback="/(tabs)/sessions?view=fields">
      <Stack.Screen options={{ headerShown: false }} />
      <Text style={styles.title}>Plans</Text>

      <View style={styles.banner}>
        <Text style={styles.bannerTitle}>{FIRST_REQUEST_FREE_COPY}</Text>
        <Text style={styles.bannerBody}>{status?.free_request_used === true ? "You’ve used it. Pick a plan for more." : "Try it before you pay for anything."}</Text>
      </View>

      <View style={styles.yours}>
        <Text style={styles.yoursLabel}>Your plan</Text>
        <Text style={styles.yoursTitle}>{line.title}</Text>
        <Text style={styles.muted}>{line.detail}</Text>
      </View>

      {PLAN_IDS.map((id) => {
        const p = PLANS[id];
        const mine = (id === "concierge" && isConcierge) || (id === "free" && !isConcierge);
        const extra = extraRequestLine(p);
        const highlight = id === "season";
        return (
          <View key={id} style={[styles.card, highlight && styles.cardHighlight, mine && styles.cardMine]}>
            {highlight ? <Text style={styles.badge}>Best for a full season</Text> : null}
            <View style={styles.cardHead}>
              <Text style={styles.planName}>{p.name}</Text>
              <Text style={styles.price}>
                {formatPlanPrice(p.priceCents)}
                <Text style={styles.per}>{planPriceSuffix(p)}</Text>
              </Text>
            </View>
            <Text style={styles.muted}>{p.tagline}</Text>
            <View style={styles.features}>
              {p.features.map((f) => (
                <Text key={f} style={styles.feature}>
                  • {f}
                </Text>
              ))}
              {extra ? <Text style={styles.feature}>• {extra}</Text> : null}
            </View>
            {id === "free" ? (
              <View style={[styles.cta, styles.ctaOff]} accessibilityRole="text">
                <Text style={styles.ctaText}>{mine ? "Your plan" : "Included"}</Text>
              </View>
            ) : (
              <Pressable
                onPress={() => (id === "season" ? router.push("/season-book") : void chooseConcierge())}
                disabled={busy || mine}
                style={[styles.cta, (busy || mine) && styles.ctaOff]}
                accessibilityRole="button"
                accessibilityLabel={mine ? `${p.name}, your plan` : p.cta}
              >
                {busy && id === "concierge" ? <ActivityIndicator color={themeColor().onPitch} /> : <Text style={styles.ctaText}>{mine ? "Your plan" : p.cta}</Text>}
              </Pressable>
            )}
          </View>
        );
      })}

      <Text style={styles.foot}>{CREDIT_COPY}</Text>
      <Text style={styles.foot}>{FIELD_FEES_COPY}</Text>
      <Text style={styles.foot}>Test mode: use Stripe’s test card 4242 4242 4242 4242. No real charges.</Text>
    </FieldScreenShell>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    title: { fontSize: 28, lineHeight: 32, ...headline, color: c.text },
    muted: { fontSize: 14, fontFamily: "Inter_400Regular", color: c.muted, lineHeight: 20 },
    banner: { padding: 14, borderRadius: radius.card, backgroundColor: c.pitchPanel, gap: 2 },
    bannerTitle: { fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700", color: c.onPitchPanel },
    bannerBody: { fontSize: 14, fontFamily: "Inter_400Regular", color: c.onPitchPanel },
    yours: { padding: 14, borderRadius: radius.card, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, gap: 2 },
    yoursLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: c.muted },
    yoursTitle: { fontSize: 18, ...headline, color: c.text },
    card: { padding: 16, borderRadius: radius.card, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, gap: 8 },
    cardHighlight: { borderColor: c.pitchText, borderWidth: 2, backgroundColor: c.pitchPanel },
    cardMine: { borderColor: c.pitchText },
    badge: { alignSelf: "flex-start", fontSize: 11, fontFamily: "Inter_700Bold", fontWeight: "700", color: c.onPitch, backgroundColor: c.pitch, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, overflow: "hidden" },
    cardHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
    planName: { fontSize: 22, ...headline, color: c.text },
    price: { fontSize: 22, ...headline, color: c.text },
    per: { fontSize: 14, fontFamily: "Inter_500Medium", color: c.muted },
    features: { gap: 4 },
    feature: { fontSize: 14, fontFamily: "Inter_400Regular", color: c.text, lineHeight: 20 },
    cta: { marginTop: 4, backgroundColor: c.pitch, borderRadius: radius.button, paddingVertical: 13, alignItems: "center" },
    ctaOff: { opacity: 0.55 },
    ctaText: { color: c.onPitch, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
    foot: { fontSize: 13, fontFamily: "Inter_400Regular", color: c.muted, lineHeight: 18 },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
