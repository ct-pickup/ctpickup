import { Stack } from "expo-router";
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
  FIRST_REQUEST_FREE_COPY,
  formatPlanPrice,
  PLAN_IDS,
  PLANS,
  SEASON_COPY,
  yourPlanLine,
  type PlanId,
} from "@shared/fields/plans";

/**
 * Plans: Scout, Email and Concierge. Choose opens Stripe Checkout (test mode) in an in-app browser sheet, then the plan
 * status is refreshed when the sheet closes. Admin only for now. No Apple in-app purchase in this step.
 */
export default function PlansScreen() {
  useThemedStyles(publish_styles);
  const { session } = useAuth();
  const { isAdmin } = useProfileAdmin();
  const { status, refresh } = usePlanStatus();
  const [busy, setBusy] = useState<PlanId | null>(null);
  const current = status?.plan ?? null;
  const line = yourPlanLine(status);

  async function choose(plan: PlanId) {
    const token = session?.access_token;
    if (!token) return;
    setBusy(plan);
    try {
      const res = await startPlanCheckout(token, plan);
      if (!res.ok) {
        Alert.alert(res.code === "already_subscribed" ? "You already have a plan" : "Couldn’t start checkout", res.message);
        return;
      }
      await WebBrowser.openBrowserAsync(res.url);
      // The sheet closed. The webhook may take a moment, so check now and once more shortly after.
      await refresh();
      setTimeout(() => void refresh(), 3000);
    } finally {
      setBusy(null);
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
        <Text style={styles.bannerBody}>{status?.free_request_used === true ? "You’ve used it. Pick a plan for more." : "Try it before you pick a plan."}</Text>
      </View>

      <View style={styles.yours}>
        <Text style={styles.yoursLabel}>Your plan</Text>
        <Text style={styles.yoursTitle}>{line.title}</Text>
        <Text style={styles.muted}>{line.detail}</Text>
      </View>

      {PLAN_IDS.map((id) => {
        const p = PLANS[id];
        const mine = current === id;
        const extra = extraRequestLine(p);
        return (
          <View key={id} style={[styles.card, mine && styles.cardMine]}>
            <View style={styles.cardHead}>
              <Text style={styles.planName}>{p.name}</Text>
              <Text style={styles.price}>
                {formatPlanPrice(p.priceCents)}
                <Text style={styles.per}>/mo</Text>
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
            <Pressable
              onPress={() => void choose(id)}
              disabled={busy != null || mine}
              style={[styles.cta, (busy != null || mine) && styles.ctaOff]}
              accessibilityRole="button"
              accessibilityLabel={mine ? `${p.name}, your plan` : `Choose ${p.name}`}
            >
              {busy === id ? <ActivityIndicator color={themeColor().onPitch} /> : <Text style={styles.ctaText}>{mine ? "Your plan" : "Choose"}</Text>}
            </Pressable>
          </View>
        );
      })}

      <Text style={styles.foot}>{SEASON_COPY}</Text>
      <Text style={styles.foot}>{CREDIT_COPY}</Text>
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
    cardMine: { borderColor: c.pitchText, borderWidth: 2 },
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
