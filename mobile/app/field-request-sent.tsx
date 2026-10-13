import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { FieldScreenShell } from "@/components/fields/FieldScreenShell";
import { weekendDays, timeLabel } from "@/lib/fields/requestOptions";
import { getSampleField } from "@/lib/fields/sampleData";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";

const STEPS = [
  { title: "Received by Competitive Together", sub: "Just now", done: true },
  { title: "Sending to the venue", sub: "Facility-use request, sent by our team", done: false },
  { title: "Venue approves", sub: "We'll notify you", done: false },
  { title: "You're confirmed", sub: "Pay and invite your players", done: false },
] as const;

export default function FieldRequestSentScreen() {
  useThemedStyles(publish_styles);
  const router = useRouter();
  const { id, day, time } = useLocalSearchParams<{ id: string; day?: string; time?: string; players?: string }>();
  const item = getSampleField(id);
  const when = (weekendDays(new Date(), 8).find((d) => d.iso === day)?.long ?? day ?? "") + (time ? ` at ${timeLabel(time)}` : "");

  return (
    <FieldScreenShell
      fallback="/(tabs)/sessions"
      footer={
        <Pressable onPress={() => router.replace("/(tabs)/sessions")} style={styles.cta} accessibilityRole="button">
          <Text style={styles.ctaText}>Back to fields</Text>
        </Pressable>
      }
    >
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.check}>
        <FontAwesome name="check" size={26} color={themeColor().onPitch} />
      </View>
      <Text style={styles.title}>Request sent</Text>
      <Text style={styles.body}>
        We’re asking {item?.venue.name ?? "the venue"} for {when}. We’ll notify you the moment they reply. You aren’t charged until it’s approved.
      </Text>

      <View style={styles.steps}>
        {STEPS.map((s) => (
          <View key={s.title} style={styles.step}>
            <View style={[styles.dot, s.done && styles.dotDone]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.stepTitle, !s.done && styles.stepTitleTodo]}>{s.title}</Text>
              <Text style={styles.stepSub}>{s.sub}</Text>
            </View>
          </View>
        ))}
      </View>
      <Text style={styles.sample}>Sample data. Nothing was sent: saving requests comes in the next step.</Text>
    </FieldScreenShell>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    check: { width: 56, height: 56, borderRadius: 28, backgroundColor: c.pitch, alignItems: "center", justifyContent: "center" },
    title: { fontSize: 28, lineHeight: 32, ...headline, color: c.text },
    body: { fontSize: 16, fontFamily: "Inter_400Regular", color: c.text, lineHeight: 23 },
    steps: { gap: 18, padding: 16, backgroundColor: c.card, borderRadius: radius.card, borderWidth: 1, borderColor: c.line },
    step: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
    dot: { width: 14, height: 14, borderRadius: 7, marginTop: 3, borderWidth: 2, borderColor: c.line },
    dotDone: { backgroundColor: c.pitch, borderColor: c.pitch },
    stepTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: c.text },
    stepTitleTodo: { color: c.muted },
    stepSub: { fontSize: 13, fontFamily: "Inter_400Regular", color: c.muted },
    sample: { fontSize: 12, fontFamily: "Inter_500Medium", color: c.muted },
    cta: { backgroundColor: c.pitch, borderRadius: radius.button, paddingVertical: 16, alignItems: "center" },
    ctaText: { color: c.onPitch, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
