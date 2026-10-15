import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useFieldListing } from "@/hooks/useFieldListings";
import { FieldScreenShell } from "@/components/fields/FieldScreenShell";
import { RequestTracker } from "@/components/fields/RequestTracker";
import { formatRequestWhen } from "@shared/fields/requestEmail";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";

export default function FieldRequestSentScreen() {
  useThemedStyles(publish_styles);
  const router = useRouter();
  const { id, day, time, hours } = useLocalSearchParams<{ id: string; day?: string; time?: string; hours?: string; players?: string }>();
  const { listing: item } = useFieldListing(id);
  const when = day && time ? formatRequestWhen(day, time, Number(hours) || 2) : "the time you picked";

  return (
    <FieldScreenShell
      fallback="/(tabs)/sessions?view=fields"
      footer={
        <>
          <Pressable onPress={() => router.replace("/field-requests")} style={styles.cta} accessibilityRole="button">
            <Text style={styles.ctaText}>View my requests</Text>
          </Pressable>
          <Pressable onPress={() => router.replace("/(tabs)/sessions?view=fields")} style={styles.secondary} accessibilityRole="button">
            <Text style={styles.secondaryText}>Back to fields</Text>
          </Pressable>
        </>
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

      <RequestTracker status="new" />
    </FieldScreenShell>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    check: { width: 56, height: 56, borderRadius: 28, backgroundColor: c.pitch, alignItems: "center", justifyContent: "center" },
    title: { fontSize: 28, lineHeight: 32, ...headline, color: c.text },
    body: { fontSize: 16, fontFamily: "Inter_400Regular", color: c.text, lineHeight: 23 },
    secondary: { borderRadius: radius.button, paddingVertical: 14, alignItems: "center", borderWidth: 1, borderColor: c.line, backgroundColor: c.card },
    secondaryText: { color: c.text, fontSize: 15, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    cta: { backgroundColor: c.pitch, borderRadius: radius.button, paddingVertical: 16, alignItems: "center" },
    ctaText: { color: c.onPitch, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
