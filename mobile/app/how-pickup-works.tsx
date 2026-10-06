import { useNavigation } from "expo-router";
import { useEffect } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { themeColor, useThemedStyles } from "@/theme";
type Step = {
  number: string;
  title: string;
  body: string;
};

const STEPS: Step[] = [
  {
    number: "01",
    title: "Request Access",
    body: "Create your profile and get approved. Public runs are open to approved players in your region. Select runs are invite-only—you’ll get a notification when staff invites you.",
  },
  {
    number: "02",
    title: "Join or respond",
    body: "For public runs, request a spot first come first served. For select runs, tap the notification to confirm or decline when you’re invited.",
  },
  {
    number: "03",
    title: "Confirm Spot",
    body: "Once selected, you confirm your spot. Payment may be required to lock in.",
  },
  {
    number: "04",
    title: "Play",
    body: "Show up, compete, and stay consistent to maintain access to future runs.",
  },
];

const IMPORTANT_BULLETS: string[] = [
  "Spots are limited and fill quickly.",
  "Location is shared after confirmation.",
  "No-shows impact future eligibility.",
  "Reliability and level help you stay in the mix for future runs.",
];

export default function HowPickupWorksScreen() {
  useThemedStyles(publish_styles);

  const navigation = useNavigation();

  useEffect(() => {
    navigation.setOptions?.({
      title: "How pickup works",
      headerTitleAlign: "center",
      headerStyle: {
        backgroundColor: themeColor().bg,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: themeColor().line,
      },
      headerTintColor: themeColor().text,
      headerShadowVisible: false,
    });
  }, [navigation]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.kicker}>HOW IT WORKS</Text>
      <Text style={styles.lead}>
        A quick walkthrough of how pickup runs work from request to play day.
      </Text>

      {STEPS.map((step) => (
        <View key={step.number} style={styles.card}>
          <View style={styles.stepHeader}>
            <Text style={styles.stepNumber}>{step.number}</Text>
            <Text style={styles.stepTitle}>{step.title}</Text>
          </View>
          <Text style={styles.stepBody}>{step.body}</Text>
        </View>
      ))}

      <View style={[styles.card, styles.importantCard]}>
        <Text style={styles.importantLabel}>IMPORTANT</Text>
        <View style={styles.bulletList}>
          {IMPORTANT_BULLETS.map((item) => (
            <View key={item} style={styles.bulletRow}>
              <Text style={styles.bulletDot}>•</Text>
              <Text style={styles.bulletText}>{item}</Text>
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

function make_styles() {
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: themeColor().bg },
  content: { padding: 20, paddingBottom: 40 },
  kicker: {
    fontSize: 13, fontFamily: "Inter_700Bold",
    fontWeight: "800",
    color: themeColor().pitchText,
  },
  lead: {
    marginTop: 8,
    fontSize: 16, fontFamily: "Inter_400Regular",
    lineHeight: 22,
    color: themeColor().muted,
  },
  card: {
    marginTop: 12,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().card,
  },
  stepHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  stepNumber: {
    fontSize: 13, fontFamily: "Inter_700Bold",
    fontWeight: "800",
    color: themeColor().pitchText,
  },
  stepTitle: {
    fontSize: 16, fontFamily: "Inter_700Bold",
    fontWeight: "800",
    color: themeColor().text,
    flexShrink: 1,
  },
  stepBody: {
    marginTop: 8,
    fontSize: 14, fontFamily: "Inter_400Regular",
    lineHeight: 21,
    color: themeColor().muted,
  },
  importantCard: {
    marginTop: 20,
    borderColor: themeColor().pitchText,
    backgroundColor: themeColor().pitchPanel,
  },
  importantLabel: {
    fontSize: 13, fontFamily: "Inter_700Bold",
    fontWeight: "800",
    color: themeColor().pitchText,
  },
  bulletList: {
    marginTop: 12,
    gap: 8,
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  bulletDot: {
    fontSize: 14, fontFamily: "Inter_400Regular",
    lineHeight: 21,
    color: themeColor().pitchText,
    width: 10,
    textAlign: "center",
  },
  bulletText: {
    flex: 1,
    fontSize: 14, fontFamily: "Inter_400Regular",
    lineHeight: 21,
    color: themeColor().text,
  },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}

